# dsh-file-recall

DeepSeek Harness 插件：在本地资料库中按模糊描述定位**文件与页/幻灯片**，并给出可核验的证据片段。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

## 它能做什么

- 从「只记得零散细节」的描述，定位到**文件 + 页/幻灯片/段**，而不是只给文件名。
- 返回可核验原文：搜索结果只是线索，`file_recall_evidence` 按索引读回原文；页码来自索引，禁止模型编造。
- 中文 **bigram** 检索（FTS5 trigram 对 2 字中文会 0 命中），正文 + 路径双路 BM25 → RRF。
- 处理 PPTX / DOCX / PDF / XLSX / TXT / Markdown；扫描版 PDF 取内嵌页图 → OCR。
- OCR 双通道：tesseract.js 兜底（离线），macOS Vision 可选（probe + 自动回退）。
- 反馈学习：用户确认/纠正后记住用词，下次检索自动前置改写。
- 本地优先：插件自身除可选的查询改写外不发起网络请求；**读页验证会把原文交给当前会话模型**，要严格本地请配合本地模型使用。

## 状态

M1 功能完成：抽取 / OCR（含扫描 PDF 页面栅格化）/ 分批建库 / 检索证据 / 反馈学习 / runtime skill 均已实现；单测 109/109、E2E、60 条 ToT 合成评测与 1k chunk 性能通过；自包含 Mac 分发包已生成。**待办**：Mac 真机验收（Vision/TCC/离线）。

## 设计要点（已定）

- 索引：`node:sqlite` + FTS5；中文写入时预切 **bigram**（trigram 对 2 字中文 0 命中）。
- 抽取：纯 JS 自建（jszip + fast-xml-parser / mammoth / pdfjs-dist / exceljs），零 native。
- 检索：元数据软过滤 → 正文 + 路径双路 BM25 → RRF → top-k → agent 读页验证。
- 建库：平台无常驻进程，`file_recall_index` 分批执行，可中断、可续跑。
- OCR：`tesseract.js`（可测、兜底）+ macOS Vision（实验性，probe + 回退）。
- 数据：`$DSH_HOME/storages/file-recall/index.db`（卸载不清理，提供 reset）。

## 配置

在 DSH 的插件配置入口（profile 中 `dsh-file-recall` 这一行的 `config`）填写：

```json
{
  "roots": ["/Users/<你爸的用户名>/Documents/资料"],
  "excludeGlobs": ["**/node_modules/**"],
  "topK": 8,
  "ocr": { "mode": "lazy", "provider": "auto", "langs": ["chi_sim"] },
  "expansion": { "enabled": true }
}
```

- `ocr.mode`：`lazy`（默认，建库只抽文本、扫描页登记待处理，**按需识别**）/ `eager`（建库时就识别）/ `off`。
  **懒 OCR 是给大库用的**：一个几万文件的杂乱目录，用 eager 建库要花几小时，lazy 只要几分钟就能先搜起来。
  代价是**扫描页在被识别前对内容检索不可见**（文件名和文件夹照样能搜到）。需要时：
  `file_recall_evidence { path, page }` 当场识别那一页，或 `file_recall_index { action: "ocr", maxFiles: 10 }` 分批预热。
- `expansion.enabled` 默认 **true**（用当前默认模型改写模糊描述，只发 query，不发文档正文）；不需要可显式设 false。
- `roots` 为空时索引工具只会报 0 个文件；可以：
  - 在配置里填 `roots`（持久、优先）；或
  - 让 agent 调用 `file_recall_index action="configure" roots=["..."] confirm=true`（会清理旧 roots 之外的索引，写入本地 meta，重启后仍生效，直到配置里显式覆盖）。
- 填好后先 `file_recall_index action="sync"`，再反复 `build` 到 `done: true`。
- `ocr.provider`：`auto`（Mac 优先 Vision，失败回退 tesseract）/ `tesseract` / `vision`。
- `dbPath` 可覆盖索引路径；默认 `$DSH_HOME/storages/file-recall/index.db`。

## 验证命令

发布前**必须**跑 `node --test` + `node scripts/install-smoke.mjs`。单测通过不等于插件能用：`install-smoke` 会按 DSH 真实加载路径检查工具、skill、面板路由形态、API 版本标记与浏览器包，任何一项不符直接失败。

```text
node --test                 # 单测（数量见 review.md）
node scripts/install-smoke.mjs  # 安装冒烟：工具 + skill + 路由 + apiVersion + client.js
node scripts/e2e.mjs        # 真实 fixtures：sync → build → 6 条 gold 查询 → 空态 → evidence
node scripts/eval.mjs       # 60 条合成 ToT 查询：top-1/top-5/MRR
node scripts/perf.mjs       # 200 文件 / 1000 chunks 建库与查询 p50/p95
node scripts/install-smoke.mjs --entry ../dist/dsh-file-recall/index.js
node scripts/ocr-selfcheck.mjs test/fixtures/ocr-zh.png auto
```

