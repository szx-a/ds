# dsh 记忆体（Memory Body）插件

> 社区体验版 · 跨会话记忆：多体 + 挂载 + 自动总结 + FTS5 检索
>
> 这是 GitHub Discussions [#1822（记忆体 Memory Body）](https://github.com/deepseek-ai/deepseek-harness/discussions/1822) 提案的一个可运行实现。

---

## 这是什么

一个 DeepSeek Harness 的记忆插件，实现「命名、跨会话、隔离、可挂载」的记忆单元（Memory Body）：

- **多个记忆体（body）**：每个体是一组相关记忆，物理上是一个目录 + JSONL 文件
- **挂载（mount）**：控制当前会话能检索哪些体（数据永久、挂载按会话）
- **双权威**：`user`（用户钦定的文档）vs `model`（模型自动总结的经验）
- **自动总结**：把会话提炼成经验写入记忆体
- **GUI + 后台 JSONL 双编辑**：既能在设置页管体，也能直接改文件
- **FTS5 全文检索**：中英文 3 字以上任意子串命中

核心闭环：`/remember` → 存储 → `memory_search` → 检索。

---

## 特性

- 多体 + 挂载：`/mount` `/unmount` 按会话挂载
- 降权不删除：`/forget` 只标记失效（superseded），历史可追溯、可恢复
- 事件溯源：JSONL 权威层 + SQLite FTS5 可重建读模型（索引可丢弃、可重建）
- 中文检索：FTS5 `trigram` 分词器，3 字以上任意子串命中
- 三平面架构：host（存储 + 命令 + Remote）+ preset（工具）+ client（GUI）

---

## 安装

### 前置：版本对齐（重要）

当前基于 dsh `0.1.1-rc.2`（插件 version 同为 `0.1.1-rc.2`），已发布到 npm。

### 方式一：手动接入（当前可用的方式）

需要改动 5 个官方文件 + 放入 2 个插件目录：

**1. `packages/bundle/web-app/package.json`** —— `dependencies` 加 2 行：

```json
"@szx-a/dsh-layered-memory-architecture": "workspace:^",
"@szx-a/dsh-layered-memory-architecture-preset": "workspace:^"
```

**2. `packages/bundle/web-app/cordis.patch.yml`** —— 加 2 个 row（host 平面）：

```yaml
- id: memory-store
  name: '@szx-a/dsh-layered-memory-architecture/memory-store'
  config:
    root: 'F:/dp/memory-body-data'   # ⚠️ 改成你自己的数据目录路径！
    defaultBodies: [code]            # 默认挂载的体，可改成自己的（如 [physics]），该体需先创建

- id: memory-body
  name: '@szx-a/dsh-layered-memory-architecture'
```

> ⚠️ `root` 是**数据存放目录**，请改成你自己的绝对路径（如 `'D:/ds/memory-data'`），首次启动会自动建目录。
>
> ⚠️ `defaultBodies` 是**默认挂载清单，不是创建命令**：`code` 只是示例名，可改成任意体 id（如 `[physics]`），但该体**必须先在磁盘上创建**（设置页建，或手动建 `body.json`），否则 `/remember` 会报 `does not exist`。

**3. `apps/cli/config/agent-presets/standard/agent.cordis.yml`** —— 末尾加 1 个 row（preset 平面）：

```yaml
- id: memory-body-preset
  name: '@szx-a/dsh-layered-memory-architecture-preset'
  config:
    autoSummarize: false
```

**4. `tsconfig.host.json`** —— `references` 加 2 行：

```json
{ "path": "./packages/memory/memory-body/tsconfig.host.json" },
{ "path": "./packages/memory/memory-body-preset" }
```

**5. `tsconfig.client.json`** —— `references` 加 1 行：

```json
{ "path": "./packages/memory/memory-body/tsconfig.client.json" }
```

**6~7. 放入插件目录**：

```
packages/memory/memory-body/           # host 包：存储 + 命令 + Remote + GUI
packages/memory/memory-body-preset/    # preset 包：工具 + 自动总结
```

**8. 构建**（在 harness 根目录）：

```bash
pnpm exec tsc -b packages/memory/memory-body/tsconfig.host.json packages/memory/memory-body-preset
cd packages/memory/memory-body          && pnpm exec tsdown --env.DSH_BUILD_FACE client
cd packages/memory/memory-body-preset   && pnpm exec tsdown
```

**9. 重启**：`Ctrl+C` 停掉 `pnpm dsh web` 再重启（命令在 node 进程启动时注册，只刷新浏览器不会加载）。

**10. 初始化一个体**：默认挂载 `[code]`，但本仓库**不含记忆数据**（数据是私有的，不随源码分发）。重启后先建体：

- 方式 A：设置页 → 「记忆体」tab → 新建体，id 填 `code`（或改成你自己的 id）
- 方式 B：手动在 `root` 目录建 `code/body.json`（内容见下方「后台编辑」）

建完体才能 `/remember` / `memory_search`，否则会报「body does not exist」。

> ⚠️ 本仓库是**源码存档**，不含 `lib/` 构建产物，且依赖 harness monorepo 的 `@deepseek-ai/*` 包 —— 必须放进 harness 源码树内构建，不能独立编译运行。

### 方式二：npm 安装（推荐）

已发布到 npm（`@szx-a/dsh-layered-memory-architecture@0.1.1-rc.2` + `-preset`），适合**不想放源码、不想自己构建**的情况（npm 包已含编译好的 `lib/` 产物和类型声明）。

**1. 安装两个包**（装到 web-app bundle）：

```bash
pnpm --filter @deepseek-ai/dsh-web-app add @szx-a/dsh-layered-memory-architecture @szx-a/dsh-layered-memory-architecture-preset
```

**2. 改 `packages/bundle/web-app/cordis.patch.yml`**（同方式一第 2 步）：加 `memory-store` + `memory-body` 两个 row。

**3. 改 `apps/cli/config/agent-presets/standard/agent.cordis.yml`**（同方式一第 3 步）：加 `memory-body-preset` row。

**4. 重启**：`Ctrl+C` 停掉 `pnpm dsh web` 再重启。

**5. 初始化体**（同方式一第 10 步）。

> npm 安装**省掉了**方式一的第 1、4、5、6~7、8 步：不用手动加 web-app 依赖（`pnpm add` 自动写）、不用改 tsconfig、不用放源码、不用构建。

---

## 用法

### 命令

| 命令 | 作用 | 示例 |
|---|---|---|
| `/remember <内容>` | 存一条你钦定的记忆 | `/remember 用 pnpm 构建，别用 npm` |
| `/remember <体id> <内容>` | 存到指定体 | `/remember physics 牛顿三定律` |
| `/summarize` | 把当前对话总结成经验存下 | `/summarize` |
| `/forget <关键词>` | 降权（不删除，检索跳过） | `/forget 测试` |
| `/mount <体id>` | 把体挂到**当前会话** | `/mount physics` |
| `/unmount <体id>` | 从当前会话卸下（数据保留） | `/unmount code` |

### 记忆写到哪里？（默认写入目标）

最容易踩坑的地方，单独说明。

**先分清三个动作**：

- **建体**（设置页建，或手动建 `body.json`）= 创建，只在磁盘生成一个体，**不等于授权**
- **挂载**（`/mount`）= 授权，「这个会话能读写这个体」
- **写入**（`/remember` `/summarize`）= 实际存内容

只有**挂载**的体才能被写。刚建好的体**不会自动挂载**，要先 `/mount <体id>`。所以「在 GUI 里建了体」之后直接 `/remember` 会报 `No memory body mounted` —— 那不是体不存在，是还没挂载。

**挂载是累加，可挂多个**（`/unmount` 只删那一个，不影响其他）：

```
/mount wd-231567   → [wd-231567]
/mount code        → [code, wd-231567]        # 后挂的插到最前
/mount physics     → [physics, code, wd-231567]
```

**默认写入「最近挂载的体」**（挂载集第一个）：

- 刚启动、没挂过任何体 → 挂载集 = `defaultBodies`（默认 `[code]`），默认写 `code`
- `/mount physics` → 把 `physics` 插到最前，默认写 `physics`

**体必须先存在**：默认目标体（或任何你指定的体）若没创建，`/remember` `/summarize` 会报 `Memory body "xxx" does not exist`，**不会自动创建**。

**显式指定体**（绕过默认，挂多个时才有意义）：

- `/remember <体id> <内容>` → 存到指定体
- `/summarize <体id>` → 总结到指定体

> ⚠️ 显式指定的体**也必须已挂载**：`/remember x 内容` 里若 `x` 长得像体 id（全小写字母数字/连字符）却未挂载，会**报错** `Memory body "x" is not mounted`，不会静默当文本。所以先 `/mount x` 再点名。

**所有操作的默认目标一览**（命令 + 模型工具都遵循同一规则）：

| 操作 | 权威 | 不指定体时的目标 |
|---|---|---|
| `/remember` | user | 最近挂载的体（挂载集第一个） |
| `memory_remember`（模型自动） | user | 最近挂载的体 |
| `/summarize` | model | 最近挂载的体 |
| 自动总结 | model | 最近挂载的体 |
| `memory_search`（模型自动） | — | 搜**所有**挂载的体 |

**核心规则一句话**：所有写入（命令和模型工具）默认写到「**最近挂载的体**」——因为 `/mount` 会把体插到挂载集最前。想写别的体就显式指定体 id。

**举例**（挂 `physics` 和 `code` 两个）：

| 操作 | 挂载集 | `/remember 内容` 存到 | `/remember code 内容` 存到 |
|---|---|---|---|
| （无操作） | `[code]` | `code` | `code` |
| `/mount physics` | `[physics, code]` | `physics` | `code` |
| `/mount physics` 后 `/unmount code` | `[physics]` | `physics` | ❌ 报错 `code` 未挂载 |

### 模型工具（自动调用，无需手动）

- `memory_search <关键词>` —— 跨会话回忆，检索挂载的体
- `memory_remember <内容>` —— 你明确说「记住 xxx」时自动写入
- `memory_forget <关键词>` —— 模型发现记忆过时/错误时主动降权（标记失效、不删除、可追溯）
- `memory_correct <关键词> <新内容>` —— 模型主动纠正：降权旧条目 + 写入纠正后的内容

### GUI

- **设置页 → 「记忆体」tab**：查看体列表、新建体、删除体、查看条目
- **输入框 dock 挂载标签**：聊天输入框附近实时显示当前会话挂载的记忆体（如「记忆体：code, physics」），`/mount` `/unmount` 后自动刷新

### 后台编辑

数据是纯文本，可直接改，改完下次检索自动重建索引：

```
<root>/
  <bodyId>/            # 一个体 = 一个目录
    body.json          # 体元数据（name/description/kind/trust）
    entries.jsonl      # 记忆条目，一行一条，append-only
```

---

## 架构（LMA — Layered Memory Architecture）

2 个包（host + preset）+ 3 个加载平面：

```
┌─ host 平面（cordis.patch.yml）─────────────────────────────┐
│  memory-store   共享存储服务（JSONL + FTS5）               │
│  memory-body    Remote（体管理 GUI）+ /remember 等命令     │
└────────────────────────────────────────────────────────────┘
┌─ agent preset（agent.cordis.yml）──────────────────────────┐
│  memory-body-preset   工具（search/remember/forget/correct）│
│                        + 自动总结                          │
└────────────────────────────────────────────────────────────┘
┌─ client（dsh.client + exports["./client"]）────────────────┐
│  设置页「记忆体」tab + 自 mount Remote                     │
└────────────────────────────────────────────────────────────┘
```

### 服务组件

| 组件 | 形态 | 职责 |
|---|---|---|
| `MemoryStore` | Service 类 | 共享存储：JSONL + FTS + 挂载集 |
| `MemoryBodyService` | TypertRemoteService | 体管理 Remote + 命令注册 |
| preset 插件 | namespace plugin | 工具 + 自动总结 |
| client 插件 | 双面 React 插件 | GUI + 自 mount Remote |

### 存储：事件溯源

- **权威层**：JSONL（append-only、可手改、可审计）
- **读模型**：SQLite FTS5（可丢弃、每次 search 前从 JSONL 重建）
- **降权不删除**：supersede 追加标记行，同 id 折叠取最新
- **双权威**：`user`（用户钦定，只读）/ `model`（模型总结，可编辑）

### 作用域与挂载机制

**作用域**（LMA 的设计哲学）：

| 维度 | 作用域 | 说明 |
|---|---|---|
| 体（body） | 全局共享 | 一个 root，所有工作区/会话可见同一套体 |
| 挂载（mount） | 按会话 | 每个会话挂载自己的子集，互不影响 |
| 默认挂载集 | 全局 | `defaultBodies` 对所有新会话生效 |

> 隔离靠「体本身」（独立目录 + 独立 JSONL），不靠工作区限制 —— 用户通过「建体 + 挂载」自由管理，而非系统预设边界。

**挂载机制**：

- **建体 ≠ 挂载**：建体只是磁盘生成 body.json，挂载才是「授权会话读写」
- **挂载累加**：`/mount` 插到最前（最近挂载 = 默认写入目标），`/unmount` 只删单个
- **挂载持久化**：会话挂载集存 `root/mounts.json`，`/mount` `/unmount` 立即落盘；会话重启自动恢复，新会话回退默认

### 设计取舍

1. **隔离在存储层，而非检索层** —— 记忆按体分开存放，挂载圈定范围，从源头不乱炖
2. **双权威 vs 混在一起** —— user/model 严格分层
3. **降权不删除 vs 覆盖** —— 可审计可回滚
4. **GUI + JSONL 双编辑 vs 黑盒** —— 透明可手改
5. **事件溯源 vs 单一数据库** —— 索引可重建

---

## 开发历程与踩坑

### 迭代主线

1. 三大基石提案投递 GitHub Discussions（#1822 记忆体 / #1825 插件市场）
2. 拆分 host 包（存储 + Remote + 命令）与 preset 包（工具 + 自动总结）
3. 修 client 插件自 mount Remote（第三方包不在 api-remotes 白名单）
4. 加会话级挂载（`/mount` `/unmount`）
5. FTS5 分词器 unicode61 → trigram（修中文检索）
6. 在 worktree 副本完成 `v0.1.2-alpha.1` 适配并验证完整跑通（9 处改动，构建 0 错误，`dsh web` 干净启动，挂载标签实时刷新已恢复）—— 正式发布待 rc

### 关键踩坑（已固化到 `RECOVERY.md`）

| 坑 | 现象 | 根因 | 解法 |
|---|---|---|---|
| 循环等待 | `pending (waiting for service: remote.memoryBody)` | 把「自己 `$mount` 出来的服务」写进 `inject`，apply 前死等 | `inject` 只写外部依赖，`$mount` 后用 `ctx.get()` 读 |
| 假阳性 | 删 row 后「启动成功」但功能全没 | 删 row = 弃用服务，服务不加载自然无 pending | 用 `SQLite` warning 判断服务是否真加载 |
| `waiting for memoryStore` | preset 工具不激活 | 前置 `MODULE_NOT_FOUND` 把 memory-store row 带崩 | 修模块解析（leaf 包进 fallback 闭包） |
| 中文搜不到 | 搜「用中文」搜不到「用中文交流」 | unicode61 把连续中文粘成一个 token | 换 trigram 分词器 |

---

## 测试与后续开发

### 已知限制

1. **检索最短 3 字符**：trigram 天生不支持 2 字及以下的搜索（`中文` 返回空）
2. **自动总结默认关**：`autoSummarize: false`，需手动开启
3. **安装门槛**：npm 安装仍需手动改 2 个接入文件（cordis.patch.yml / agent.cordis.yml），未接入一键安装通道

### 测试

- **单元测试未补**：`store.ts` / `fts.ts` / `parse.ts` 是纯函数，尚未补测试

### 后续开发（按优先级）

1. **记忆提供者接口**：让第三方记忆插件（dsh-memory-evolve / EchoCore 等）挂 LMA 之上，PLM「地基插件」定位验证点
2. **挂载体元信息注入**：模型只加载已挂载体的 `id + 描述`
3. **量化对比数据**：benchmark（token 节省量、检索命中率）
4. **向量检索**：`BodyKind` 已预留 `vector` 扩展位，混合检索
5. **权重自然衰减**：`weight` 字段支持记忆自然衰减

---

## 版本提示

| 项 | 值 |
|---|---|
| dsh 版本 | `0.1.1-rc.2` |
| 插件 version | `0.1.1-rc.2` |
| npm 包 | `@szx-a/dsh-layered-memory-architecture` + `-preset` |
| peerDependencies | 发布时由 `pnpm publish` 自动替换 `workspace:^` → `^0.1.1-rc.2` |

### 兼容性说明

**当前稳定支持**：dsh `v0.1.1-rc.2`（npm 包 `@szx-a/dsh-layered-memory-architecture@0.1.1-rc.2` + `-preset`）。

**`v0.1.2-alpha.1` 兼容性状态**：官方正在进行重大重构。作者已在 worktree 副本（隔离环境，主目录 3080 全程不动）完成适配并**验证可完整跑通、功能不降级**——9 处改动、host/preset/client 三侧构建 0 错误、`dsh web` 干净启动、挂载标签实时刷新已恢复。破坏点与实测结论：

| 破坏点 | 影响 LMA 的 | 实测结论 |
|---|---|---|
| agent-presets 目录迁移（`apps/cli/config` → `packages/preset`） | preset 接入点 | memory-body-preset row 需搬到新位置 |
| `@deepseek-ai/dsh-client-runtime` 被拆散 | client 插件依赖 | `ClientContext` → cordis `Context`；`ConversationSnapshot.chat.legacy.nodes` → chat 包的 `ChatSnapshot.legacy.nodes`；store 引擎 → `dsh-client-store`。共 9 处改动，详见下方适配步骤 |
| ApiProxy 移除 | Remote 层 | ✅ `ctx.remote.$mount` / `TypertRemoteNamespaceMap` 未变，**零改动** |

**作者立场**：作为 LMA 的作者/维护者，会跟进官方版本演进，**等 `0.1.2` 出 rc 稳定版后第一时间适配并发布新版本**。虽然 alpha.1 已在副本跑通，但官方 alpha未稳定、`runtime→store` 重构仍在变动（`ChatSnapshot.legacy.nodes` 的 `legacy` 字段名暗示官方可能在 rc 前改名），此时发布会反复返工，故待稳定后一次到位。

### LMA 适配新版本的步骤（供先行者自担风险参考）



**A. 接入点（同 0.1.1-rc.2，只改路径）**

1. **host 接入**：`packages/bundle/web-app/cordis.patch.yml` 的 `plugin-inventory` 后，加 `memory-store` + `memory-body` 两个 row
2. **preset 接入**：`packages/preset/agent-presets/presets/standard/agent.cordis.yml`（⚠️ 0.1.2 新路径）末尾，加 `memory-body-preset` row
3. **依赖**：`packages/bundle/web-app/package.json` 加 2 个 `@szx-a/...` 依赖
4. **references**：`tsconfig.host.json` / `tsconfig.client.json` 加 memory references

**B. client 源码改动（`@deepseek-ai/dsh-client-runtime` 被拆散导致，共 6 处）**

5. `src/client/index.tsx`：`ClientContext` import 从 `dsh-client-runtime/client` → `@deepseek-ai/cordis` 的 `Context`
6. `src/client/MountedBodiesLine.tsx`：`ConversationSnapshot` import 换成 chat 包的 `ChatSnapshot`；实时刷新信号从 `useSession(s => s.chat.legacy.nodes)` 换成 `useChat(s => s.legacy.nodes)`（照官方 `StatsLine` 先例，功能不降级）
7. `package.json`：删 3 处 `dsh-client-runtime`（inject 数组 / peerDeps / devDeps），**新增** `@deepseek-ai/dsh-client-ui-chat`（inject 数组 / peerDeps / devDeps 三处）
8. `tsconfig.client.json`：删 `client/runtime` reference，**新增** `client/ui-chat` reference
9. `src/client/index.tsx`：补 2 个空 import `@deepseek-ai/dsh-api-remotes/client`（ctx.remote 类型）+ `@deepseek-ai/dsh-client-ui-renderer/client`（ctx.slots 类型）；`conversation.composer.dock` slot 的 inject factory 参数去掉 `: string`、用 `String(sessionId)` 转换

**C. 构建 + 验证（⚠️ 关键：必须跑 host + client 两个 face）**

10. **构建**：`pnpm install` → `pnpm run build:lib:host` → `pnpm run build:lib:client`。只跑 host face 会让 `dsh web` 报 `MissingClientBundleError`（缺全图 `lib/client.js`）
11. **验证**：`pnpm dsh web --no-open --port 0` 启动（看 SQLite warning、无 pending、无 MissingClientBundleError；HTTP 探测返回 401 即确认监听）

---

## 目录结构

```
packages/memory/
├── memory-body/                 # host 包 @szx-a/dsh-layered-memory-architecture
│   └── src/
│       ├── index.ts             # MemoryBodyService（Remote + 命令注册）
│       ├── memory-store.ts      # MemoryStore（共享存储服务）
│       ├── store.ts             # JSONL 权威存储（纯函数）
│       ├── fts.ts               # FTS5 检索（trigram）
│       ├── command.ts           # /remember /summarize /forget /mount /unmount
│       ├── summarize.ts         # 总结逻辑
│       ├── parse.ts             # 输入解析
│       └── client/              # GUI（记忆体 tab）
└── memory-body-preset/          # preset 包（-preset 后缀）
    └── src/
        ├── index.ts             # 工具 + 自动总结装配
        ├── tool.ts              # memory_search / remember / forget / correct
        └── auto-summarize.ts    # 自动总结触发
```

---

## 许可证

见 [LICENSE](./LICENSE)。
