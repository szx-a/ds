/**
 * preset 侧自动总结触发：agent 每个 turn 结束（running→idle）时，消息数达阈值自动总结进记忆体。
 * 复用 host 包的 summarizeIntoBody；失败静默写日志，绝不打断会话；默认关闭。
 *
 * @module @szx-a/dsh-layered-memory-architecture-preset/auto-summarize
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { summarizeIntoBody } from '@szx-a/dsh-layered-memory-architecture/summarize'
import type { MemoryStore } from '@szx-a/dsh-layered-memory-architecture/memory-store'

const MIN_MESSAGES = 15
const MIN_GAP = 10

export function registerAutoSummarize(ctx: Context, store: MemoryStore, enabled: boolean): void {
  if (!enabled) return
  const lastSummarized = new WeakMap<Agent, number>()

  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle') return
    const bodies = store.mountedFor(agent)
    if (bodies.length === 0) return
    const length = agent.session.deriveMessages().length
    const last = lastSummarized.get(agent) ?? 0
    if (length < MIN_MESSAGES || length - last < MIN_GAP) return

    const bodyId = bodies[0]
    if (bodyId === undefined) return
    void summarizeIntoBody(ctx, store, bodyId, agent).then((result) => {
      if (result.ok) {
        lastSummarized.set(agent, length)
      } else {
        ctx.logger.warn(`memory-body auto-summarize skipped: ${result.reason}`)
      }
    }).catch((error: unknown) => {
      ctx.logger.warn(`memory-body auto-summarize failed: ${String(error)}`)
    })
  }, { global: true })
}
