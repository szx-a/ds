/**
 * P3 单元测试：公理锚向量二进制持久化 + 树状路由的 top-k 选择逻辑。
 *
 * 覆盖：
 * 1. writeAnchor/readAnchor 往返（float 精度保留）。
 * 2. 不存在的锚返回空数组。
 * 3. groupAnchorPath/bodyAnchorPath 路径正确（锚在群/体目录内）。
 * 4. 树状路由的 top-k 选择逻辑（用余弦相似度选最相关的群/体）。
 *
 * 运行：node --import tsx --test 本文件。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { writeAnchor, readAnchor, groupAnchorPath, bodyAnchorPath } from './anchor.ts'
import { cosineSimilarity } from './embed.ts'

test('writeAnchor/readAnchor 往返（float 精度）', () => {
  const root = mkdtempSync(join(tmpdir(), 'lma-p3-'))
  const path = join(root, 'anchor.vec')
  const vec = [0.1, 0.2, 0.3, -0.4, 0.5]

  writeAnchor(path, vec)
  const back = readAnchor(path)

  assert.equal(back.length, vec.length)
  for (let i = 0; i < vec.length; i++) {
    assert.ok(Math.abs((back[i] ?? 0) - (vec[i] ?? 0)) < 1e-6)
  }
})

test('不存在的锚返回空数组', () => {
  const root = mkdtempSync(join(tmpdir(), 'lma-p3-'))
  assert.deepEqual(readAnchor(join(root, 'nonexistent.vec')), [])
})

test('锚路径在群/体目录内', () => {
  const root = mkdtempSync(join(tmpdir(), 'lma-p3-'))
  // groupAnchorPath = <root>/<group>/anchor.vec
  assert.ok(groupAnchorPath(root, 'physics').endsWith(`physics${sep}anchor.vec`))
  // bodyAnchorPath = <root>/<group>/<body>/anchor.vec
  assert.ok(bodyAnchorPath(root, 'physics', 'quantum').endsWith(`physics${sep}quantum${sep}anchor.vec`))
})

test('树状路由 top-k 选择：查询向量与群锚/体锚的相似度排序', () => {
  // 模拟：查询向量 [1,0,0]，两个群锚 physics=[1,0,0]（相关）、literature=[0,1,0]（无关）
  const q = [1, 0, 0]
  const physicsAnchor = [1, 0, 0]
  const literatureAnchor = [0, 1, 0]

  const physicsScore = cosineSimilarity(q, physicsAnchor)
  const literatureScore = cosineSimilarity(q, literatureAnchor)

  // physics 群得分高于 literature 群
  assert.ok(physicsScore > literatureScore)

  // 模拟体锚路由：physics 群内两个体，quantum=[0.9,0.1,0] 比 relativity=[0.1,0.9,0] 更相关
  const quantumAnchor = [0.9, 0.1, 0]
  const relativityAnchor = [0.1, 0.9, 0]
  assert.ok(cosineSimilarity(q, quantumAnchor) > cosineSimilarity(q, relativityAnchor))

  // top-k=1 选择：选得分最高的体
  const bodyScores = [
    { bodyId: 'quantum', score: cosineSimilarity(q, quantumAnchor) },
    { bodyId: 'relativity', score: cosineSimilarity(q, relativityAnchor) },
  ]
  bodyScores.sort((a, b) => b.score - a.score)
  assert.equal(bodyScores[0].bodyId, 'quantum')
})

test('锚向量二进制写盘 + 群体目录层级（物理隔离的锚存储）', () => {
  const root = mkdtempSync(join(tmpdir(), 'lma-p3-'))
  const gAnchor = groupAnchorPath(root, 'physics')
  const bAnchor = bodyAnchorPath(root, 'physics', 'quantum')

  mkdirSync(join(root, 'physics'), { recursive: true })
  mkdirSync(join(root, 'physics', 'quantum'), { recursive: true })

  writeAnchor(gAnchor, [1, 0, 0])
  writeAnchor(bAnchor, [0.9, 0.1, 0])

  assert.deepEqual(readAnchor(gAnchor), [1, 0, 0])
  assert.ok(readAnchor(bAnchor).length === 3)
})
