/**
 * 跨模块共享类型，独立成文件以避免 index ↔ command/tool 的循环 import。
 * Remote boundary 类型（BodySummary/EntrySummary）也放这里——
 * Typert 生成器要求它们从 public non-root 子路径（./types）导出。
 * @module dsh-memory-body/types
 */

/** 读取"当前会话挂载的体 id 列表"的函数（第一版直读 config，后续接 settings/GUI）。 */
export type MountedBodies = () => string[]

/** GUI 用的体摘要（Remote listBodies 的返回类型）。 */
export interface BodySummary {
  id: string
  groupId: string
  name: string
  description: string
  kind: string
}

/** GUI 用的群摘要（Remote listGroups 的返回类型）。 */
export interface GroupSummary {
  id: string
  name: string
  description: string
}

/** 待人工仲裁项（Remote listPendingArbitrations 的返回类型）。 */
export interface PendingArbitration {
  id: string
  concept: string
  thresholdVerdict: 'near' | 'far'
  aiVerdict: 'assign' | 'create'
  nearestGroupId?: string | undefined
  suggestedGroupName?: string | undefined
}

/** 人工仲裁决策（Remote resolveArbitration 的入参类型）。 */
export type ArbitrationDecision =
  | { kind: 'assign-existing'; groupId: string }
  | { kind: 'create-new'; groupName?: string | undefined }

/** GUI 用的条目摘要（Remote listEntries 的返回类型）。 */
export interface EntrySummary {
  bodyId: string
  authority: 'user' | 'model'
  content: string
  id: string
}
