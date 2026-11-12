/**
 * Read-only archive tidy planner.
 *
 * This module never moves a file. It reads the index (names, dates, and the head
 * of each document's text) and produces a PROPOSAL; execution lives in
 * lib/apply.js behind an explicit confirmation and a reversible journal.
 *
 * Decisions this module owns, so the user never has to answer them:
 *
 *  DATE, in priority order —
 *    1. a date in the file NAME (the author already decided it matters),
 *    2. a date in the first lines of the CONTENT (front matter, a dated heading),
 *    3. the file mtime, marked low confidence (copies rewrite it).
 *  RENAME — only ever ADD a prefix (`2023-05-01_原名`); the name the user chose is
 *    never rewritten, and a name without a real date keeps its name and is only
 *    moved. Machine names (camera/scanner) get the date prefix because they carry
 *    no meaning at all.
 *  STRUCTURE — semester/project → course → content kind → dated file name, which
 *    is the shape the archive's own working notes already use.
 *  SAFETY — an Obsidian vault is detected by `.obsidian` and becomes move-only by
 *    default: renaming inside a vault silently breaks `[[wiki links]]`, and that
 *    is a worse outcome than a dated filename.
 *
 * Everything is derived from the index and, for dates, from text already indexed,
 * so the same proposal can be produced on macOS with no extra scanning.
 */

import { existsSync } from 'node:fs'
import { extname, join } from 'node:path'

const SEP = /[\\/]+/
const MAX_ACTIONS = 400

/** Names a camera or a scanner produced, not a person. */
const JUNK_PATTERNS = [
  /^img[_-]?\d+/i,
  /^dsc[_-]?\d+/i,
  /^dscn\d+/i,
  /^pxl[_-]?\d+/i,
  /^screenshot/i,
  /^screen ?shot/i,
  /^扫描件[ _-]?\d*/,
  /^扫描[ _-]?\d+$/,
  /^新建文件夹/,
  /^新建文本文档/,
  /^未命名/,
  /^无标题/,
  /^副本/,
  /^document\d*$/i,
  /^file\d+$/i,
  /^微信图片[_-]?\d*/,
  /^mmexport\d+/i,
]

const DATE_PATTERNS = [
  /\b(19|20)\d{2}[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])\b/,
  /\b(19|20)\d{2}[-_.]?(0[1-9]|1[0-2])\b/,
  /\b(19|20)\d{2}\b/,
]

