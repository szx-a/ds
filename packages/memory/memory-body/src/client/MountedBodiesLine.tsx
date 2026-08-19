import { useEffect, useState, type ReactNode } from 'react'

/** 挂载状态标签的注入面。 */
export interface MountedBodiesLineInjected {
  listMounted(): Promise<string[]>
}

/** 输入框 dock 的挂载状态标签：显示当前会话挂载的记忆体。 */
export function MountedBodiesLine(props: MountedBodiesLineInjected): ReactNode {
  const { listMounted } = props
  const [mounted, setMounted] = useState<string[] | null>(null)

  useEffect(() => {
    void listMounted().then(setMounted, () => setMounted([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (mounted === null || mounted.length === 0) return null
  return <span title="当前会话挂载的记忆体">记忆体：{mounted.join(', ')}</span>
}
