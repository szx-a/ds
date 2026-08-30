# GUI 设计评估与延后说明

> 状态：**明确延后**。本文记录延后理由、真实工程量、以及延后后的替代方案。

## 一、GUI 的真实结构（从 `ui-settings-plugin-inventory` 先例确认）

GUI（"图形化看到和选择记忆体"）在 Harness 里是**双面 client 插件**，不是"加个设置页"：

| 侧 | 文件 | 内容 |
|---|---|---|
| host（node half） | `src/index.ts` | `apply()` 空壳，但需暴露 **Remote**（RPC 面）给浏览器 |
| client（browser half） | `src/client/index.ts` | React 组件（`.tsx`）+ `ctx.slots.inject('settings.plugins.tab', ...)` + locale 字典 + `ctx.remote.xxx` 调用 |

关键依赖（client 侧 `inject`）：
- `@deepseek-ai/dsh-client-runtime/client`（`ClientContext`）
- `@deepseek-ai/dsh-client-ui-slots`（slots）
- `@deepseek-ai/dsh-client-locale/client`（locale）
- `@deepseek-ai/dsh-client-ui-settings/client`（settings）
- React + `.tsx` + `tsdown` bundle（`lib/client.js`）

## 二、真实工程量（为什么延后）

1. **host 侧要新建 Remote API**：`remote.memoryBody`（listBodies / createBody / removeBody / listEntries / editEntry），走 api-proxy 的 Remote 生成机制——这是 host 插件里没有的部分，要新写并接 Typert/Remote 描述符。
2. **client 侧 React 组件**：体列表卡片、创建对话框、删除、编辑条目——照 `ui-agent-preset` 的 roster 卡片（约几百行 React）。
3. **双面 bundle**：tsdown 出 `lib/client.js`，且 web 需要 `dev:web` watcher 重建 client bundle（否则改 UI 不生效）。
4. **locale**：中英文字典。

这四块加起来，超过存储+FTS+命令的总和，且**全部依赖"闭环在 Harness 里已验证"这个前提**。

## 三、延后理由（诚实）

1. **依赖闭环验证**：GUI 的每个按钮（创建体、删除体、改条目）都调 host 的存储/检索 API。若存储/检索在 Harness 里还没跑通，GUI 就是"在未验证的地基上盖楼"。
2. **超出社区体验版 v0.1 的范围**：体验版的目的是"验证记忆体概念"，后台 JSONL + 三个命令 + 检索工具已经足够验证。GUI 是"产品化"，不是"验证"。
3. **postmortem 0001 教训**：不堆第三层未验证代码。

## 四、延后后的替代（v0.1 已具备）

"两头实现"在 v0.1 的兑现方式：

- **给懂的人**：`agent.cordis.yml` 配置挂载 + 后台直接编辑 `body.json`/`entries.jsonl` + `/remember` `/summarize` `/forget` 命令。
- **给不懂的人**：**暂缺**——这是 GUI 的唯一缺口，也是概念验证通过后第一个该补的产品化。

## 五、GUI 实现清单（闭环验证通过后）

1. host 侧：`memoryBody` Remote（listBodies/createBody/removeBody/listEntries/updateEntry/retireEntry）。
2. client 侧：`ui-memory-body` 双面插件，settings tab 里做体管理卡片 + 挂载选择器。
3. locale + tsdown bundle。

## 六、结论

**GUI 是目标里唯一"应该延后"的一项**，且延后是**负责任的选择**（不是逃避）：它依赖闭环验证、工程量最大、且 v0.1 有替代方案。核心的"验证记忆体概念"不依赖 GUI。
