/**
 * store.ts 的独立逻辑测试（不依赖 Harness，用 node:test + tsx 跑）。
 * 覆盖：路径编码、体元数据读写、条目追加/读取折叠、降权不删除。
 */

import { strict as assert } from 'node:assert'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendEntry, encodeSegment, readBody, readEntries, retireEntry, supersedeEntry, writeBody,
} from '../src/store.ts'

const root = mkdtempSync(join(tmpdir(), 'dsh-memory-body-test-'))

// 1. 路径安全编码
assert.equal(encodeSegment('code'), 'code')
assert.equal(encodeSegment('..'), '~002E~002E')
assert.equal(encodeSegment('a/b'), 'a~002Fb')
assert.equal(encodeSegment(''), '~')
console.log('✓ encodeSegment 路径安全')

// 2. 体元数据读写
const body = { id: 'code', name: 'Code', description: '代码记忆', kind: 'fts' as const, trust: 'user' as const, createdAt: Date.now() }
await writeBody(root, body)
const read = await readBody(root, 'code')
assert.equal(read?.name, 'Code')
assert.equal(read?.kind, 'fts')
assert.equal(await readBody(root, 'nonexistent'), undefined)
console.log('✓ writeBody / readBody')

// 3. 条目追加 + 读取
const e1 = await appendEntry(root, { bodyId: 'code', authority: 'user', content: '用 pnpm 构建', weight: 1, status: 'active' })
let entries = await readEntries(root, 'code')
assert.equal(entries.length, 1)
assert.equal(entries[0].content, '用 pnpm 构建')
assert.equal(entries[0].authority, 'user')
assert.ok(entries[0].id.length > 0)
console.log('✓ appendEntry / readEntries')

// 4. 降权不删除：supersede 后旧条目折叠为 superseded，新条目 active
const e2 = await supersedeEntry(root, e1, '用 pnpm run build:web', 'model')
entries = await readEntries(root, 'code')
// 折叠后：e1 → superseded，e2 → active，共 2 条
assert.equal(entries.length, 2)
const active = entries.filter(e => e.status === 'active' && e.weight > 0)
const superseded = entries.filter(e => e.status === 'superseded')
assert.equal(active.length, 1)
assert.equal(active[0].id, e2.id)
assert.equal(active[0].content, '用 pnpm run build:web')
assert.equal(active[0].authority, 'model')
assert.equal(superseded.length, 1)
assert.equal(superseded[0].id, e1.id)
assert.equal(superseded[0].supersededBy, e2.id)
assert.equal(superseded[0].weight, 0)
console.log('✓ supersedeEntry 降权不删除（旧条目折叠为 superseded，出处链完整）')

// 5. retireEntry 纯降权（/forget 的存储语义）
const e3 = await appendEntry(root, { bodyId: 'code', authority: 'user', content: '临时笔记：稍后废弃', weight: 1, status: 'active' })
await retireEntry(root, e3)
entries = await readEntries(root, 'code')
const e3Fold = entries.find(e => e.id === e3.id)
assert.equal(e3Fold?.status, 'superseded')
assert.equal(e3Fold?.weight, 0)
assert.equal(e3Fold?.supersededBy, undefined) // retire 无新条目，无推翻链
console.log('✓ retireEntry 纯降权（/forget 语义）')

console.log('\n全部通过。测试根目录：', root)
