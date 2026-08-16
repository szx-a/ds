/**
 * FTS5 检索读模型：可重建、可丢弃的全文索引。
 * 权威永远在 JSONL（store.ts）；这里只做"从权威重建索引 + 检索"，
 * 照 session-query-sqlite 的 disposable read model 模式。
 *
 * v0.1 同步策略：每次 search 前全量重建挂载体的索引（正确性优先；
 * 体数量少、条目少时足够快）。后续可改增量同步。
 *
 * @module dsh-memory-body/fts
 */

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { readEntries } from './store.ts'

/** 把用户输入转义为一个 FTS5 phrase——惰性数据，绝不当作 FTS 语法执行。 */
export function quoteFtsData(query: string): string {
  return `"${query.replaceAll('"', '""')}"`
}

export interface FtsHit {
  bodyId: string
  authority: 'user' | 'model'
  content: string
  id: string
}

export class MemoryFts {
  private db: DatabaseSync

  constructor(path: string) {
    // 确保父目录存在（照 session-query-sqlite 打开数据库前 mkdir 的先例），
    // 否则 root 目录不存在时 new DatabaseSync 会抛 "unable to open database file"。
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path)
    // 每次启动重建表结构：tokenize 切换（unicode61→trigram）时旧表定义会残留，
    // IF NOT EXISTS 不会重建。索引数据由 rebuildBody 在每次 search 前从 JSONL 权威层重建，DROP 不丢数据。
    this.db.exec(`
      DROP TABLE IF EXISTS entries_fts;
      CREATE VIRTUAL TABLE entries_fts USING fts5(
        content,
        body_id UNINDEXED,
        entry_id UNINDEXED,
        authority UNINDEXED,
        tokenize = 'trigram'
      )
    `)
  }

  close(): void {
    this.db.close()
  }

  /** 全量重建一个体的 FTS 索引（只索引活跃条目：weight>0 且未 superseded）。 */
  async rebuildBody(root: string, bodyId: string): Promise<void> {
    const entries = await readEntries(root, bodyId)
    const active = entries.filter(e => e.status === 'active' && e.weight > 0)
    const del = this.db.prepare('DELETE FROM entries_fts WHERE body_id = ?')
    const ins = this.db.prepare(
      'INSERT INTO entries_fts (content, body_id, entry_id, authority) VALUES (?, ?, ?, ?)',
    )
    this.db.exec('BEGIN')
    try {
      del.run(bodyId)
      for (const e of active) ins.run(e.content, e.bodyId, e.id, e.authority)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /** FTS5 检索，按 body_id 过滤（权限边界：只返回挂载体的命中）。 */
  search(query: string, bodyIds: string[]): FtsHit[] {
    if (bodyIds.length === 0) return []
    // trigram 分词器最短 3 字符（按 Unicode 码点），更短的查询直接无命中，避免 FTS 报错。
    if ([...query].length < 3) return []
    const phrase = quoteFtsData(query)
    const rows = this.db.prepare(
      'SELECT body_id, entry_id, authority, content FROM entries_fts WHERE entries_fts MATCH ?',
    ).all(phrase) as Array<{ body_id: string; entry_id: string; authority: string; content: string }>
    const wanted = new Set(bodyIds)
    return rows
      .filter(row => wanted.has(row.body_id))
      .map(row => ({ bodyId: row.body_id, authority: row.authority as 'user' | 'model', content: row.content, id: row.entry_id }))
  }
}
