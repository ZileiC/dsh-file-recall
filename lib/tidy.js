/**
 * Read-only archive tidy planner.
 *
 * This module never touches the filesystem: it reads the index and produces a
 * PROPOSAL. Execution is a separate, consent-gated step, because moving files is
 * the one thing in this plugin that can lose the user's work.
 *
 * The proposal is deliberately conservative:
 *  - renames never rewrite the existing name, they only add a date prefix
 *    (`2023-05-01_原名`), so nothing the user typed is lost and the change is
 *    easy to reverse;
 *  - moves only ever lift loose files into a folder inside the same root;
 *  - findings that need judgement (duplicate names, overloaded folders) are
 *    reported, not acted on.
 *
 * Everything is derived from `files.path` + `files.mtime`, so the same plan can
 * be produced on macOS with no extra scanning.
 */

import { extname } from 'node:path'

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
        const prefix = isoDate(file.mtime)
        if (!prefix) continue
        const proposed = `${prefix}_${name}`
        push({
          kind: 'rename',
          from: file.rel,
          to: `${dirnameOf(file.rel) ? dirnameOf(file.rel) + '/' : ''}${proposed}`,
          reason: '相机/扫描仪自动命名，只看名字不知道是什么；加日期前缀便于排序与辨认',
          confidence: 'medium',
          conflict: false,
        })
        continue
      }
      if (!hasDateSignal(name, file.path)) undated += 1
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

  return { plan }
}
