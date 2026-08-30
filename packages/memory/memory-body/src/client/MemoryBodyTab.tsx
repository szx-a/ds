import { useEffect, useState, type ReactNode } from 'react'

/** Remote 面：host 的 memoryBody Remote 方法（client 侧注入）。 */
export interface MemoryBodyTabInjected {
  listBodies(): Promise<BodyRow[]>
  createBody(id: string, name: string, description: string, kind: string): Promise<{ id: string }>
  removeBody(bodyId: string): Promise<{ removed: boolean }>
  listEntries(bodyId: string): Promise<EntryRow[]>
}

export interface BodyRow {
  id: string
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

/** 体管理卡片：列出所有体、创建、删除、展开看条目。 */
export function MemoryBodyTab(props: MemoryBodyTabInjected): ReactNode {
  const { listBodies, createBody, removeBody, listEntries } = props
  const [bodies, setBodies] = useState<BodyRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [entries, setEntries] = useState<Record<string, EntryRow[]>>({})

  const reload = (): void => {
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
    const trimmedId = id.trim()
    if (trimmedId === '' || name.trim() === '') return
    void createBody(trimmedId, name.trim(), description.trim(), 'fts').then(
      () => {
        setId('')
        setName('')
        setDescription('')
        setError(null)
        reload()
      },
      (e: unknown) => { setError(e instanceof Error ? e.message : String(e)) },
    )
  }

  const remove = (bodyId: string): void => {
    void removeBody(bodyId).then(
      () => {
        setEntries((prev) => { const next = { ...prev }; delete next[bodyId]; return next })
        if (expanded === bodyId) setExpanded(null)
        reload()
      },
      (e: unknown) => { setError(e instanceof Error ? e.message : String(e)) },
    )
  }

  const toggle = (bodyId: string): void => {
    setExpanded(prev => (prev === bodyId ? null : bodyId))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontWeight: 600 }}>记忆体</div>

      {/* 创建表单 */}
      <div style={{ display: 'flex', gap: 6 }}>
        <input placeholder="id（小写字母/数字/连字符）" value={id} onChange={e => setId(e.target.value)} />
        <input placeholder="名称" value={name} onChange={e => setName(e.target.value)} />
        <input placeholder="描述（可选）" value={description} onChange={e => setDescription(e.target.value)} />
        <button type="button" onClick={create}>创建</button>
      </div>

      {error !== null ? <div style={{ color: '#d33' }}>{error}</div> : null}

      {/* 体列表 */}
      {bodies.length === 0
        ? <div>还没有记忆体。</div>
        : bodies.map(body => (
          <div key={body.id} style={{ border: '1px solid #ccc', borderRadius: 4, padding: 8 }}>
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
  )
}
