/**
 * P4 单元测试：AI 自动建群建体的「阈值 + AI 语义」双重判定。
 *
 * 覆盖三级确定性裁决模型：
 * 1. near + assign → 一致，自动归入现有（assign-existing）
 * 2. far + create → 一致，自动新建（create-new）
 * 3. near + create / far + assign → 冲突，上抛人工仲裁（conflict）
 * 4. 无现有群 → 冷启动直接新建
 * 5. 无概念向量 → 退化为按 AI 语义
 *
 * 运行：node --import tsx --test 本文件。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decidePlacement } from './placement.ts'

test('near + assign → assign-existing（一致，自动归入）', () => {
  const v = decidePlacement({
    conceptVector: [1, 0, 0],
    groupAnchors: [{ groupId: 'physics', anchor: [1, 0, 0] }],
    threshold: 0.5,
    aiVerdict: 'assign',
    aiTargetGroupId: 'physics',
  })
  assert.equal(v.action, 'assign-existing')
  assert.equal(v.thresholdVerdict, 'near')
  assert.equal(v.nearestGroupId, 'physics')
})

test('far + create → create-new（一致，自动新建）', () => {
  const v = decidePlacement({
    conceptVector: [1, 0, 0],
    groupAnchors: [{ groupId: 'literature', anchor: [0, 1, 0] }],
    threshold: 0.5,
    aiVerdict: 'create',
  })
  assert.equal(v.action, 'create-new')
  assert.equal(v.thresholdVerdict, 'far')
})

test('near + create → conflict（冲突，上抛人工）', () => {
  const v = decidePlacement({
    conceptVector: [1, 0, 0],
    groupAnchors: [{ groupId: 'physics', anchor: [1, 0, 0] }],
    threshold: 0.5,
    aiVerdict: 'create',
  })
  assert.equal(v.action, 'conflict')
  assert.equal(v.thresholdVerdict, 'near')
  assert.equal(v.aiVerdict, 'create')
})

test('far + assign → conflict（冲突，上抛人工）', () => {
  const v = decidePlacement({
    conceptVector: [1, 0, 0],
    groupAnchors: [{ groupId: 'literature', anchor: [0, 1, 0] }],
    threshold: 0.5,
    aiVerdict: 'assign',
    aiTargetGroupId: 'literature',
  })
  assert.equal(v.action, 'conflict')
  assert.equal(v.thresholdVerdict, 'far')
  assert.equal(v.aiVerdict, 'assign')
})

test('无现有群 → 冷启动直接新建', () => {
  const v = decidePlacement({
    conceptVector: [1, 0, 0],
    groupAnchors: [],
    threshold: 0.5,
    aiVerdict: 'create',
  })
  assert.equal(v.action, 'create-new')
})

test('无概念向量 → 退化为按 AI 语义', () => {
  // 空向量 + assign → 视为 near，归入现有
  const assignV = decidePlacement({
    conceptVector: [],
    groupAnchors: [{ groupId: 'physics', anchor: [1, 0, 0] }],
    threshold: 0.5,
    aiVerdict: 'assign',
    aiTargetGroupId: 'physics',
  })
  assert.equal(assignV.action, 'assign-existing')

  // 空向量 + create → 视为 far，新建
  const createV = decidePlacement({
    conceptVector: [],
    groupAnchors: [{ groupId: 'physics', anchor: [1, 0, 0] }],
    threshold: 0.5,
    aiVerdict: 'create',
  })
  assert.equal(createV.action, 'create-new')
})

test('阈值边界：相似度等于阈值视为 near', () => {
  // cos([1,0,0], [1,0,0]) = 1.0 >= 0.5
  const v = decidePlacement({
    conceptVector: [1, 0, 0],
    groupAnchors: [{ groupId: 'physics', anchor: [1, 0, 0] }],
    threshold: 0.5,
    aiVerdict: 'assign',
  })
  assert.equal(v.action, 'assign-existing')
})
