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

当前基于 workspace `0.1.0-rc.5` 开发，npm 官方最新为 `0.1.0-rc.6`。发布/分发前需先 `git pull` 同步官方到 `rc.6` 并重新构建验证。

### 方式一：手动接入（当前可用的方式）

需要改动 5 个官方文件 + 放入 2 个插件目录：

**1. `packages/bundle/web-app/package.json`** —— `dependencies` 加 2 行：

```json
"@2464500754/dsh-layered-memory-architecture": "workspace:^",
"@2464500754/dsh-layered-memory-architecture-preset": "workspace:^"
```

**2. `packages/bundle/web-app/cordis.patch.yml`** —— 加 2 个 row（host 平面）：

```yaml
- id: memory-store
  name: '@2464500754/dsh-layered-memory-architecture/memory-store'
  config:
    root: 'F:/dp/memory-body-data'   # ⚠️ 改成你自己的数据目录路径！
    defaultBodies: [code]            # 默认挂载的体，可改成自己的（如 [physics]），该体需先创建

- id: memory-body
  name: '@2464500754/dsh-layered-memory-architecture'
```

> ⚠️ `root` 是**数据存放目录**，请改成你自己的绝对路径（如 `'D:/ds/memory-data'`），首次启动会自动建目录。
>
> ⚠️ `defaultBodies` 是**默认挂载清单，不是创建命令**：`code` 只是示例名，可改成任意体 id（如 `[physics]`），但该体**必须先在磁盘上创建**（设置页建，或手动建 `body.json`），否则 `/remember` 会报 `does not exist`。

**3. `apps/cli/config/agent-presets/standard/agent.cordis.yml`** —— 末尾加 1 个 row（preset 平面）：

```yaml
- id: memory-body-preset
  name: '@2464500754/dsh-layered-memory-architecture-preset'
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

### 方式二：npm 安装（规划中）

两个包已具备标准 npm 包结构（`@2464500754/dsh-layered-memory-architecture` + `-preset`）。发布前需：

1. `git pull` 同步到 `rc.6` 并重新构建验证
2. 把 `peerDependencies` 的 `workspace:^` 换成 npm 真实版本（`@deepseek-ai/cordis` → `^4.0.1`，`dsh-*` → `^0.1.0-rc.6`）
3. `pnpm publish` 两个包
4. 提交到社区市场（`dshmarket` / `awesome-deepseek-harness`）

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

**举例**（挂 `physics` 和 `code` 两个）：

| 操作 | 挂载集 | `/remember 内容` 存到 | `/remember code 内容` 存到 |
|---|---|---|---|
| （无操作） | `[code]` | `code` | `code` |
| `/mount physics` | `[physics, code]` | `physics` | `code` |
| `/mount physics` 后 `/unmount code` | `[physics]` | `physics` | ❌ 报错 `code` 未挂载 |

### 模型工具（自动调用，无需手动）

- `memory_search <关键词>` —— 跨会话回忆，检索挂载的体
- `memory_remember <内容>` —— 你明确说「记住 xxx」时自动写入

### GUI

设置页 → 「记忆体」tab：查看体列表、新建体、删除体、查看条目。

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
│  memory-body-preset   工具（memory_search/memory_remember）│
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

### 挂载机制

- **建体 ≠ 挂载**：建体只是磁盘生成 body.json，挂载才是「授权会话读写」
- **挂载累加**：`/mount` 插到最前（最近挂载 = 默认写入目标），`/unmount` 只删单个
- **会话级**：挂载集存进程内存（WeakMap），关会话重开回退默认

### 设计取舍

1. **挂载 vs 全量注入** —— 只加载挂载的体，隔离显式可控
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

### 关键踩坑（已固化到 `RECOVERY.md`）

| 坑 | 现象 | 根因 | 解法 |
|---|---|---|---|
| 循环等待 | `pending (waiting for service: remote.memoryBody)` | 把「自己 `$mount` 出来的服务」写进 `inject`，apply 前死等 | `inject` 只写外部依赖，`$mount` 后用 `ctx.get()` 读 |
| 假阳性 | 删 row 后「启动成功」但功能全没 | 删 row = 弃用服务，服务不加载自然无 pending | 用 `SQLite` warning 判断服务是否真加载 |
| `waiting for memoryStore` | preset 工具不激活 | 前置 `MODULE_NOT_FOUND` 把 memory-store row 带崩 | 修模块解析（leaf 包进 fallback 闭包） |
| 中文搜不到 | 搜「用中文」搜不到「用中文交流」 | unicode61 把连续中文粘成一个 token | 换 trigram 分词器 |

---

## 已知限制

1. **检索最短 3 字符**：trigram 天生不支持 2 字及以下的搜索（`中文` 返回空）
2. **挂载是会话临时**（方案 A）：关会话重开回退全局默认，未做持久化
3. **未发布 npm**：依赖版本对齐（rc.5 vs rc.6）未完成
4. **无单元测试**：`store.ts` / `fts.ts` 是纯函数，尚未补测试
5. **自动总结默认关**：`autoSummarize: false`，需手动开启
6. **安装门槛**：手动接入需改 5 个官方文件，未接入一键安装通道

---

## 版本提示

| 项 | 值 |
|---|---|
| workspace 版本 | `0.1.0-rc.5` |
| npm 官方最新 | `0.1.0-rc.6` |
| 发布前动作 | `git pull` 同步 rc.6 → 重新构建 → 改 `peerDependencies` |

⚠️ npm 上 **没有 `0.1.0-rc.5`**（官方是 rc.2 → rc.3 → rc.6），`workspace:^` 若原样发布会导致依赖解析失败。

---

## 目录结构

```
packages/memory/
├── memory-body/                 # host 包 @2464500754/dsh-layered-memory-architecture
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
        ├── tool.ts              # memory_search / memory_remember
        └── auto-summarize.ts    # 自动总结触发
```

---

## 许可证

见 [LICENSE](./LICENSE)。
