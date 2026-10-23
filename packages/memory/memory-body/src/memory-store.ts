/**
 * MemoryStore：host 平面的共享存储服务，封装 root + FTS + 存储操作。
 * Remote（体管理）与 preset 包的命令/工具都 inject 它，共享同一份存储。
 *
 * @module @szx-a/dsh-layered-memory-architecture/memory-store
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import {
  appendEntry, bodyDirInGroup, deleteBody, expandMountTargets, groupDir, listBodyIds,
  listBodyIdsInGroup, listGroupIds, readBody, readEntries, readEntriesFromDir, retireEntry,
  supersedeEntry, resolveRoot, writeBody, type MemoryBody, type MemoryEntry,
} from './store.ts'
import { deleteGroup, listGroups, readGroup, writeGroup, type MemoryGroup } from './group.ts'
import { MemoryFts, type FtsHit } from './fts.ts'
import { migrateBodiesToDefaultGroup } from './migrate.ts'
import { cosineSimilarity, NullEmbedder, type Embedder } from './embed.ts'
import { bodyAnchorPath, groupAnchorPath, readAnchor, writeAnchor } from './anchor.ts'
import { decidePlacement, type GroupAnchorRef, type PlacementInput, type PlacementVerdict } from './placement.ts'
import type { PendingArbitration, ArbitrationDecision } from './types.ts'

export interface MemoryStoreConfig {
  root: string
  defaultBodies: string[]
}

/** 携带会话身份的调用者（Agent 满足此形状，避免 host 包硬依赖 dsh-agent 类型）。 */
export interface SessionOwner {
  readonly session: { readonly id: string }
}

export class MemoryStore extends Service {
  static Config: z<MemoryStoreConfig> = z.object({
    root: z.string().required(),
    defaultBodies: z.array(z.string()).default([]),
  })

  private readonly root: string
  private readonly mountedList: string[]
  private readonly mountsPath: string
  /** 会话级挂载覆盖（sessionId → 显式挂载集）。持久化到 mounts.json，会话重启后恢复。 */
  private readonly sessionMounts: Map<string, Set<string>>
  /** 群级 FTS 映射（groupId → 该群的独立索引）：P1b 物理隔离，每群一个 index.sqlite。 */
  private readonly ftsByGroup = new Map<string, MemoryFts>()
  /** 可插拔 embedder（默认 NullEmbedder 降级为 FTS5 兜底）。 */
  private embedder: Embedder = new NullEmbedder()
  /** 待人工仲裁队列（conflict 时入队，GUI 弹窗轮询）。 */
  private readonly pendingArbitrations = new Map<string, PendingArbitration>()

  constructor(ctx: Context, config: MemoryStoreConfig) {
    super(ctx, 'memoryStore')
    this.root = resolveRoot(config.root)
    // P0：构造时同步迁移旧版「体在 root 下」→「体在群下」（幂等，无裸体目录则 no-op）。
    migrateBodiesToDefaultGroup(this.root)
    this.mountedList = config.defaultBodies
    this.mountsPath = join(this.root, 'mounts.json')
    this.sessionMounts = this.loadMounts()
    const ftsByGroup = this.ftsByGroup
    ctx.effect(function* () {
      yield () => {
        for (const fts of ftsByGroup.values()) fts.close()
      }
    }, 'memory-store fts dispose')
  }

  /** 注入真实 embedder（P3 接入本地模型/官方服务；不注入则 FTS5 兜底）。 */
  setEmbedder(embedder: Embedder): void {
    this.embedder = embedder
  }

  /** 是否有可用的 embedding（NullEmbedder 视为无）。 */
  hasEmbedder(): boolean {
    return !(this.embedder instanceof NullEmbedder)
  }

  /** 生成并持久化群的公理锚向量（有 embedder 时；无则跳过）。 */
  async generateGroupAnchor(groupId: string, concept: string): Promise<void> {
    if (!this.hasEmbedder()) return
    const anchor = await this.embedder.anchor(concept)
    if (anchor.length > 0) writeAnchor(groupAnchorPath(this.root, groupId), anchor)
  }

  /** 生成并持久化体的公理锚向量（有 embedder 时；无则跳过）。 */
  async generateBodyAnchor(groupId: string, bodyId: string, concept: string): Promise<void> {
    if (!this.hasEmbedder()) return
    const anchor = await this.embedder.anchor(concept)
    if (anchor.length > 0) writeAnchor(bodyAnchorPath(this.root, groupId, bodyId), anchor)
  }

