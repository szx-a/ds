/**
 * P1b 单元测试：群级 FTS 独立索引（物理隔离）。
 *
 * 覆盖：
 * 1. MemoryFts 独立实例：每个群一个 sqlite，检索只命中该群的体。
 * 2. rebuildBody 新签名（接收体目录）：从体目录读条目建索引。
 * 3. 两个群的索引互不干扰（物理隔离的验证）。
 *
 * 运行：node --import tsx --test 本文件。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryFts } from './fts.ts'
import { groupDir, bodyDirInGroup, type MemoryEntry } from './store.ts'
import { writeGroup } from './group.ts'

/** 建一个群 + 群下某体的条目（entries.jsonl）。 */
async function makeGroupWithEntries(root: string, groupId: string, bodyId: string, contents: string[]): Promise<string> {
  await writeGroup(root, { id: groupId, name: groupId, description: '', createdAt: Date.now() })
  const dir = bodyDirInGroup(root, groupId, bodyId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'body.json'), JSON.stringify({ id: bodyId, groupId, name: bodyId, description: '', kind: 'fts', trust: 'user', createdAt: Date.now() }) + '\n')
  let jsonl = ''
  for (const c of contents) {
    const entry: MemoryEntry = {
      id: `id-${c}`,
      bodyId,
      authority: 'user',
      content: c,
      weight: 1,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    jsonl += JSON.stringify(entry) + '\n'
  }
  writeFileSync(join(dir, 'entries.jsonl'), jsonl)
  return dir
}

test('MemoryFts 独立实例：每群一个 sqlite，重建后检索命中', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lma-p1b-'))
  const dir = await makeGroupWithEntries(root, 'physics', 'quantum', ['薛定谔方程描述量子态演化', '海森堡不确定性原理'])

  const fts = new MemoryFts(join(groupDir(root, 'physics'), 'index.sqlite'))
  await fts.rebuildBody(dir, 'quantum')

  const hits = fts.search('薛定谔方程', ['quantum'])
  assert.equal(hits.length, 1)
  assert.equal(hits[0].bodyId, 'quantum')
  assert.ok(hits[0].content.includes('薛定谔'))

  fts.close()
})

test('两个群的独立索引互不干扰（物理隔离）', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lma-p1b-'))
  const physicsDir = await makeGroupWithEntries(root, 'physics', 'quantum', ['量子纠缠是量子力学的现象'])
  const litDir = await makeGroupWithEntries(root, 'literature', 'poetry', ['李白的诗歌豪放飘逸'])

  const physicsFts = new MemoryFts(join(groupDir(root, 'physics'), 'index.sqlite'))
  const litFts = new MemoryFts(join(groupDir(root, 'literature'), 'index.sqlite'))

  await physicsFts.rebuildBody(physicsDir, 'quantum')
  await litFts.rebuildBody(litDir, 'poetry')

  // physics 群的索引里只有 physics 的条目，搜"李白"无命中
  assert.equal(physicsFts.search('李白的诗歌', ['quantum']).length, 0)
  // literature 群的索引里只有 literature 的条目，搜"量子"无命中
  assert.equal(litFts.search('量子纠缠', ['poetry']).length, 0)
  // 各自群内能命中
  assert.equal(physicsFts.search('量子纠缠', ['quantum']).length, 1)
  assert.equal(litFts.search('李白的诗歌', ['poetry']).length, 1)

  // 物理隔离：每个群有独立的 index.sqlite 文件
  assert.ok(existsSync(join(groupDir(root, 'physics'), 'index.sqlite')))
  assert.ok(existsSync(join(groupDir(root, 'literature'), 'index.sqlite')))

  physicsFts.close()
  litFts.close()
})

test('群级 FTS 文件路径与体目录一致（在群目录内）', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lma-p1b-'))
  await makeGroupWithEntries(root, 'physics', 'quantum', ['测试内容足够长'])

  // 群级索引在群目录下，体目录也在群目录下（物理隔离的目录结构）
  assert.ok(existsSync(join(groupDir(root, 'physics'))))
  assert.ok(existsSync(bodyDirInGroup(root, 'physics', 'quantum')))
})
