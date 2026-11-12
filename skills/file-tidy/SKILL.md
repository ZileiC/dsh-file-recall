# File Tidy

给本地资料库生成并执行**整理方案**：把散落、乱名、无日期的文件理成一个按检索效率组织、且随时可撤销的结构。

## 何时使用

- 用户说「帮我整理一下这些文件」「太乱了，按年份/课程分一下」「这些名字看不出是什么」。
- 用户抱怨「找不到东西」而索引覆盖正常——问题在结构，不在检索。

不要主动使用。整理是大事，用户没提就不要碰。

## 三条铁律

1. **先看结构，再看明细，最后才动手。** 顺序固定，不能跳：
   - `{ action: "structure" }` → 理想结构鱼骨图（层级 + 规则）
   - `{ action: "detail" }` → **逐个文件**的去向鱼骨图（每个顶层目录一张）
   - `{ action: "plan" }` → 逐条清单（移动/改名 + 理由 + 日期来源）
2. **执行必须同时满足：用户明确同意 + `confirm: true` + `dryRun: false`。** 少一个就是演练，不得宣称已整理。
3. **绝不碰 Obsidian vault 的文件名。** 检测到 `.obsidian` 时方案自动转为「只移动、不改名」并在 `notes` 里说明。用户若坚持改名，必须让他知道会断开 `[[双链]]`。

## 决策已内置，不要问用户

| 问题 | 已定规则 |
|---|---|
| 日期取哪个 | **文件名 > 正文（frontmatter/开头日期行）> mtime**。mtime 标 `confidence: low`，因为拷贝会改它 |
| 机器名里的数字 | `IMG_2034` 的 2034 是序号，**不当日期**；年份也不允许超过今年+1 |
| 怎么改名 | **只加前缀** `YYYY-MM-DD_原名.ext`，原名一个字不改；用户自己起的名字（哪怕没日期）**不动**，只归类 |
| 怎么归类 | 顶层=学期/项目，二层=课程，三层=内容类型 `notes/slides/assignments/exams/assets`，文件名带日期 |
| 什么不动 | 已带日期的、已在正确目录且命名清晰的、`venv/node_modules/build/dist/site-packages` 等构建依赖 |
| 重复文件 | 只报告，不合并、不删除 |

## 执行流程

1. `{ action: "detail" }` 拿逐文件方案与鱼骨图路径（`diagramPaths`）。
2. 把**摘要 + 前 10 条 + 图路径**给用户；说明 `protection` 与 `renameAllowed`。
3. 用户同意后：`{ action: "plan" }` 落盘计划。
4. 先演练：`{ action: "apply", dryRun: true }`，把 `planned/applied/failed` 报给用户。
5. 用户再确认，才 `{ action: "apply", confirm: true, dryRun: false }`。
6. 出问题立刻 `{ action: "undo", confirm: true, dryRun: false }`——journal 在 `$DSH_HOME/storages/file-recall/tidy-journal.jsonl`，整批可逆。

## 汇报纪律

- 演练结果必须说「**没有移动任何文件**」；执行结果给出 `applied` 数量与 `journalPath`。
- `failed` 不为空时必须逐条说明原因（跨盘、被占用、权限），不要说「大体完成」。
- 不许用脚本绕过工具去移动文件。

## 空态与拒绝

- `actions` 为空：「结构已经够干净，没找到需要动的地方」，不要硬凑。
- `truncated: true`：超过 400 条上限，建议先按子目录分批整理。
- 目标路径逃出根目录（`../`）：工具会拒绝并计入 `failed`，如实报告，不要重试绕开。
