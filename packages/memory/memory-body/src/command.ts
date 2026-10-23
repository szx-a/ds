/**
 * 命令层：/remember（存文档）、/summarize（总结，复用 summarize.ts）、/forget（降权）。
 * 命令在 host 平面（照 command-goal 先例），通过 MemoryStore 访问存储。
 *
 * 照 command-compact 的注册方式：ctx.commands.register({ name, description, handler })。
 * handler 返回 CommandResult（success/error + text）。
 *
 * @module dsh-memory-body/command
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { MemoryStore } from './memory-store.ts'
import { summarizeIntoBody } from './summarize.ts'
import { parseRemember, parseSummarizeBody } from './parse.ts'

/* ------------------------------------------------------------------ /remember */

async function executeRemember(
  _ctx: Context,
  store: MemoryStore,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  const bodyIds = await store.mountedBodies(invocation.agent)
  const parsed = parseRemember(invocation.rawInput, bodyIds)
  if (typeof parsed === 'string') return { kind: 'error', text: parsed }
  const body = await store.readBody(parsed.bodyId)
  if (body === undefined) return { kind: 'error', text: `Memory body ${JSON.stringify(parsed.bodyId)} does not exist.` }
  const entry = await store.appendEntry({
    bodyId: parsed.bodyId,
    authority: 'user',
    content: parsed.content,
    weight: 1,
    status: 'active',
  })
  return { kind: 'success', text: `Remembered into body ${JSON.stringify(parsed.bodyId)} (entry ${entry.id}).` }
}

/* ------------------------------------------------------------------ /summarize */

async function executeSummarize(
  ctx: Context,
  store: MemoryStore,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  const agent = invocation.agent
  if (agent === undefined) return { kind: 'error', text: '/summarize requires an owning agent session.' }
  const mounted = store.mountedFor(agent)
  if (mounted.length === 0) return { kind: 'error', text: 'No memory body mounted. Configure `defaultBodies` in cordis.yml first.' }

  // 可选目标体：/summarize <体id> 或 /summarize（默认第一个挂载体）；挂群展开为所有体。
  const bodyIds = await store.mountedBodies(agent)
  const rawBodyId = parseSummarizeBody(invocation.rawInput, bodyIds)
  const body = await store.readBody(rawBodyId)
  if (body === undefined) return { kind: 'error', text: `Memory body ${JSON.stringify(rawBodyId)} does not exist.` }

  const result = await summarizeIntoBody(ctx, store, rawBodyId, agent, invocation.signal)
  if (!result.ok) {
    return { kind: 'error', text: `Summarization failed: ${result.reason}. Nothing stored.` }
  }
  return { kind: 'success', text: `Summarized into body ${JSON.stringify(rawBodyId)} (entry ${result.entryId}).` }
}

/* ------------------------------------------------------------------ /forget */

const FORGET_USAGE = 'Usage: /forget <关键词>'

/** 把匹配关键词的活跃条目标记为废弃（降权不删除，物理保留、可追溯）。 */
async function executeForget(
  store: MemoryStore,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  const query = invocation.rawInput.trim()
  if (query.length === 0) return { kind: 'error', text: FORGET_USAGE }
  const mounted = store.mountedFor(invocation.agent)
  if (mounted.length === 0) return { kind: 'error', text: 'No memory body mounted.' }
  const needle = query.toLowerCase()
  let retired = 0
  for (const bodyId of mounted) {
    const entries = await store.readEntries(bodyId)
    for (const entry of entries) {
      if (entry.status === 'active' && entry.weight > 0 && entry.content.toLowerCase().includes(needle)) {
        await store.retireEntry(entry)
        retired++
      }
    }
  }
  if (retired === 0) return { kind: 'success', text: `No active memory matched ${JSON.stringify(query)}.` }
  return {
    kind: 'success',
    text: `Retired ${retired} memor${retired === 1 ? 'y' : 'ies'} matching ${JSON.stringify(query)} (kept in history, not deleted).`,
  }
}

/* ------------------------------------------------------------------ /mount /unmount */

const MOUNT_USAGE = 'Usage: /mount <群id> 或 /mount <群id>/<体id>'

/** 挂载目标路径：单段 = 群，两段 = group/body（均小写字母数字 + 连字符）。 */
const MOUNT_PATH = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)?$/

/** 把某个群或体挂到当前会话（只影响当前会话，数据持久、挂载临时）。 */
async function executeMount(
  store: MemoryStore,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  const owner = invocation.agent
  if (owner === undefined) return { kind: 'error', text: '/mount requires an owning agent session.' }
  const target = invocation.rawInput.trim()
  if (target.length === 0 || !MOUNT_PATH.test(target)) return { kind: 'error', text: MOUNT_USAGE }
  if (!await store.mountTargetExists(target)) {
    return { kind: 'error', text: `Mount target ${JSON.stringify(target)} does not exist (no such group or body).` }
  }
  store.mount(target, owner)
  const kind = target.includes('/') ? 'body' : 'group'
  return { kind: 'success', text: `Mounted ${kind} ${JSON.stringify(target)} for this session.` }
}

/** 从当前会话卸下某个群或体（不删数据，只是本会话不再检索它）。 */
async function executeUnmount(
  store: MemoryStore,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  const owner = invocation.agent
  if (owner === undefined) return { kind: 'error', text: '/unmount requires an owning agent session.' }
  const target = invocation.rawInput.trim()
  if (target.length === 0 || !MOUNT_PATH.test(target)) return { kind: 'error', text: 'Usage: /unmount <群id 或 群id/体id>' }
  store.unmount(target, owner)
  return { kind: 'success', text: `Unmounted ${JSON.stringify(target)} for this session.` }
}

/* ------------------------------------------------------------------ 注册 */

export function registerCommands(ctx: Context, store: MemoryStore): void {
  ctx.effect(function* () {
    yield ctx.commands.register({
      name: 'remember',
      description: 'Store a durable document/note into a mounted memory body',
      input: { hint: '内容（可先写体 id 再写内容）' },
      handler: invocation => executeRemember(ctx, store, invocation),
    })
    yield ctx.commands.register({
      name: 'summarize',
      description: 'Summarize the current conversation into a mounted memory body',
      input: { hint: '可选体 id（留空用默认体）' },
      handler: invocation => executeSummarize(ctx, store, invocation),
    })
    yield ctx.commands.register({
      name: 'forget',
      description: 'Retire a memory entry matching a keyword (mark superseded, not deleted)',
      input: { hint: '关键词' },
      handler: invocation => executeForget(store, invocation),
    })
    yield ctx.commands.register({
      name: 'mount',
      description: 'Mount a memory group or body into the current session (visible to memory_search)',
      input: { hint: '群 id 或 群id/体id' },
      handler: invocation => executeMount(store, invocation),
    })
    yield ctx.commands.register({
      name: 'unmount',
      description: 'Unmount a memory group or body from the current session (data kept, just not searched)',
      input: { hint: '群 id 或 群id/体id' },
      handler: invocation => executeUnmount(store, invocation),
    })
  }, 'memory-body commands lifecycle')
}
