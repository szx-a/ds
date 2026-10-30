# 验证清单（按顺序执行）

这是让 `dsh-memory-body` 从"静态代码"变成"能跑的插件"的验证步骤。每步有命令和预期结果。

## 第 0 步：确认环境

```powershell
node --version
```

需要 Node 22.19+ 或 24+（Harness 的要求）。Harness 根目录有 `tsx`（`pnpm dsh` 就是靠它加载 TS）。

## 第 1 步：跑存储层测试（不依赖 Harness，先验证 store.ts 对不对）

在 **Harness 根目录**（`F:\DSH\deepseek-harness`）执行：

```powershell
node --import tsx/esm F:/dp/memory-body-plugin/test/store.test.ts
```

预期输出五组 `✓`，最后一行 `全部通过`：

```
✓ encodeSegment 路径安全
✓ writeBody / readBody
✓ appendEntry / readEntries
✓ supersedeEntry 降权不删除（旧条目折叠为 superseded，出处链完整）
✓ retireEntry 纯降权（/forget 语义）
全部通过。测试根目录： ...
```

**如果报错**：把完整报错贴回来。这一步不通过，后面都不用做。

## 第 1.5 步：跑 FTS 读模型测试

```powershell
node --import tsx/esm F:/dp/memory-body-plugin/test/fts.test.ts
```

预期输出四组 `✓` + `全部通过`：

```
✓ FTS5 分词检索（pnpm 命中 2 条）
✓ FTS5 单词检索（build 命中 1 条）
✓ phrase 转义（FTS 语法注入被当作惰性数据）
✓ 权限过滤（未挂载体不命中）
全部通过。测试根目录： ...
```

这一步验证 FTS5 读模型（`node:sqlite`）在你环境里可用、分词正确、注入被防住。

## 第 2 步：创建记忆体（临时手动方式，GUI 会替代）

```powershell
New-Item -ItemType Directory -Force F:/dp/memory-body-data/code | Out-Null
Set-Content -Path F:/dp/memory-body-data/code/body.json -Value '{
  "id": "code",
  "name": "Code",
  "description": "代码片段、踩过的坑、相似流程",
  "kind": "fts",
  "trust": "user",
  "createdAt": 0
}'
```

## 第 3 步：加载插件（web 模式：加进 agent preset）

`pnpm dsh web` 的模型面向命令/工具由 **agent preset** 组合（`web-app/cordis.patch.yml` 把 `tool-todo`、`command-compact` 全移到 preset）。本插件注册命令+工具，所以要加进 preset 的 `agent.cordis.yml`。

最快方式：编辑 shipped 的 `apps/cli/config/agent-presets/standard/agent.cordis.yml`，末尾加：

```yaml
- id: memory-body
  name: 'F:/dp/memory-body-plugin/src/index.ts'
  config:
    root: 'F:/dp/memory-body-data'
    defaultBodies: [code]
```

然后照常启动 `pnpm dsh web`。

**加载成功标志**：Harness 正常启动，不报 `plugin tree failed to load`；如果报错，把报错贴回来。

> 正式做法（不改 shipped 文件）：copy standard 到 `$DSH_HOME/.agent-presets/`，在那份副本加本行，再在设置里选它为默认 preset。

## 第 4 步：跑通闭环

在 Harness 里依次试：

1. `/remember 用 pnpm run build:web 构建 Web 前端`
   → 预期：回复 `Remembered into body "code" (entry ...)`。

2. 让模型搜：`memory_search 里查一下 pnpm 构建`（或直接问"我记过 pnpm 构建相关的东西吗"）
   → 预期：模型调用 `memory_search`，返回第 1 步存的条目。

3. `/summarize`
   → 预期：模型总结当前会话，回复 `Summarized into body "code" (entry ...)`。

4. `/forget 构建`
   → 预期：回复 `Retired N memories matching "构建" (kept in history, not deleted)`；之后 `memory_search` 不再返回被废弃的条目。

## 后台文件检查（"双编辑"的验证）

打开 `F:/dp/memory-body-data/code/entries.jsonl`，你应该能看到上面的条目（一行一条 JSON），可直接手改或删行。改完再 `memory_search` 验证生效。

---

## 常见问题预判

- **加载报 `Cannot find module '@deepseek-ai/cordis'`**：说明 Harness 不是 tsx 启动，或 bareModuleBaseUrl 没指向 harness。贴报错。
- **报 `inject` 服务不存在**：说明 commands/tools/llm 之一不在你的组合里。贴报错，我看你的 cordis.yml 补依赖。
- **`/summarize` 报 no provider/model**：先正常对话一轮（让 request header 记录 provider/model），再 summarize。
