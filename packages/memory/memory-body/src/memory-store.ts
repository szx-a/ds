/**
 * MemoryStore：host 平面的共享存储服务，封装 root + FTS + 存储操作。
 * Remote（体管理）与 preset 包的命令/工具都 inject 它，共享同一份存储。
 *
 * @module @2464500754/dsh-layered-memory-architecture/memory-store
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import {
  appendEntry, deleteBody, listBodyIds, readBody, readEntries, retireEntry,
  resolveRoot, writeBody, type MemoryBody, type MemoryEntry,
} from './store.ts'
import { MemoryFts, type FtsHit } from './fts.ts'

export interface MemoryStoreConfig {
  root: string
  defaultBodies: string[]
}

/** 携带会话身份的调用者（Agent 满足此形状，避免 host 包硬依赖 dsh-agent 类型）。 */
export interface SessionOwner {
  readonly session: object
}

export class MemoryStore extends Service {
  static Config: z<MemoryStoreConfig> = z.object({
    root: z.string().required(),
    defaultBodies: z.array(z.string()).default([]),
  })

  private readonly root: string
  private readonly fts: MemoryFts
  private readonly mountedList: string[]
  /** 会话级挂载覆盖（session → 显式挂载集）。进程内存，不持久化：关会话重开即回退默认。 */
  private readonly sessionMounts = new WeakMap<object, Set<string>>()

  constructor(ctx: Context, config: MemoryStoreConfig) {
    super(ctx, 'memoryStore')
    this.root = resolveRoot(config.root)
    this.fts = new MemoryFts(join(this.root, 'index.sqlite'))
    this.mountedList = config.defaultBodies
    ctx.effect(() => () => this.fts.close(), 'memory-store fts dispose')
  }

  /** 默认（全局）挂载的体 id 列表。 */
  mounted(): string[] {
    return this.mountedList
  }

  /** 某会话的挂载集：优先取该会话的显式覆盖，否则回退默认集。 */
  mountedFor(owner: SessionOwner | undefined): string[] {
    if (owner === undefined) return this.mountedList
    const overrides = this.sessionMounts.get(owner.session)
    return overrides === undefined ? this.mountedList : [...overrides]
  }

  /** 把某个体挂到指定会话（首次挂载会先继承默认集）。 */
  mount(bodyId: string, owner: SessionOwner): void {
    let overrides = this.sessionMounts.get(owner.session)
    if (overrides === undefined) {
      overrides = new Set(this.mountedList)
      this.sessionMounts.set(owner.session, overrides)
    }
    overrides.add(bodyId)
  }

  /** 从指定会话卸下某个体（首次操作会先继承默认集再删，卸空即无挂载）。 */
  unmount(bodyId: string, owner: SessionOwner): void {
    let overrides = this.sessionMounts.get(owner.session)
    if (overrides === undefined) {
      overrides = new Set(this.mountedList)
      this.sessionMounts.set(owner.session, overrides)
    }
    overrides.delete(bodyId)
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
