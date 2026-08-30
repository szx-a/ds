/**
 * preset 侧工具：memory_search（检索）与 memory_remember（模型主动写入）。
 * 通过 host 平面的 MemoryStore 访问存储；权限边界只限挂载集内的体。
 *
 * @module @szx-a/dsh-layered-memory-architecture-preset/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { MemoryStore } from '@szx-a/dsh-layered-memory-architecture/memory-store'

const MAX_HITS = 5

export function registerSearchTool(ctx: Context, store: MemoryStore): void {
  ctx.tools.register(defineTool({
    name: 'memory_search',
    description:
      'Search the mounted memory bodies for durable knowledge (user-remembered documents and model-summarized experience). '
      + 'Use it to recall cross-session context relevant to the current task. Returns the matched entries and the body they came from.',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'Literal keywords or phrase to search for in memory content.',
      },
      bodyId: {
        type: 'string',
        description: 'Optional specific memory body id to search; omit to search all mounted bodies.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          hits: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                bodyId: { type: 'string', required: true },
                authority: { type: 'string', required: true, enum: ['user', 'model'] },
                content: { type: 'string', required: true },
                id: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        if (value.hits.length === 0) return [{ type: 'text', text: 'No matching memory found.' }]
        const lines = value.hits.map(hit => `[${hit.bodyId}] (${hit.authority}) ${hit.content}`)
        return [{ type: 'text', text: `Found ${value.hits.length} matching memor${value.hits.length === 1 ? 'y' : 'ies'}:\n${lines.join('\n')}` }]
      },
    },
    async execute(args, exec) {
      const mountedList = store.mountedFor(exec.agent)
      if (mountedList.length === 0) {
        throw new Error('no memory body mounted; configure `defaultBodies` in cordis.yml first')
      }
      // 权限边界：显式指定的体也必须属于挂载集，否则拒绝。
      const targets = args.bodyId !== undefined && args.bodyId !== ''
        ? (mountedList.includes(args.bodyId) ? [args.bodyId] : [])
        : mountedList
      if (targets.length === 0) {
        throw new Error(`memory body ${JSON.stringify(args.bodyId)} is not mounted`)
      }
      const hits = (await store.search(args.query, targets)).slice(0, MAX_HITS)
      return {
        hits: hits.map(hit => ({
          bodyId: hit.bodyId,
          authority: hit.authority,
          content: hit.content,
          id: hit.id,
        })),
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Search memory', kind: 'other', rawInput: args.query }),
  }))
}

/** 注册 memory_remember：模型在用户明确要求"记住 xxx"时，主动写入 authority='user' 的条目。 */
export function registerRememberTool(ctx: Context, store: MemoryStore): void {
  ctx.tools.register(defineTool({
    name: 'memory_remember',
    description:
      'Store a durable note into a mounted memory body when the user explicitly asks to remember/save/store something. '
      + 'First resolve what the user actually wants remembered (e.g. "记住之前那篇文档的关键内容" means the document\'s key content), distill it into the actual content, and store THAT — never store the "remember ..." instruction sentence itself. '
      + 'Never write to memory on your own initiative.',
    parameters: {
      content: {
        type: 'string',
        required: true,
        description: 'The actual content to remember — the distilled or verbatim content the user wants kept, NOT the "remember ..." instruction sentence.',
      },
      bodyId: {
        type: 'string',
        description: 'Optional memory body id to write to; omit to write to the default (first mounted) body.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          bodyId: { type: 'string', required: true },
          id: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Remembered into body ${JSON.stringify(value.bodyId)} (entry ${value.id}).` }],
    },
    async execute(args, exec) {
      const mountedList = store.mountedFor(exec.agent)
      if (mountedList.length === 0) {
        throw new Error('no memory body mounted; configure `defaultBodies` in cordis.yml first')
      }
      // 权限边界：显式指定的体必须属于挂载集，否则拒绝。
      let bodyId: string
      if (args.bodyId !== undefined && args.bodyId !== '') {
        if (!mountedList.includes(args.bodyId)) {
          throw new Error(`memory body ${JSON.stringify(args.bodyId)} is not mounted`)
        }
        bodyId = args.bodyId
      } else {
        const first = mountedList[0]
        if (first === undefined) throw new Error('no memory body mounted')
        bodyId = first
      }
      const entry = await store.appendEntry({
        bodyId,
        authority: 'user',
        content: args.content,
        weight: 1,
        status: 'active',
      })
      return { bodyId: entry.bodyId, id: entry.id }
    },
    presentCall: args => ({ card: 'generic', title: 'Remember', kind: 'other', rawInput: args.content }),
  }))
}

/** 注册 memory_forget：模型主动降权（标记失效，不删除，可追溯）。 */
export function registerForgetTool(ctx: Context, store: MemoryStore): void {
  ctx.tools.register(defineTool({
    name: 'memory_forget',
    description:
      'Mark a stored memory entry as superseded (inactive) so it no longer appears in memory_search. '
      + 'Call when you notice a stored memory is outdated, wrong, or superseded by newer information. '
      + 'This does NOT delete the entry — it is kept for auditability and can be undone.',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'Keyword matching the memory entry to retire (matches content substring).',
      },
      bodyId: {
        type: 'string',
        description: 'Optional body id to restrict the search; omit to search all mounted bodies.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          retired: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Retired ${value.retired} memor${value.retired === 1 ? 'y' : 'ies'} (kept in history, not deleted).` }],
    },
    async execute(args, exec) {
      const mountedList = store.mountedFor(exec.agent)
      if (mountedList.length === 0) {
        throw new Error('no memory body mounted; configure `defaultBodies` in cordis.yml first')
      }
      const targets = args.bodyId !== undefined && args.bodyId !== ''
        ? (mountedList.includes(args.bodyId) ? [args.bodyId] : [])
        : mountedList
      if (targets.length === 0) {
        throw new Error(`memory body ${JSON.stringify(args.bodyId)} is not mounted`)
      }
      const needle = args.query.toLowerCase()
      let retired = 0
      for (const bodyId of targets) {
        const entries = await store.readEntries(bodyId)
        for (const entry of entries) {
          if (entry.status === 'active' && entry.weight > 0 && entry.content.toLowerCase().includes(needle)) {
            await store.retireEntry(entry)
            retired++
          }
        }
      }
      return { retired }
    },
    presentCall: args => ({ card: 'generic', title: 'Forget memory', kind: 'other', rawInput: args.query }),
  }))
}

