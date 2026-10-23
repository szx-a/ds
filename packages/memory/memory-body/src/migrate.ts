/**
 * 迁移：现有「体-词条」两层 → 「群-体-词条」三层。
 *
 * 规则（幂等，可重复执行）：
 * - 检测 root 下的「裸体目录」（不在任何群下的体目录，旧版两层遗留）。
 * - 若存在，自动建 default 群（general）并把裸体目录移入，body.json 补 groupId。
 * - 无裸体目录则 no-op（重复启动无副作用）。
 *
 * 迁移是纯目录移动 + 字段补充，JSONL 事件流原样保留，历史零丢失、可回退。
 *
 * 用同步 fs：迁移在 MemoryStore 构造时同步执行，必须在任何读操作前完成
 * （否则迁移前 findBodyDir 扫不到根下的裸体目录）。
 *
 * @module dsh-memory-body/migrate
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BODY_ID, bodyDirInGroup, groupDir, type MemoryBody } from './store.ts'

/** 默认群 id（迁移时现有体归入此群）。 */
export const DEFAULT_GROUP_ID = 'general'

/**
 * 检测并迁移裸体目录到 default 群。返回迁移的体 id 列表（无迁移返回空数组）。
 * 幂等：只处理 root 下直接子级、不在任何群下的裸体目录。
 */
export function migrateBodiesToDefaultGroup(root: string): string[] {
  // 1. 扫描 root 下所有直接子级，找出裸体目录（合法 body id 且不是群目录）。
  let children: string[]
  try {
    children = readdirSync(root)
  } catch {
    return []
  }
  const bareBodyIds: string[] = []
  for (const child of children) {
    if (!BODY_ID.test(child)) continue
    const childDir = join(root, child)
    // 是群目录：含 group.json（新版群在 root 下），跳过。
    if (existsSync(join(childDir, 'group.json'))) continue
    // 是裸体目录：含 body.json 但无 group.json（旧版「体在 root 下」），迁移。
    if (existsSync(join(childDir, 'body.json'))) {
      bareBodyIds.push(child)
    }
  }
  if (bareBodyIds.length === 0) return []

  // 2. 确保 default 群存在。
  const groupPath = groupDir(root, DEFAULT_GROUP_ID)
  mkdirSync(groupPath, { recursive: true, mode: 0o700 })
  const groupMetaPath = join(groupPath, 'group.json')
  if (!existsSync(groupMetaPath)) {
    writeFileSync(
      groupMetaPath,
      JSON.stringify({
        id: DEFAULT_GROUP_ID,
        name: 'General 通用域',
        description: '迁移前已有的记忆体归入此群（自动创建）。',
        createdAt: Date.now(),
      }, null, 2) + '\n',
    )
  }

  // 3. 逐个迁移裸体目录：移动到 default 群下 + body.json 补 groupId。
  const migrated: string[] = []
  for (const bodyId of bareBodyIds) {
    const from = join(root, bodyId)
    const to = bodyDirInGroup(root, DEFAULT_GROUP_ID, bodyId)
    // 目标已存在则跳过移动（幂等），但仍补 groupId。
    if (!existsSync(join(to, 'body.json'))) {
      renameSync(from, to)
    }
    // 补 body.json 的 groupId（若缺失）。
    const bodyMetaPath = join(to, 'body.json')
    try {
      const body = JSON.parse(readFileSync(bodyMetaPath, 'utf8')) as MemoryBody
      if (body.groupId !== DEFAULT_GROUP_ID) {
        body.groupId = DEFAULT_GROUP_ID
        writeFileSync(bodyMetaPath, JSON.stringify(body, null, 2) + '\n')
      }
    } catch {
      // body.json 缺失或损坏时，跳过字段补充（目录移动已完成，体仍可被发现）。
    }
    migrated.push(bodyId)
  }
  return migrated
}