  /**
   * AI 自动归置：读现有群锚，对给定概念做「阈值 + AI 语义」双重判定。
   * 返回判定结果；action='conflict' 时由上层弹人工仲裁面板。
   */
  async autoPlace(conceptVector: number[], aiVerdict: 'assign' | 'create', aiTargetGroupId?: string | undefined, threshold: number = 0.5): Promise<PlacementVerdict> {
    // 读所有现有群的锚向量。
    const groupAnchors: GroupAnchorRef[] = []
    for (const groupId of await listGroupIds(this.root)) {
      const anchor = readAnchor(groupAnchorPath(this.root, groupId))
      if (anchor.length > 0) groupAnchors.push({ groupId, anchor })
    }
    const input: PlacementInput = {
      conceptVector,
      groupAnchors,
      threshold,
      aiVerdict,
      aiTargetGroupId,
    }
    return decidePlacement(input)
  }

  /**
   * AI 自动归置的完整流程：生成概念向量 → 双重判定 → 执行或入队仲裁。
   * - assign-existing → 返回归入的群 id。
   * - create-new → 自动建群（suggestedGroupName 转合法 id），返回新群 id。
   * - conflict → 入队待仲裁，返回 arbitration（GUI 弹窗轮询后 resolve）。
   */
  async placeMemory(content: string, aiVerdict: 'assign' | 'create', suggestedGroupName?: string | undefined): Promise<{ action: 'assign-existing' | 'create-new' | 'conflict'; groupId?: string | undefined; arbitration?: PendingArbitration | undefined }> {
    // 1. 生成概念向量（用 anchor，因为是"主题/概念"而非普通文本）。
    const conceptVector = this.hasEmbedder() ? await this.embedder.anchor(content) : []
    // 2. 双重判定。
    const verdict = await this.autoPlace(conceptVector, aiVerdict, undefined)
    // 3. 执行或入队。
    if (verdict.action === 'assign-existing' && verdict.nearestGroupId !== undefined) {
      return { action: 'assign-existing', groupId: verdict.nearestGroupId }
    }
    if (verdict.action === 'create-new') {
      const groupId = this.makeGroupId(suggestedGroupName)
      await this.writeGroup({ id: groupId, name: suggestedGroupName ?? groupId, description: '', createdAt: Date.now() })
      await this.generateGroupAnchor(groupId, suggestedGroupName ?? groupId)
      return { action: 'create-new', groupId }
    }
    // conflict：入队待仲裁。
    const arbitration: PendingArbitration = {
      id: randomUUID(),
      concept: content,
      thresholdVerdict: verdict.thresholdVerdict,
      aiVerdict: verdict.aiVerdict,
      nearestGroupId: verdict.nearestGroupId,
      suggestedGroupName,
    }
    this.pendingArbitrations.set(arbitration.id, arbitration)
    return { action: 'conflict', arbitration }
  }

  /** 列出待人工仲裁项（GUI 弹窗轮询）。 */
  listPendingArbitrations(): PendingArbitration[] {
    return [...this.pendingArbitrations.values()]
  }

  /**
   * 人工仲裁决策（三选项）：
   * - assign-existing + groupId → 归入指定现有群（AI 建议的 nearest 或用户手动指定）。
   * - create-new + groupName → 新建群（输入群名，空则自动生成 id）。
   * 返回最终群 id；仲裁项从队列移除。
   */
  async resolveArbitration(arbitrationId: string, decision: ArbitrationDecision): Promise<{ groupId: string } | { error: string }> {
    const item = this.pendingArbitrations.get(arbitrationId)
    if (item === undefined) return { error: `arbitration ${JSON.stringify(arbitrationId)} not found` }
    this.pendingArbitrations.delete(arbitrationId)
    if (decision.kind === 'assign-existing') {
      return { groupId: decision.groupId }
    }
    // create-new：新建群（groupName 转合法 id）。
    const groupId = this.makeGroupId(decision.groupName)
    await this.writeGroup({ id: groupId, name: decision.groupName ?? groupId, description: '', createdAt: Date.now() })
    await this.generateGroupAnchor(groupId, decision.groupName ?? groupId)
    return { groupId }
  }

  /** 把建议群名转成合法群 id（合法则原样，否则 g-<base36 时间戳>）。 */
  private makeGroupId(suggested?: string | undefined): string {
    if (suggested !== undefined && /^[a-z0-9][a-z0-9-]*$/.test(suggested)) return suggested
    return `g-${Date.now().toString(36)}`
  }

