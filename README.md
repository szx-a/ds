# dsh 记忆体（Memory Body）插件

> 社区体验版 · LMA 分层记忆架构：群-体-词条三层 + 挂载 + 自动总结 + 向量检索
>
> 这是 GitHub Discussions [#1822（记忆体 Memory Body）](https://github.com/deepseek-ai/deepseek-harness/discussions/1822) 提案的一个可运行实现。

---

## 目录

- [这是什么](#这是什么)
- [特性](#特性)
- [安装](#安装)
  - [关键机制：bundle 必须进 bundles 列表](#-关键机制bundle-必须进-dshprofilebundles-列表才会生效)
  - [前置：版本对齐](#前置版本对齐重要)
  - [方式一：手动接入（源码）](#方式一手动接入当前可用的方式)
  - [方式二：npm 安装（web 端）](#方式二npm-安装web-端)
  - [方式三：bundle 安装（桌面端）](#方式三bundle-安装plugin_manager-install_bundle桌面端--web-端通用)
- [用法](#用法)
  - [命令](#命令)
  - [记忆写到哪里（默认写入目标）](#记忆写到哪里默认写入目标)
  - [模型工具](#模型工具自动调用无需手动)
  - [GUI](#gui)
  - [后台编辑](#后台编辑)
- [架构（LMA）](#架构lma--layered-memory-architecture)
  - [设计动机：三大困境](#设计动机现有记忆系统的三大困境)
  - [核心范式：自顶向下公理切割](#核心范式自顶向下公理切割)
  - [三层拓扑](#三层拓扑)
  - [公理锚 vs 质心](#公理锚-vs-质心向量层最锋利的一刀)
  - [数学形式化：定义与定理](#数学形式化定义与定理)
  - [检索：树状多族路由](#检索树状多族路由)
  - [主权与创建](#主权与创建)
  - [与传统系统的对比](#与传统系统的对比)
  - [2 个包 + 3 个加载平面](#2-个包--3-个加载平面)
  - [服务组件](#服务组件)
  - [存储：事件溯源](#存储事件溯源)
  - [作用域与挂载机制](#作用域与挂载机制)
  - [设计取舍](#设计取舍)
  - [本体论与三条原则](#本体论与三条原则)
- [开发历程与踩坑](#开发历程与踩坑)
  - [迭代主线](#迭代主线)
  - [关键踩坑](#关键踩坑已固化到-recoverymd)
- [测试与后续开发](#测试与后续开发)
- [版本提示](#版本提示)
  - [兼容性说明](#兼容性说明)
  - [适配 SOP](#适配-sop跟随-dsh-版本更新)
- [目录结构](#目录结构)
- [许可证](#许可证)

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

源码已适配 dsh `0.2.2-rc.3`（含挂载标签实时刷新）。npm 发布版：`latest` = `0.1.1-rc.2`（dsh rc.2），`rc` = `0.4.0-rc.1`（dsh 0.2.2-rc.3，**v2 群-体-词条三层架构**）。

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

npm 已发布两个包，**基于 dsh `0.2.2-rc.3`**（`rc` tag），适合 web 端**不想放源码、不想自己构建**的情况（npm 包已含编译好的 `lib/` 产物和类型声明）。

- `@szx-a/dsh-layered-memory-architecture@0.4.0-rc.1`
- `@szx-a/dsh-layered-memory-architecture-preset@0.4.0-rc.1`

> ⚠️ `latest` tag 仍是 `0.1.1-rc.2`（dsh rc.2 旧版）。装 0.3.0 版需显式写 `@0.4.0-rc.1` 或 `@rc`。

**1. 安装两个包**（装到 web-app bundle）：

```bash
pnpm --filter @deepseek-ai/dsh-web-app add @szx-a/dsh-layered-memory-architecture@0.4.0-rc.1 @szx-a/dsh-layered-memory-architecture-preset@0.4.0-rc.1
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
@szx-a/dsh-layered-memory-architecture@0.4.0-rc.1
@szx-a/dsh-layered-memory-architecture-preset@0.4.0-rc.1
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

### 设计动机：现有记忆系统的三大困境

大语言模型的长期记忆，目前几乎都走同一条路：把一切内容变成高维向量，丢进一个扁平空间，靠近似最近邻（ANN）算法检索。这条路有三个绕不开的困境：

- **算力内卷**：检索空间永远是全集 U。随着数据规模 N 无界增长，内存开销与检索延迟线性甚至指数膨胀。无论怎么优化 HNSW 的图结构、怎么压内存，检索范围始终是「所有记忆」，这是结构决定的，算法救不了。
- **语义漂移**：根据高维几何的「距离集中现象」，维度越高，任意两个随机向量的距离越趋于相等——「距离近」越来越不代表「语义相关」。大量无关的日常对话（长尾高频）与少量精专知识（短尾低频）混在一个空间里，全局检索的信噪比急剧下降，假阳性直接引发幻觉。
- **越权失控**：现有系统倾向于让 AI 自动提取、自动预测记忆，记忆空间沦为无序的「垃圾桶」。人类用户失去了对记忆物理边界的绝对控制权——主权（Sovereignty）缺失。

三个困境指向同一个根源：**它们都在一个扁平、连续的度量空间里，用统计概率去「猜」边界。**

### 核心范式：自顶向下公理切割

LMA 与所有主流记忆系统（RAG / HNSW / K-Means / RAPTOR / Mem0）的本质区别：

| | 主流（自底向上聚类） | LMA（自顶向下公理切割） |
|---|---|---|
| 边界怎么来 | 度量距离、算法打包（概率涌现） | 用户/AI 基于领域知识**公理定义** |
| 边界性质 | 模糊、会漂移 | 刚性、锁死 |
| 数学基础 | 度量空间 + 概率密度估计 | 离散拓扑 + 集合论 |
| 不确定时 | 用概率硬猜 | 上抛人工仲裁 |

主流系统（RAG、HNSW、K-Means、层次聚类、RAPTOR、Mem0）在数学上的本质是 **Bottom-up Clustering（自底向上的聚类与摘要）**：把海量向量丢进去，用算法计算距离、自动打包成「簇」或「摘要」，这是统计学的概率映射，边界是「涌现」的、模糊的、会漂移的。它们的层级（如 RAPTOR 的摘要树）本质是「喂给 LLM 阅读的摘要」，是数据压缩机制，不是检索隔离边界。

LMA 走的是相反的 **Top-down Axiomatic Partitioning（自顶向下的公理切割）**：「群、体、词条」不是算法算出来的，而是用户或 AI 基于领域知识直接**硬性定义的集合公理**。族 ⊃ 簇 ⊃ 向量 是一个**绝对的拓扑空间包含关系**，不依赖概率计算，依赖群或体的创建。

一句话：**主流在「度量空间里猜边界」，LMA 在「拓扑空间里立边界」。** 前者边界是概率，后者边界是公理。归属关系（∈）是唯一刚性公理——词条不跨体、体不跨群；内容柔性（边界内自由演化）；增删是主权事件（AI 增删需人工批准）。

### 三层拓扑

```
记忆群 Group = 族 Family   →  领域公理锚向量
记忆体 Body  = 簇 Cluster  →  主题公理锚向量
词条 Entry   = 向量 Vector →  内容 embedding
```

- **公理锚（非质心）**：群/体锚是创建时定义的领域/主题概念向量，稳定不漂移
- **物理隔离**：每群独立目录 + 独立 FTS5 索引 + 独立锚文件

### 公理锚 vs 质心：向量层最锋利的一刀

三层结构各自有一个「中心点」用于路由。这里藏着最关键的实现抉择：**中心点到底是「质心」还是「公理锚」？**

- **质心（centroid）**：对群内所有词条向量求平均、算出来的。它会随数据增删而漂移，是统计量。
- **公理锚（axiomatic anchor）**：创建群/体时，由用户或 AI 基于领域知识**定义**的领域概念向量（「Physics」这个概念本身的 embedding）。它稳定不漂移，是公理量。

如果用了「质心」，就等于把「聚类」套了个「群」的壳子——边界照样漂移，照样是概率映射，违背了整个架构的初衷。所以 LMA 的锚必须是「公理锚」。

**「公理锚 vs 质心」，就是「公理切割 vs 统计聚类」在向量层的最终分界。** 它让「隔离」从「统计上的近似分开」变成「定义上的绝对分开」。

### 数学形式化：定义与定理

把「群、体、词条」映射到集合论与拓扑学，可以严格定义出 LMA 的底层结构。设全量记忆词条构成的高维向量空间为全集 $V$，规模为 $N$。

**定义 1（族 Family / 记忆群）**：LMA 将全集 $V$ 划分为 $m$ 个互不相交的子空间 $\mathcal{F} = \{F_1, \dots, F_m\}$，满足三个性质：

1. **完备性**：$V = \bigcup_{i=1}^{m} F_i$
2. **互斥性**：$\forall\, i \neq j,\; F_i \cap F_j = \emptyset$
3. **直和性**：$V = \bigoplus_{i=1}^{m} F_i$

传统聚类允许一个向量以不同的概率同时属于多个簇（软聚类的隶属度）。但在 LMA 中，一个向量一旦被挂载写入某个族 $F_i$，它在拓扑上就被绝对固定于 $F_i$——任何检索算法的搜索算力，在进入 $F_i$ 的瞬间，就在数学上被截断了与其他族的连通性。

**定义 2（簇 Cluster / 记忆体）**：在族 $F_i$ 内部，系统基于语义一致性建立划分 $\mathcal{C}_i = \{C_{i1}, \dots, C_{ik}\}$，满足 $F_i = \bigcup_{j=1}^{k} C_{ij}$ 且互不相交。

根据高维几何的「距离集中现象」，当维度 $d \to \infty$ 时，任意两个随机向量的距离变异系数趋于零：

$$\frac{\sqrt{\operatorname{Var}(\|x - y\|_2)}}{\mathbb{E}(\|x - y\|_2)} \to 0$$

这意味着「距离近」越来越不代表「语义相关」。LMA 的簇本质上是把距离度量**限制在局部紧致集 $C_{ij}$ 内**，度量环境的信噪比远高于全局空间。

**定义 3（向量 Vector / 词条 Entry）**：词条 $v$ 受两重约束——**归属约束**（$v \in C_{ij} \subset F_i \subset V$，所属簇/族被卸载则不可检索）与**溯源约束**（增删改查绑定在不可变的 JSONL 事件流中）。

**集合论映射**：设全量词条集合为 $U$，任何元素满足唯一归属：

$$\forall\, x \in U,\quad \exists!\, (F_i, C_{ij})\ \text{ 使得 }\ x \in C_{ij} \subset F_i$$

这种严格嵌套切断了跨域的语义跃迁路径。

**定理（三阶降维复杂度）**：设 $m$ 为族数、$k$ 为每族簇数、$n$ 为每簇词条数，$N = m \cdot k \cdot n$。

| 模式 | 挂载状态 | 复杂度 |
|---|---|---|
| 模式一（全局树状检索） | 无挂载（冷启动） | $T_1 = O(\log m + \log k) = O(\log K),\ K = m \cdot k$ |
| 模式二（挂载群，子空间降维） | 挂 $q$ 个群 | $T_2 = O(\log(q \cdot k)),\ q < m$ |
| 模式三（挂载体，点对点直连） | 挂 $r$ 个体 | $T_3 = O(1)$（微秒级） |

被抛弃的 $(m - q)$ 个族在物理意义上彻底从计算图中剔除，算力消耗断崖式下跌——这是扁平架构结构上做不到的。

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

### 与传统系统的对比

| 维度 | 主流（RAG / HNSW / RAPTOR / Mem0） | LMA |
|---|---|---|
| 数学本质 | 自底向上聚类与摘要 | 自顶向下公理切割 |
| 边界来源 | 距离度量、算法打包（概率） | 领域知识、硬性定义（公理） |
| 边界性质 | 模糊、会漂移 | 刚性、锁死 |
| 数学基础 | 度量空间 + 概率密度估计 | 离散拓扑 + 集合论 |
| 层级用途 | 给 LLM 读的摘要压缩 | 检索隔离边界 |
| 检索空间 | 始终全集 U | 三态降维（U → 子空间 → 直连） |
| 不确定时 | 用概率硬猜 | 上抛人工仲裁 |
| 人类主权 | 弱（AI 自动预测） | 强（手动 > 自动） |

当前前沿系统（RAPTOR 的摘要树、Mem0 的混合存储）试图通过优化「算法」来解决算力问题，但它们的数据结构依然受限于「统计学软聚类」。LMA 是纯粹的结构主义架构：传统系统想要逆向重构成 LMA 的结构，需要把历史累积的无标签向量重新物理打标与拓扑划分，这在信息论上是不可逆的（会导致大量信息丢失）——这构成了 LMA 的架构护城河。

### 设计取舍

1. **自顶向下公理切割 vs 自底向上聚类** —— 边界靠定义锁死，不靠度量维持、不漂移
2. **隔离在存储层（物理）** —— 每群独立目录/索引，未命中群物理不参与计算
3. **双权威 vs 混在一起** —— user/model 严格分层
4. **降权不删除 vs 覆盖** —— 可审计可回滚
5. **GUI + JSONL 双编辑 vs 黑盒** —— 透明可手改
6. **事件溯源 vs 单一数据库** —— 索引可重建
7. **可插拔 Embedder vs 强绑定** —— 有 embedding 向量精排，无则 FTS5 兜底

### 本体论与三条原则

LMA 不止是一个插件级的优化，而是对 AI 记忆本体论的一次定义：**记忆不应当是模型概率预测的奴隶，而应当是具有明确公理边界、主权归属于人类的确定性拓扑空间。**

它确立的原则是：

1. 边界靠「定义」锁死，不靠「度量」维持
2. 隔离靠「结构」强制，不靠「算法」近似
3. 主权靠「挂载」显式，不靠「预测」默许

在未来的通用人工智能系统中，「事件溯源 + 主权挂载 + 公理切割」将成为底层认知基础设施的必经之路——为物理第一性模型工程提供确定性的记忆前置路由。

---

## 开发历程与踩坑

### 迭代主线

1. 三大基石提案投递 GitHub Discussions（#1822 记忆体 / #1825 插件市场）
2. 拆分 host 包（存储 + Remote + 命令）与 preset 包（工具 + 自动总结）
3. 修 client 插件自 mount Remote（第三方包不在 api-remotes 白名单）
4. 加会话级挂载（`/mount` `/unmount`）
5. FTS5 分词器 unicode61 → trigram（修中文检索）
6. 早期版本适配（0.1.2 → 0.2.1-rc.2）：LMA 源码零改动，仅接入点随官方重构迁移（preset 位置、MessageSource kind、tsconfig 拆分、micromark override、tsdown clientBundle 参数）
7. LMA 正式架构升级到 **v2 群-体-词条三层**（自顶向下公理切割：族⊃簇⊃向量、公理锚、树状多族路由、群级物理隔离、AI 自动建群 + 阈值/语义双重判定 + 人工仲裁面板）；npm 发布 `0.3.0-rc.1`
8. 官方出 `v0.2.1-rc.5`，主体更新并跑通（rc.2→rc.5 纯增量：官方仅新增 `ui-entry-customization` 包，LMA 源码零改动、接入点零变化）；npm 发布 `0.3.0-rc.4`
9. 官方出 `v0.2.2-rc.3`，主体更新并跑通（0.2.1→0.2.2 跨 minor：唯一适配点是 LMA files 白名单加 `lib/typert.remote-client.d.ts.map`，LMA 源码零改动、接入点零变化、micromark override 不再需要）；npm 发布 `0.4.0-rc.1`

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
| dsh 版本 | `0.2.2-rc.3`（源码已适配并跑通） |
| 插件 version | `0.4.0-rc.1`（npm 发布版，dsh 0.2.2-rc.3，**v2 群-体-词条三层**）；源码已适配 `0.2.2-rc.3` |
| npm 包 | `@szx-a/dsh-layered-memory-architecture` + `-preset` |
| peerDependencies | 发布时由 `pnpm publish` 自动替换 `workspace:*` → 对应官方版本 |

### 兼容性说明

| 版本 | 支持状态 |
|---|---|
| dsh `v0.1.1-rc.2` | ✅ npm 发布版（`@szx-a/dsh-layered-memory-architecture@0.1.1-rc.2` + `-preset`） |
| dsh `v0.2.2-rc.3` | ✅ 源码已适配并跑通（主体已更新验证），npm 发布 `0.4.0-rc.1`（`rc` tag，v2 群层） |

### 适配 SOP（跟随 dsh 版本更新）

LMA 跟随 dsh 版本更新的标准流程已固化为独立文档，三步走：**副本验证 → 主体接入 → npm 发布**。

- 核心原则：先在副本验证、再动主体；数据用 git 存档记录；官方文件只增不删。
- 版本适配历史见「开发历程」的迭代主线；历次适配的适配点结论都记录在案（如 0.2.2 的 files 加 .d.ts.map）。

详细流程见仓库外的 SOP 文档（dsh-lma-update-sop.md），或参考最近一次适配的总结。

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
