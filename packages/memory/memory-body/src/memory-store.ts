/**
 * MemoryStore：host 平面的共享存储服务，封装 root + FTS + 存储操作。
 * Remote（体管理）与 preset 包的命令/工具都 inject 它，共享同一份存储。
 *
 * @module @2464500754/dsh-layered-memory-architecture/memory-store
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import {
  appendEntry, deleteBody, listBodyIds, readBody, readEntries, retireEntry, supersedeEntry,
  resolveRoot, writeBody, type MemoryBody, type MemoryEntry,
} from './store.ts'
import { MemoryFts, type FtsHit } from './fts.ts'

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
  private readonly fts: MemoryFts
  private readonly mountedList: string[]
  private readonly mountsPath: string
  /** 会话级挂载覆盖（sessionId → 显式挂载集）。持久化到 mounts.json，会话重启后恢复。 */
  private readonly sessionMounts: Map<string, Set<string>>

  constructor(ctx: Context, config: MemoryStoreConfig) {
    super(ctx, 'memoryStore')
    this.root = resolveRoot(config.root)
    this.fts = new MemoryFts(join(this.root, 'index.sqlite'))
    this.mountedList = config.defaultBodies
    this.mountsPath = join(this.root, 'mounts.json')
    this.sessionMounts = this.loadMounts()
    ctx.effect(() => () => this.fts.close(), 'memory-store fts dispose')
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

  appendEntry(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<MemoryEntry> {
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

  async search(query: string, bodyIds: string[]): Promise<FtsHit[]> {
    for (const bodyId of bodyIds) {
      await this.fts.rebuildBody(this.root, bodyId)
    }
    return this.fts.search(query, bodyIds)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    memoryStore: MemoryStore
  }
}

export default MemoryStore
