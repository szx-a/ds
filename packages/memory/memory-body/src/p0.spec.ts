/**
 * P0 单元测试：迁移 + 群目录读写。
 *
 * 覆盖：
 * 1. 迁移：裸体目录（旧版「体在 root 下」）自动归入 general 群 + body.json 补 groupId。
 * 2. 迁移幂等：重复迁移无副作用。
 * 3. 群目录读写：writeGroup / readGroup / listGroups / deleteGroup。
 * 4. 体目录定位：体迁入群后，readBody/listBodyIds 能通过 findBodyDir 找到。
 *
 * 运行：node --test 本文件（用 node 内置 test runner，无外部依赖）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readBody, listBodyIds, listGroupIds, groupDir, type MemoryBody } from './store.ts'
import { writeGroup, readGroup, listGroups, deleteGroup } from './group.ts'
import { migrateBodiesToDefaultGroup, DEFAULT_GROUP_ID } from './migrate.ts'

/** 建一个旧版「体在 root 下」的裸体目录（模拟迁移前的两层布局）。 */
function makeBareBody(root: string, bodyId: string): void {
  const dir = join(root, bodyId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'body.json'), JSON.stringify({
    id: bodyId,
    name: bodyId,
    description: '',
    kind: 'fts',
    trust: 'user',
    createdAt: Date.now(),
  } satisfies Omit<MemoryBody, 'groupId'>) + '\n')
  writeFileSync(join(dir, 'entries.jsonl'), '')
}

test('迁移：裸体目录归入 general 群 + 补 groupId', () => {
  const root = mkdtempSync(join(tmpdir(), 'lma-p0-'))
  makeBareBody(root, 'code')
  makeBareBody(root, 'physics')

  const migrated = migrateBodiesToDefaultGroup(root)
  assert.deepEqual(migrated.sort(), ['code', 'physics'])

  // 体目录已移入 general 群下
  assert.ok(existsSync(join(groupDir(root, DEFAULT_GROUP_ID), 'code', 'body.json')))
  assert.ok(existsSync(join(groupDir(root, DEFAULT_GROUP_ID), 'physics', 'body.json')))
  // root 下不再有裸体目录
  assert.ok(!existsSync(join(root, 'code')))

  // body.json 已补 groupId
  const body = JSON.parse(readFileSync(join(groupDir(root, DEFAULT_GROUP_ID), 'code', 'body.json'), 'utf8'))
  assert.equal(body.groupId, DEFAULT_GROUP_ID)
})

test('迁移幂等：重复迁移无副作用', () => {
  const root = mkdtempSync(join(tmpdir(), 'lma-p0-'))
  makeBareBody(root, 'code')

  migrateBodiesToDefaultGroup(root)
  const second = migrateBodiesToDefaultGroup(root)
  assert.deepEqual(second, []) // 第二次无裸体目录，返回空

  // 体仍只有一个，且 groupId 正确
  assert.equal(JSON.parse(readFileSync(join(groupDir(root, DEFAULT_GROUP_ID), 'code', 'body.json'), 'utf8')).groupId, DEFAULT_GROUP_ID)
})

test('群目录读写 + 删除', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lma-p0-'))
  await writeGroup(root, { id: 'physics', name: 'Physics', description: '物理域', createdAt: Date.now() })

  const groups = await listGroups(root)
  assert.deepEqual(groups, ['physics'])

  const g = await readGroup(root, 'physics')
  assert.equal(g?.name, 'Physics')

  await deleteGroup(root, 'physics')
  assert.deepEqual(await listGroups(root), [])
})

test('体迁入群后，readBody/listBodyIds 能定位', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lma-p0-'))
  makeBareBody(root, 'code')
  migrateBodiesToDefaultGroup(root)

  const ids = await listBodyIds(root)
  assert.deepEqual(ids, ['code'])

  const body = await readBody(root, 'code')
  assert.equal(body?.groupId, DEFAULT_GROUP_ID)
  assert.equal(body?.id, 'code')

  assert.deepEqual(await listGroupIds(root), [DEFAULT_GROUP_ID])
})

test('合法 id 校验：非法群 id 报错', () => {
  const root = mkdtempSync(join(tmpdir(), 'lma-p0-'))
  assert.throws(() => groupDir(root, '../evil'), /invalid memory group id/)
})
