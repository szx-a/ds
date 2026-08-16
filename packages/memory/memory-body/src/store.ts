/**
 * Cordis-free 权威存储层：记忆体的 JSONL 文件读写。
 *
 * 目录布局（照 agent-presets 的"目录即体" + session-persistence-jsonl 的"JSONL 即权威"）：
 *
 *   <root>/
 *     <bodyId-encoded>/            # 一个体 = 一个目录，目录名 = 编码后的体 id
 *       body.json                  # 体元数据（name/description/kind/trust）—— 用户可手改
 *       entries.jsonl              # 记忆条目（append-only，一行一条）—— 用户可手改
 *
 * 设计原则：
 * - 权威层是【可读写的文本文件】，不是 SQLite —— 满足"用户能在后台文件改"。
 * - 条目 append-only，降权不删除：推翻旧经验 = 追加新条目 + 旧条目标记 superseded。
 * - 所有路径经 encodeSegment 编码，防目录穿越。
 * - 纯函数、无 ctx 依赖，可独立单元测试（照 spill-local/store.ts 的分层）。
 *
 * @module dsh-memory-body/store
 */

import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** 体 id 的合法形状（照 agent-presets 的 PRESET_ID 约定）。 */
export const BODY_ID = /^[a-z0-9][a-z0-9-]*$/

/**
 * 编码任意字符串为一个安全路径段（照 spill-local 的 encodeSegment，镜像
 * session-persistence-jsonl 的同名函数）。反转 `../`、绝对路径、NUL、分隔符。
 */
export function encodeSegment(raw: string): string {
  if (raw.length === 0) return '~'
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      out += ch
    } else {
      out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
    }
  }
  return out
}

/** 体的信任档位（照 agent-presets 的 PresetTrust：system/user）。 */
export type BodyTrust = 'system' | 'user'

/** 体的检索策略标记：FTS5（第一版）/ vector / summary（Provider 扩展点）。 */
export type BodyKind = 'fts' | 'vector' | 'summary'

/** 一个命名记忆体的元数据（body.json 的内容）。 */
export interface MemoryBody {
  id: string
  name: string
  description: string
  kind: BodyKind
  trust: BodyTrust
  createdAt: number
}

/** 条目权威：user（用户钦定的文档，只读引用）| model（模型总结的经验，可编辑）。 */
export type EntryAuthority = 'user' | 'model'

/** 条目状态：active（活跃）| superseded（被新经验推翻，检索时过滤）。 */
export type EntryStatus = 'active' | 'superseded'

/** 一条记忆条目（entries.jsonl 的一行）。 */
export interface MemoryEntry {
  id: string
  bodyId: string
  authority: EntryAuthority
  content: string
  /** 出处：模型总结来自哪个会话、哪条事件（user 条目可省略）。 */
  provenanceSession?: string
  provenanceSeq?: number
  /** 检索权重：被推翻降为 0，活跃为 1（未来可扩展自然衰减）。 */
  weight: number
  status: EntryStatus
  /** 指向推翻它的新条目 id（降权不删除的链）。 */
  supersededBy?: string
  createdAt: number
  updatedAt: number
}

/* ------------------------------------------------------------------ 路径 */

function bodyDir(root: string, bodyId: string): string {
  if (!BODY_ID.test(bodyId)) {
    throw new Error(`invalid memory body id: ${JSON.stringify(bodyId)} (must match ${BODY_ID})`)
  }
  return join(root, encodeSegment(bodyId))
}

function bodyMetaPath(root: string, bodyId: string): string {
  return join(bodyDir(root, bodyId), 'body.json')
}

function entriesPath(root: string, bodyId: string): string {
  return join(bodyDir(root, bodyId), 'entries.jsonl')
}

/* ------------------------------------------------------------------ 体元数据 */

/** 列出 root 下所有体目录（只认合法 id 的目录）。 */
export async function listBodyIds(root: string): Promise<string[]> {
  let children: string[]
  try {
    children = await readdir(root)
  } catch {
    return []
  }
  const ids: string[] = []
  for (const child of children) {
    if (BODY_ID.test(child)) ids.push(child)
  }
  return ids.sort()
}

