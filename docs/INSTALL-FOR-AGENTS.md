# 给 Agent 的安装与接入说明

这份文档写给**另一个 AI agent**：你要在用户的机器上装好 `dsh-file-recall`，让用户能用中文模糊描述找到本地旧资料，并可选地生成整理方案。

不要跳过第 2 步的核对——这个插件装错的典型症状是「工具能用、面板 404」，看起来像插件坏了，其实是宿主还在跑旧模块。

---

## 0. 先确认环境

| 需要 | 检查方式 |
|---|---|
| DeepSeek Harness ≥ 0.2.2-rc.1 | 宿主设置里看版本 |
| Node ≥ 22.19 | `node -v`（需要内置 `node:sqlite`） |
| 平台 | macOS / Windows 都可以；macOS 额外有 Vision OCR 通道 |

---

## 1. 拿到插件

两种方式，二选一。

**A. 从 GitHub（推荐给非开发者机器）**

```bash
git clone https://github.com/ZileiC/dsh-file-recall.git
cd dsh-file-recall
npm install --omit=dev --omit=optional
```

`--omit=optional` 是必须的：它排除 `pdfjs-dist` 的可选原生 canvas，插件本身零 `.node` 依赖，跨平台可搬。

**B. 从分发包（目标机不能编译时）**

把已打好的 zip 解压到任意目录，确认解压后存在 `index.js`、`lib/`、`node_modules/`，然后直接进入第 2 步。

---

## 2. 安装到 profile 并**核对产物**

推荐用宿主自带的插件安装入口（把 `<插件目录绝对路径>` 换成上一步的目录）：

> 对 agent 说明：在 DSH 里调用 `plugin_manager`，`action: "install_bundle"`，`target` 传插件目录绝对路径。不要手写 profile 的 `package.json`。

装完必须核对三件事，缺一不可：

1. **工具已注册**：`file_recall_index` / `file_recall_search` / `file_recall_evidence` / `file_recall_feedback` / `file_recall_tidy` 五个都在。
2. **两个 skill 已注册**：`file-recall` 与 `file-tidy`。
3. **HTTP 路由已注册**：调用 `file_recall_index { action: "status" }`，返回里必须是

   ```json
   "ui": { "status": "registered", "path": "/api/file-recall", "error": null }
   ```

   如果 `ui.status` 是 `waiting` 或 `error`，说明宿主启动时 HTTP 服务还没就绪——本插件用 `ctx.inject(['webServer'])` 等待它，正常情况下会自动补上。若仍是 `error`，`ui.error` 里就是确切原因。

> **不要**用「重启后应该就好了」结案。`ui.status` 就是这件事的判据。

---

## 3. 选资料目录并建索引

先问用户资料放在哪（一次只问一个目录）。然后：

```text
file_recall_index { action: "configure", roots: ["<绝对路径>"], confirm: true }
file_recall_index { action: "sync" }
file_recall_index { action: "build", maxFiles: 200 }   // 重复调用直到 done: true
```

要点：

- `configure` 是**替换**扫描范围，不是追加；要多个目录就一次全给。
- `build` 分批，中断可续，返回 `done: true` 才算完。
- 默认是**懒 OCR**（`ocr.mode: "lazy"`）：建库只抽文本，扫描页登记待处理，几万个文件也能几分钟建完。
  - 要读某页：`file_recall_evidence { path, page }` 当场识别。
  - 要预热：`file_recall_index { action: "ocr", maxFiles: 10 }`，重复到 `remaining` 为 0。
  - 想要建库时就识别：`ocr: { mode: "eager" }`（慢，大库不推荐）。
- 索引文件在 `$DSH_HOME/storages/file-recall/index.db`；卸载不自动删除，需要清空用 `action: "reset"`（会保留学习词表与目录配置）。

---

## 4. 第一次真实查询

直接用用户原话问，不要先改写：

```text
file_recall_search { query: "那个讲带宽优化的跨文化笔记" }
file_recall_evidence { chunkId: <命中里的 chunkId> }
```

**证据纪律**：页码/幻灯片号只能来自工具返回的 `page`/`block`/`locator`；引文必须从 `file_recall_evidence.text` 逐字复制。**绝不编造文件、页码或引文**。

---

## 5. 整理方案（可选）

用户要求整理时，按固定顺序：

```text
file_recall_tidy { action: "structure" }   // 理想结构鱼骨图（SVG 路径在 diagramPath）
file_recall_tidy { action: "detail" }      // 逐个文件的去向（每个顶层目录一张图）
file_recall_tidy { action: "plan" }        // 逐条清单，落盘到 storage
file_recall_tidy { action: "apply", dryRun: true }              // 演练
file_recall_tidy { action: "apply", confirm: true, dryRun: false }  // 用户同意后才执行
file_recall_tidy { action: "undo", confirm: true, dryRun: false }   // 出事就整批回滚
```

- 默认对 Obsidian vault 只移动、不改名（改名会断 `[[双链]]`）。
- journal 在 `$DSH_HOME/storages/file-recall/tidy-journal.jsonl`，可整批撤销。
- 方案与图都写在 `$DSH_HOME/storages/file-recall/` 下，**不会写进用户的资料目录**。

---

## 6. 常见故障

| 症状 | 原因 | 处理 |
|---|---|---|
| 面板「无法连接插件服务 HTTP 404」 | 宿主在跑旧模块，或路由未注册 | 先看 `status.ui.status`；`error` 会给出原因，`waiting` 稍等。仍不行就完全退出宿主再启动 |
| 面板「宿主插件版本过旧」 | 客户端 bundle 与宿主 `apiVersion` 不一致 | 刷新页面（或重启宿主），让客户端重新加载 |
| `file_recall_evidence` 报 `not lossless JSON` | 旧版本返回了 `undefined` 字段 | 升级插件；该问题已在新版修复 |
| 搜索 0 命中 | 索引为空 / 目录配错 / 全是被跳过的类型 | 看 `status.files`、`status.roots`、`lastSyncSummary.skippedByExtension` |
| 扫描件搜不到内容 | 懒 OCR 还没识别该页 | `file_recall_evidence { path, page }` 或 `action: "ocr"` |
| 整理方案里出现 venv/构建目录 | 旧版本未排除 | 升级插件；新版整目录忽略并计入 `ignoredFiles` |

---

## 7. 验收清单（装完请逐条确认）

- [ ] 五个工具都在
- [ ] `file-recall` 与 `file-tidy` 两个 skill 都在
- [ ] `status.ui.status === "registered"`
- [ ] `sync` + `build` 后 `status.files > 0`，`status.errors` 为 0
- [ ] 一条真实查询能返回命中，并用 `evidence` 读回原文
- [ ] 面板能打开，图谱有节点，检索时输入框上方出现一次提示条
- [ ] `tidy` 的 `structure` 能出图，且 `executable: false`（未执行任何改动）

macOS 用户额外确认（需要真机）：

- [ ] OCR provider 自检返回 `vision` 或 `tesseract`
- [ ] 扫描版 PDF 的某一页能按需识别出文本
- [ ] 拒绝「文件与文件夹」权限时，错误信息里有可执行的引导
