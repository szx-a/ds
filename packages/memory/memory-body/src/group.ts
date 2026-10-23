/**
 * 群（族）存储层：顶层领域隔离域的 JSON 读写。
 *
 * 目录布局（"目录即群" + "目录即体" 的层级延续）：
 *
 *   <root>/
 *     <groupId-encoded>/          # 一个群 = 一个目录，目录名 = 编码后的群 id
 *       group.json                # 群元数据（name/description/anchorRef）—— 用户可手改
 *       <bodyId-encoded>/         # 群下的体目录（归属刚性：体物理存在于群内）
 *
 * 设计原则（延续 store.ts）：
 * - 权威层是【可读写的文本文件】，不是 SQLite。
 * - 群是"归属关系"的物理载体：体在哪个群目录下，就属于哪个群（物理隔离）。
 * - 群/体增删是主权事件：人工自由，AI 增删需人工批准（P4 实现面板，此处先提供读写）。
 * - 所有路径经 encodeSegment 编码，防目录穿越。
 *
 * @module dsh-memory-body/group
 */

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { GROUP_ID, groupDir } from './store.ts'

/** 一个记忆群（族）：顶层领域隔离域。 */
export interface MemoryGroup {
  id: string
  name: string
  description: string
  /** 群公理锚向量的二进制文件引用（P3 实现；P0 阶段留空，可手填）。 */
  anchorRef?: string
  createdAt: number
}

/* ------------------------------------------------------------------ 路径 */

function groupMetaPath(root: string, groupId: string): string {
  return join(groupDir(root, groupId), 'group.json')
}

/* ------------------------------------------------------------------ 群元数据 */

/** 列出 root 下所有群目录（只认合法 id 的目录）。 */
export async function listGroups(root: string): Promise<string[]> {
  let children: string[]
  try {
    children = await readdir(root)
  } catch {
    return []
  }
  const ids: string[] = []
  for (const child of children) {
    if (GROUP_ID.test(child)) ids.push(child)
  }
  return ids.sort()
}

/** 读一个群的元数据；不存在返回 undefined。 */
export async function readGroup(root: string, groupId: string): Promise<MemoryGroup | undefined> {
  try {
    const text = await readFile(groupMetaPath(root, groupId), 'utf8')
    const parsed = JSON.parse(text) as MemoryGroup
    if (parsed.id !== groupId) {
      throw new Error(`group.json id mismatch: expected ${groupId}, got ${parsed.id}`)
    }
    return parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** 写一个群的元数据（创建或覆盖）。 */
export async function writeGroup(root: string, group: MemoryGroup): Promise<void> {
  if (group.id !== group.id.trim() || !GROUP_ID.test(group.id)) {
    throw new Error(`invalid memory group id: ${JSON.stringify(group.id)}`)
  }
  await mkdir(groupDir(root, group.id), { recursive: true, mode: 0o700 })
  await writeFile(groupMetaPath(root, group.id), JSON.stringify(group, null, 2) + '\n')
}

/** 删除一个群（连同群下所有体）。不存在则 no-op。 */
export async function deleteGroup(root: string, groupId: string): Promise<void> {
  await rm(groupDir(root, groupId), { recursive: true, force: true })
}

/** 解析 root 为绝对路径（供插件在 apply 时调用）。 */
export function resolveGroupRoot(root: string): string {
  return resolve(root)
}
