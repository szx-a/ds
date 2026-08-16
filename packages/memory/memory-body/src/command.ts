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
import { BODY_ID } from './store.ts'

/* ------------------------------------------------------------------ /remember */

async function executeRemember(
  _ctx: Context,
  store: MemoryStore,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  const parsed = parseRemember(invocation.rawInput, store.mountedFor(invocation.agent))
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

  // 可选目标体：/summarize <体id> 或 /summarize（默认第一个挂载体）
  const bodyId = parseSummarizeBody(invocation.rawInput, mounted)
  const body = await store.readBody(bodyId)
  if (body === undefined) return { kind: 'error', text: `Memory body ${JSON.stringify(bodyId)} does not exist.` }

  const result = await summarizeIntoBody(ctx, store, bodyId, agent, invocation.signal)
  if (!result.ok) {
    return { kind: 'error', text: `Summarization failed: ${result.reason}. Nothing stored.` }
  }
  return { kind: 'success', text: `Summarized into body ${JSON.stringify(bodyId)} (entry ${result.entryId}).` }
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

const MOUNT_USAGE = 'Usage: /mount <体id>'

/** 把某个体挂到当前会话（只影响当前会话，数据持久、挂载临时）。 */
async function executeMount(
  store: MemoryStore,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  const owner = invocation.agent
  if (owner === undefined) return { kind: 'error', text: '/mount requires an owning agent session.' }
  const bodyId = invocation.rawInput.trim()
  if (bodyId.length === 0 || !BODY_ID.test(bodyId)) return { kind: 'error', text: MOUNT_USAGE }
  const body = await store.readBody(bodyId)
  if (body === undefined) return { kind: 'error', text: `Memory body ${JSON.stringify(bodyId)} does not exist.` }
  store.mount(bodyId, owner)
  return { kind: 'success', text: `Mounted body ${JSON.stringify(bodyId)} for this session.` }
}

/** 从当前会话卸下某个体（不删数据，只是本会话不再检索它）。 */
async function executeUnmount(
  store: MemoryStore,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  const owner = invocation.agent
  if (owner === undefined) return { kind: 'error', text: '/unmount requires an owning agent session.' }
  const bodyId = invocation.rawInput.trim()
  if (bodyId.length === 0 || !BODY_ID.test(bodyId)) return { kind: 'error', text: 'Usage: /unmount <体id>' }
  store.unmount(bodyId, owner)
  return { kind: 'success', text: `Unmounted body ${JSON.stringify(bodyId)} for this session.` }
}

/* ------------------------------------------------------------------ 注册 */

export function registerCommands(ctx: Context, store: MemoryStore): void {
  ctx.effect(function* () {
    yield ctx.commands.register({
      name: 'remember',
      description: 'Store a durable document/note into a mounted memory body',
      input: { hint: '内容（可先写体 id 再写内容）' },
      handler: (invocation) => executeRemember(ctx, store, invocation),
    })
    yield ctx.commands.register({
      name: 'summarize',
      description: 'Summarize the current conversation into a mounted memory body',
      input: { hint: '可选体 id（留空用默认体）' },
      handler: (invocation) => executeSummarize(ctx, store, invocation),
    })
    yield ctx.commands.register({
      name: 'forget',
      description: 'Retire a memory entry matching a keyword (mark superseded, not deleted)',
      input: { hint: '关键词' },
      handler: (invocation) => executeForget(store, invocation),
    })
    yield ctx.commands.register({
      name: 'mount',
      description: 'Mount a memory body into the current session (visible to memory_search)',
      input: { hint: '体 id' },
      handler: (invocation) => executeMount(store, invocation),
    })
    yield ctx.commands.register({
      name: 'unmount',
      description: 'Unmount a memory body from the current session (data kept, just not searched)',
      input: { hint: '体 id' },
      handler: (invocation) => executeUnmount(store, invocation),
    })
  }, 'memory-body commands lifecycle')
}
