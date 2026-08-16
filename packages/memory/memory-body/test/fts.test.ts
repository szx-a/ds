/**
 * fts.ts 的独立测试（node:sqlite FTS5 + tsx）。
 * 覆盖：重建索引、分词检索、phrase 转义（防 FTS 语法注入）、权限过滤。
 */

import { strict as assert } from 'node:assert'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendEntry, writeBody } from '../src/store.ts'
import { MemoryFts, quoteFtsData } from '../src/fts.ts'

const root = mkdtempSync(join(tmpdir(), 'dsh-memory-body-fts-'))

// 建体 + 写英文条目（unicode61 对英文分词可靠）
await writeBody(root, { id: 'code', name: 'Code', description: '代码', kind: 'fts', trust: 'user', createdAt: Date.now() })
await appendEntry(root, { bodyId: 'code', authority: 'user', content: 'build the web frontend with pnpm', weight: 1, status: 'active' })
await appendEntry(root, { bodyId: 'code', authority: 'model', content: 'pnpm on Windows needs admin permission', weight: 1, status: 'active' })

const fts = new MemoryFts(join(root, 'index.sqlite'))
await fts.rebuildBody(root, 'code')

// 分词检索：pnpm 命中两条
const hits1 = fts.search('pnpm', ['code'])
assert.equal(hits1.length, 2)
console.log('✓ FTS5 分词检索（pnpm 命中 2 条）')

// 单词检索：build 只命中第一条
const hits2 = fts.search('build', ['code'])
assert.equal(hits2.length, 1)
assert.equal(hits2[0].authority, 'user')
console.log('✓ FTS5 单词检索（build 命中 1 条）')

// phrase 转义：FTS 语法字符被当作惰性数据，不执行、不报错、无命中
assert.equal(quoteFtsData('a"b'), '"a""b"')
const malicious = fts.search('" OR "', ['code'])
assert.equal(malicious.length, 0)
console.log('✓ phrase 转义（FTS 语法注入被当作惰性数据）')

// 权限过滤：未挂载体搜不到
const hits3 = fts.search('pnpm', ['other'])
assert.equal(hits3.length, 0)
console.log('✓ 权限过滤（未挂载体不命中）')

fts.close()
console.log('\n全部通过。测试根目录：', root)
