# 决策点：要不要给模型加 memory_remember 工具

> 来源：模型在 `/summarize` 验证时反馈"工具集里只有 memory_search，没有写入/删除工具"。
> 状态：**待用户决策**。核心闭环不依赖它，它是 UX 增强，不是 bug 修复。

## 一、问题的本质

当前"双写入入口"的实现：

| 入口 | 触发者 | 现状 |
|---|---|---|
| `/remember` 命令 | **用户**在输入框打 | 已实现，待验证 |
| 自动总结 | 模型自动（`/summarize` 或 `autoSummarize`） | `/summarize` 已验证 |

模型反馈暴露的缺口：**如果用户用自然语言说"记住这个"，模型无法主动写入**——它没有对应的工具，只能回答"请用 /remember 命令"。

## 二、两个选项

### 选项 A：保持现状（命令是唯一写入入口）

- 写入 = 用户 `/remember`；模型只检索（`memory_search`）+ 总结（`/summarize`/自动）。
- **优点**：符合最初设计"文档内容由用户选择"；写入是用户显式动作，安全；零新代码。
- **缺点**：用户得记住用 `/remember` 命令，不能"随手让模型记"。

### 选项 B：加 `memory_remember` 工具（模型可主动写入）

- 模型在用户说"记住 xxx"时，调用 `memory_remember` 工具写入 `authority='user'` 的条目。
- **优点**：UX 更自然，模型能"随手指令即记"；更接近"混合写入"的完整形态。
- **缺点**：新代码、新验证；多一个模型可调用的写入入口（需谨慎设计权限——模型只能写入用户明确要求的内容，不能自己擅自写入）。

## 三、我的建议

**先做选项 A 的收尾（验证完 `/remember`/检索/`/forget` 三步），把 goal 完成。** 然后，如果体验后确实觉得"每次要自己打 `/remember` 太麻烦"，再做选项 B——它是加一个工具（照 `tool-todo`/`memory_search` 的 `defineTool` 模式），工程量不大、风险可控。

理由：核心闭环（存储、检索、命令、LLM、出处）已经全部验证，`memory_remember` 是"锦上添花"。**先闭环、后增强**，符合这几轮反复强调的"不堆未验证代码"。

## 四、若做选项 B，实现要点（预留）

- 照 `tool.ts` 的 `memory_search`，加一个 `memory_remember` 工具：
  - `parameters`: `{ content: string (required), bodyId?: string }`
  - `execute`: 调 `appendEntry(authority='user')`（复用已验证的存储层）
  - 权限：`bodyId` 必须属于挂载集（同 `memory_search` 的边界）
- 描述里明确"只在用户明确要求记住时调用，不要擅自写入"。
