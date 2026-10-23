/**
 * 记忆体（Memory Body）Remote 服务：体管理的 host→client RPC + 命令注册。
 *
 * 形态照 GoalService / PluginInventoryGateway：Service 类（extends TypertRemoteService），
 * static inject + constructor(ctx) + @Remote 方法 + export default。
 * 命令（/remember 等）在 host 平面注册（照 command-goal 先例）；工具在 preset 包。
 * 存储统一走 MemoryStore（host 平面共享服务），本服务只做 RPC + 命令。
 *
 * @module @szx-a/dsh-layered-memory-architecture
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { MemoryStore } from './memory-store.ts'
import type { BodySummary, EntrySummary, GroupSummary, PendingArbitration, ArbitrationDecision } from './types.ts'
import { registerCommands } from './command.ts'
import { DEFAULT_GROUP_ID } from './migrate.ts'

export type { BodySummary, EntrySummary, GroupSummary, PendingArbitration, ArbitrationDecision } from './types.ts'

export class MemoryBodyService extends TypertRemoteService {
  static inject = ['memoryStore', 'commands', 'llm']

  private readonly store: MemoryStore

  constructor(ctx: Context) {
    super(ctx, 'memoryBody')
    this.store = ctx.memoryStore
    registerCommands(ctx, this.store)
  }

  /* ── Remote：群管理（GUI 用） ─────────────── */

  /** 列出所有群的摘要（GUI 下拉框）。 */
  @Remote('listGroups')
  async listGroups(): Promise<GroupSummary[]> {
    const ids = await this.store.listGroups()
    const groups: GroupSummary[] = []
    for (const id of ids) {
      const group = await this.store.readGroup(id)
      if (group === undefined) continue
      groups.push({ id: group.id, name: group.name, description: group.description })
    }
    return groups
  }

  /** 创建一个群（人工；AI 自动建群走 autoPlace + 仲裁）。 */
  @Remote('createGroup')
  async createGroup(id: string, name: string, description: string): Promise<{ id: string }> {
    const existing = await this.store.readGroup(id)
    if (existing !== undefined) {
      throw new Error(`memory group ${JSON.stringify(id)} already exists`)
    }
    await this.store.writeGroup({ id, name, description, createdAt: Date.now() })
    // P3：创建群时生成并持久化群公理锚向量（有 embedder 时）。
    await this.store.generateGroupAnchor(id, name)
    return { id }
  }

  /** 删除一个群（连同群下所有体）。 */
  @Remote('removeGroup')
  async removeGroup(groupId: string): Promise<{ removed: boolean }> {
    const group = await this.store.readGroup(groupId)
    if (group === undefined) return { removed: false }
    await this.store.deleteGroup(groupId)
    return { removed: true }
  }

  /* ── Remote：体管理（GUI 用，管理面不受挂载限制） ─────────────── */

  /** 列出所有体的摘要。 */
  @Remote('listBodies')
  async listBodies(): Promise<BodySummary[]> {
    const ids = await this.store.listBodyIds()
    const bodies: BodySummary[] = []
    for (const id of ids) {
      const body = await this.store.readBody(id)
      if (body === undefined) continue
      bodies.push({ id: body.id, groupId: body.groupId, name: body.name, description: body.description, kind: body.kind })
    }
    return bodies
  }

  /** 创建一个体（可选指定归属群，空则归 default 群）。 */
  @Remote('createBody')
  async createBody(id: string, name: string, description: string, kind: string, groupId?: string): Promise<{ id: string }> {
    const existing = await this.store.readBody(id)
    if (existing !== undefined) {
      throw new Error(`memory body ${JSON.stringify(id)} already exists`)
    }
    const targetGroup = groupId === undefined || groupId === '' ? DEFAULT_GROUP_ID : groupId
    await this.store.writeBody({
      id,
      groupId: targetGroup,
      name,
      description,
      kind: kind as 'fts' | 'vector' | 'summary',
      trust: 'user',
      createdAt: Date.now(),
    })
    // P3：创建体时生成并持久化体公理锚向量（有 embedder 时）。
    await this.store.generateBodyAnchor(targetGroup, id, name)
    return { id }
  }

  /** 删除一个体（连同其全部条目）。 */
  @Remote('removeBody')
  async removeBody(bodyId: string): Promise<{ removed: boolean }> {
    const body = await this.store.readBody(bodyId)
    if (body === undefined) return { removed: false }
    await this.store.deleteBody(bodyId)
    return { removed: true }
  }

  /** 列出某个体的活跃条目。 */
  @Remote('listEntries')
  async listEntries(bodyId: string): Promise<EntrySummary[]> {
    const entries = await this.store.readEntries(bodyId)
    const result: EntrySummary[] = []
    for (const e of entries) {
      if (e.status === 'active' && e.weight > 0) {
        result.push({ bodyId: e.bodyId, authority: e.authority, content: e.content, id: e.id })
      }
    }
    return result
  }

  /** 列出某会话当前挂载的体 id（供 client 显示挂载状态）。 */
  @Remote('listMounted')
  async listMounted(sessionId: string): Promise<string[]> {
    return this.store.mountedForSession(sessionId)
  }

  /* ── Remote：AI 自动归置 + 仲裁（P4） ─────────────── */

  /** AI 自动归置（现有群都明显不匹配时才调用）：判定 + 执行或入队仲裁。 */
  @Remote('placeMemory')
  async placeMemory(content: string, aiVerdict: 'assign' | 'create', suggestedGroupName?: string): Promise<{ action: 'assign-existing' | 'create-new' | 'conflict'; groupId?: string | undefined; arbitration?: PendingArbitration | undefined }> {
    return this.store.placeMemory(content, aiVerdict, suggestedGroupName)
  }

  /** 列出待人工仲裁项（GUI 弹窗轮询）。 */
  @Remote('listPendingArbitrations')
  async listPendingArbitrations(): Promise<PendingArbitration[]> {
    return this.store.listPendingArbitrations()
  }

  /** 人工仲裁决策（三选项：归入现有群 / 新建群）。 */
  @Remote('resolveArbitration')
  async resolveArbitration(arbitrationId: string, decision: ArbitrationDecision): Promise<{ groupId?: string; error?: string }> {
    const r = await this.store.resolveArbitration(arbitrationId, decision)
    if ('error' in r) return { error: r.error }
    return { groupId: r.groupId }
  }
}

export default MemoryBodyService
