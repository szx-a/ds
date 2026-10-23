/**
 * Cordis-free 权威存储层：记忆体的 JSONL 文件读写。
 *
 * 目录布局（"目录即群" + "目录即体" 的层级延续 + "JSONL 即权威"）：
 *
 *   <root>/
 *     <groupId-encoded>/            # 一个群 = 一个目录（归属刚性：体物理存在于群内）
 *       group.json                  # 群元数据（name/description/anchorRef）—— 用户可手改
 *       <bodyId-encoded>/           # 一个体 = 群下的一个目录，目录名 = 编码后的体 id
 *         body.json                 # 体元数据（groupId/name/description/kind/trust）—— 用户可手改
 *         entries.jsonl             # 记忆条目（append-only，一行一条）—— 用户可手改
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
  /** 归属群 id（刚性 ∈ 关系；物理上由体所在群目录决定，此为冗余记录便于查询）。 */
  groupId: string
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
  /** 词条内容向量（LMA 自持；P2 内存暂存，P3 二进制持久化）。 */
  embedding?: number[]
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

/** 群 id 的合法形状（与 BODY_ID 同约定）。 */
export const GROUP_ID = /^[a-z0-9][a-z0-9-]*$/

/** 群目录绝对路径。 */
export function groupDir(root: string, groupId: string): string {
  if (!GROUP_ID.test(groupId)) {
    throw new Error(`invalid memory group id: ${JSON.stringify(groupId)} (must match ${GROUP_ID})`)
  }
  return join(root, encodeSegment(groupId))
}

/** 群下某体的目录绝对路径（归属刚性：体物理存在于群内）。 */
export function bodyDirInGroup(root: string, groupId: string, bodyId: string): string {
  if (!BODY_ID.test(bodyId)) {
    throw new Error(`invalid memory body id: ${JSON.stringify(bodyId)} (must match ${BODY_ID})`)
  }
  return join(groupDir(root, groupId), encodeSegment(bodyId))
}

/** 列出 root 下所有群目录 id。 */
export async function listGroupIds(root: string): Promise<string[]> {
  let children: string[]
  try {
    children = await readdir(root)
  } catch {
    return []
  }
  const ids: string[] = []
  for (const child of children) {
    if (GROUP_ID.test(child)) ids.push(child)
  }
  return ids.sort()
}

/**
 * 定位体所在群目录（目录结构是归属的物理权威：扫描所有群找体）。
 * 返回 undefined 表示体不存在于任何群。
 */
async function findBodyDir(root: string, bodyId: string): Promise<string | undefined> {
  // 「群/体」路径（带斜杠）：直接定位该群下的体，免扫描。
  const slash = bodyId.indexOf('/')
  if (slash >= 0) {
    const groupId = bodyId.slice(0, slash)
    const bId = bodyId.slice(slash + 1)
    if (groupId === '' || bId === '') return undefined
    const dir = bodyDirInGroup(root, groupId, bId)
    try {
      await readFile(join(dir, 'body.json'), 'utf8')
      return dir
    } catch {
      return undefined
    }
  }
  // 纯体 id：扫描所有群定位。
  for (const groupId of await listGroupIds(root)) {
    const dir = bodyDirInGroup(root, groupId, bodyId)
    try {
      await readFile(join(dir, 'body.json'), 'utf8')
      return dir
    } catch {
      // 该群下无此体，继续找下一个群
    }
  }
  return undefined
}

function bodyMetaPath(dir: string): string {
  return join(dir, 'body.json')
}

function entriesPath(dir: string): string {
  return join(dir, 'entries.jsonl')
}

/* ------------------------------------------------------------------ 体元数据 */

/** 列出 root 下所有体目录（遍历所有群下的体）。 */
export async function listBodyIds(root: string): Promise<string[]> {
  const ids: string[] = []
  for (const groupId of await listGroupIds(root)) {
    for (const child of await listBodyIdsInGroup(root, groupId)) {
      ids.push(child)
    }
  }
  return ids.sort()
}