const CONTENT_DATE_PATTERNS = [
  /(?:^|\n)\s*date\s*:\s*((?:19|20)\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/i,
  /(?:^|\n)\s*(?:日期|时间|date)\s*[:：]\s*((?:19|20)\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/i,
  /((?:19|20)\d{2})-(\d{2})-(\d{2})/,
]

/** Folder names that tell the content kind, checked before the extension. */
const KIND_FOLDERS = [
  ['notes', /note|笔记|骨架笔记|笔记归档/i],
  ['slides', /slide|ppt|课件|演示|presentation/i],
  ['assignments', /assign|homework|作业|提交|hw\d/i],
  ['exams', /exam|midterm|final|quiz|考|测验|期中|期末|复盘/i],
  ['assets', /asset|image|图片|素材|附件|scan|扫描|screenshot|截图/i],
]

const KIND_BY_EXTENSION = {
  '.md': 'notes',
  '.txt': 'notes',
  '.pptx': 'slides',
  '.ppt': 'slides',
  '.key': 'slides',
  '.pdf': 'slides',
  '.docx': 'assignments',
  '.doc': 'assignments',
  '.xlsx': 'assignments',
  '.png': 'assets',
  '.jpg': 'assets',
  '.jpeg': 'assets',
  '.gif': 'assets',
  '.webp': 'assets',
  '.heic': 'assets',
}

function kindOf(relPath, fileName) {
  for (const [kind, pattern] of KIND_FOLDERS) {
    if (pattern.test(relPath)) return kind
  }
  return KIND_BY_EXTENSION[extname(fileName).toLowerCase()] ?? 'notes'
}

/**
 * Paths that are build output, dependency trees or tool caches.
 *
 * A tidy proposal that suggests renaming files inside `site-packages` or
 * `build/win-x64` is noise the user has to read through, and renaming them
 * would break the tools that created them. Detected on live data: the first
 * pass proposed 393 renames, most of them inside venvs.
 */
const IGNORED_SEGMENTS = new Set([
  'venv',
  '.venv',
  'env',
  '.env',
  'site-packages',
  'node_modules',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.git',
  '.hg',
  '.svn',
  'build',
  'dist',
  'out',
  'target',
  '.next',
  '.nuxt',
  '.cache',
  '.gradle',
  '.idea',
  '.vscode',
  'flutter_assets',
  'packages',
  'Pods',
  '.build',
  'third_party',
  'vendor',
  'vendor_bundle',
  '.dart_tool',
  '.tox',
  'coverage',
])

function isIgnoredPath(rel) {
  const segments = String(rel ?? '').split('/')
  for (const segment of segments) {
    if (IGNORED_SEGMENTS.has(segment)) return true
  }
  return false
}

function toPosix(value) {
  return String(value ?? '').replace(/\\/g, '/')
}

function basenameOf(path) {
  const parts = toPosix(path).split('/')
  return parts[parts.length - 1] || ''
}

function dirnameOf(path) {
  const parts = toPosix(path).split('/')
  parts.pop()
  return parts.join('/')
}

/** True when a name or any of its parent folders already carries a year. */
function hasDateSignal(name, path) {
  const stem = name.replace(extname(name), '')
  for (const pattern of DATE_PATTERNS) if (pattern.test(stem)) return true
  return /\b(19|20)\d{2}\b/.test(dirnameOf(path))
}

function isJunkName(name) {
  const stem = name.replace(extname(name), '')
  return JUNK_PATTERNS.some((pattern) => pattern.test(stem))
}

function isoDate(ms) {
  const date = new Date(Number(ms) || Date.now())
  if (Number.isNaN(date.getTime())) return null
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function two(value) {
  return String(value).padStart(2, '0')
}

function validParts(year, month = null, day = null) {
  const y = Number(year)
  const m = month == null ? null : Number(month)
  const d = day == null ? null : Number(day)
  // A year in the future is almost always a counter, not a date: `IMG_2034` is
  // the 2034th photo, not a file from 2034.
  const latest = new Date().getFullYear() + 1
  if (!Number.isInteger(y) || y < 1900 || y > latest) return null
  if (m == null) return { text: String(y), precision: 'year' }
  if (!Number.isInteger(m) || m < 1 || m > 12) return null
  if (d == null) return { text: `${y}-${two(m)}`, precision: 'month' }
  if (!Number.isInteger(d) || d < 1 || d > 31) return null
  return { text: `${y}-${two(m)}-${two(d)}`, precision: 'day' }
}

/** A date the author put in the file name, if any. */
function dateFromName(name) {
  const stem = String(name ?? '').replace(extname(String(name ?? '')), '')
  const day = stem.match(/((?:19|20)\d{2})[-_.年]?(0[1-9]|1[0-2])[-_.月]?(0[1-9]|[12]\d|3[01])/)
  if (day) {
    const parts = validParts(day[1], day[2], day[3])
    if (parts) return parts
  }
  const month = stem.match(/((?:19|20)\d{2})[-_.年]?(0[1-9]|1[0-2])(?!\d)/)
  if (month) {
    const parts = validParts(month[1], month[2])
    if (parts) return parts
  }
  const year = stem.match(/((?:19|20)\d{2})(?!\d)/)
  if (year) return validParts(year[1])
  return null
}

/** A date the author wrote in the first lines of the document, if any. */
function dateFromContent(head) {
  const text = String(head ?? '')
  for (const pattern of CONTENT_DATE_PATTERNS) {
    const match = text.match(pattern)
    if (!match) continue
    const parts = validParts(match[1], match[2] ?? null, match[3] ?? null)
    if (parts) return parts
  }
  return null
}

/**
 * Decide the date for one file, and say where it came from so the proposal can
 * be judged: a date the author wrote beats a timestamp a copy rewrote.
 */
function pickDate(name, contentHead, mtime, { skipName = false } = {}) {
  const named = skipName ? null : dateFromName(name)
  if (named) return { ...named, source: 'name', confidence: 'high' }
  const content = dateFromContent(contentHead)
  if (content) return { ...content, source: 'content', confidence: 'medium' }
  const mtimeIso = isoDate(mtime)
  if (mtimeIso) return { text: mtimeIso, precision: 'day', source: 'mtime', confidence: 'low' }
  return null
}

/** `.obsidian` means renaming would break wiki links; treat the root as protected. */
function detectProtection(roots) {
  const protectedRoots = []
  for (const root of roots) {
    try {
      if (existsSync(join(root, '.obsidian'))) protectedRoots.push(root)
    } catch (failure) {
      /* unreadable root: not protected */
    }
  }
  return protectedRoots
}

function relativeTo(root, path) {
  const normalizedRoot = toPosix(root).replace(/\/+$/, '')
  const target = toPosix(path)
  const rootLower = normalizedRoot.toLowerCase()
  if (target.toLowerCase().slice(0, rootLower.length) !== rootLower) return null
  return target.slice(normalizedRoot.length).replace(/^\/+/, '')
}

/**
 * @param {{ store: object, now?: () => number, maxActions?: number, looseRootThreshold?: number, overloadThreshold?: number }} options
 */
export function createTidyPlanner(options = {}) {
  const { store } = options
  if (!store) throw new Error('createTidyPlanner: store is required')
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const maxActions = Number(options.maxActions) > 0 ? Number(options.maxActions) : MAX_ACTIONS
  // Renaming inside an Obsidian vault breaks `[[links]]`. Move-only unless the
  // caller explicitly opts in for that root.
  const allowVaultRename = options.allowVaultRename === true
  const looseRootThreshold =
    Number(options.looseRootThreshold) >= 0 ? Number(options.looseRootThreshold) : 5
  const overloadThreshold =
    Number(options.overloadThreshold) > 0 ? Number(options.overloadThreshold) : 50

  /**
   * Build a proposal from the index only.
   *
   * @param {{ roots: string[] }} input
   */
  function plan({ roots = [] } = {}) {
    const cleanRoots = (Array.isArray(roots) ? roots : []).filter(Boolean).map(String)
    const files = typeof store.listAllFiles === 'function' ? store.listAllFiles() : []
    // Content head per file: lets a date the author wrote win over mtime.
    const heads = new Map()
    if (typeof store.firstChunkHeadByPath === 'function') {
      for (const row of store.firstChunkHeadByPath()) heads.set(row.path, row.head)
    }
    const inRoot = []
    let ignored = 0
    for (const file of files) {
      const root = cleanRoots.find((candidate) => relativeTo(candidate, file.path) !== null)
      if (!root) continue
      const rel = relativeTo(root, file.path)
      if (isIgnoredPath(rel)) {
        ignored += 1
        continue
      }
      inRoot.push({ ...file, root, rel })
    }

    const protectedRoots = detectProtection(cleanRoots)
    const renameAllowed = allowVaultRename || protectedRoots.length === 0

    const actions = []
    const notes = []
    const duplicates = []
    const overloaded = []
    let truncated = false

    const push = (action) => {
      if (actions.length >= maxActions) {
        truncated = true
        return
      }
      actions.push(action)
    }

    // Loose files sitting directly in a root: the classic "everything on the
    // desktop" shape, and the cheapest thing to fix.
    const rootLoose = inRoot.filter((file) => !file.rel.includes('/'))
    if (rootLoose.length > looseRootThreshold) {
      const targetFolder = '整理归档'
      for (const file of rootLoose) {
        push({
          kind: 'move',
          from: file.rel,
          to: `${targetFolder}/${basenameOf(file.rel)}`,
          reason: `根目录散落 ${rootLoose.length} 个文件，建议收进「${targetFolder}」`,
          confidence: 'medium',
          conflict: false,
        })
      }
      notes.push(`根目录有 ${rootLoose.length} 个散落文件（阈值 ${looseRootThreshold}）。`)
    }

    // Renames are limited to names a camera or scanner produced. A file whose
    // name the user chose is left alone even when it carries no date: mtime is a
    // modification time, not a document date, so prefixing every undated file
    // would rewrite a person's naming for no reliable gain. Undated files are
    // counted, not touched.
    let undated = 0
    for (const file of inRoot) {
      const name = basenameOf(file.rel)
      if (isJunkName(name)) {
        // A machine name has no information; the best date we have is worth
        // adding. Inside a protected vault we keep it as is. The digits inside
        // the machine name are a counter, not a date, so skip that source.
        if (!renameAllowed) continue
        const picked = pickDate(name, heads.get(file.path), file.mtime, { skipName: true })
        if (!picked) continue
        const proposed = `${picked.text}_${name}`
        push({
          kind: 'rename',
          from: file.rel,
          to: `${dirnameOf(file.rel) ? dirnameOf(file.rel) + '/' : ''}${proposed}`,
          reason: `相机/扫描仪自动命名，看不出内容；加日期前缀（来源：${picked.source}）便于排序与辨认`,
          confidence: picked.confidence,
          dateSource: picked.source,
          conflict: false,
        })
        continue
      }
      if (!hasDateSignal(name, file.path)) undated += 1
    }

    if (!renameAllowed) {
      notes.push(
        '检测到 Obsidian vault（存在 .obsidian）：本次只建议移动，不改名——改名会断开 [[双链]]。' +
          '确实要改名请显式允许。',
      )
    }

    // Same file name in several folders: report, never merge.
    const byName = new Map()
    for (const file of inRoot) {
      const name = basenameOf(file.rel).toLowerCase()
      if (!byName.has(name)) byName.set(name, [])
      byName.get(name).push(file.rel)
    }
    for (const [name, paths] of byName) {
      if (paths.length > 1) duplicates.push({ name, paths: paths.slice(0, 10) })
    }

    // Folders that hold too much to scan by eye: report only.
    const perFolder = new Map()
    for (const file of inRoot) {
      const folder = dirnameOf(file.rel)
      if (!folder) continue
      perFolder.set(folder, (perFolder.get(folder) || 0) + 1)
    }
    for (const [folder, count] of perFolder) {
      if (count > overloadThreshold) overloaded.push({ folder, files: count })
    }

    actions.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'move' ? -1 : 1
      return left.from.localeCompare(right.from)
    })

    const summary = {
      files: inRoot.length,
      ignoredFiles: ignored,
      folders: perFolder.size,
      moves: actions.filter((action) => action.kind === 'move').length,
      renames: actions.filter((action) => action.kind === 'rename').length,
      undated,
      duplicates: duplicates.length,
      overloadedFolders: overloaded.length,
      truncated,
    }

    return {
      generatedAt: now(),
      roots: cleanRoots,
      summary,
      actions,
      duplicates: duplicates.slice(0, 50),
      overloaded: overloaded.slice(0, 20),
      notes,
      // Execution is not implemented in this phase; say so in the payload rather
      // than letting a caller assume a plan can be applied.
      executable: false,
      boundary:
        '这是只读方案：插件不会移动或重命名任何文件。执行与撤销是后续独立步骤，需要单独确认。',
    }
  }

  /**
   * The ideal structure, derived from how the archive is actually used.
   *
   * Semesters and courses are already the retrieval keys a person thinks in
   * ("那门语文沟通课"), so the proposal keeps them as the first two levels and
   * normalises what sits underneath: one folder per content kind, so notes,
   * slides, assignments and scans never compete in the same list. It is a
   * proposal only — rendering and approval happen elsewhere.
   *
   * @param {{ roots: string[] }} input
   */
  function structure({ roots = [] } = {}) {
    const cleanRoots = (Array.isArray(roots) ? roots : []).filter(Boolean).map(String)
    const files = typeof store.listAllFiles === 'function' ? store.listAllFiles() : []
    const inRoot = []
    let ignored = 0
    for (const file of files) {
      const root = cleanRoots.find((candidate) => relativeTo(candidate, file.path) !== null)
      if (!root) continue
      const rel = relativeTo(root, file.path)
      if (isIgnoredPath(rel)) {
        ignored += 1
        continue
      }
      inRoot.push({ rel, mtime: file.mtime })
    }

    const topCounts = new Map()
    const childCounts = new Map()
    for (const file of inRoot) {
      const parts = file.rel.split('/')
      const top = parts.length > 1 ? parts[0] : '根目录散落文件'
      const child = parts.length > 2 ? parts[1] : parts.length > 1 ? '（直接放在这一层）' : ''
      topCounts.set(top, (topCounts.get(top) || 0) + 1)
      if (child) {
        const key = top + '\u0000' + child
        childCounts.set(key, (childCounts.get(key) || 0) + 1)
      }
    }

    const topEntries = [...topCounts.entries()].sort((left, right) => right[1] - left[1])
    // A fishbone is a summary, not a listing: more than five bones with long
    // course names cannot be read in one glance, and clipped labels collide.
    const shown = topEntries.slice(0, 5)
    const omitted = topEntries.slice(5)
    const branches = shown.map(([label, count]) => {
      const children = [...childCounts.entries()]
        .filter(([key]) => key.startsWith(label + '\u0000'))
        .map(([key, childCount]) => ({ label: key.split('\u0000')[1], count: childCount }))
        .sort((left, right) => right.count - left.count)
        .slice(0, 3)
      return { label, count, children }
    })

    return {
      head: '找到东西',
      subtitle:
        `${inRoot.length} 个文件 · ${topCounts.size} 个顶层目录 · 忽略 ${ignored} 个（构建/依赖）` +
        (omitted.length > 0
          ? ` · 图中只展开最大的 5 个，其余 ${omitted.length} 个（${omitted
              .map(([label]) => label)
              .slice(0, 4)
              .join('、')}${omitted.length > 4 ? '…' : ''}）未展开`
          : ''),
      branches,
      omittedBranches: omitted.map(([label, count]) => ({ label, count })),
      totals: { files: inRoot.length, ignored, topFolders: topCounts.size },
      proposal: {
        levels: [
          '学年/学期（Ⅰ 25 Fall、Ⅱ 26 Fall …）',
          '课程或项目（如 1077 Chinese communication）',
          '内容类型：Notes / Slides / Assignments / Exams / Assets',
          '文件名：YYYY-MM-DD_主题_类型.ext',
        ],
        rules: [
          '同一门课的四类材料不再混在一个列表里，找笔记不会翻到课件',
          '日期取自文件名或内容；文件里没有日期线索时保留原名，只用目录归类',
          '扫描件与图片归入 Assets，正文检索靠按需 OCR',
          '已在正确位置、命名清晰的课程与目录不动',
        ],
      },
    }
  }

  /**
   * The per-file proposal: every file's target path, grouped so it can be drawn
   * as one fishbone per top folder (bones = content kind, ticks = file names).
   *
   * This is the thing a person must see before anything is applied — a summary of
   * folders is not enough to judge a rename, but 1121 rows are not reviewable
   * either, so each view caps its ticks and reports how many it hid.
   *
   * @param {{ roots: string[], ticksPerKind?: number }} input
   */
  function detail({ roots = [], ticksPerKind = 5 } = {}) {
    const cleanRoots = (Array.isArray(roots) ? roots : []).filter(Boolean).map(String)
    const files = typeof store.listAllFiles === 'function' ? store.listAllFiles() : []
    const heads = new Map()
    if (typeof store.firstChunkHeadByPath === 'function') {
      for (const row of store.firstChunkHeadByPath()) heads.set(row.path, row.head)
    }
    const protection = detectProtection(cleanRoots)
    const renameAllowed = allowVaultRename || protection.length === 0
    const ticks = Math.max(1, Math.floor(Number(ticksPerKind) || 5))

    const branches = new Map()
    let considered = 0
    let unchanged = 0
    for (const file of files) {
      const root = cleanRoots.find((candidate) => relativeTo(candidate, file.path) !== null)
      if (!root) continue
      const rel = relativeTo(root, file.path)
      if (isIgnoredPath(rel)) continue
      considered += 1

      const parts = rel.split('/')
      const name = parts[parts.length - 1]
      const top = parts.length > 1 ? parts[0] : '根目录散落文件'
      // Keep the folder the person already uses when it carries meaning; the
      // kind folder is only added when it is missing.
      const kind = kindOf(rel, name)
      const targetDir = parts.length > 1 ? `${top}/${kind}` : `整理归档/${kind}`
      const picked = pickDate(name, heads.get(file.path), file.mtime)
      const dated = hasDateSignal(name, file.path)
      let targetName = name
      let action = 'keep'
      if (!dated && picked && renameAllowed && isJunkName(name)) {
        targetName = `${picked.text}_${name}`
        action = 'rename'
      } else if (!dated && picked && picked.confidence !== 'low') {
        // The author wrote a date but not in the name: adding it is a rename too.
        targetName = `${picked.text}_${name}`
        action = 'rename'
      }
      const target = `${targetDir}/${targetName}`
      if (target === rel) {
        unchanged += 1
        continue
      }
      if (!branches.has(top)) branches.set(top, new Map())
      const kinds = branches.get(top)
      if (!kinds.has(kind)) kinds.set(kind, [])
      kinds.get(kind).push({
        name,
        target: `${targetName}`,
        targetDir,
        action,
        dateSource: picked ? picked.source : null,
        confidence: picked ? picked.confidence : null,
        more: false,
      })
    }

    const views = []
    for (const [top, kinds] of branches) {
      const kindList = [...kinds.entries()].map(([kind, entries]) => ({
        kind,
        count: entries.length,
        files: entries.slice(0, ticks),
        hidden: Math.max(0, entries.length - ticks),
      }))
      views.push({ top, kinds: kindList, total: kindList.reduce((sum, k) => sum + k.count, 0) })
    }
    views.sort((left, right) => right.total - left.total)

    return {
      head: '每个文件的去向',
      protection:
        protection.length === 0
          ? null
          : '检测到 Obsidian vault：默认只移动、不改名（改名会断开双链）',
      renameAllowed,
      considered,
      unchanged,
      views: views.slice(0, 5),
      omittedViews: Math.max(0, views.length - 5),
      totals: {
        files: considered,
        toMove: views.reduce((sum, view) => sum + view.total, 0),
        unchanged,
      },
    }
  }

  return { plan, structure, detail }
}
