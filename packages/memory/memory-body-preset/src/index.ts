/**
 * preset 侧入口：namespace plugin，注册模型面向的工具（memory_search/memory_remember）与自动总结。
 * 存储走 host 平面的 MemoryStore（inject），命令在 host 包（照 command-goal 先例）。
 *
 * @module @szx-a/dsh-layered-memory-architecture-preset
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { MemoryStore } from '@szx-a/dsh-layered-memory-architecture/memory-store'
import { registerSearchTool, registerRememberTool, registerForgetTool, registerCorrectTool } from './tool.ts'
import { registerAutoSummarize } from './auto-summarize.ts'

export const name = 'memory-body-preset'
export const inject = ['memoryStore', 'tools', 'llm']

export interface Config {
  /** 是否启用自动总结，默认关。 */
  autoSummarize?: boolean
}

export const Config: z<Config> = z.object({
  autoSummarize: z.boolean().default(false),
})

export function apply(ctx: Context, config: Config): void {
  const store = ctx.memoryStore as MemoryStore
  registerSearchTool(ctx, store)
  registerRememberTool(ctx, store)
  registerForgetTool(ctx, store)
  registerCorrectTool(ctx, store)
  registerAutoSummarize(ctx, store, config.autoSummarize === true)
}
