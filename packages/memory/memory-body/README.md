# dsh-memory-body

记忆体（Memory Body）**社区体验版**：命名、跨会话、隔离、可挂载的记忆单元。

这是《记忆体提案》（`memory-body-proposal.md`）和《实现研究》（`memory-body-implementation.md`）的**最小可运行原型**，用于验证"记忆体"这个概念——**不是**官方 seam，不阻塞、不等待官方。

## 已实现

| 能力 | 入口 | 说明 |
|---|---|---|
| 存文档 | `/remember <内容>` 或 `/remember <体id> <内容>` | 写入 `authority='user'` 的条目 |
| 模型记住 | `memory_remember` 工具（模型自动调用） | 用户说"记住 xxx"时，模型主动写入 `authority='user'`；只在用户明确要求时调用 |
| 模型总结 | `/summarize [体id]` | 模型总结当前会话，写入 `authority='model'` 的条目，带出处（会话 id） |
| 自动总结 | `config.autoSummarize: true` | agent 每个 turn 结束（idle）时，消息数达阈值自动总结（默认关） |
| 检索 | `memory_search` 工具（模型自动调用） | FTS5 读模型（可重建），只搜已挂载的体，返回 top 5 |
| 降权不删除 | `/forget <关键词>` | 匹配的活跃条目标记 superseded（物理保留、可追溯） |

## 目录结构

```
<root>/                       # 记忆体存储根（config.root）
  index.sqlite                # FTS5 读模型（可重建、可丢弃，权威不在它）
  <体id>/                     # 一个体 = 一个目录（目录名 = 体 id）
    body.json                 # 体元数据（name/description/kind/trust）—— 可手改
    entries.jsonl             # 记忆条目（append-only，一行一条）—— 可手改
```

**权威层是文本文件，不是 SQLite**——这正是"用户能在 GUI 和后台文件都能改"的兑现：你随时可以直接打开 `entries.jsonl` 手改或删行。

## 配置（agent.cordis.yml）

```yaml
- id: memory-body
  name: 'F:/dp/memory-body-plugin/src/index.ts'
  config:
    root: 'F:/dp/memory-body-data'   # 记忆体存储根（必填）
    defaultBodies: [code]            # 默认挂载的体 id 列表
    autoSummarize: false             # 是否自动总结（默认关）
```

## 加载方式（web 模式：加进 agent preset）

`pnpm dsh web` 用 profile + agent preset 机制：**模型面向的命令/工具由 agent preset 组合**（`web-app/cordis.patch.yml` 里 `tool-todo`、`command-compact` 等全被 `disabled: true` 移到 preset）。本插件注册的正是命令+工具，所以加进 agent preset 的 `agent.cordis.yml`。

最快方式（体验版）：编辑 shipped 的 `apps/cli/config/agent-presets/standard/agent.cordis.yml`，末尾加上面的配置段。

- 本插件 **provide nothing**（只消费 `commands`/`tools`/`llm`），**不需要 isolate realm**，直接一行即可。
- 依赖 Harness 用 tsx 启动（`pnpm dsh` 即 `node --import tsx/esm`）。
- 正式做法（不改 shipped 文件）：copy standard 到 `$DSH_HOME/.agent-presets/`，在那份副本里加本行，再设它为默认 preset。

## 创建体（临时方式，GUI 会替代）

```bash
mkdir -p <root>/code
cat > <root>/code/body.json <<'EOF'
{
  "id": "code",
  "name": "Code",
  "description": "代码片段、踩过的坑、相似流程",
  "kind": "fts",
  "trust": "user",
  "createdAt": 0
}
EOF
```

## 已知限制（诚实标注）

- 检索走 **FTS5 unicode61**：英文分词可靠；**中文无空格，长句可能整体成一个 token**，建议短关键词。向量 Provider 是后续。
- 挂载是 **agent.cordis.yml 配置**，不是 GUI/settings——"两头实现"只完成了"给懂的人"那一头。
- 自动总结是**消息数阈值 + turn 结束触发**（简化版），不是"上下文过半"的精确 token 阈值；且默认关。
- 没有创建/删除/编辑体的命令与 GUI——暂时手动建目录。

## 验证

见 `VERIFY.md`（分步验证）和 `RISKS.md`（加载风险清单）。核心测试：

```powershell
node --import tsx/esm F:/dp/memory-body-plugin/test/store.test.ts   # 存储层（5 ✓）
node --import tsx/esm F:/dp/memory-body-plugin/test/fts.test.ts     # FTS 读模型（4 ✓）
node F:/dp/memory-body-plugin/test/check-exports.mjs                # 导出形状
```