/** 读一个体的元数据；不存在返回 undefined。 */
export async function readBody(root: string, bodyId: string): Promise<MemoryBody | undefined> {
  try {
    const text = await readFile(bodyMetaPath(root, bodyId), 'utf8')
    const parsed = JSON.parse(text) as MemoryBody
    if (parsed.id !== bodyId) {
      throw new Error(`body.json id mismatch: expected ${bodyId}, got ${parsed.id}`)
    }
    return parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** 写一个体的元数据（创建或覆盖，用户手改的入口之一）。 */
export async function writeBody(root: string, body: MemoryBody): Promise<void> {
  if (body.id !== body.id.trim() || !BODY_ID.test(body.id)) {
    throw new Error(`invalid memory body id: ${JSON.stringify(body.id)}`)
  }
  await mkdir(bodyDir(root, body.id), { recursive: true, mode: 0o700 })
  await writeFile(bodyMetaPath(root, body.id), JSON.stringify(body, null, 2) + '\n')
}

/** 删除一个体（连同它的 body.json 和 entries.jsonl）。不存在则 no-op。 */
export async function deleteBody(root: string, bodyId: string): Promise<void> {
  await rm(bodyDir(root, bodyId), { recursive: true, force: true })
}

/* ------------------------------------------------------------------ 条目 */

/**
 * 追加一条记忆条目（append-only）。返回落盘后的完整条目。
 * 写入走排他追加：条目 id 由调用方（或此处）生成，保证可追溯。
 */
export async function appendEntry(
  root: string,
  entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
): Promise<MemoryEntry> {
  const now = Date.now()
  const full: MemoryEntry = {
    id: entry.id ?? randomUUID(),
    ...entry,
    createdAt: now,
    updatedAt: now,
  }
  await mkdir(bodyDir(root, full.bodyId), { recursive: true, mode: 0o700 })
  await appendFile(entriesPath(root, full.bodyId), JSON.stringify(full) + '\n')
  return full
}

/**
 * 读取一个体的全部条目（含被推翻的旧条目，调用方按需过滤）。
 * 同 id 取最后一条：append-only 的"读时最新"折叠——supersede 追加的
 * 推翻标记行（复用旧 id）会覆盖旧条目的 active 状态，检索过滤 active 即得最新。
 * 容忍 torn tail（最后一行没写完就丢弃），但已提交行的 JSON 错误会抛出。
 */
export async function readEntries(root: string, bodyId: string): Promise<MemoryEntry[]> {
  let text: string
  try {
    text = await readFile(entriesPath(root, bodyId), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const byId = new Map<string, MemoryEntry>()
  const lines = text.split('\n')
  for (const line of lines) {
    if (line.length === 0) continue
    try {
      const entry = JSON.parse(line) as MemoryEntry
      byId.set(entry.id, entry)
    } catch {
      // torn tail（最后一行没写完）容忍；中间行损坏属于文件被手改坏，抛出。
      if (line !== lines[lines.length - 1]) {
        throw new Error(`corrupt entries.jsonl in body ${JSON.stringify(bodyId)}: unparsable line`)
      }
    }
  }
  return [...byId.values()]
}

/**
 * 降权不删除：新经验推翻旧经验。
 * 追加一条新条目（weight=1），并把旧条目标记为 superseded（weight=0 + supersededBy）。
 * 物理上不删旧条目，出处链完整、可回滚。
 */
export async function supersedeEntry(
  root: string,
  oldEntry: MemoryEntry,
  newContent: string,
  authority: EntryAuthority = 'model',
): Promise<MemoryEntry> {
  const now = Date.now()
  const newEntry: MemoryEntry = {
    id: randomUUID(),
    bodyId: oldEntry.bodyId,
    authority,
    content: newContent,
    ...oldEntry.provenanceSession !== undefined ? { provenanceSession: oldEntry.provenanceSession } : {},
    ...oldEntry.provenanceSeq !== undefined ? { provenanceSeq: oldEntry.provenanceSeq } : {},
    weight: 1,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  const path = entriesPath(root, oldEntry.bodyId)
  await appendFile(path, JSON.stringify(newEntry) + '\n')
  // 追加"推翻记录"行：标记旧条目被谁推翻（append-only，不改写旧行）。
  const marker: MemoryEntry = {
    ...oldEntry,
    weight: 0,
    status: 'superseded',
    supersededBy: newEntry.id,
    updatedAt: now,
  }
  await appendFile(path, JSON.stringify(marker) + '\n')
  return newEntry
}

/**
 * 纯降权（无新内容）：把一条旧条目标记为废弃（superseded + weight=0）。
 * 用于用户 /forget——物理不删，检索时被过滤，但出处与正文仍可追溯、可恢复。
 */
export async function retireEntry(root: string, oldEntry: MemoryEntry): Promise<MemoryEntry> {
  const now = Date.now()
  const marker: MemoryEntry = {
    ...oldEntry,
    weight: 0,
    status: 'superseded',
    updatedAt: now,
  }
  await appendFile(entriesPath(root, oldEntry.bodyId), JSON.stringify(marker) + '\n')
  return marker
}

/** 解析 root 为绝对路径（供插件在 apply 时调用）。 */
export function resolveRoot(root: string): string {
  return resolve(root)
}
