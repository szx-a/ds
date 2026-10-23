import { useEffect, useState, type ReactNode } from 'react'
import { ArbitrationPanel, type ArbitrationDecisionInput, type ArbitrationRow } from './ArbitrationPanel.tsx'

/** Remote 面：host 的 memoryBody Remote 方法（client 侧注入）。 */
export interface MemoryBodyTabInjected {
  listBodies(): Promise<BodyRow[]>
  createBody(id: string, name: string, description: string, kind: string, groupId?: string): Promise<{ id: string }>
  removeBody(bodyId: string): Promise<{ removed: boolean }>
  listEntries(bodyId: string): Promise<EntryRow[]>
  listGroups(): Promise<GroupRow[]>
  createGroup(id: string, name: string, description: string): Promise<{ id: string }>
  removeGroup(groupId: string): Promise<{ removed: boolean }>
  listPendingArbitrations(): Promise<ArbitrationRow[]>
  resolveArbitration(arbitrationId: string, decision: ArbitrationDecisionInput): Promise<{ groupId?: string; error?: string }>
}

export interface BodyRow {
  id: string
  groupId: string
  name: string
  description: string
  kind: string
}

export interface EntryRow {
  bodyId: string
  authority: 'user' | 'model'
  content: string
  id: string
}

export interface GroupRow {
  id: string
  name: string
  description: string
}