/** 列出某群下的所有体 id。 */
export async function listBodyIdsInGroup(root: string, groupId: string): Promise<string[]> {
  let children: string[]
  try {
    children = await readdir(groupDir(root, groupId))
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
  const dir = await findBodyDir(root, bodyId)
  if (dir === undefined) return undefined
  try {
    const text = await readFile(bodyMetaPath(dir), 'utf8')
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

/** 写一个体的元数据（创建或覆盖，用户手改的入口之一）。体必须声明 groupId。 */
export async function writeBody(root: string, body: MemoryBody): Promise<void> {
  if (body.id !== body.id.trim() || !BODY_ID.test(body.id)) {
    throw new Error(`invalid memory body id: ${JSON.stringify(body.id)}`)
  }
  if (!GROUP_ID.test(body.groupId)) {
    throw new Error(`invalid memory group id: ${JSON.stringify(body.groupId)} (must match ${GROUP_ID})`)
  }
  const dir = bodyDirInGroup(root, body.groupId, body.id)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await writeFile(bodyMetaPath(dir), JSON.stringify(body, null, 2) + '\n')
}

/** 删除一个体（连同它的 body.json 和 entries.jsonl）。不存在则 no-op。 */
export async function deleteBody(root: string, bodyId: string): Promise<void> {
  const dir = await findBodyDir(root, bodyId)
  if (dir === undefined) return
  await rm(dir, { recursive: true, force: true })
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
  const dir = await findBodyDir(root, full.bodyId)
  if (dir === undefined) {
    throw new Error(`memory body ${JSON.stringify(full.bodyId)} does not exist; create it before appending entries`)
  }
  await appendFile(entriesPath(dir), JSON.stringify(full) + '\n')
  return full
}

/**
 * 读取一个体的全部条目（含被推翻的旧条目，调用方按需过滤）。
 * 同 id 取最后一条：append-only 的"读时最新"折叠——supersede 追加的
 * 推翻标记行（复用旧 id）会覆盖旧条目的 active 状态，检索过滤 active 即得最新。
 * 容忍 torn tail（最后一行没写完就丢弃），但已提交行的 JSON 错误会抛出。
 */
export async function readEntries(root: string, bodyId: string): Promise<MemoryEntry[]> {
  const dir = await findBodyDir(root, bodyId)
  if (dir === undefined) return []
  return readEntriesFromDir(dir, bodyId)
}

/** 按体目录读条目（供群级 FTS 用：体目录已由调用方定位，免去再次 findBodyDir 扫描）。 */
export async function readEntriesFromDir(dir: string, bodyId: string): Promise<MemoryEntry[]> {
  let text: string
  try {
    text = await readFile(entriesPath(dir), 'utf8')
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
  const dir = await findBodyDir(root, oldEntry.bodyId)
  if (dir === undefined) {
    throw new Error(`memory body ${JSON.stringify(oldEntry.bodyId)} does not exist`)
  }
  const path = entriesPath(dir)
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
  const dir = await findBodyDir(root, oldEntry.bodyId)
  if (dir === undefined) {
    throw new Error(`memory body ${JSON.stringify(oldEntry.bodyId)} does not exist`)
  }
  await appendFile(entriesPath(dir), JSON.stringify(marker) + '\n')
  return marker
}

/* ------------------------------------------------------------------ 挂载目标 */

/** 展开后的「要检索的体」（含群信息，用于群级 FTS 隔离）。 */
export interface MountBody {
  groupId: string
  bodyId: string
}

/**
 * 把挂载目标路径展开为「要检索的体」列表。
 *
 * 挂载语法（P1）：
 * - 单段 `physics` = 挂载整个群（展开为该群下所有体）。
 * - 两段 `physics/quantum` = 挂载群里某个体。
 * - 旧式单段体 id（如 `code`，P0 迁移前遗留）= 归入 general 群（向后兼容）。
 */
export async function expandMountTargets(root: string, targets: readonly string[]): Promise<MountBody[]> {
  const result: MountBody[] = []
  const groupIds = new Set(await listGroupIds(root))
  for (const target of targets) {
    const seg = target.split('/').filter(s => s.length > 0)
    if (seg.length >= 2) {
      // 两段：group/body
      const groupId = seg[0]
      const bodyId = seg.slice(1).join('/')
      if (groupId !== undefined) {
        result.push({ groupId, bodyId })
      }
    } else if (seg.length === 1) {
      const single = seg[0]
      if (single !== undefined && groupIds.has(single)) {
        // 单段且是群：展开为群下所有体
        for (const bodyId of await listBodyIdsInGroup(root, single)) {
          result.push({ groupId: single, bodyId })
        }
      } else if (single !== undefined) {
        // 单段且不是群：旧式体 id，扫描所有群定位其归属（向后兼容）。
        for (const groupId of groupIds) {
          for (const bodyId of await listBodyIdsInGroup(root, groupId)) {
            if (bodyId === single) {
              result.push({ groupId, bodyId })
            }
          }
        }
        // 找不到归属的体：跳过（目标不存在，检索时自然无命中）。
      }
    }
  }
  return result
}

/** 解析 root 为绝对路径（供插件在 apply 时调用）。 */
export function resolveRoot(root: string): string {
  return resolve(root)
}
