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

      // Aggregate into every ancestor folder. Keyed by root + rel: two roots may
      // both contain "课程A", and a rel-only key silently merged them (the folder
      // then belonged to whichever root was walked first).
      for (let depth = 0; depth < relParts.length; depth += 1) {
        const rel = joinRelative(relParts.slice(0, depth + 1))
        const key = root + '\u0000' + rel
        const parentRel = depth === 0 ? '' : joinRelative(relParts.slice(0, depth))
        const existing = folders.get(key)
        if (existing) {
          existing.files += 1
          existing.chunks += chunks
          if (scanned) existing.scanned += 1
        } else {
          folders.set(key, {
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

  function relDepth(rel) {
    return rel === '' ? 0 : String(rel).split(/[\\/]+/).length
  }

  /** The real name of a configured root, for drawing it as a node. */
  function rootName(rootPath) {
    const parts = String(rootPath ?? '').split(/[\\/]+/).filter(Boolean)
    return parts.length > 0 ? parts[parts.length - 1] : String(rootPath ?? '')
  }

  function rootNodeId(rootPath) {
    return 'root:' + String(rootPath ?? '')
  }

  function isInside(rel, focusRel) {
    if (focusRel === '') return true
    if (rel === focusRel) return true
    return rel.startsWith(focusRel + PATH_SEP) || rel.startsWith(focusRel + '/')
  }

  /**
   * Several levels of the archive at once, plus the memory edges that land on it.
   *
   * One level was not enough to read the shape of an archive: the panel showed a
   * ring of folders and nothing else. `depth` now controls how far one request
   * goes (1-3) and the client lays the result out as concentric rings, so depth
   * is visible instead of implied.
   *
   * @param {{
   *   roots: string[],
   *   focus?: string|null,     // folder rel path; null = top level
   *   depth?: number,          // levels below the focus (default 2)
   *   perDepth?: number,       // max nodes per level, heaviest first
   *   memoryLimit?: number,
   * }} input
   */
  function build({
    roots = [],
    focus = null,
    depth = 3,
    perDepth = 16,
    memoryLimit = 200,
  } = {}) {
    const cleanRoots = (Array.isArray(roots) ? roots : []).filter(Boolean).map(String)
    const snap = snapshot(cleanRoots)
    const focusRel = focus == null ? '' : String(focus)
    const base = relDepth(focusRel)
    const maxDepth = Math.min(3, Math.max(1, Math.floor(Number(depth) || 3)))
    const limit = Math.max(1, Math.floor(Number(perDepth) || 16))

    const byDepth = new Map()
    const push = (level, node) => {
      if (!byDepth.has(level)) byDepth.set(level, [])
      byDepth.get(level).push(node)
    }

    /*
     * The configured roots ARE nodes. The panel used to draw a single synthetic
     * hub labelled "everything", which lied twice: it hid the real root folders,
     * and it merged two unrelated archives into one invented centre.
     *
     * At the top level each root is emitted with `depth: 0`, its own id and its
     * real folder name; when a focus is open, only that root is shown as the
     * anchor so the breadcrumb still starts somewhere real.
     */
    const rootNodes = []
    for (const root of cleanRoots) {
      const own = snap.folders.filter((folder) => folder.root === root)
      if (own.length === 0 && !snap.files.some((file) => file.root === root)) continue
      // A focused view only draws the root it belongs to.
      if (focusRel !== '' && !own.some((folder) => folder.rel === focusRel)) continue
      const topFolders = own.filter((folder) => folder.parentRel === '')
      const rootFiles = snap.files.filter((file) => file.root === root && file.parentRel === '')
      rootNodes.push({
        id: rootNodeId(root),
        type: 'root',
        name: rootName(root),
        rel: '',
        path: root,
        root,
        parentId: null,
        parentRel: null,
        depth: 0,
        files: rootFiles.length + topFolders.reduce((sum, folder) => sum + folder.files, 0),
        chunks: topFolders.reduce((sum, folder) => sum + folder.chunks, 0),
        scanned: topFolders.reduce((sum, folder) => sum + folder.scanned, 0),
      })
    }

    for (const folder of snap.folders) {
      if (folder.rel === focusRel || !isInside(folder.rel, focusRel)) continue
      const level = relDepth(folder.rel) - base
      if (level < 1 || level > maxDepth) continue
      const atTop = folder.parentRel === '' || folder.parentRel === focusRel
      push(level, {
        id: folder.id,
        type: 'folder',
        name: folder.name,
        rel: folder.rel,
        // Link by id: two roots can hold the same relative path, and a rel-keyed
        // link would then draw one tree's branch under the other root.
        parentId: atTop ? rootNodeId(folder.root) : 'folder:' + folder.root + PATH_SEP + folder.parentRel,
        parentRel: atTop ? null : folder.parentRel,
        root: folder.root,
        depth: level,
        files: folder.files,
        chunks: folder.chunks,
        scanned: folder.scanned,
      })
    }
    for (const file of snap.files) {
      if (!isInside(file.rel, focusRel)) continue
      const level = relDepth(file.rel) - base
      if (level < 1 || level > maxDepth) continue
      const atTop = file.parentRel === '' || file.parentRel === focusRel
      push(level, {
        id: file.id,
        type: 'file',
        name: file.name,
        rel: file.rel,
        parentId: atTop ? rootNodeId(file.root) : 'folder:' + file.root + PATH_SEP + file.parentRel,
        parentRel: atTop ? null : file.parentRel,
        root: file.root,
        depth: level,
        path: file.path,
        kind: file.kind,
        chunks: file.chunks,
        scanned: file.scanned,
      })
    }

    // Keep each level readable, and report what was dropped instead of
    // truncating silently.
    const nodes = [...rootNodes]
    const hidden = {}
    for (const level of [...byDepth.keys()].sort((left, right) => left - right)) {
      const group = byDepth.get(level)
      group.sort(
        (left, right) => (right.files || right.chunks || 0) - (left.files || left.chunks || 0),
      )
      nodes.push(...group.slice(0, limit))
      if (group.length > limit) hidden[String(level)] = group.length - limit
    }

    const childIds = new Set(nodes.map((node) => node.id))
    // Root-qualified: the same relative path can exist under two roots.
    const byRel = new Map(
      nodes
        .filter((node) => node.rel !== '' && node.root)
        .map((node) => [node.root + '|' + node.rel, node.id]),
    )
    const focusPrefix = focusRel === '' ? '' : focusRel + PATH_SEP

    /**
     * Point a recall at a node that is in this view: the node itself, else its
     * nearest visible ancestor folder, else nothing.
     */
    function resolveTarget(edge) {
      if (childIds.has(edge.targetFile)) return edge.targetFile
      if (focusRel === '') {
        if (edge.targetFolder && childIds.has(edge.targetFolder)) return edge.targetFolder
      }
      if (focusRel !== '' && !edge.fileRel.startsWith(focusPrefix)) return null
      const inner = focusRel === '' ? edge.fileRel : edge.fileRel.slice(focusPrefix.length)
      const parts = inner.split(/[\\/]+/).filter(Boolean)
      for (let take = parts.length - 1; take >= 1; take -= 1) {
        const rel = focusRel === '' ? parts.slice(0, take).join(PATH_SEP) : focusRel + PATH_SEP + parts.slice(0, take).join(PATH_SEP)
        const id = byRel.get(edge.root + '|' + rel)
        if (id) return id
      }
      // Nothing at the requested depth survived the cap: fall back to the root
      // itself so the recall still points at the archive it came from.
      return childIds.has(rootNodeId(edge.root)) ? rootNodeId(edge.root) : null
    }

    const edges = memoryEdges(cleanRoots, memoryLimit)
      .map((edge) => ({ ...edge, target: resolveTarget(edge) }))
      .filter((edge) => edge.target !== null)

    const top = snap.folders.filter((folder) => folder.parentRel === '')
    const totals = {
      folders: snap.folders.length,
      files: snap.files.length,
      chunks: top.reduce((sum, folder) => sum + folder.chunks, 0),
      scanned: top.reduce((sum, folder) => sum + folder.scanned, 0),
      rootFiles: snap.files.filter((file) => file.parentRel === '').length,
    }

    return {
      roots: cleanRoots,
      focus: focusRel === '' ? null : focusRel,
      depth: maxDepth,
      breadcrumb: focusRel === '' ? [] : focusRel.split(/[\\/]+/),
      nodes,
      hidden,
      edges,
      totals,
    }
  }

  return { build, snapshot }
}
