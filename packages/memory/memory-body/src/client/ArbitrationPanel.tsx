import { useEffect, useState, type ReactNode } from 'react'

/** 待仲裁项（Remote listPendingArbitrations 的返回项）。 */
export interface ArbitrationRow {
  id: string
  concept: string
  thresholdVerdict: 'near' | 'far'
  aiVerdict: 'assign' | 'create'
  nearestGroupId?: string | undefined
  suggestedGroupName?: string | undefined
}

/** 仲裁决策（Remote resolveArbitration 的入参，与 host 的 ArbitrationDecision 判别联合一致）。 */
export type ArbitrationDecisionInput =
  | { kind: 'assign-existing'; groupId: string }
  | { kind: 'create-new'; groupName?: string | undefined }

export interface ArbitrationPanelInjected {
  listPendingArbitrations(): Promise<ArbitrationRow[]>
  listGroups(): Promise<Array<{ id: string; name: string; description: string }>>
  resolveArbitration(arbitrationId: string, decision: ArbitrationDecisionInput): Promise<{ groupId?: string; error?: string }>
  onResolved(): void
}

/**
 * 人工仲裁面板：轮询待仲裁项，有 conflict 就弹窗让用户选三选项：
 * ① 同意归入 AI 建议 ② 新建群（输入群名） ③ 手动指定现有群。
 */
export function ArbitrationPanel(props: ArbitrationPanelInjected): ReactNode {
  const { listPendingArbitrations, listGroups, resolveArbitration, onResolved } = props
  const [items, setItems] = useState<ArbitrationRow[]>([])
  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [newGroupName, setNewGroupName] = useState('')
  const [manualGroupId, setManualGroupId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const poll = (): void => {
    void listPendingArbitrations().then((rows) => {
      setItems(rows)
      if (rows.length > 0 && activeId === null) setActiveId(rows[0]!.id)
      if (rows.length > 0) {
        void listGroups().then(gs => setGroups(gs), () => {})
      }
    }, () => setError('listPendingArbitrations failed'))
  }

  useEffect(() => {
    poll()
    const timer = setInterval(poll, 3000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (items.length === 0) return null

  const active = items.find(i => i.id === activeId) ?? items[0]!

  const submit = (decision: ArbitrationDecisionInput): void => {
    if (active === undefined) return
    void resolveArbitration(active.id, decision).then(
      (r) => {
        if (r.error !== undefined) { setError(r.error); return }
        setActiveId(null)
        setNewGroupName('')
        setManualGroupId('')
        setError(null)
        onResolved()
        poll()
      },
      (e: unknown) => { setError(e instanceof Error ? e.message : String(e)) },
    )
  }

  return (
    <div style={{ border: '1px solid #c60', borderRadius: 6, padding: 12, background: '#fff7e6', marginTop: 8 }}>
      <div style={{ fontWeight: 600, color: '#a50' }}>⚖️ 记忆归置需要你裁决</div>
      <div style={{ marginTop: 4, fontSize: 13 }}>
        待归置内容：<b>{active?.concept}</b>
      </div>
      <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
        阈值判定：{active?.thresholdVerdict === 'near' ? '与现有群接近' : '与现有群都不匹配'}；
        AI 语义：{active?.aiVerdict === 'assign' ? '建议归入现有' : '建议新建'}
        {active?.nearestGroupId !== undefined ? `（最近群：${active.nearestGroupId}）` : ''}
      </div>

      {error !== null ? <div style={{ color: '#d33', fontSize: 12, marginTop: 4 }}>{error}</div> : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        {/* ① 同意归入 AI 建议 */}
        {active.nearestGroupId !== undefined
          ? <button type="button" onClick={() => submit({ kind: 'assign-existing', groupId: active.nearestGroupId ?? '' })}>
            ① 同意归入 AI 建议（{active.nearestGroupId}）
          </button>
          : null}

        {/* ② 新建群（输入群名） */}
        <div style={{ display: 'flex', gap: 6 }}>
          <input placeholder="② 新群名（可中文，空则自动生成 id）" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} />
          <button type="button" onClick={() => submit({ kind: 'create-new', groupName: newGroupName })}>② 新建群</button>
        </div>

        {/* ③ 手动指定现有群 */}
        <div style={{ display: 'flex', gap: 6 }}>
          <select value={manualGroupId} onChange={e => setManualGroupId(e.target.value)}>
            <option value="">③ 手动指定现有群…</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name || g.id}</option>)}
          </select>
          <button
            type="button"
            onClick={() => { if (manualGroupId !== '') submit({ kind: 'assign-existing', groupId: manualGroupId }) }}
          >
            ③ 归入指定群
          </button>
        </div>
      </div>
    </div>
  )
}