/** 体管理卡片：群-体两层管理（列出群、创建/删除群、列出体、创建/删除体、展开看条目）。 */
export function MemoryBodyTab(props: MemoryBodyTabInjected): ReactNode {
  const { listBodies, createBody, removeBody, listEntries, listGroups, createGroup, removeGroup, listPendingArbitrations, resolveArbitration } = props
  const [groups, setGroups] = useState<GroupRow[]>([])
  const [bodies, setBodies] = useState<BodyRow[]>([])
  const [error, setError] = useState<string | null>(null)
  // 群创建表单
  const [groupId, setGroupId] = useState('')
  const [groupName, setGroupName] = useState('')
  const [groupDescription, setGroupDescription] = useState('')
  // 体创建表单
  const [bodyId, setBodyId] = useState('')
  const [bodyName, setBodyName] = useState('')
  const [bodyDescription, setBodyDescription] = useState('')
  const [bodyGroup, setBodyGroup] = useState('general')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [entries, setEntries] = useState<Record<string, EntryRow[]>>({})

  const reload = (): void => {
    void listGroups().then(setGroups, () => setError('listGroups failed'))
    void listBodies().then(setBodies, () => setError('listBodies failed'))
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (expanded === null || entries[expanded] !== undefined) return
    void listEntries(expanded).then(
      (rows) => { setEntries(prev => ({ ...prev, [expanded]: rows })) },
      () => { setError(`listEntries(${expanded}) failed`) },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded])

  const create = (): void => {
    const trimmedGroup = bodyGroup.trim() || 'general'
    const trimmedId = bodyId.trim()
    if (trimmedId === '' || bodyName.trim() === '') return
    void createBody(trimmedId, bodyName.trim(), bodyDescription.trim(), 'fts', trimmedGroup).then(
      () => {
        setBodyId('')
        setBodyName('')
        setBodyDescription('')
        setError(null)
        reload()
      },
      (e: unknown) => { setError(e instanceof Error ? e.message : String(e)) },
    )
  }

  const createNewGroup = (): void => {
    const trimmedId = groupId.trim()
    if (trimmedId === '' || groupName.trim() === '') return
    void createGroup(trimmedId, groupName.trim(), groupDescription.trim()).then(
      () => {
        setGroupId('')
        setGroupName('')
        setGroupDescription('')
        setError(null)
        reload()
      },
      (e: unknown) => { setError(e instanceof Error ? e.message : String(e)) },
    )
  }

  const removeGroupById = (gid: string): void => {
    void removeGroup(gid).then(
      () => {
        setEntries((prev) => {
          const next = { ...prev }
          for (const key of Object.keys(next)) {
            if (bodies.find(b => b.id === key)?.groupId === gid) delete next[key]
          }
          return next
        })
        if (expanded !== null && bodies.find(b => b.id === expanded)?.groupId === gid) setExpanded(null)
        reload()
      },
      (e: unknown) => { setError(e instanceof Error ? e.message : String(e)) },
    )
  }

  const remove = (bodyIdToRemove: string): void => {
    void removeBody(bodyIdToRemove).then(
      () => {
        setEntries((prev) => { const next = { ...prev }; delete next[bodyIdToRemove]; return next })
        if (expanded === bodyIdToRemove) setExpanded(null)
        reload()
      },
      (e: unknown) => { setError(e instanceof Error ? e.message : String(e)) },
    )
  }

  const toggle = (bodyIdToToggle: string): void => {
    setExpanded(prev => (prev === bodyIdToToggle ? null : bodyIdToToggle))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* 人工仲裁面板（有 conflict 时轮询弹出） */}
      <ArbitrationPanel
        listPendingArbitrations={listPendingArbitrations}
        listGroups={listGroups}
        resolveArbitration={resolveArbitration}
        onResolved={reload}
      />

      <div style={{ fontWeight: 600 }}>记忆体（群 - 体 - 词条）</div>

      {/* 群创建表单 */}
      <div style={{ display: 'flex', gap: 6 }}>
        <input placeholder="群 id（如 physics）" value={groupId} onChange={e => setGroupId(e.target.value)} />
        <input placeholder="群名（如 Physics 物理域）" value={groupName} onChange={e => setGroupName(e.target.value)} />
        <input placeholder="群描述（可选）" value={groupDescription} onChange={e => setGroupDescription(e.target.value)} />
        <button type="button" onClick={createNewGroup}>创建群</button>
      </div>

      {/* 体创建表单 */}
      <div style={{ display: 'flex', gap: 6 }}>
        <input placeholder="体 id（小写字母/数字/连字符）" value={bodyId} onChange={e => setBodyId(e.target.value)} />
        <input placeholder="体名" value={bodyName} onChange={e => setBodyName(e.target.value)} />
        <input placeholder="体描述（可选）" value={bodyDescription} onChange={e => setBodyDescription(e.target.value)} />
        <select value={bodyGroup} onChange={e => setBodyGroup(e.target.value)}>
          {groups.length === 0
            ? <option value="general">general</option>
            : groups.map(g => <option key={g.id} value={g.id}>{g.name || g.id}</option>)}
        </select>
        <button type="button" onClick={create}>创建体</button>
      </div>

      {error !== null ? <div style={{ color: '#d33' }}>{error}</div> : null}

      {/* 群-体列表 */}
      {groups.length === 0 && bodies.length === 0
        ? <div>还没有记忆群或记忆体。</div>
        : groups.map(group => {
          const groupBodies = bodies.filter(b => b.groupId === group.id)
          return (
            <div key={group.id} style={{ border: '1px solid #999', borderRadius: 4, padding: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <b>📁 {group.id}</b>（{group.name}）
                <button type="button" onClick={() => removeGroupById(group.id)}>删除群</button>
              </div>
              {group.description !== '' ? <div style={{ color: '#666', fontSize: 12 }}>{group.description}</div> : null}
              {/* 群下体列表 */}
              <div style={{ marginTop: 6, paddingLeft: 12 }}>
                {groupBodies.length === 0
                  ? <div style={{ color: '#999', fontSize: 12 }}>（群内无体）</div>
                  : groupBodies.map(body => (
                    <div key={body.id} style={{ border: '1px solid #ccc', borderRadius: 4, padding: 8, marginBottom: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <button type="button" onClick={() => toggle(body.id)} style={{ textAlign: 'left', border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}>
                          <b>{body.id}</b>（{body.name}）<span style={{ color: '#666' }}> {body.kind}</span>
                        </button>
                        <button type="button" onClick={() => remove(body.id)}>删除</button>
                      </div>
                      {body.description !== '' ? <div style={{ color: '#666', fontSize: 12 }}>{body.description}</div> : null}
                      {expanded === body.id
                        ? <div style={{ marginTop: 6 }}>
                          {entries[body.id] === undefined
                            ? <div>加载中…</div>
                            : entries[body.id]!.length === 0
                              ? <div style={{ color: '#666' }}>（空）</div>
                              : entries[body.id]!.map(entry => (
                                <div key={entry.id} style={{ fontSize: 13, marginBottom: 4 }}>
                                  <span style={{ color: entry.authority === 'user' ? '#036' : '#060' }}>[{entry.authority}]</span> {entry.content}
                                </div>
                              ))}
                        </div>
                        : null}
                    </div>
                  ))}
              </div>
            </div>
          )
        })}
    </div>
  )
}
