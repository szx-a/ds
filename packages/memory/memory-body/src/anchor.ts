/**
 * 公理锚向量的二进制持久化（.vec 文件）。
 *
 * 格式：纯 Float32Array 裸写（无 header），维度 = byteLength / 4。
 * 用二进制而非 JSON number[]，避免高维向量在 JSON 里体积爆炸（用户确认）。
 *
 * 路径约定：
 * - 群锚：<group>/anchor.vec
 * - 体锚：<group>/<body>/anchor.vec
 *
 * 锚向量是「公理锚」而非「质心」：创建群/体时由 embedder.anchor(概念) 定义，
 * 稳定不漂移（归属关系是刚性公理，锚是内容、边界内可演化——P4 处理演化）。
 *
 * @module dsh-memory-body/anchor
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { groupDir, bodyDirInGroup } from './store.ts'

/** 写一个锚向量到二进制 .vec 文件。 */
export function writeAnchor(path: string, vector: readonly number[]): void {
  const f32 = new Float32Array(vector.length)
  for (let i = 0; i < vector.length; i++) f32[i] = vector[i] ?? 0
  writeFileSync(path, Buffer.from(f32.buffer))
}

/** 读一个锚向量（不存在返回空数组）。 */
export function readAnchor(path: string): number[] {
  if (!existsSync(path)) return []
  const buf = readFileSync(path)
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))
  return Array.from(f32)
}

/** 群锚向量文件路径。 */
export function groupAnchorPath(root: string, groupId: string): string {
  return join(groupDir(root, groupId), 'anchor.vec')
}

/** 体锚向量文件路径。 */
export function bodyAnchorPath(root: string, groupId: string, bodyId: string): string {
  return join(bodyDirInGroup(root, groupId, bodyId), 'anchor.vec')
}
