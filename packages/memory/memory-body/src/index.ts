/**
 * 记忆体（Memory Body）Remote 服务：体管理的 host→client RPC + 命令注册。
 *
 * 形态照 GoalService / PluginInventoryGateway：Service 类（extends TypertRemoteService），
 * static inject + constructor(ctx) + @Remote 方法 + export default。
 * 命令（/remember 等）在 host 平面注册（照 command-goal 先例）；工具在 preset 包。
 * 存储统一走 MemoryStore（host 平面共享服务），本服务只做 RPC + 命令。
 *
 * @module @2464500754/dsh-layered-memory-architecture
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { MemoryStore } from './memory-store.ts'
import type { BodySummary, EntrySummary } from './types.ts'
import { registerCommands } from './command.ts'

export type { BodySummary, EntrySummary } from './types.ts'

export class MemoryBodyService extends TypertRemoteService {
  static inject = ['memoryStore', 'commands', 'llm']

  private readonly store: MemoryStore

  constructor(ctx: Context) {
    super(ctx, 'memoryBody')
    this.store = ctx.memoryStore
    registerCommands(ctx, this.store)
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
      bodies.push({ id: body.id, name: body.name, description: body.description, kind: body.kind })
    }
    return bodies
  }

  /** 创建一个体。 */
  @Remote('createBody')
  async createBody(id: string, name: string, description: string, kind: string): Promise<{ id: string }> {
    const existing = await this.store.readBody(id)
    if (existing !== undefined) {
      throw new Error(`memory body ${JSON.stringify(id)} already exists`)
    }
    await this.store.writeBody({
      id,
      name,
      description,
      kind: kind as 'fts' | 'vector' | 'summary',
      trust: 'user',
      createdAt: Date.now(),
    })
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
}

export default MemoryBodyService
