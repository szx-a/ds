/**
 * 可插拔 embedding 层：LMA 自持向量的接口定义 + 降级实现。
 *
 * 设计原则（延续"embedding 是增强层，不是前置依赖"）：
 * - Embedder 是可插拔接口：真实实现（本地模型 / 官方服务 / 外部 API）由上层注入。
 * - NullEmbedder 是降级兜底：无 embedding 时返回空向量，检索退化为纯 FTS5，功能不丢。
 * - anchor 用于生成群/体的公理锚向量（P3 用），embed 用于生成词条内容向量。
 *
 * @module dsh-memory-body/embed
 */

/** 可插拔 embedding 接口。 */
export interface Embedder {
  /** 生成一段文本的内容向量。 */
  embed(text: string): Promise<number[]>
  /** 生成"领域/主题概念"的锚向量（创建群/体时调用）。 */
  anchor(concept: string): Promise<number[]>
}

/** 降级实现：无 embedding 时返回空向量（调用方检测空向量即退化为 FTS5 检索）。 */
export class NullEmbedder implements Embedder {
  async embed(): Promise<number[]> {
    return []
  }

  async anchor(): Promise<number[]> {
    return []
  }
}

/** 判断一个向量是否有效（非空即视为有 embedding）。 */
export function hasEmbedding(vector: readonly number[]): boolean {
  return vector.length > 0
}

/** 余弦相似度（向量精排用；两向量任一方为空返回 0）。 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0
    const bi = b[i] ?? 0
    dot += ai * bi
    na += ai * ai
    nb += bi * bi
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
