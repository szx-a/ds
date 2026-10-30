# 加载风险清单（加载进 Harness 前必读）

按"最可能先崩 → 最不可能"排序。每个风险有**报错特征**和**定位方法**。

## 已确认无风险（代码级 review 结论）

- `inject = ['commands', 'tools', 'llm']` 三个服务名正确：`commands` 由 `packages/interaction/commands` 提供，`llm` 由 `llm-deepseek`/`llm-pi-ai` 提供，`tools` 广泛存在。
- `store.ts` 权威存储层已通过 4 个单测（`encodeSegment`/`writeBody`/`appendEntry`/`supersedeEntry`）。
- 加载方式已从 `app-boot.spec.ts`（`name` 写绝对路径）+ `headless-agent/cordis.yml`（条目格式）确认。

## 风险 1：Node 版本不支持 `node:sqlite`（FTS 读模型）

- **报错特征**：加载后第一次调 `memory_search` 时，报 `node:sqlite is not supported` 或 `Cannot find module 'node:sqlite'`，或 `--experimental-sqlite` 相关提示。
- **定位**：`node --version`。`node:sqlite` 需要 **Node 22.5+**（22.19 稳定）；若你的 Node < 22.5，`fts.ts` 的 `import { DatabaseSync } from 'node:sqlite'` 会失败。
- **影响**：只影响检索，不影响 `/remember` 存储（存储走 JSONL，不依赖 sqlite）。
- **验证**：跑 `test/fts.test.ts` 能立刻暴露这个风险。

## 风险 2：插件 `.ts` 源码未被 tsx 加载

- **报错特征**：启动 Harness 时报 `Unknown file extension ".ts"` 或 `ERR_UNKNOWN_FILE_EXTENSION`。
- **定位**：确认启动命令走 `pnpm dsh`（根 package.json 的 `dsh` script 是 `node --import tsx/esm apps/cli/src/bin.ts`）。若你用的是 build 产物启动，需先把插件 `tsdown` 成 `.js`。
- **影响**：完全无法加载，这是最硬的一关。

## 风险 3：`config` 字段格式

- **报错特征**：启动报 `config` 校验失败（schemastery 的 schema 拒绝）。
- **定位**：确认 `agent.cordis.yml`（agent preset，不是 cordis.yml）里 `root` 是字符串（加引号）、`defaultBodies` 是字符串数组 `[code]`。
- **示例**：
  ```yaml
  - id: memory-body
    name: 'F:/dp/memory-body-plugin/src/index.ts'
    config:
      root: 'F:/dp/memory-body-data'
      defaultBodies: [code]
  ```

## 风险 4：`/summarize` 拿不到 provider/model

- **报错特征**：`/summarize` 回复 `No provider/model available for summarization. Route one request first.`
- **定位**：这是**预期行为**——`resolveTarget` 从 `requestHeader().config` 或 `agent.options` 拿 provider/model，两者都是"已经发过一次请求"之后才有。**先正常对话一轮，再 `/summarize`**。
- **影响**：不是 bug，是时序约束，已在 VERIFY.md 标注。

## 已知设计限制（不是 bug）

1. **中文分词**：FTS5 `unicode61` 对英文可靠；中文无空格，长句可能整体成一个 token。中文检索请用短关键词（如"构建"、"pnpm"）。
2. **FTS 每次重建**：v0.1 每次 `memory_search` 前全量重建挂载体的索引，条目少时无感；条目多（>几千）会变慢，后续改增量。
3. **挂载是 cordis.yml 配置**：不是 GUI/settings，只是"给懂的人"那一头；GUI 是后续。
4. **自动总结是手动 `/summarize`**：不是"阈值+会话结束"自动触发，那是 v0.2（接入点已探明：`agent/status` 的 `running→idle`）。

## 建议的验证顺序（重申）

1. `node --import tsx/esm F:/dp/memory-body-plugin/test/store.test.ts`（已过 4 ✓）
2. `node --import tsx/esm F:/dp/memory-body-plugin/test/fts.test.ts`（暴露风险 1）
3. 按 VERIFY.md 第 2-4 步加载 + 跑闭环（暴露风险 2/3/4）
