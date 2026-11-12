/**
 * Graph payload for the panel.
 *
 * The person this is built for keeps a large, messy folder archive on macOS and
 * has no Obsidian, so the only structure that always exists is containment:
 * folders inside folders, files inside those. That is the backbone.
 *
 * On top of it sits what the plugin learned: every recall is an edge to the file
 * it surfaced, coloured by whether it was right. That layer only exists because
 * lib/outcome.js settles verdicts silently.
 *
 * Never returns the whole archive: a folder expands only when asked. An
 * unrequested 50k-node payload would be unusable on screen and wasteful on the
 * wire.
 */

import { sep as PATH_SEP } from 'node:path'

const KIND_BY_EXTENSION = {
  '.md': 'md',
  '.txt': 'txt',
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.pptx': 'pptx',
  '.xlsx': 'xlsx',
}

function normalizeForCompare(value) {
  // Windows paths are case-insensitive AND the user may have typed either
  // separator for the root; a mismatch here silently empties the graph.
  return String(value ?? '')
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/')
    .toLowerCase()
}

export function splitRelative(rootPath, filePath) {
  const root = String(rootPath ?? '').replace(/[\\/]+$/, '')
  const target = String(filePath ?? '')
  if (!root) return null
  if (normalizeForCompare(target).slice(0, normalizeForCompare(root).length) !== normalizeForCompare(root)) {
    return null
  }
  const rest = target.slice(root.length).replace(/^[\\/]+/, '')
  if (!rest) return null
  return rest.split(/[\\/]+/).filter(Boolean)
}

function joinRelative(parts) {
  return parts.join(PATH_SEP)
}

function fileKind(path) {
  const match = String(path ?? '').toLowerCase().match(/(\.[^.\\/]+)$/)
  if (!match) return 'other'
  return KIND_BY_EXTENSION[match[1]] ?? 'other'
}

function isScannedStatus(status) {
  return status === 'scanned' || status === 'ocr_ok'
}

/**
 * @param {{
 *   store: object,
 *   now?: () => number,
 *   ttlMs?: number,
 * }} options
 */
