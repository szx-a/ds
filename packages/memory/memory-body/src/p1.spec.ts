/**
 * P1 单元测试：群级挂载目标展开（expandMountTargets）。
 *
 * 覆盖：
 * 1. 单段群 id → 展开为群下所有体。
 * 2. 两段 group/body → 展开为该体。
 * 3. 旧式单段体 id → 扫描定位归属群。
 * 4. 不存在的目标 → 返回空。
 *
 * 运行：node --import tsx --test 本文件。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expandMountTargets } from './store.ts'
import { writeGroup } from './group.ts'
import { migrateBodiesToDefaultGroup, DEFAULT_GROUP_ID } from './migrate.ts'

/** 建一个群 + 群里两个体。 */
async function makeGroupWithBodies(root: string, groupId: string, bodyIds: string[]): Promise<void> {
  await writeGroup(root, { id: groupId, name: groupId, description: '', createdAt: Date.now() })
  const groupDir = join(root, groupId)
  mkdirSync(groupDir, { recursive: true })
  for (const bodyId of bodyIds) {
    const dir = join(groupDir, bodyId)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'body.json'), JSON.stringify({ id: bodyId, groupId, name: bodyId, description: '', kind: 'fts', trust: 'user', createdAt: Date.now() }) + '\n')
  }
}

test('单段群 id 展开为群下所有体', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lma-p1-'))
  await makeGroupWithBodies(root, 'physics', ['quantum', 'relativity'])

  const mounts = await expandMountTargets(root, ['physics'])
  assert.deepEqual(mounts.map(m => `${m.groupId}/${m.bodyId}`).sort(), ['physics/quantum', 'physics/relativity'])
})

test('两段 group/body 展开为该体', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lma-p1-'))
  await makeGroupWithBodies(root, 'physics', ['quantum', 'relativity'])

  const mounts = await expandMountTargets(root, ['physics/quantum'])
  assert.deepEqual(mounts, [{ groupId: 'physics', bodyId: 'quantum' }])
})

test('旧式单段体 id 扫描定位归属群', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lma-p1-'))
  // 模拟 P0 迁移后的布局：体在 general 群下
  await makeGroupWithBodies(root, 'general', ['code'])

  const mounts = await expandMountTargets(root, ['code'])
  assert.deepEqual(mounts, [{ groupId: 'general', bodyId: 'code' }])
})

test('不存在的目标返回空', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lma-p1-'))
  await makeGroupWithBodies(root, 'physics', ['quantum'])

  const mounts = await expandMountTargets(root, ['nonexistent'])
  assert.deepEqual(mounts, [])
})

test('混合目标：群 + 体 + 旧式体 id 一起展开', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lma-p1-'))
  await makeGroupWithBodies(root, 'physics', ['quantum', 'relativity'])
  await makeGroupWithBodies(root, 'general', ['code'])

  const mounts = await expandMountTargets(root, ['physics', 'physics/quantum', 'code'])
  const keys = mounts.map(m => `${m.groupId}/${m.bodyId}`).sort()
  assert.deepEqual(keys, ['general/code', 'physics/quantum', 'physics/quantum', 'physics/relativity'])
})

test('migrate 后 expandMountTargets 能定位旧体', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lma-p1-'))
  // 建旧版裸体目录
  const bare = join(root, 'code')
  mkdirSync(bare, { recursive: true })
  writeFileSync(join(bare, 'body.json'), JSON.stringify({ id: 'code', name: 'code', description: '', kind: 'fts', trust: 'user', createdAt: Date.now() }) + '\n')
  writeFileSync(join(bare, 'entries.jsonl'), '')

  // P0 迁移
  migrateBodiesToDefaultGroup(root)

  // P1 旧式单段体 id 定位
  const mounts = await expandMountTargets(root, ['code'])
  assert.deepEqual(mounts, [{ groupId: DEFAULT_GROUP_ID, bodyId: 'code' }])
})
