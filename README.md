# dsh 记忆体（Memory Body）插件

> 社区体验版 · LMA 分层记忆架构：群-体-词条三层 + 挂载 + 自动总结 + 向量检索
>
> 这是 GitHub Discussions [#1822（记忆体 Memory Body）](https://github.com/deepseek-ai/deepseek-harness/discussions/1822) 提案的一个可运行实现。

---

## 这是什么

一个 DeepSeek Harness 的记忆插件，实现 **LMA（Layered Memory Architecture）分层记忆架构**——「群（Group）→ 体（Body）→ 词条（Entry）」三层记忆树：

- **记忆群（group）**：顶层领域隔离域（如 Physics 物理域、Literature 文学域），物理上是一个目录
- **记忆体（body）**：群内的主题容器（如 Physics 下的 QuantumMechanics），物理上是群目录下的子目录 + JSONL
- **词条（entry）**：底层的原子记忆单元（文本块 + 向量）
- **挂载（mount）**：控制当前会话能检索哪些群/体（`/mount physics` 挂群、`/mount physics/quantum` 挂体）
- **双权威**：`user`（用户钦定的文档）vs `model`（模型自动总结的经验）
- **自动总结**：把会话提炼成经验写入记忆体
- **GUI + 后台 JSONL 双编辑**：既能在设置页管群/体，也能直接改文件
- **检索**：FTS5 粗筛 + 向量精排（有 embedding 时），中英文 3 字以上任意子串命中

核心闭环：/remember → 存储 → memory_search → 检索。

---

## 特性

- **群-体-词条三层**：自顶向下公理切割（族 ⊃ 簇 ⊃ 向量），归属关系是唯一刚性公理——词条不跨体、体不跨群
- **群级物理隔离**：每群独立目录 + 独立 FTS5 索引，检索只进相关群，未命中群物理不参与计算
- **公理锚向量**：群/体创建时定义领域/主题锚向量（非聚类质心），树状多族路由（群锚 → 体锚 → 词条级）
- **AI 自动建群建体**：冷启动零配置，阈值 + AI 语义双重判定——一致自动、冲突上抛人工仲裁面板
- **多体 + 挂载**：`/mount` `/unmount` 按会话挂载（支持群和体两种粒度）
- **降权不删除**：`/forget` 只标记失效（superseded），历史可追溯、可恢复
- **事件溯源**：JSONL 权威层 + SQLite FTS5 可重建读模型（索引可丢弃、可重建）
- **中文检索**：FTS5 `trigram` 分词器，3 字以上任意子串命中
- **可插拔 Embedder**：有 embedding 时向量精排，无时 FTS5 兜底（功能不丢）
- **三平面架构**：host（存储 + 命令 + Remote）+ preset（工具）+ client（GUI）

---

## 安装

### ⚠️ 关键机制：bundle 必须进 `dsh.profile.bundles` 列表才会生效

LMA 的两个包都声明了 `dsh.bundle.patch`（指向包内 `cordis.patch.yml`），但**这个声明本身不产生任何自动加载**。dsh 加载 bundle 的规则是：

- **只有出现在 profile 的 `dsh.profile.bundles` 列表里的包，它的 `cordis.patch.yml` 才会被应用**。
- 把包名写进这个列表的，是 `plugin_manager install_bundle`（或 `dsh plugin add`）——它会 pnpm 装包**并自动加进 bundles 列表**。
- **光 `pnpm add` 装包、不手动加 row、不调 `install_bundle`**，包虽然装了但不在 bundles 列表，**接入点不会生效**。

所以下面三种方式的核心区别是「谁把 LMA 的接入点送进 dsh 的加载链」：

| 方式 | 接入点怎么进加载链 | 适用 |
|---|---|---|
| 方式一（手动接入） | 手动把 row 写进 web-app 的 cordis.patch.yml | web 端源码树、想完全掌控 |
| 方式二（npm + 手动 row） | `pnpm add` 装包，再手动写 row | web 端不想放源码 |
| 方式三（bundle 安装） | `plugin_manager install_bundle` 自动进 bundles 列表 | 桌面端 / 任何有 plugin_manager 的环境 |

### 前置：版本对齐（重要）

源码已适配 dsh `0.2.1-rc.2`（含挂载标签实时刷新）。npm 发布版：`latest` = `0.1.1-rc.2`（dsh rc.2），`rc` = `0.3.0-rc.3`（dsh 0.2.1-rc.2，**v2 群-体-词条三层架构**）。

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

**3. `packages/bundle/web-app/presets/standard.patch.yml`**（⚠️ 0.2.0 新路径，旧版在 `packages/preset/agent-presets/presets/standard/agent.cordis.yml`）—— 在 `preset-standard` 的 `config.plugins` 数组末尾加 1 个条目：

```yaml
          # LMA 记忆体：模型面向的工具 + 自动总结
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

**8. 构建**（在 harness 根目录，⚠️ 0.2.1 起用统一编排 `build:official`，不能手动拆 tsc）：

```bash
corepack pnpm install           # 0.2.1 起用 corepack pnpm 满足版本要求（pnpm 11.28.5）
corepack pnpm run build:official # = tsx scripts/build.ts --profile official（9 gate 全链路）
```

> ⚠️ 0.2.1 的构建方式变了：不能再手动拆 `tsc -b tsconfig.host.json` + `tsc -b tsconfig.client.json`——那样会跳过 Typert 的 remote 类型生成，报几十个 `Cannot find module '@xxx/remote'` 假错误。用 `build:official` 或 `typecheck`（生成 Typert 声明 + 类型检查）。

**9. 重启**：`Ctrl+C` 停掉 `pnpm dsh web` 再重启（命令在 node 进程启动时注册，只刷新浏览器不会加载）。

**10. 初始化一个体**：默认挂载 `[code]`，但本仓库**不含记忆数据**（数据是私有的，不随源码分发）。重启后先建体：

- 方式 A：设置页 → 「记忆体」tab → 新建体，id 填 `code`（或改成你自己的 id）
- 方式 B：手动在 `root` 目录建 `code/body.json`（内容见下方「后台编辑」）

建完体才能 `/remember` / `memory_search`，否则会报「body does not exist」。

> ⚠️ 本仓库是**源码存档**，不含 `lib/` 构建产物，且依赖 harness monorepo 的 `@deepseek-ai/*` 包 —— 必须放进 harness 源码树内构建，不能独立编译运行。

### 方式二：npm 安装（web 端）

npm 已发布两个包，**基于 dsh `0.2.1-rc.2`**（`rc` tag），适合 web 端**不想放源码、不想自己构建**的情况（npm 包已含编译好的 `lib/` 产物和类型声明）。

- `@szx-a/dsh-layered-memory-architecture@0.3.0-rc.3`
- `@szx-a/dsh-layered-memory-architecture-preset@0.3.0-rc.3`

> ⚠️ `latest` tag 仍是 `0.1.1-rc.2`（dsh rc.2 旧版）。装 0.3.0 版需显式写 `@0.3.0-rc.3` 或 `@rc`。

**1. 安装两个包**（装到 web-app bundle）：

```bash
pnpm --filter @deepseek-ai/dsh-web-app add @szx-a/dsh-layered-memory-architecture@0.3.0-rc.3 @szx-a/dsh-layered-memory-architecture-preset@0.3.0-rc.3
```

**2. 改 `packages/bundle/web-app/cordis.patch.yml`**（同方式一第 2 步）：加 `memory-store` + `memory-body` 两个 row。

**3. 改 `packages/bundle/web-app/presets/standard.patch.yml`**（⚠️ 0.2.0 新路径，同方式一第 3 步）：在 `preset-standard` 的 `config.plugins` 数组末尾加 `memory-body-preset` 条目。

**4. 重启**：`Ctrl+C` 停掉 `pnpm dsh web` 再重启。

**5. 初始化体**（同方式一第 10 步）。

> npm 安装**省掉了**方式一的第 1、4、5、6~7、8 步：不用手动加 web-app 依赖（`pnpm add` 自动写）、不用改 tsconfig、不用放源码、不用构建。

### 方式三：bundle 安装（`plugin_manager install_bundle`，桌面端 / web 端通用）

用 dsh 的插件管理器装包，**装包即生效、不用手动改任何 cordis.patch.yml、不用构建**——这是官方为第三方插件设计的正规分发方式。桌面端（Electron 打包版）和 web 端（源码树）都有 `plugin_manager`，走同一条路径：`install_bundle` 会 pnpm 装包**并自动把包名加进 `dsh.profile.bundles` 列表**，于是 LMA 自带的 `cordis.patch.yml` 接入点被加载。

**1. 打开插件管理器**（桌面端 GUI 或对话里调用），安装两个包：

```
@szx-a/dsh-layered-memory-architecture@0.3.0-rc.3
@szx-a/dsh-layered-memory-architecture-preset@0.3.0-rc.3
```

（等价于 `plugin_manager install_bundle <包名>`）

**2. 配置记忆数据目录**：LMA 的 bundle 自带 `cordis.patch.yml` 里默认 `root: 'F:/dp/memory-body-data'`。若要用你自己的目录，安装后在 profile 的 `cordis.patch.yml`（桌面端在 `~/.dsh/profiles/desktop/`，web 端在 `~/.dsh/profiles/web/`）里覆盖 `memory-store` 的 `config.root`。

**3. 重启** dsh（桌面端重启应用；web 端 `Ctrl+C` 停掉 `pnpm dsh web` 再重启），让新 bundle 生效。

**4. 初始化体**（同方式一第 10 步）。

> ⚠️ 用 `install_bundle` 装**刚发布**的包有两个已知注意点（都是 dsh 的分发机制，非 LMA 问题）：
> - **镜像同步滞后**：profile 默认走 npmmirror 镜像，可能还没同步新版本导致"找不到包"。在 profile 目录加 `.npmrc`（`registry=https://registry.npmjs.org/`）强制走官方源。
> - **供应链 `minimumReleaseAge` 拦截**：dsh 会拦**刚发布**的包（防供应链攻击）。若报 `minimumReleaseAge` 违规，在 profile 的 `pnpm-workspace.yaml` 加 `minimumReleaseAgeExclude` 条目（`包名@版本`）豁免，然后在 profile 目录手动 `pnpm install` 重读配置。

---

## 用法

### 命令

| 命令 | 作用 | 示例 |
|---|---|---|
| `/remember <内容>` | 存一条你钦定的记忆 | `/remember 用 pnpm 构建，别用 npm` |
| `/remember <体id> <内容>` | 存到指定体 | `/remember quantum 薛定谔方程` |
| `/summarize` | 把当前对话总结成经验存下 | `/summarize` |
| `/forget <关键词>` | 降权（不删除，检索跳过） | `/forget 测试` |
| `/mount <群id>` | 把整个群挂到**当前会话** | `/mount physics` |
| `/mount <群id>/<体id>` | 把群里某个体挂到当前会话 | `/mount physics/quantum` |
| `/unmount <群id 或 群id/体id>` | 从当前会话卸下（数据保留） | `/unmount code` |

> ⚠️ v2 起 `/mount` 支持群和体两种粒度：单段（`physics`）= 挂整个群，两段（`physics/quantum`）= 挂群里某个体。旧式单段体 id（如 `code`）仍兼容，自动定位其归属群。

### 记忆写到哪里？（默认写入目标）

最容易踩坑的地方，单独说明。

**先分清三个动作**：

- **建群/建体**（设置页建，或手动建 `group.json` / `body.json`）= 创建，只在磁盘生成，**不等于授权**
- **挂载**（`/mount`）= 授权，「这个会话能检索/写入这些群或体」
- **写入**（`/remember` `/summarize`）= 实际存内容

只有**挂载**的群/体才能被读写。刚建好的群/体**不会自动挂载**，要先 `/mount`。所以「在 GUI 里建了体」之后直接 `/remember` 会报 `No memory body mounted` —— 那不是体不存在，是还没挂载。

**挂载是累加，可挂多个**（`/unmount` 只删那一个，不影响其他）：

```
/mount physics         → 群下所有体全挂载（检索 + 写入都覆盖全群）
/mount physics/quantum → 只挂群里某个体（后挂的插到最前）
```

> ⚠️ **挂群 vs 挂体**：
> - `/mount physics`（单段）挂**群** = 群下**所有体全挂载**：`memory_search` 检索覆盖所有体，写入默认落到群内第一个体；
> - `/mount physics/quantum`（两段）挂群里**某个体**，只检索/写入这个体。
>
> 输入框底部的挂载标签会显示**群名**（挂群时）或**体名**（挂体时）。

**默认写入「最近挂载的体」**（挂载集里第一个体）：

- 刚启动、没挂过任何体 → 挂载集 = `defaultBodies`（默认 `[code]`），默认写 `code`
- `/mount physics`（挂群）→ 群下所有体全挂载，默认写群内**第一个体**
- `/mount physics/quantum`（挂体）→ 默认写它

**群/体必须先存在**：默认目标体（或任何你指定的体）若没创建，`/remember` `/summarize` 会报 `Memory body "xxx" does not exist`，**不会自动创建**。

**显式指定体**（绕过默认，挂多个时才有意义）：

- `/remember <体id> <内容>` → 存到指定体
- `/summarize <体id>` → 总结到指定体

> ⚠️ 显式指定的体**也必须已挂载**：`/remember x 内容` 里若 `x` 长得像体 id（全小写字母数字/连字符）却未挂载，会**报错** `Memory body "x" is not mounted`，不会静默当文本。挂群后群内任意体都算已挂载，可直接点名。

**所有操作的默认目标一览**（命令 + 模型工具都遵循同一规则）：

| 操作 | 权威 | 不指定体时的目标 |
|---|---|---|
| `/remember` | user | 最近挂载的体（挂载集里第一个体） |
| `memory_remember`（模型自动） | user | 最近挂载的体 |
| `/summarize` | model | 最近挂载的体 |
| 自动总结 | model | 最近挂载的体 |
| `memory_search`（模型自动） | — | 搜**所有**挂载的群/体 |

**核心规则一句话**：所有写入（命令和模型工具）默认写到「**最近挂载的体**」——因为 `/mount` 会把目标插到挂载集最前。想写别的体就显式指定体 id；想覆盖整群就挂群（默认写群内第一个体）。

**举例**（假设 `physics` 群下有 `quantum`、`relativity` 两个体，另有 `code` 体）：

| 操作 | 挂载（展开后） | `/remember 内容` 存到 | `/remember relativity 内容` 存到 |
|---|---|---|---|
| （无操作） | `[code]` | `code` | ❌ 报错 `relativity` 未挂载 |
| `/mount physics`（挂群） | `[quantum, relativity]` | `quantum`（第一个体） | `relativity` ✅ |
| `/mount physics/quantum`（挂体） | `[quantum, code]` | `quantum` | ❌ 报错 `relativity` 未挂载 |

### 模型工具（自动调用，无需手动）

- `memory_search <关键词>` —— 跨会话回忆，检索挂载的体
- `memory_remember <内容>` —— 你明确说「记住 xxx」时自动写入
- `memory_forget <关键词>` —— 模型发现记忆过时/错误时主动降权（标记失效、不删除、可追溯）
- `memory_correct <关键词> <新内容>` —— 模型主动纠正：降权旧条目 + 写入纠正后的内容

### GUI

- **设置页 → 「记忆体」tab**：查看群/体列表、新建群/体、删除群/体、查看条目
- **输入框 dock 挂载标签**：聊天输入框附近实时显示当前会话挂载的记忆（挂群显示**群名**、挂体显示**体名**），`/mount` `/unmount` 后自动刷新

### 后台编辑

数据是纯文本，可直接改，改完下次检索自动重建索引：

```
<root>/
  <groupId>/           # 一个群 = 一个目录（物理隔离单元）
    group.json         # 群元数据（name/description/anchorRef）
    anchor.vec         # 群公理锚向量（二进制）
    index.sqlite       # 群级 FTS5 索引（每群独立）
    <bodyId>/          # 一个体 = 群下的一个子目录
      body.json        # 体元数据（groupId/name/description/kind/trust）
      anchor.vec       # 体公理锚向量（二进制）
      entries.jsonl    # 记忆条目，一行一条，append-only
  mounts.json          # 会话挂载集
```

---

## 架构（LMA — Layered Memory Architecture）

### 核心范式：自顶向下公理切割

LMA 与所有主流记忆系统（RAG / HNSW / K-Means / RAPTOR / Mem0）的本质区别：

| | 主流（自底向上聚类） | LMA（自顶向下公理切割） |
|---|---|---|
| 边界怎么来 | 度量距离、算法打包（概率涌现） | 用户/AI 基于领域知识**公理定义** |
| 边界性质 | 模糊、会漂移 | 刚性、锁死 |
| 数学基础 | 度量空间 + 概率密度估计 | 离散拓扑 + 集合论 |
| 不确定时 | 用概率硬猜 | 上抛人工仲裁 |

**族 ⊃ 簇 ⊃ 向量** 是绝对的拓扑包含关系，不依赖概率计算，依赖群/体的创建。归属关系（∈）是唯一刚性公理——词条不跨体、体不跨群；内容柔性（边界内自由演化）；增删是主权事件（AI 增删需人工批准）。

### 三层拓扑

```
记忆群 Group = 族 Family   →  领域公理锚向量
记忆体 Body  = 簇 Cluster  →  主题公理锚向量
词条 Entry   = 向量 Vector →  内容 embedding
```

- **公理锚（非质心）**：群/体锚是创建时定义的领域/主题概念向量，稳定不漂移
- **物理隔离**：每群独立目录 + 独立 FTS5 索引 + 独立锚文件

### 检索：树状多族路由

```
查询向量 → 群锚路由（多族并行）→ 命中群内体锚路由 → 簇内词条级检索
```

| 模式 | 挂载 | 复杂度 |
|---|---|---|
| 模式 1 | 无（AI 自动建群） | O(log K)，树状路由 |
| 模式 2 | 挂 q 个群 | 子空间坍缩，降一级 |
| 模式 3 | 挂 r 个体 | O(1) 哈希直连 |

有 embedding 时向量精排，无时 FTS5 兜底（可插拔 Embedder，功能不丢）。

### 主权与创建

- **挂载**：手动 > 自动；`/mount physics`（群）/ `/mount physics/quantum`（体）
- **创建**：AI / 用户 / 半自动三方；冷启动零配置（AI 自动建群建体）
- **三级确定性裁决**：阈值+AI语义一致→自动；冲突→人工仲裁面板（同意归入 AI 建议 / 新建群 / 手动指定群）

### 2 个包 + 3 个加载平面

```
┌─ host 平面（cordis.patch.yml）─────────────────────────────┐
│  memory-store   共享存储服务（群/体 JSONL + 群级 FTS5 + 锚） │
│  memory-body    Remote（群/体管理 GUI）+ /remember 等命令   │
└────────────────────────────────────────────────────────────┘
┌─ agent preset（standard.patch.yml）────────────────────────┐
│  memory-body-preset   工具（search/remember/forget/correct）│
│                        + 自动总结                          │
└────────────────────────────────────────────────────────────┘
┌─ client（dsh.client + exports["./client"]）────────────────┐
│  设置页「记忆体」tab（群-体两层管理）+ 仲裁面板 + 自 mount  │
└────────────────────────────────────────────────────────────┘
```

### 服务组件

| 组件 | 形态 | 职责 |
|---|---|---|
| `MemoryStore` | Service 类 | 共享存储：群/体 JSONL + 群级 FTS + 挂载集 + 树状路由 + 仲裁队列 |
| `MemoryBodyService` | TypertRemoteService | 群/体管理 Remote + 归置/仲裁 Remote + 命令注册 |
| preset 插件 | namespace plugin | 工具 + 自动总结 |
| client 插件 | 双面 React 插件 | GUI（群-体管理 + 仲裁面板）+ 自 mount Remote |

### 存储：事件溯源

- **权威层**：JSONL（append-only、可手改、可审计）
- **读模型**：SQLite FTS5（可丢弃、每次 search 前从 JSONL 重建；**每群独立 index.sqlite**）
- **锚向量**：`.vec` 二进制文件（群锚 `<group>/anchor.vec`，体锚 `<group>/<body>/anchor.vec`）
- **降权不删除**：supersede 追加标记行，同 id 折叠取最新
- **双权威**：`user`（用户钦定，只读）/ `model`（模型总结，可编辑）

### 作用域与挂载机制

**作用域**（LMA 的设计哲学）：

| 维度 | 作用域 | 说明 |
|---|---|---|
| 群（group） | 全局共享 | 顶层领域隔离域，物理目录 |
| 体（body） | 全局共享（群内） | 一个 root，所有工作区/会话可见同一套群/体 |
| 挂载（mount） | 按会话 | 每个会话挂载自己的子集（群或体），互不影响 |
| 默认挂载集 | 全局 | `defaultBodies` 对所有新会话生效 |

> 隔离靠「群/体本身」（独立目录 + 独立索引 + 独立 JSONL），不靠工作区限制 —— 用户通过「建群/建体 + 挂载」自由管理，而非系统预设边界。

**挂载机制**：

- **建群/建体 ≠ 挂载**：建只是磁盘生成，挂载才是「授权会话读写」
- **挂载累加**：`/mount` 插到最前（最近挂载 = 默认写入目标），`/unmount` 只删单个
- **挂载持久化**：会话挂载集存 `root/mounts.json`，`/mount` `/unmount` 立即落盘；会话重启自动恢复，新会话回退默认

### 设计取舍

1. **自顶向下公理切割 vs 自底向上聚类** —— 边界靠定义锁死，不靠度量维持、不漂移
2. **隔离在存储层（物理）** —— 每群独立目录/索引，未命中群物理不参与计算
3. **双权威 vs 混在一起** —— user/model 严格分层
4. **降权不删除 vs 覆盖** —— 可审计可回滚
5. **GUI + JSONL 双编辑 vs 黑盒** —— 透明可手改
6. **事件溯源 vs 单一数据库** —— 索引可重建
7. **可插拔 Embedder vs 强绑定** —— 有 embedding 向量精排，无则 FTS5 兜底

---

## 开发历程与踩坑

### 迭代主线

1. 三大基石提案投递 GitHub Discussions（#1822 记忆体 / #1825 插件市场）
2. 拆分 host 包（存储 + Remote + 命令）与 preset 包（工具 + 自动总结）
3. 修 client 插件自 mount Remote（第三方包不在 api-remotes 白名单）
4. 加会话级挂载（`/mount` `/unmount`）
5. FTS5 分词器 unicode61 → trigram（修中文检索）
6. 在 worktree 副本完成 `v0.1.2-alpha.1` 适配并验证完整跑通（9 处改动，构建 0 错误，挂载标签实时刷新已恢复）
7. 官方出 `v0.1.2-rc.1` 后，主体已更新到 rc.1 并跑通（9 处适配跨 alpha.1→alpha.4→rc.1 全程零改动）
8. 官方版本号跳到 `v0.1.5-rc.2`（跳过 0.1.3/0.1.4），主体已更新到 0.1.5-rc.2 并跑通（9 处适配全程零改动）
9. 官方跨 0.1.6/0.1.7 到 `v0.2.0-rc.2`，主体已更新到 0.2.0-rc.2 并跑通（0.2.0 有 4 处适配：preset 声明方式重构、summarize kind 类型、tsconfig 子项目路径、micromark override）
10. 官方出 `v0.2.1-rc.2`，主体已更新到 0.2.1-rc.2 并跑通（0.2.1 仅 1 处适配：tsdown.config.ts 的 clientBundle 参数改 import.meta.dirname；构建方式改为 build:official 统一编排）；npm 发布 `0.2.1-rc.1`
11. LMA 正式架构升级到 **v2 群-体-词条三层**（自顶向下公理切割：族⊃簇⊃向量、公理锚、树状多族路由、群级物理隔离、AI 自动建群 + 阈值/语义双重判定 + 人工仲裁面板）；npm 发布 `0.3.0-rc.3`

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
3. **真实 embedding 未接**：树状路由/向量精排的可插拔 Embedder 接口已就位，但真实 embedding 模型（本地 onnx / 官方服务）尚未接入；当前默认 NullEmbedder 降级为纯 FTS5 检索（功能完整，向量增强待接模型）

### 测试

- **26 个单元测试**：`p0`~`p4.spec.ts` 覆盖迁移/挂载展开/群级 FTS/embedding 降级/锚向量/双重判定，全部通过（`node --import tsx --test`）

### 后续开发（按优先级）

1. **接入真实 embedding 模型**：实现 `Embedder` 接口（本地 onnx 小模型或官方 embedding 服务），激活树状多族路由 + 向量精排
2. **记忆提供者接口**：让第三方记忆插件（dsh-memory-evolve / EchoCore 等）挂 LMA 之上，PLM「地基插件」定位验证点
3. **AI 自动归置的 LLM 语义判定**：`autoPlace` 的 `aiVerdict` 目前由调用方传入，尚未接 LLM 自动判断「归入现有 or 新建」的语义
4. **量化对比数据**：benchmark（token 节省量、检索命中率、树状路由 vs 扁平检索的性能对比）
5. **权重自然衰减**：`weight` 字段支持记忆自然衰减
6. **挂载体元信息注入**：模型只加载已挂载体的 `id + 描述`

---

## 版本提示

| 项 | 值 |
|---|---|
| dsh 版本 | `0.2.1-rc.2`（源码已适配并跑通） |
| 插件 version | `0.3.0-rc.3`（npm 发布版，dsh 0.2.1-rc.2，**v2 群-体-词条三层**）；源码已适配 `0.2.1-rc.2` |
| npm 包 | `@szx-a/dsh-layered-memory-architecture` + `-preset` |
| peerDependencies | 发布时由 `pnpm publish` 自动替换 `workspace:*` → 对应官方版本 |

### 兼容性说明

| 版本 | 支持状态 |
|---|---|
| dsh `v0.1.1-rc.2` | ✅ npm 发布版（`@szx-a/dsh-layered-memory-architecture@0.1.1-rc.2` + `-preset`） |
| dsh `v0.2.1-rc.2` | ✅ 源码已适配并跑通（主体已更新验证），npm 发布 `0.3.0-rc.3`（`rc` tag，v2 群层） |

**`v0.2.0` 适配结论**：官方从 rc.2 到 0.2.0 经历多次重大重构（版本号跳过 0.1.3/0.1.4，又跨 0.1.6/0.1.7 到 0.2.0）。作者已在 worktree 副本（隔离环境）完成适配，并已**将主体更新到 `0.2.0-rc.2` 验证跑通**。0.2.0 相对 0.1.5 不再零改动，共 4 处适配（见下方适配步骤），破坏点与实测结论：

| 破坏点 | 影响 LMA 的 | 实测结论 |
|---|---|---|
| agent-presets 目录迁移（`apps/cli/config` → `packages/preset`） | preset 接入点 | 0.1.2 起 preset 移到 packages/preset，0.2.0 又改为 packages/bundle/web-app/presets/*.patch.yml 的声明方式 |
| `@deepseek-ai/dsh-client-runtime` 被拆散 | client 插件依赖 | `ClientContext` → cordis `Context`；`ConversationSnapshot.chat.legacy.nodes` → chat 包的 `ChatSnapshot.legacy.nodes` |
| 0.2.0 MessageSource 移除通用 `plugin` kind | summarize.ts | `source: { kind: 'plugin' }` → `{ kind: 'user' }` |
| 0.2.0 ui-* 包拆成 host/client 子项目 | tsconfig.client.json | references 改为指向 `.client.json` |

**作者立场**：LMA 已适配 `0.2.0-rc.2` 并在主体跑通。官方版本迭代快（跳过 0.1.3/0.1.4 直接 0.1.5，又跨 0.1.6/0.1.7 到 0.2.0）。`0.2.0` 的 npm 发布版待定。

### LMA 适配新版本的步骤（供先行者自担风险参考）

> 教程级清单，具体到文件 + 行 + 前后代码。以 dsh 0.2.0-rc.2 为准；从旧版本（rc.2 / 0.1.x）跨过来时，先看「A. 接入点」和「B. client 源码」是否已经改过。

**A. 接入点（路径随版本变化，0.2.0 的 preset 声明方式变了）**

**1. host 接入** — `packages/bundle/web-app/cordis.patch.yml`，在 `plugin-inventory` row 后加：

```yaml
    # LMA 记忆体：共享存储服务 + Remote（体管理 GUI）+ 命令
    - id: memory-store
      name: '@szx-a/dsh-layered-memory-architecture/memory-store'
      config:
        root: 'F:/dp/memory-body-data'   # ⚠️ 改成你自己的数据目录
        defaultBodies: [code]

    - id: memory-body
      name: '@szx-a/dsh-layered-memory-architecture'
```

**2. preset 接入** — ⚠️ 0.2.0 变了，不再是独立的 agent.cordis.yml row，而是 `packages/bundle/web-app/presets/standard.patch.yml` 里 `preset-standard` 声明的 `config.plugins` 数组末尾加一个条目：

```yaml
          # LMA 记忆体：模型面向的工具 + 自动总结
          - id: memory-body-preset
            name: '@szx-a/dsh-layered-memory-architecture-preset'
            config:
              autoSummarize: false
```

> 历史沿革：0.1.1-rc.2 在 `apps/cli/config/agent-presets/standard/agent.cordis.yml`；0.1.2 搬到 `packages/preset/agent-presets/presets/standard/agent.cordis.yml`；**0.2.0 改为 `packages/bundle/web-app/presets/standard.patch.yml` 的 plugins 数组声明方式**（preset 从静态 yml row 变成 `@deepseek-ai/dsh-agent-preset` 声明的 config.plugins 条目）。

**3. 依赖** — `packages/bundle/web-app/package.json` 的 `dependencies` 加 2 行（⚠️ 0.2.0 用 `workspace:*` 而不是 `workspace:^`）：

```json
"@szx-a/dsh-layered-memory-architecture": "workspace:*",
"@szx-a/dsh-layered-memory-architecture-preset": "workspace:*"
```

**4. references** — `tsconfig.host.json` 的 `references` 加：

```json
{ "path": "./packages/memory/memory-body/tsconfig.host.json" },
{ "path": "./packages/memory/memory-body-preset" }
```

`tsconfig.client.json` 的 `references` 加：

```json
{ "path": "./packages/memory/memory-body/tsconfig.client.json" }
```

**B. client 源码改动（`@deepseek-ai/dsh-client-runtime` 被拆散导致，5 处）**

**5. `src/client/index.tsx` 第 8 行** — `ClientContext` 换包：

```ts
// 旧
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// 新
import type { Context as ClientContext } from '@deepseek-ai/cordis'
```

**6. `src/client/MountedBodiesLine.tsx` 第 2-3 行** — import 换成 `ChatSnapshot`：

```ts
// 旧
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
// 新
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'   // SnapshotSelectorHook 仍在 ui-slots
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'     // 消息节点在 ChatSnapshot.legacy.nodes
```

**7. `package.json`** — 删 3 处 `dsh-client-runtime`，新增 `ui-chat`：

```jsonc
// dsh.client.inject 数组：删 "@deepseek-ai/dsh-client-runtime"，加
"@deepseek-ai/dsh-client-ui-chat"

// peerDependencies / devDependencies：删 "@deepseek-ai/dsh-client-runtime": "workspace:^"，加
"@deepseek-ai/dsh-client-ui-chat": "workspace:^"
```

> 我们 LMA 没直接用 store 引擎，删掉 runtime 即可，无需加 `@deepseek-ai/dsh-client-store`。

**8. `tsconfig.client.json`** — 删 `client/runtime` reference；⚠️ 0.2.0 里 ui-settings/ui-conversation/ui-chat 拆成 host/client 子项目，引用要指向 `.client.json`：

```json
// 0.2.0 的正确引用（旧版直接引目录 ../../client/ui-chat）
{ "path": "../../client/ui-settings/tsconfig.client.json" },
{ "path": "../../client/ui-conversation/tsconfig.client.json" },
{ "path": "../../client/ui-chat/tsconfig.client.json" }
```

**9. `src/client/index.tsx`** — 补 2 个空 import + slot 参数类型：

```ts
// 顶部补（提供 client 服务类型声明）
import type {} from '@deepseek-ai/dsh-api-remotes/client'        // ctx.remote 类型
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'  // ctx.slots 类型

// conversation.composer.dock slot 的 inject factory（第 63、65 行）
// 旧
inject: (sessionId: string) => ({
  listMounted: async (): Promise<string[]> => {
    const r = await remote.listMounted(sessionId)
    return r.ok ? r.value : []
  },
}),
// 新（去掉 `: string` 注解，用 String() 转换 branded 类型 SessionIdOf）
inject: (sessionId) => ({
  listMounted: async (): Promise<string[]> => {
    const r = await remote.listMounted(String(sessionId))
    return r.ok ? r.value : []
  },
}),
```

> 实时刷新信号也已恢复：`MountedBodiesLine` 里 `useSession(s => s.chat.legacy.nodes.length)` → `useChat(s => s.legacy.nodes.length)`（照官方 `StatsLine` 先例，`useChat` 由 ui-chat merge 进 `SessionStandardProps`，session 作用域 slot 组件自动获得）。

**10. `src/summarize.ts`（⚠️ 0.2.0 新增改动）** — MessageSource 移除了通用 `plugin` kind：

```ts
// 旧
source: { kind: 'plugin', plugin: 'dsh-memory-body' }
// 新（0.2.0 的 MessageSourceMap 只有 user/model/tool/system-prompt）
source: { kind: 'user' }
```

**11. `pnpm-workspace.yaml`（⚠️ 0.2.0 新增，官方 lock 漂移绕行）** — 在 `overrides` 段加：

```yaml
overrides:
  'micromark-util-types': '2.0.2'
```

> 0.2.0-rc.2 的官方 lock 存在 micromark-util-types 版本漂移（2.0.2/2.0.3 冲突导致 ui-primitives 类型报错）。加 override 锁 2.0.2 才能 `pnpm install` 通过。注意 pnpm 11.7 不读 package.json 的 pnpm.overrides，要写在 `pnpm-workspace.yaml`。

**C. 构建 + 验证（⚠️ 关键教训）**

```bash
pnpm run clean                 # 更新版本后必先清旧 lib 产物，否则假 MISSING_EXPORT
pnpm install                   # 链接新依赖（会触发 micromark 漂移，需上面第 11 步的 override）
pnpm run build:lib:host        # = tsc -b tsconfig.host.json && tsdown host && desktop bundle
pnpm run build:lib:client      # = tsc -b tsconfig.client.json && tsdown --env.DSH_BUILD_FACE client
pnpm dsh web --no-open --port 0
```

- **必须跑 host + client 两个 face**：只跑 host face 会让 `dsh web` 报 `MissingClientBundleError`（缺全图 `lib/client.js`）。
- **通过标准**：打印 URL + `ExperimentalWarning: SQLite`，无 `pending`、无 `typert manifest`、无 `MissingClientBundleError`；HTTP 探测返回 401 即确认监听。
- **编译错误先分真假**：`Cannot find module .../remote`、`MISSING_EXPORT` 类报错，多数是「依赖产物没构建 / 旧 lib 残留 / 依赖版本漂移」，先 clean + 全量构建 + 确认 override，剩下的才是真 API 变化，**别急着改好代码**。
- ⚠️ **build:lib:host 的 exit 1 可能来自最后的 desktop bundle**（输出全是 `✓ built` 无 error）。验证 LMA 编译应单独跑 `tsc -b tsconfig.host.json` + `tsc -b tsconfig.client.json` + `tsdown --env.DSH_BUILD_FACE client`，不要被 desktop bundle 的 exit 1 干扰。

---

## 目录结构

### LMA 源码

```
packages/memory/
├── memory-body/                 # host 包 @szx-a/dsh-layered-memory-architecture
│   └── src/
│       ├── index.ts             # MemoryBodyService（群/体管理 Remote + 归置/仲裁 Remote + 命令注册）
│       ├── memory-store.ts      # MemoryStore（共享存储服务 + 树状路由 + 仲裁队列）
│       ├── store.ts             # JSONL 权威存储（纯函数，群/体目录 + 挂载展开）
│       ├── group.ts             # 群存储（group.json 读写）
│       ├── migrate.ts           # 迁移（旧版裸体归 default 群，幂等）
│       ├── embed.ts             # 可插拔 Embedder + NullEmbedder 降级 + 余弦相似度
│       ├── anchor.ts            # 公理锚向量二进制持久化（.vec）
│       ├── placement.ts         # 阈值 + AI 语义双重判定（三级裁决）
│       ├── fts.ts               # FTS5 检索（trigram，群级独立索引）
│       ├── command.ts           # /remember /summarize /forget /mount /unmount（群/体粒度）
│       ├── summarize.ts         # 总结逻辑
│       ├── parse.ts             # 输入解析
│       └── client/              # GUI（群-体管理 tab + 仲裁面板）
└── memory-body-preset/          # preset 包（-preset 后缀）
    └── src/
        ├── index.ts             # 工具 + 自动总结装配
        ├── tool.ts              # memory_search / remember / forget / correct
        └── auto-summarize.ts    # 自动总结触发
```

> v2 起 LMA 源码不再是「官方零改动」——新增了群层相关文件（group/migrate/embed/anchor/placement/ArbitrationPanel），这些是 LMA 自己的架构演进，非官方重构所致。

### 接入点目录（dsh 版本不同，路径不同）

| 接入点 | 0.1.1-rc.2（旧） | 0.2.x（新） |
|---|---|---|
| host 行（memory-store / memory-body） | `packages/bundle/web-app/cordis.patch.yml` | `packages/bundle/web-app/cordis.patch.yml`（不变） |
| preset 行（memory-body-preset） | `apps/cli/config/agent-presets/standard/agent.cordis.yml` | **`packages/bundle/web-app/presets/standard.patch.yml`**（⚠️ 0.2.0 起改为 plugins 数组声明） |
| web-app 依赖 | `packages/bundle/web-app/package.json` | `packages/bundle/web-app/package.json`（不变） |
| tsconfig references | `tsconfig.host.json` / `tsconfig.client.json` | `tsconfig.host.json` / `tsconfig.client.json`（不变） |

> preset 接入点经历两次迁移：0.1.2 从 `apps/cli/config/` 移到 `packages/preset/`，0.2.0 又改为 `packages/bundle/web-app/presets/standard.patch.yml` 的 plugins 数组声明方式。完整适配见上方「LMA 适配新版本的步骤」。

---

## 许可证

见 [LICENSE](./LICENSE)。