export function createGraphBuilder(options = {}) {
  const { store } = options
  if (!store) throw new Error('createGraphBuilder: store is required')
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const ttlMs = Number(options.ttlMs) > 0 ? Number(options.ttlMs) : 10_000

  let cached = null
  let cachedAt = 0

  /** Aggregate every file and folder once; the archive changes rarely. */
  function snapshot(roots) {
    const signature = roots.join('|')
    if (cached !== null && cached.signature === signature && now() - cachedAt < ttlMs) {
      return cached.value
    }

    const files = typeof store.listAllFiles === 'function' ? store.listAllFiles() : []
    const chunkCounts = new Map()
    if (typeof store.chunkCountByPath === 'function') {
      for (const row of store.chunkCountByPath()) {
        chunkCounts.set(row.path, Number(row.n) || 0)
      }
    }

    const folders = new Map()
    const fileNodes = []
    const rootSet = new Set(roots.map(normalizeForCompare))

    for (const file of files) {
      const root = roots.find((candidate) => splitRelative(candidate, file.path) !== null)
      if (!root) continue
      const parts = splitRelative(root, file.path)
      if (!parts || parts.length === 0) continue
      const relParts = parts.slice(0, -1)
      const name = parts[parts.length - 1]
      const chunks = chunkCounts.get(file.path) ?? 0
      const scanned = isScannedStatus(file.status)

      fileNodes.push({
        id: 'file:' + file.path,
        type: 'file',
        name,
        path: file.path,
        rel: joinRelative(parts),
        parentRel: relParts.length ? joinRelative(relParts) : '',
        root,
        atRoot: rootSet.has(normalizeForCompare(root)),
        kind: fileKind(name),
        chunks,
        scanned,
        status: file.status ?? null,
      })

      // Aggregate into every ancestor folder.
      for (let depth = 0; depth < relParts.length; depth += 1) {
        const rel = joinRelative(relParts.slice(0, depth + 1))
        const parentRel = depth === 0 ? '' : joinRelative(relParts.slice(0, depth))
        const existing = folders.get(rel)
        if (existing) {
          existing.files += 1
          existing.chunks += chunks
          if (scanned) existing.scanned += 1
        } else {
          folders.set(rel, {
            id: 'folder:' + root + PATH_SEP + rel,
            type: 'folder',
            name: relParts[depth],
            rel,
            parentRel,
            root,
            depth: depth + 1,
            files: 1,
            chunks,
            scanned: scanned ? 1 : 0,
          })
        }
      }
    }

    const value = { folders: Array.from(folders.values()), files: fileNodes, roots }
    cached = { signature, value }
    cachedAt = now()
    return value
  }

  /**
   * "Unknown" is its own bucket on purpose: an unsettled recall is not evidence
   * of success, and showing it as neutral is more honest than hiding it.
   */
  function memoryEdges(roots, limit = 200) {
    const rows = typeof store.listQueries === 'function' ? store.listQueries(limit) : []
    const edges = []
    for (const row of rows) {
      const topPath = row.top_path ? String(row.top_path) : null
      if (!topPath) continue
      const root = roots.find((candidate) => splitRelative(candidate, topPath) !== null)
      if (!root) continue
      const parts = splitRelative(root, topPath)
      if (!parts || parts.length === 0) continue
      const folderRel = parts.length > 1 ? joinRelative(parts.slice(0, 1)) : ''
      edges.push({
        id: 'query:' + row.id,
        queryId: row.id,
        query: String(row.raw ?? ''),
        at: Number(row.ts) || 0,
        hits: Number(row.hits) || 0,
        outcome: row.outcome ?? null,
        source: row.outcome_source ?? null,
        root,
        targetFile: 'file:' + topPath,
        targetFolder: folderRel ? 'folder:' + root + PATH_SEP + folderRel : null,
        fileRel: joinRelative(parts),
        folderRel,
      })
    }
    return edges
  }

  /**
   * One level of the archive, plus the memory edges that land on it.
   *
   * @param {{
   *   roots: string[],
   *   focus?: string|null,     // folder rel path; null = top level
   *   memoryLimit?: number,
   * }} input
   */
  function build({ roots = [], focus = null, memoryLimit = 200 } = {}) {
    const cleanRoots = (Array.isArray(roots) ? roots : []).filter(Boolean).map(String)
    const snap = snapshot(cleanRoots)
    const focusRel = focus == null ? '' : String(focus)
    const children = []

    for (const folder of snap.folders) {
      if (folder.parentRel !== focusRel) continue
      children.push({
        id: folder.id,
        type: 'folder',
        name: folder.name,
        rel: folder.rel,
        files: folder.files,
        chunks: folder.chunks,
        scanned: folder.scanned,
      })
    }
    for (const file of snap.files) {
      if (file.parentRel !== focusRel) continue
      children.push({
        id: file.id,
        type: 'file',
        name: file.name,
        rel: file.rel,
        path: file.path,
        kind: file.kind,
        chunks: file.chunks,
        scanned: file.scanned,
      })
    }

    const childIds = new Set(children.map((node) => node.id))
    const focusPrefix = focusRel === '' ? '' : focusRel + PATH_SEP

    /**
     * Point a recall at a node that is actually in this view.
     *
     * At the top level that is the top folder. Inside a folder it is the file
     * itself when it sits directly there, otherwise the subfolder containing it —
     * dropping those edges instead (the first version did) hid most of the
     * memory as soon as the user drilled in past one level.
     */
    function resolveTarget(edge) {
      if (focusRel === '') {
        return edge.targetFolder && childIds.has(edge.targetFolder) ? edge.targetFolder : null
      }
      if (childIds.has(edge.targetFile)) return edge.targetFile
      if (!edge.fileRel.startsWith(focusPrefix)) return null
      const rest = edge.fileRel.slice(focusPrefix.length)
      const first = rest.split(/[\\/]+/)[0]
      if (!first || first === rest) return null
      const candidate = 'folder:' + edge.root + PATH_SEP + focusPrefix + first
      return childIds.has(candidate) ? candidate : null
    }

    const edges = memoryEdges(cleanRoots, memoryLimit)
      .map((edge) => ({ ...edge, target: resolveTarget(edge) }))
      .filter((edge) => edge.target !== null)

    const totals = snap.folders.length === 0 && snap.files.length === 0
      ? { folders: 0, files: 0, chunks: 0, scanned: 0, rootFiles: 0 }
      : (() => {
          const top = snap.folders.filter((folder) => folder.parentRel === '')
          return {
            folders: snap.folders.length,
            files: snap.files.length,
            chunks: top.reduce((sum, folder) => sum + folder.chunks, 0),
            scanned: snap.folders
              .filter((folder) => folder.parentRel === '')
              .reduce((sum, folder) => sum + folder.scanned, 0),
            rootFiles: snap.files.filter((file) => file.parentRel === '').length,
          }
        })()

    return {
      roots: cleanRoots,
      focus: focusRel === '' ? null : focusRel,
      breadcrumb: focusRel === '' ? [] : focusRel.split(/[\\/]+/),
      nodes: children,
      edges,
      totals,
    }
  }

  return { build, snapshot }
}
