/**
 * /remember 与 /summarize 的输入解析纯函数（无 cordis/LLM 依赖，可独立测试）。
 * @module dsh-memory-body/parse
 */

import { BODY_ID } from './store.ts'

export const REMEMBER_USAGE = 'Usage: /remember <内容>  或  /remember <体id> <内容>'

export type ParsedRemember = { bodyId: string; content: string }

/** 无挂载体的统一错误文案。 */
const NO_MOUNTED = 'No memory body mounted. Run /mount <bodyId> first (or configure defaultBodies in cordis.yml).'

/**
 * 解析 /remember 的输入：可选体 id + 必填内容。
 * - `/remember <体id> <内容>`：第一段是已挂载的体 id → 写入该体。
 * - `/remember <内容>`：整体是内容 → 写入默认体（挂载集第一个）。
 * - 空输入 / 无挂载体 → 返回人类可读的错误字符串。
 */
export function parseRemember(rawInput: string, mounted: string[]): ParsedRemember | string {
  const parts = rawInput.trim().split(/\s+/)
  const first = parts[0] ?? ''
  if (parts.length === 0 || (parts.length === 1 && first === '')) return REMEMBER_USAGE
  if (parts.length >= 2 && mounted.includes(first)) {
    return { bodyId: first, content: parts.slice(1).join(' ') }
  }
  // 第一段长得像体 id（全小写字母数字/连字符）却不在挂载集 → 明确报错，而非静默当文本。
  if (parts.length >= 2 && BODY_ID.test(first)) {
    return `Memory body ${JSON.stringify(first)} is not mounted. Run /mount ${first} first.`
  }
  const defaultBody = mounted[0]
  if (defaultBody === undefined) return NO_MOUNTED
  return { bodyId: defaultBody, content: parts.join(' ') }
}

/** 解析 /summarize 的可选目标体：`/summarize <体id>` 或 `/summarize`（默认第一个挂载体）。 */
export function parseSummarizeBody(rawInput: string, mounted: string[]): string {
  const rawBody = rawInput.trim()
  if (rawBody.length > 0 && mounted.includes(rawBody)) return rawBody
  return mounted[0] ?? ''
}
