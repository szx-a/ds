# 加载后逐项验收清单

> 用途：加载 `memory-body` 成功后，逐项确认功能；
> 前置：已按 VERIFY.md 完成配置 + 启动 `pnpm dsh web` + 创建体 `code`。

## 第 0 项：加载成功标志

- Harness 正常启动，**不报** `plugin tree failed to load` / `preset "standard" failed to mount`。
- Web GUI 能正常打开、能新建会话。

**如果这里就失败**：贴完整报错（尤其 `apply loader entry memory-body` 后面的具体错误）。

---

## 第 1 项：`/remember`（存文档）

输入：
```
/remember 用 pnpm run build:web 构建 Web 前端
```

预期回复（含 "Remembered into body"）：
```
Remembered into body "code" (entry <一串id>)
```

**失败报什么**：回复里的错误文字原文 + 你当时的完整输入。

---

## 第 2 项：`memory_search`（检索）

输入（自然语言，让模型自己调工具）：
```
我记过 pnpm 构建相关的东西吗
```

预期：
- 模型调用 `memory_search` 工具；
- 返回第 1 项存的条目（`[code] (user) 用 pnpm run build:web 构建 Web 前端`）。

**失败报什么**：模型是否调用了 `memory_search`？工具返回了什么（或报了什么错）？

---

## 第 3 项：`/summarize`（模型总结）

输入：
```
/summarize
```

预期回复（含 "Summarized into body"）：
```
Summarized into body "code" (entry <一串id>)
```

**注意**：若回复 `Summarization failed: no provider/model available`，说明会话还没发过请求——**先正常对话一轮，再 `/summarize`**。

**失败报什么**：失败文字原文（尤其是 `Summarization failed:` 后面的 reason）。

---

## 第 4 项：`/forget`（降权不删除）

输入：
```
/forget 构建
```

预期回复（含 "Retired"）：
```
Retired 1 memory matching "构建" (kept in history, not deleted)
```

然后**再问一次**"我记过 pnpm 构建相关的东西吗"，预期 `memory_search` **不再返回**被废弃的条目（但 `entries.jsonl` 文件里那行还在，只是标记 `superseded`）。

**失败报什么**：`/forget` 的回复原文 + 之后 memory_search 是否还返回旧条目。

---

## 第 5 项：后台文件检查（"双编辑"验证）

打开 `F:/dp/memory-body-data/code/entries.jsonl`，应能看到上面的条目（一行一条 JSON）。手改某条 `content`，再 `memory_search` 验证生效（FTS 每次检索前重建，会读到改动）。

同时确认 `F:/dp/memory-body-data/index.sqlite` 存在（FTS 读模型，可删——下次检索会重建）。

---

## 故障报告模板（任一项失败时，可反馈)

```
【哪一项】第 N 项 /remember
【输入】xxx
【实际输出/报错】xxx（原文，别删减）
【环境】Node 版本、是否 tsx 启动、agent.cordis.yml 里 memory-body 那段配置
```