## OCR 双通道

- `ocr.provider=auto`（默认）：macOS 上先 probe Vision，成功则优先用；任何失败自动回退 tesseract。其他平台只用 tesseract。
- 语言数据随包：`lib/ocr/lang/*.traineddata`（tessdata_fast）。**默认只加载 `chi_sim`**——实测同时加载 `chi_sim`+`eng` 会让中文识别退化成英文乱码，而 `chi_sim` 单模型本身也能读英文。
- 离线：`gzip=false`、`cacheMethod=none`，不请求网络。
- 结果字段：`source`（`tesseract` | `vision`）、`confidence`（0–100）、`fallbackFrom`。
- 质量提醒：tesseract fast 模型偶有错字（实测「说明」被识别成「癌明」），但关键词仍可检索；`tessdata_best` 与 tesseract.js 的 wasm 不兼容，不要换。

### Windows 自检

```text
node scripts/ocr-selfcheck.mjs test/fixtures/ocr-zh.png auto
```

期望：`active provider: tesseract`、`source: tesseract`、文本包含「预算」。

### macOS 自检（人工验收，必须在父亲的 Mac 上做）

1. 在插件目录执行 `node scripts/ocr-selfcheck.mjs <一张扫描页导出的 PNG> auto`。
2. 期望 `active provider: vision`、`source: vision`、`fallbackFrom: (none)`，且文本包含页面上的中文关键词。
3. 若 Vision 不可用或失败，输出应出现 `source: tesseract` 与 `fallbackFrom: vision`——这证明回退链路工作，但也说明 Vision 集成需要修；把 stderr 完整带回。
4. 网络断开后重跑一次，确认仍然可用（离线验收）。
5. 首次运行可能需要给 DSH/终端授予「完全磁盘访问」，否则读取受 TCC 保护的目录会失败。

> M1 的 OCR 覆盖「独立图片」与「内嵌整页图像的扫描 PDF」；PPT 内嵌截图需要整页渲染，属 M2。


## 安装（GitHub clone）

需要 Node.js >= 22.19（插件使用内置 `node:sqlite`）。

```powershell
git clone https://github.com/ZileiC/dsh-file-recall.git
cd dsh-file-recall
npm install --ignore-scripts   # 安装纯 JS 运行依赖；无 native 编译
```

然后在 DeepSeek Harness 里：

```text
plugin_manager action=install_bundle target=<clone 下来的绝对路径>
```

安装后确认 `file_recall_index` 出现在工具列表；首次使用先配置 `roots` 并建库（见上）。

## 界面

装好后左侧栏多一个「文件记忆召回」图标（`file-recall`），点开是面板：

- 顶部状态点与数字：文件 / 片段 / OCR 页 / 待处理 / 失败
- 检索实况：最近一次 `file_recall_search` 发生时，这里会亮一次——墨迹扫过、扩写出来的词逐个浮现、命中的页依次落点（含定位与耗时）。检索是模型在后台发起的，所以这是你唯一能「看见」它在工作的窗口
- **资料图谱**：以**文件夹**为骨架的节点图（不依赖 Obsidian 或任何笔记软件，纯目录就能画）。点文件夹下钻一层，返回键回上层；每个节点外的小圆点是检索落点，颜色表示结果：绿=找对了、红=没找到、黄=部分对、灰=还没结算。扫描件比例高的文件夹一眼可辨
- 索引覆盖：最近同步时间、当前 OCR provider（含回退来源）、资料目录
- 最近纠正：找对 / 部分对 / 找错，以及学到的对照
- 空态会直接告诉你在对话里怎么说才能建库

面板每 4 秒轮询一次状态，检索实况走 1.5 秒的增量轮询（`/activity?since=<id>`，只在标签页可见时请求，空结果只有几十字节）；数据来自同源只读接口 `/api/file-recall/{status,recent,activity}`，**面板不提供写操作**，所有变更仍走对话里的工具调用。侧边栏图标在每次检索时右上角亮一个小点，索引器有积压时状态点会缓慢呼吸。以上动效全部遵循 `prefers-reduced-motion`。