  /** 取某群的独立 FTS 索引（惰性创建，物理隔离：不同群不同 sqlite 文件）。 */
  private groupFts(groupId: string): MemoryFts {
    let fts = this.ftsByGroup.get(groupId)
    if (fts === undefined) {
      fts = new MemoryFts(join(groupDir(this.root, groupId), 'index.sqlite'))
      this.ftsByGroup.set(groupId, fts)
    }
    return fts
  }

  /** 默认（全局）挂载的体 id 列表。 */
  mounted(): string[] {
    return this.mountedList
  }

  /** 某会话的挂载集：优先取该会话的显式覆盖，否则回退默认集。 */
  mountedFor(owner: SessionOwner | undefined): string[] {
    if (owner === undefined) return this.mountedList
    return this.mountedForSession(owner.session.id)
  }

  /** 按 sessionId 查询挂载集（供 Remote 跨 host/client 查询）。 */
  mountedForSession(sessionId: string): string[] {
    const overrides = this.sessionMounts.get(sessionId)
    return overrides === undefined ? this.mountedList : [...overrides]
  }

  /** 把某个体挂到指定会话，并置为最前（最近挂载的体 = 默认写入目标）。 */
  mount(bodyId: string, owner: SessionOwner): void {
    const sessionId = owner.session.id
    let overrides = this.sessionMounts.get(sessionId)
    if (overrides === undefined) {
      overrides = new Set(this.mountedList)
    }
    // 插到最前：/remember /summarize 默认写 mounted[0]，最近挂载的体自动成为默认写入目标。
    this.sessionMounts.set(sessionId, new Set([bodyId, ...overrides]))
    this.persistMounts()
  }

  /** 从指定会话卸下某个体（首次操作会先继承默认集再删，卸空即无挂载）。 */
  unmount(bodyId: string, owner: SessionOwner): void {
    const sessionId = owner.session.id
    let overrides = this.sessionMounts.get(sessionId)
    if (overrides === undefined) {
      overrides = new Set(this.mountedList)
      this.sessionMounts.set(sessionId, overrides)
    }
    overrides.delete(bodyId)
    this.persistMounts()
  }

  /**
   * 展开挂载集为纯体 id 列表（写入用）：挂群 = 群下所有体全挂载，展开为所有体 id。
   * - 体路径 'group/body' → 'body'
   * - 群 'group' → 群下所有体 id（全挂载）
   * - 旧式纯体 id → 自身
   * 供 parseRemember 匹配显式指定体 + 默认写入目标。
   */
  async mountedBodies(owner: SessionOwner | undefined): Promise<string[]> {
    const bodyIds: string[] = []
    for (const target of this.mountedFor(owner)) {
      if (target.includes('/')) {
        bodyIds.push(target.slice(target.indexOf('/') + 1))
      } else {
        const groupBodies = await listBodyIdsInGroup(this.root, target)
        if (groupBodies.length > 0) bodyIds.push(...groupBodies)
        else bodyIds.push(target)
      }
    }
    return bodyIds
  }

  /**
   * 把挂载目标解析为纯体 id（默认写入目标用）：
   * - 体路径 'group/body' → 'body'
   * - 群 'group' → 群内第一个体 id（挂群默认写第一个）
   * - 旧式纯体 id → 自身（调用方 readBody 验证存在性）
   */
  async resolveBodyId(target: string): Promise<string | undefined> {
    const slash = target.indexOf('/')
    if (slash >= 0) {
      const bId = target.slice(slash + 1)
      return bId === '' ? undefined : bId
    }
    const bodyIds = await listBodyIdsInGroup(this.root, target)
    if (bodyIds.length > 0) return bodyIds[0]
    return target
  }

  /** 挂载目标的显示名（dock 标签用）：群 → 群名，体 → 体名，旧体 id → 体名。 */
  async mountLabel(target: string): Promise<string> {
    if (target.includes('/')) {
      const body = await this.readBody(target)
      if (body !== undefined && body.name !== '') return body.name
      return target
    }
    const group = await this.readGroup(target)
    if (group !== undefined && group.name !== '') return group.name
    const body = await this.readBody(target)
    if (body !== undefined && body.name !== '') return body.name
    return target
  }

