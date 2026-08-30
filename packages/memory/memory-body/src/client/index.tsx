/**
 * client 插件入口：贡献 settings tab，并自己 mount host 的 memoryBody Remote。
 *
 * 关键：api-remotes 的 Remote mount 是显式白名单（只含官方包），
 * 第三方包的 Remote 必须由 client 插件自己 ctx.remote.$mount（照 api-remotes 的 apply 先例）。
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import memoryBodyRemote from '@szx-a/dsh-layered-memory-architecture/remote'
import type {} from '@szx-a/dsh-layered-memory-architecture/remote'
import { MemoryBodyTab, type BodyRow, type EntryRow, type MemoryBodyTabInjected } from './MemoryBodyTab.tsx'
import { MountedBodiesLine } from './MountedBodiesLine.tsx'

export const inject = ['slots', 'remote']

export async function apply(ctx: ClientContext): Promise<void> {
  // 自己 mount memoryBody Remote（第三方包不在 api-remotes 白名单里）
  const dispose = await ctx.remote.$mount(memoryBodyRemote)
  ctx.effect(() => () => { void dispose() }, 'memoryBody remote dispose')

  const remote = ctx.get('remote.memoryBody') as TypertRemoteNamespaceMap['memoryBody'] | undefined
  if (!remote) throw new Error('memoryBody remote did not mount')

  const injected = (): MemoryBodyTabInjected => ({
    listBodies: async (): Promise<BodyRow[]> => {
      const r = await remote.listBodies()
      if (!r.ok) throw new Error(`listBodies failed: ${r.error.code}: ${r.error.message}`)
      return r.value
    },
    createBody: async (id, name, description, kind) => {
      const r = await remote.createBody(id, name, description, kind)
      if (!r.ok) throw new Error(`createBody failed: ${r.error.code}: ${r.error.message}`)
      return r.value
    },
    removeBody: async (bodyId) => {
      const r = await remote.removeBody(bodyId)
      if (!r.ok) throw new Error(`removeBody failed: ${r.error.code}: ${r.error.message}`)
      return r.value
    },
    listEntries: async (bodyId): Promise<EntryRow[]> => {
      const r = await remote.listEntries(bodyId)
      if (!r.ok) throw new Error(`listEntries failed: ${r.error.code}: ${r.error.message}`)
      return r.value
    },
  })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'memory-body',
    order: 20,
    label: () => '记忆体',
    inject: injected,
  }, MemoryBodyTab))

  // 输入框 dock 的挂载状态标签（照官方 StatsLine 的先例）。
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'memory-mounted',
    order: 1,
    inject: (sessionId: string) => ({
      listMounted: async (): Promise<string[]> => {
        const r = await remote.listMounted(sessionId)
        return r.ok ? r.value : []
      },
    }),
  }, MountedBodiesLine))
}