> 面板与宿主之间有 `apiVersion` 校验：**升级插件后必须刷新一次页面（或重启应用）**，否则面板会直接告诉你「宿主插件版本过旧」，而不是静默显示错数据。
>
> 面板显示「无法连接插件服务 / HTTP 404」= host 侧 `/api/file-recall/*` 路由没生效，通常是宿主还在跑旧模块：重启应用。若重启后仍 404，把 `node scripts/doctor.mjs "<资料目录>"` 的输出发出来。
|---|---|
| `file_recall_index` | `status` / `sync` / `build` / `configure` / `retry` / `reset` / `ocr`；`build` 分批执行，重复到 `done: true` |
| `file_recall_search` | 模糊描述 → 候选（path / page / locator / snippet / matchType） |
| `file_recall_evidence` | 按 chunkId 读回索引原文；扫描页可给 `{ path, page }` 当场 OCR |
| `file_recall_feedback` | 记录 hit/wrong/partial；纠正词进入本地同义词表 |
| `file_recall_tidy` | `structure`（理想结构鱼骨图）/ `detail`（**逐文件**去向鱼骨图）/ `plan`（逐条清单）/ `apply`（默认演练，`confirm:true` 才执行）/ `undo`（按 journal 整批回滚） |

随包注册两个 skill：

- `file-recall`：何时搜、如何读页、证据纪律与空态处理。
- `file-tidy`：整理方案的口径与执行纪律（先结构 → 再逐文件 → 用户同意 → 演练 → 执行 → 可 undo）。

**给其他 agent 的安装教程：[`docs/INSTALL-FOR-AGENTS.md`](docs/INSTALL-FOR-AGENTS.md)**，含验收清单与常见故障表。

整理方案的既定决策（不需要问用户）：

| 问题 | 规则 |
|---|---|
| 日期 | **文件名 > 正文（frontmatter/开头日期行）> mtime**；mtime 标低置信度 |
| 机器名数字 | `IMG_2034` 的 2034 是序号不是年份；未来年份一律不采信 |
| 改名 | 只加日期前缀，原名不改；用户自己起的名字即使没日期也不动 |
| 结构 | 学期/项目 → 课程 → 内容类型（notes/slides/assignments/exams/assets）→ 带日期的文件名 |
| Obsidian vault | 检测到 `.obsidian` 默认**只移动不改名**（改名会断双链） |
| 执行 | `confirm:true` + `dryRun:false` 双条件；journal 在 `$DSH_HOME/storages/file-recall/tidy-journal.jsonl`，可整批 undo |

## Mac 分发包

```text
node scripts/pack.mjs
# 输出：projects/file-recall/dist/dsh-file-recall/
```

- 目录内已带生产依赖（`--omit=optional`，**零 native**，跨平台纯 JS），无需在 Mac 上跑 npm install。
- tesseract.js 的 worker 从包内 `node_modules` 启动，所以必须**整个目录**一起拷贝。
- 安装后：配置 `roots`（或让 agent 调 `file_recall_index action="configure"`）→ `sync` → 反复 `build` 到 done。

## Mac 验收清单（人工，步骤 9）

- [ ] 整个 `dist/dsh-file-recall` 目录拷到 Mac，`install_bundle`，确认 4 个工具 + `file-recall` skill
- [ ] `file_recall_index action="configure" roots=["/Users/.../资料"] confirm=true` → sync → build 到 done
- [ ] `file_recall_index action="status"` 返回 `ocr.provider = vision`（或回退后的 tesseract）
- [ ] 扫描 PDF 一页经 OCR 后 `file_recall_search` 能检索到
- [ ] 拒绝磁盘访问时 `sync.errors` 出现 Full Disk Access 提示
- [ ] 断网后 OCR 仍可用（离线）
- [ ] 父亲真实资料 20 条 ToT 查询：top-5 命中率与 evidence 记录

## 卸载

```text
plugin_manager action=remove_bundle target=dsh-file-recall
```

索引文件不会自动删除；如需清理，调用 `file_recall_index action=reset` 或手动删除
`$DSH_HOME/storages/file-recall/`。

## 已知边界

- 扫描版 PDF 支持**内嵌整页图像**的栅格化 + OCR；混合 PDF（文本页+扫描页）会只 OCR 扫描页并显式报告缺页/失败；纯矢量页会显式标 `scanned`。
- 超过 `ocr.maxPagesPerDoc`（默认 50）的扫描件只处理前 N 页，并在 `file.error` 标注截断。
- 手写体、印章、低质量扫描不保证识别。
- `.doc` / `.xls` / `.wps` / `.key` / `.pages` / `.numbers` 等不支持格式会计入 `sync.skippedByExtension`，不静默。
- macOS Vision 需在目标 Mac 上人工验收；开发机为 Windows，无法本地验证。
- 分发包约 130MB（pdfjs + tesseract 语言包），可接受但不轻。

## License

[Apache-2.0](LICENSE)
