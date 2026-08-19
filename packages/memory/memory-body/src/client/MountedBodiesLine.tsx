import { useEffect, useState, type ReactNode } from 'react'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'

/** 挂载状态标签的注入面。 */
export interface MountedBodiesLineInjected {
  listMounted(): Promise<string[]>
}

/** 输入框 dock 的挂载状态标签：显示当前会话挂载的记忆体，随挂载命令实时刷新。 */
export function MountedBodiesLine(
  props: MountedBodiesLineInjected & { useSession?: SnapshotSelectorHook<ConversationSnapshot> },
): ReactNode {
  const { listMounted, useSession } = props
  const [mounted, setMounted] = useState<string[] | null>(null)

  // 会话消息节点数作为「有变化」信号：/mount /unmount 执行后会产生新消息节点，触发重新查询。
  const nodeCount = useSession?.(s => s.chat.legacy.nodes.length) ?? 0

  useEffect(() => {
    let alive = true
    void listMounted().then(
      (rows) => { if (alive) setMounted(rows) },
      () => { if (alive) setMounted([]) },
    )
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeCount])

  if (mounted === null || mounted.length === 0) return null
  return <span title="当前会话挂载的记忆体">记忆体：{mounted.join(', ')}</span>
}
