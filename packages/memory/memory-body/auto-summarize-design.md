# 自动总结触发（v0.2）设计

> 目标：把"模型总结经验存入"从手动 `/summarize` 升级为自动触发。
> 状态：**设计定稿，代码待闭环验证通过后实现**（避免堆未验证代码）。
> 本文所有机制都已从源码确认，不是猜测。

## 一、接入点（已确认）

`agent/status` 是 scoped 事件，签名：

```ts
'agent/status'(this: Scoped<Agent>, payload: { agent: Agent; status: 'idle' | 'running' }): void
```

监听**所有** agent 需加 `{ global: true }`（照 `packages/core/agent/src/invariant.ts` 第 17-23 行的先例）：

```ts
ctx.on('agent/status', ({ agent, status }) => {
  // status === 'idle' 表示一个 turn 结束，agent 回到等待输入
}, { global: true })
```

## 二、触发条件（v0.2 最小可行版）

不依赖 token-meter（那是 v0.3 的"上下文过半"精确版），v0.2 用**消息数**做简化阈值：

| 条件 | 值 | 理由 |
|---|---|---|
| 触发点 | agent 从 `running` → `idle` | 一个 turn 干净结束，会话处于稳定状态 |
| 最少消息数 | 会话 `deriveMessages()` 长度 ≥ 15 | 太少不值得总结（总结成本 > 收益） |
| 距上次总结 | 新增消息 ≥ 10 条 | 防每个 turn 都总结（重复、费 token） |

## 三、防重复（关键）

每个 agent 记录"已总结到的消息数"（`WeakMap<Agent, number>`，照 invariant.ts 的 `WeakMap` 先例）：

- idle 时读 `deriveMessages().length`，若 `当前 - 已总结 < 10` 则跳过；
- 总结成功后更新 `已总结 = 当前长度`；
- 会话切换（agent 换会话）自然清空（WeakMap 随 agent 回收）。

## 四、总结逻辑复用

自动触发调用的总结逻辑与 `/summarize` **完全一致**，抽成一个共享函数 `summarizeIntoBody(ctx, root, bodyId, agent, signal)`：

1. `agent.session.deriveMessages()` 拿对话历史；
2. 追加总结指令（`SUMMARIZE_INSTRUCTION`）；
3. `ctx.llm.stream` + `BlockAssembler`，检查 `finish`（干净才存）；
4. `appendEntry(authority='model', provenanceSession=agent.session.id)`。

## 五、与 compaction 的关系（需区分，避免冲突）

| | compaction | 记忆体自动总结 |
|---|---|---|
| 目的 | 窗口内自救（放不下了压进会话内） | 窗口外留存（沉淀进跨会话的记忆体） |
| 触发 | token 压力（token-meter） | turn 结束（agent idle） |
| 输出 | 会话内 summary 事件 | `memory_entries` JSONL |

两者独立、可共存；**但都消耗 LLM 调用**，v0.2 先各管各的，若实际运行中互相干扰（同一 turn 既 compact 又 summarize），再考虑互斥锁。

## 六、风险与开放点

1. **agent idle ≠ 会话结束**：Web 用户可能长时间 idle 不关，idle 触发会"过早"总结中途状态。v0.2 接受这个（总结是增量的、可被后续总结覆盖）；若不好，v0.3 换 `session/disposed`（但 dispose 时 session 数据可能已不可用，需验证）。
2. **总结失败静默**：自动触发没有用户可见的"成功/失败"反馈。失败应写日志（`ctx.logger.warn`），不打断会话。
3. **provider/model 解析**：自动触发时 `resolveTarget` 可能拿不到（会话未发过请求）。需在触发前判断，拿不到就跳过本次（下个 turn 再试）。
4. **体选择**：自动总结写入哪个体？v0.2 写**所有挂载的体**，还是只写默认体？——这是产品决策，待定。

## 七、实现清单（闭环验证通过后）

1. `src/auto-summarize.ts`：注册 `agent/status` 监听 + `summarizeIntoBody` 共享函数。
2. 从 `command.ts` 抽出 `summarizeIntoBody`，`/summarize` 和自动触发共用。
3. `index.ts`：`apply` 里注册自动触发（需 `config.autoSummarize` 开关，默认关，避免惊喜）。
