/**
 * P2 单元测试：可插拔 Embedder + 降级 + 余弦相似度。
 *
 * 覆盖：
 * 1. NullEmbedder 降级：embed/anchor 返回空向量。
 * 2. hasEmbedding：空向量 = 无 embedding。
 * 3. cosineSimilarity：正交=0、同向=1、空向量=0、维度不匹配=0。
 *
 * 运行：node --import tsx --test 本文件。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NullEmbedder, hasEmbedding, cosineSimilarity } from './embed.ts'

test('NullEmbedder 降级：embed/anchor 返回空向量', async () => {
  const e = new NullEmbedder()
  assert.deepEqual(await e.embed('任意文本'), [])
  assert.deepEqual(await e.anchor('Physics'), [])
})

test('hasEmbedding：空向量视为无 embedding', () => {
  assert.equal(hasEmbedding([]), false)
  assert.equal(hasEmbedding([0.1, 0.2]), true)
})

test('cosineSimilarity：同向=1，正交=0', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 0, 0], [1, 0, 0]) - 1) < 1e-9)
  assert.ok(Math.abs(cosineSimilarity([1, 0, 0], [0, 1, 0]) - 0) < 1e-9)
})

test('cosineSimilarity：空向量或维度不匹配返回 0', () => {
  assert.equal(cosineSimilarity([], [1, 2]), 0)
  assert.equal(cosineSimilarity([1, 2], []), 0)
  assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), 0)
})

test('cosineSimilarity：相似向量得分高于不相似', () => {
  const q = [1, 0, 0]
  const similar = [0.9, 0.1, 0]
  const dissimilar = [0, 1, 0]
  assert.ok(cosineSimilarity(q, similar) > cosineSimilarity(q, dissimilar))
})
