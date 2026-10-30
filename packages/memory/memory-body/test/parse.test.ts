/**
 * parse.ts 的独立测试：/remember 与 /summarize 的输入解析。
 * 覆盖：默认体、指定体、空输入、无挂载体、前导空格（命令系统 rawInput 含前导空格）。
 */

import { strict as assert } from 'node:assert'
import { parseRemember, parseSummarizeBody, REMEMBER_USAGE } from '../src/parse.ts'

// 1. 空输入 → Usage
assert.equal(parseRemember('', ['code']), REMEMBER_USAGE)
assert.equal(parseRemember('   ', ['code']), REMEMBER_USAGE)
console.log('✓ parseRemember 空输入返回 Usage')

// 2. 指定体：第一段是挂载的体 id
const specified = parseRemember('code 用 pnpm 构建', ['code'])
assert.deepEqual(specified, { bodyId: 'code', content: '用 pnpm 构建' })
console.log('✓ parseRemember 指定体（/remember <体id> <内容>）')

// 3. 默认体：整体是内容（第一段不是体 id）
const defaults = parseRemember(' 用 pnpm run build:web 构建', ['code'])
assert.deepEqual(defaults, { bodyId: 'code', content: '用 pnpm run build:web 构建' })
console.log('✓ parseRemember 默认体（前导空格被 trim，内容保留）')

// 4. 无挂载体 → 错误字符串
const noMount = parseRemember('内容', [])
assert.equal(typeof noMount, 'string')
console.log('✓ parseRemember 无挂载体返回错误')

// 5. parseSummarizeBody：指定体 vs 默认体
assert.equal(parseSummarizeBody(' code ', ['code']), 'code')
assert.equal(parseSummarizeBody('', ['code']), 'code')
assert.equal(parseSummarizeBody('不存在的体', ['code']), 'code') // 非挂载体回落默认
console.log('✓ parseSummarizeBody 指定体/默认体/回落')

console.log('\n全部通过。')