  /** 挂载集的显示名列表（供 dock 标签显示群名/体名，而非 id）。 */
  async mountedLabels(sessionId: string): Promise<string[]> {
    const labels: string[] = []
    for (const target of this.mountedForSession(sessionId)) {
      labels.push(await this.mountLabel(target))
    }
    return labels
  }

  /* ── 挂载持久化 ─────────────────────────────────────────── */

  /** 从 mounts.json 加载会话挂载集（文件不存在或损坏时回退空）。 */
  private loadMounts(): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>()
    try {
      if (!existsSync(this.mountsPath)) return result
      const raw = JSON.parse(readFileSync(this.mountsPath, 'utf8')) as Record<string, unknown>
      for (const [sessionId, bodies] of Object.entries(raw)) {
        if (Array.isArray(bodies)) {
          result.set(sessionId, new Set(bodies.filter(b => typeof b === 'string')))
        }
      }
    } catch {
      // 文件损坏时静默忽略，回退空（下次挂载会重写）。
    }
    return result
  }

  /** 把当前会话挂载集写回 mounts.json（每次挂载/卸载立即落盘）。 */
  private persistMounts(): void {
    const raw: Record<string, string[]> = {}
    for (const [sessionId, set] of this.sessionMounts) {
      raw[sessionId] = [...set]
    }
    writeFileSync(this.mountsPath, JSON.stringify(raw, null, 2) + '\n')
  }

  /* ── 群管理 ─────────────────────────────────────────────── */

  listGroups(): Promise<string[]> {
    return listGroups(this.root)
  }

  readGroup(groupId: string): Promise<MemoryGroup | undefined> {
    return readGroup(this.root, groupId)
  }

  writeGroup(group: MemoryGroup): Promise<void> {
    return writeGroup(this.root, group)
  }

  deleteGroup(groupId: string): Promise<void> {
    return deleteGroup(this.root, groupId)
  }

  /* ── 体管理 ─────────────────────────────────────────────── */

  listBodyIds(): Promise<string[]> {
    return listBodyIds(this.root)
  }

  readBody(bodyId: string): Promise<MemoryBody | undefined> {
    return readBody(this.root, bodyId)
  }

  writeBody(body: MemoryBody): Promise<void> {
    return writeBody(this.root, body)
  }

  deleteBody(bodyId: string): Promise<void> {
    return deleteBody(this.root, bodyId)
  }

  /* ── 条目 ───────────────────────────────────────────────── */

  readEntries(bodyId: string): Promise<MemoryEntry[]> {
    return readEntries(this.root, bodyId)
  }

  /** 追加条目：若有 embedder，先生成内容向量再落盘（P2）。 */
  async appendEntry(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<MemoryEntry> {
    if (this.hasEmbedder() && entry.content !== undefined) {
      const embedding = await this.embedder.embed(entry.content)
      return appendEntry(this.root, { ...entry, embedding })
    }
    return appendEntry(this.root, entry)
  }

  retireEntry(entry: MemoryEntry): Promise<MemoryEntry> {
    return retireEntry(this.root, entry)
  }

  /** 纠正：降权旧条目 + 写入纠正后的新条目（出处链可追溯）。 */
  supersedeEntry(entry: MemoryEntry, newContent: string, authority?: 'user' | 'model'): Promise<MemoryEntry> {
    return supersedeEntry(this.root, entry, newContent, authority)
  }

  /* ── 检索 ───────────────────────────────────────────────── */

  /** 挂载目标是否存在（群或体）。用于 /mount 命令验证目标有效。 */
  async mountTargetExists(target: string): Promise<boolean> {
    const mounts = await expandMountTargets(this.root, [target])
    return mounts.length > 0
  }

  /**
   * 检索挂载目标（群路径或体路径）内的记忆。
   * targets 语义：单段 = 群（展开为群下所有体）或旧式体 id；两段 = group/body。
   * P1b：按群分组，每个群用独立 FTS 索引（物理隔离，不同群不同 sqlite）。
   * P2：有 embedder 且候选有向量时，用余弦相似度精排；否则 FTS5 粗筛兜底。
   * P3：无挂载（targets 空）且有锚向量时，走树状多族路由（群锚→体锚）。
   */
  async search(query: string, targets: string[]): Promise<FtsHit[]> {
    let mounts = await expandMountTargets(this.root, targets)
    // P3 树状路由：无挂载（targets 空）且有 embedder 时，用群锚→体锚定位相关体。
    if (mounts.length === 0 && targets.length === 0 && this.hasEmbedder()) {
      mounts = await this.routeByAnchors(query)
    }
    // 按群分组（体 id 保持去重，避免同体重复检索）。
    const byGroup = new Map<string, Set<string>>()
    for (const m of mounts) {
      let set = byGroup.get(m.groupId)
      if (set === undefined) {
        set = new Set()
        byGroup.set(m.groupId, set)
      }
      set.add(m.bodyId)
    }
    // 每个群独立检索（物理隔离）。
    const hits: FtsHit[] = []
    for (const [groupId, bodyIds] of byGroup) {
      const fts = this.groupFts(groupId)
      for (const bodyId of bodyIds) {
        await fts.rebuildBody(bodyDirInGroup(this.root, groupId, bodyId), bodyId)
      }
      hits.push(...fts.search(query, [...bodyIds]))
    }
    // 向量精排（有 embedder 且候选多于 1 时才有意义）。
    if (this.hasEmbedder() && hits.length > 1) {
      return this.rerankByEmbedding(query, hits, mounts)
    }
    return hits
  }

  /**
   * 树状多族路由（自顶向下公理切割的检索落地）：
   * 查询向量 → 与各群公理锚比（领域路由）→ 命中群内与各体公理锚比 → 返回 top-k 体。
   * 无锚向量的群/体跳过（无向量时退化，由 FTS 兜底）。
   */
  private async routeByAnchors(query: string, topK = 3): Promise<{ groupId: string; bodyId: string }[]> {
    const qvec = await this.embedder.embed(query)
    if (qvec.length === 0) return []
    // 1. 群锚路由：选 top-k 命中族。
    const groupIds = await listGroupIds(this.root)
    const groupScores: Array<{ groupId: string; score: number }> = []
    for (const groupId of groupIds) {
      const anchor = readAnchor(groupAnchorPath(this.root, groupId))
      if (anchor.length === 0) continue
      groupScores.push({ groupId, score: cosineSimilarity(qvec, anchor) })
    }
    groupScores.sort((a, b) => b.score - a.score)
    const topGroups = groupScores.slice(0, topK).map(g => g.groupId)
    // 2. 体锚路由：命中群内选 top-k 命中簇。
    const result: Array<{ groupId: string; bodyId: string }> = []
    for (const groupId of topGroups) {
      const bodyIds = await listBodyIdsInGroup(this.root, groupId)
      const bodyScores: Array<{ bodyId: string; score: number }> = []
      for (const bodyId of bodyIds) {
        const anchor = readAnchor(bodyAnchorPath(this.root, groupId, bodyId))
        if (anchor.length === 0) continue
        bodyScores.push({ bodyId, score: cosineSimilarity(qvec, anchor) })
      }
      bodyScores.sort((a, b) => b.score - a.score)
      for (const b of bodyScores.slice(0, topK)) {
        result.push({ groupId, bodyId: b.bodyId })
      }
    }
    return result
  }

  /** 用查询向量对 FTS 粗筛候选做余弦相似度精排（无向量的候选排后）。 */
  private async rerankByEmbedding(query: string, hits: FtsHit[], mounts: readonly { groupId: string; bodyId: string }[]): Promise<FtsHit[]> {
    const qvec = await this.embedder.embed(query)
    if (qvec.length === 0) return hits
    // bodyId → groupId 唯一映射（定位体目录读条目）。
    const groupByBody = new Map<string, string>()
    for (const m of mounts) groupByBody.set(m.bodyId, m.groupId)
    // 读候选的 embedding（按体读条目，建 entry id → 向量映射）。
    const embByEntry = new Map<string, number[]>()
    for (const bodyId of new Set(hits.map(h => h.bodyId))) {
      const groupId = groupByBody.get(bodyId)
      if (groupId === undefined) continue
      const entries = await readEntriesFromDir(bodyDirInGroup(this.root, groupId, bodyId), bodyId)
      for (const e of entries) {
        if (e.embedding !== undefined) embByEntry.set(e.id, e.embedding)
      }
    }
    // 余弦相似度排序（无向量者 score 0，排后）。
    const scored = hits.map(h => {
      const emb = embByEntry.get(h.id)
      return { hit: h, score: emb === undefined ? 0 : cosineSimilarity(qvec, emb) }
    })
    scored.sort((a, b) => b.score - a.score)
    return scored.map(s => s.hit)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    memoryStore: MemoryStore
  }
}

export default MemoryStore
