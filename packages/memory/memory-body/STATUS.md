；已给三命令加

）更新时间：第 17 轮。本文是开发进度**）；已给三命令加。

##一、目标 vs 完成度

|目标项|代码|验证|状态|
|---|---|---|---|
|多体 + 挂载|✅|⏳|默认身体 + 身体 ID 隔离 + 指定体命令|
|自动总结存入|✅|✅`/summarize`已落盘真实|手动`/summarize`已验证；自动触发默认关|
|GUI + 后台双编辑|🟡 后台 ✅ / GUI 延后|后台|见`gui-design.md` |
|FTS 检索读模型|✅|✅ 4 测试|可重建|
| `存储→检索`闭环|✅|🟢**实质跑通**：`/summarize`落盘验证了加载+命令+LLM+存储+出处；剩`/remember`/检索/`/forget`三步用户实证| |

##二、文件清单（`F:\dp\memory-body-plugin\`）

|文件|作用|状态|
|---|---|---|
| `src/store.ts` |权威存储层（JSONL + 降权不删除）|✅ 5 测试 + 真实落盘|
| `src/fts.ts` |FTS5 读模型|✅ 4 测试|
| `src/summarize.ts` |共享总结逻辑|✅`/summarize`真实调用成功|
| `src/command.ts` | `/remember` `/summarize` `/forget` |🟡`/summarize`已验证；`/remember`/`/forget`待用户输入|
| `src/tool.ts` | `memory_search`工具|工具注册已验证（模型可见）；实际检索待验证|
| `src/auto-summarize.ts` |自动总结触发|⏳ 默认关，未验证|
| `src/index.ts` |插件入口|✅ apply 通过（否则`/summarize`未执行）|
| `src/types.ts` |共享类型|—|
| `src/parse.ts` | `/remember` `/summarize`输入解析纯函数|✅ 5 测试|
| `test/store.test.ts` / `test/fts.test.ts` / `test/parse.test.ts` / `test/check-exports.mjs` |测试（共 14 断言）|store/fts/parse ✅|
| `README.md` / `VERIFY.md` / `RISKS.md` / `STATUS.md` / `ACCEPTANCE.md` / `auto-summarize-design.md` / `gui-design.md` |文档|—|

##三、已修复的 bug（12 轮内）

1. `readEntries`同 id 折叠（第 1 轮）
2. `/summarize`对话历史缺失（第 2 轮）
3. `purpose`非法枚举（第 2 轮）
4. `export default apply`致命（第 5 轮，postmortem 0001 同款）
5. `/summarize`未检查 finish（第 5 轮）
6.加载方式错误：cordis.yml → agent.cordis.yml（第 6 轮）
7. `parameters.bodyId.required: false`非法（第 11 轮，）**真实加载后**schema 校验器报错；已修 + 已加入`check-exports.mjs`静态检查
8. `MemoryFts`未先创建父目录（第 13 轮，root 目录不存在时`新数据库同步`会崩；已修复，参照 session-query-site 先例）
9.命令缺`输入`hint，带参数命令（`/remember`、`/forget`）被 Web GUI 的`matchEnter`拒收（第 27 轮，**真实操作后**暴露；根因`ui-commands`里`if (!bare) return undefined`；已给三命令加`input.hint`）

。

1. 四、剩余工作【阻塞】Harness 加载验证**：schema bug 已修，等用户重新加载。
2. **【延后】GUI**：见`gui-design.md`依赖闭环验证 + 工程量超 v0.1 范围。

##五、下一步（唯一动作）

按`VERIFY.md`四步：创建体 → 编辑`standard/agent.cordis.yml`→ 重启`pnpm dsh web`→ 试`/remember`/`memory_search`/`/summarize`/`/forget`.
