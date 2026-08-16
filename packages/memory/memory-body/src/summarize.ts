/**
 * 总结共享逻辑：把当前会话提炼成一条经验，写入指定记忆体。
 * 供 /summarize 命令与自动总结触发共用（避免两处重复）。
 *
 * 返回 result 而非 throw，让自动触发能静默处理失败（写日志），
 * 而 /summarize 能把 reason 转成用户可见的错误消息。
 *
 * @module dsh-memory-body/summarize
 */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, FinishReason, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { MemoryStore } from './memory-store.ts'

export const SUMMARIZE_INSTRUCTION = [
  'You are now acting as a memory-extraction engine for this AI coding assistant. Read the conversation ABOVE and extract the durable, reusable knowledge that a future session in the SAME project would need.',
  '',
  'Focus on:',
  '- reusable experience and workflows (how a task was done, what worked, what failed and why)',
  '- project facts and decisions the user confirmed',
  '- pitfalls and their fixes',
  '',
  'Output EXACTLY one or more terse Markdown bullet lines. Write concise engineering prose in the conversation language. Preserve exact file paths, commands, identifiers, and error strings. Do NOT mention this summarization request. Do not call any tool.',
].join('\n')

export type SummarizeResult =
  | { ok: true; entryId: string }
  | { ok: false; reason: string }

/** 从 agent 解析可用的 provider/model（照 compaction-basic/summarizer 的 fallback 链）。 */
function resolveTarget(agent: Agent): { provider: string; model: string } | undefined {
  const latest = agent.session.requestHeader()?.config
  if (latest?.provider !== undefined && latest.model !== undefined) {
    return { provider: latest.provider, model: latest.model }
  }
  if (agent.options.provider !== undefined && agent.options.model !== undefined) {
    return { provider: agent.options.provider, model: agent.options.model }
  }
  return undefined
}

/** 终止原因是否"干净"（非 error/aborted/max-tokens，即总结完整落盘才可存）。 */
function isCleanFinish(finish: FinishReason): boolean {
  return finish.kind !== 'error' && finish.kind !== 'aborted' && finish.kind !== 'max-tokens'
}

function textContent(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/**
 * 把 agent 当前会话提炼成一条经验，写入 `bodyId` 记忆体。
 * @returns 成功（entryId）或失败（reason，不 throw）。
 */
export async function summarizeIntoBody(
  ctx: Context,
  store: MemoryStore,
  bodyId: string,
  agent: Agent,
  signal?: AbortSignal,
): Promise<SummarizeResult> {
  const target = resolveTarget(agent)
  if (target === undefined) return { ok: false, reason: 'no provider/model available' }

  const history = agent.session.deriveMessages()
  if (history.length === 0) return { ok: false, reason: 'no conversation history' }

  const messages: Message[] = [
    ...history,
    createUserMessage({
      content: [{ type: 'text', text: SUMMARIZE_INSTRUCTION }],
      source: { kind: 'plugin', plugin: 'dsh-memory-body' },
    }),
  ]
  const options: GenerateOptions = {
    provider: target.provider,
    model: target.model,
    messages,
    sessionId: agent.session.id,
    ...signal === undefined ? {} : { signal },
  }
  const assembler = new BlockAssembler()
  for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk)

  if (!isCleanFinish(assembler.finish)) {
    return { ok: false, reason: `summarization did not finish cleanly (${assembler.finish.kind})` }
  }
  const content = textContent(assembler.blocks())
  if (content.trim().length === 0) {
    return { ok: false, reason: 'summarization produced no text' }
  }
  const entry = await store.appendEntry({
    bodyId,
    authority: 'model',
    content: content.trim(),
    provenanceSession: agent.session.id,
    weight: 1,
    status: 'active',
  })
  return { ok: true, entryId: entry.id }
}
