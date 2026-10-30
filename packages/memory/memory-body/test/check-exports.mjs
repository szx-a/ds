/**
 * 插件静态兜底检查（把"真实加载才暴露"的坑前置）。
 *
 * 检查项（都是本会话真实踩过或 postmortem 记录的坑）：
 * 1. 入口 namespace plugin 形状：name/inject/Config/apply 齐全，无 default export
 *    （postmortem 0001：unwrapExports 会取 default、丢掉 inject，load 时直接崩）。
 * 2. 工具 schema 无 `required: false`
 *    （core/tools/src/schema.ts：`required` 字段出现时必须为 true；可选参数应省略 required）。
 *
 * 本脚本不 import（避免 bare specifier 解析问题），直接读源码文本。
 * 纯 node 内置，可独立跑。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('..', import.meta.url))
const srcDir = join(dir, 'src')

let failed = false

// ── 1. 入口导出形状 ────────────────────────────────────────────────
const entrySrc = readFileSync(join(srcDir, 'index.ts'), 'utf8')
const requiredExports = [
  'export const name',
  'export const inject',
  'export const Config',
  'export function apply',
]
for (const key of requiredExports) {
  if (!entrySrc.includes(key)) {
    console.error(`FAIL: 入口缺少必需导出：${key}`)
    failed = true
  }
}
if (/export\s+default/.test(entrySrc)) {
  console.error('FAIL: 入口有 default export（postmortem 0001：unwrapExports 会丢掉 inject）')
  failed = true
}

// ── 2. 工具 schema 无 required: false ──────────────────────────────
// 检查 tool.ts（工具定义所在文件）里没有 required: false。
const toolSrc = readFileSync(join(srcDir, 'tool.ts'), 'utf8')
if (/required\s*:\s*false/.test(toolSrc)) {
  console.error('FAIL: tool.ts 有 required: false（schema 校验器：required 出现时必须为 true；可选参数省略 required）')
  failed = true
}

if (failed) process.exit(1)
console.log('✓ 静态检查通过：导出形状正确、无 default export、无 required:false')