/** 注册 memory_correct：模型主动纠正（降权旧条目 + 写入纠正内容）。 */
export function registerCorrectTool(ctx: Context, store: MemoryStore): void {
  ctx.tools.register(defineTool({
    name: 'memory_correct',
    description:
      'Correct a stored memory that contains outdated or wrong information: mark the old entry superseded and store the corrected content. '
      + 'Call when you notice a stored memory is wrong and you know the correct version.',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'Keyword matching the old (wrong) memory entry.',
      },
      content: {
        type: 'string',
        required: true,
        description: 'The corrected content to store.',
      },
      bodyId: {
        type: 'string',
        description: 'Optional body id; omit to use the first mounted body.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          corrected: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Corrected ${value.corrected} memor${value.corrected === 1 ? 'y' : 'ies'}.` }],
    },
    async execute(args, exec) {
      const mountedList = store.mountedFor(exec.agent)
      if (mountedList.length === 0) {
        throw new Error('no memory body mounted; configure `defaultBodies` in cordis.yml first')
      }
      const bodyId = args.bodyId !== undefined && args.bodyId !== ''
        ? args.bodyId
        : mountedList[0]
      if (bodyId === undefined) throw new Error('no memory body mounted')
      if (!mountedList.includes(bodyId)) {
        throw new Error(`memory body ${JSON.stringify(bodyId)} is not mounted`)
      }
      const needle = args.query.toLowerCase()
      let corrected = 0
      const entries = await store.readEntries(bodyId)
      for (const entry of entries) {
        if (entry.status === 'active' && entry.weight > 0 && entry.content.toLowerCase().includes(needle)) {
          await store.supersedeEntry(entry, args.content, 'model')
          corrected++
        }
      }
      return { corrected }
    },
    presentCall: args => ({ card: 'generic', title: 'Correct memory', kind: 'other', rawInput: args.content }),
  }))
}
