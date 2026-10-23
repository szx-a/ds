/**
 * 归置决策：AI 自动建群/建体时的「阈值 + AI 语义」双重判定（纯函数）。
 *
 * 三级确定性裁决模型（P4）：
 * 1. 阈值判定（threshold）：纯距离——词条概念向量与现有群锚的余弦相似度。
 *    - 最大相似度 >= 阈值 → 'near'（够近）
 *    - 否则 → 'far'（不够近，倾向新建）
 * 2. AI 语义判定（semantic）：AI 基于领域知识判断「该归入现有还是新建」。
 * 3. 双重判定：
 *    - near + assign → 一致，自动归入现有群
 *    - far + create → 一致，自动新建群
 *    - 其余组合 → 冲突，上抛人工仲裁（不赌概率，交给主权）
 *
 * 这是「确定性优先」在创建端的落地：系统自信则自动、系统不确定则上抛人工。
 *
 * @module dsh-memory-body/placement
 */

import { cosineSimilarity } from './embed.ts'

/** 群锚引用（归置判定时用来比距离）。 */
export interface GroupAnchorRef {
  groupId: string
  anchor: readonly number[]
}

/** AI 语义判定结果。 */
export type AiVerdict = 'assign' | 'create'

/** 归置判定输入。 */
export interface PlacementInput {
  /** 词条/内容的概念向量（用于阈值判定）。 */
  conceptVector: readonly number[]
  /** 现有群锚列表（无群时为空 → 直接新建）。 */
  groupAnchors: readonly GroupAnchorRef[]
  /** 相似度阈值（>= 阈值视为"够近"）。 */
  threshold: number
  /** AI 语义判定（LLM 基于领域知识的判断）。 */
  aiVerdict: AiVerdict
  /** AI 建议归入的群 id（aiVerdict='assign' 时）。 */
  aiTargetGroupId?: string | undefined
}

/** 归置判定结果。 */
export interface PlacementVerdict {
  /** 最终动作：归入现有 / 新建 / 冲突上抛。 */
  action: 'assign-existing' | 'create-new' | 'conflict'
  /** 阈值判定结论。 */
  thresholdVerdict: 'near' | 'far'
  /** 阈值判定命中的最近群（near 时）。 */
  nearestGroupId?: string | undefined
  /** AI 语义判定结论。 */
  aiVerdict: AiVerdict
  /** AI 建议归入的群 id。 */
  aiTargetGroupId?: string | undefined
}

/**
 * 归置决策（纯函数）：阈值 + AI 语义双重判定。
 * - 无现有群 → 直接 create-new（冷启动零配置）。
 * - 无概念向量 → 无法阈值判定，退化为按 AI 语义（AI 说 assign 就 assign，否则 create）。
 */
export function decidePlacement(input: PlacementInput): PlacementVerdict {
  // 无现有群：直接新建（冷启动）。
  if (input.groupAnchors.length === 0) {
    return {
      action: input.aiVerdict === 'assign' ? 'conflict' : 'create-new',
      thresholdVerdict: 'far',
      aiVerdict: input.aiVerdict,
      aiTargetGroupId: input.aiTargetGroupId,
    }
  }

  // 阈值判定：找最近群锚。
  let nearestGroupId: string | undefined
  let maxSim = -1
  for (const ref of input.groupAnchors) {
    const sim = cosineSimilarity(input.conceptVector, ref.anchor)
    if (sim > maxSim) {
      maxSim = sim
      nearestGroupId = ref.groupId
    }
  }

  // 无概念向量（空向量）时无法阈值判定：按 AI 语义退化。
  const thresholdVerdict: 'near' | 'far' = input.conceptVector.length === 0
    ? (input.aiVerdict === 'assign' ? 'near' : 'far')
    : (maxSim >= input.threshold ? 'near' : 'far')

  // 双重判定。
  if (thresholdVerdict === 'near' && input.aiVerdict === 'assign') {
    return {
      action: 'assign-existing',
      thresholdVerdict,
      nearestGroupId,
      aiVerdict: input.aiVerdict,
      aiTargetGroupId: input.aiTargetGroupId ?? nearestGroupId,
    }
  }
  if (thresholdVerdict === 'far' && input.aiVerdict === 'create') {
    return {
      action: 'create-new',
      thresholdVerdict,
      nearestGroupId,
      aiVerdict: input.aiVerdict,
      aiTargetGroupId: input.aiTargetGroupId,
    }
  }
  // 冲突：near+create 或 far+assign → 上抛人工仲裁。
  return {
    action: 'conflict',
    thresholdVerdict,
    nearestGroupId,
    aiVerdict: input.aiVerdict,
    aiTargetGroupId: input.aiTargetGroupId,
  }
}

export type { PendingArbitration, ArbitrationDecision } from './types.ts'
