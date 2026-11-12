/**
 * Batched indexing over a local document corpus.
 *
 * The Harness has no daemon, so indexing is driven by repeated `build()` calls:
 * `sync()` diffs the filesystem against the `files` table, `build()` processes
 * pending files for a bounded time/count, and every file commits in its own
 * transaction. An interrupted build resumes from the persistent pending rows.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative, resolve, sep } from 'node:path'

import {
  EXTRACTOR_VERSION,
  extractFile,
  extractorFor,
  isImageExtension,
} from './extract/index.js'
import { rasterPdfPages } from './ocr/pdf-raster.js'

export const DEFAULT_EXCLUDES = [
  '**/node_modules/**',
  '**/.git/**',
  '**/.DS_Store',
  '**/~$*',
  '**/.Trash/**',
  '**/System Volume Information/**',
]

/** Translate the small glob subset used by excludeGlobs into a RegExp. */
export function globToRegExp(glob) {
  const pattern = String(glob).replace(/\\/g, '/')
  let out = ''
  let index = 0
  while (index < pattern.length) {
    if (pattern.startsWith('**/', index)) {
      out += '(?:.*/)?'
      index += 3
      continue
    }
    if (pattern.startsWith('/**', index)) {
      out += '(?:/.*)?'
      index += 3
      continue
    }
    if (pattern.startsWith('**', index)) {
      out += '.*'
      index += 2
      continue
    }
    const char = pattern[index]
    if (char === '*') {
      out += '[^/]*'
      index += 1
      continue
    }
    if (char === '?') {
      out += '[^/]'
      index += 1
      continue
    }
    out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    index += 1
  }
  return new RegExp(`^${out}$`)
}

function comparePath(value) {
  const resolved = resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isUnderRoot(filePath, root) {
  const file = comparePath(filePath)
  const base = comparePath(root)
  return file === base || file.startsWith(`${base}${sep}`)
}

function jsonMeta(raw, fallback) {
  if (!raw) return fallback
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function permissionHint(error) {
  return error?.code === 'EACCES' || error?.code === 'EPERM'
    ? ' — grant Full Disk Access to DeepSeek Harness (System Settings → Privacy & Security)'
    : ''
}

export function createIndexer(options) {
  const {
    store,
    roots = [],
    excludeGlobs = [],
    maxFileBytes = 50 * 1024 * 1024,
    batchMs = 20_000,
    maxFilesPerBatch = 50,
    ocrMaxPages = 50,
    extract = extractFile,
    ocr = null,
    dbPath = null,
  } = options ?? {}

  if (!store) throw new Error('createIndexer: store is required')
  if (!Number.isFinite(batchMs) || batchMs <= 0) throw new Error('batchMs must be positive')
  if (!Number.isInteger(maxFilesPerBatch) || maxFilesPerBatch <= 0) {
    throw new Error('maxFilesPerBatch must be a positive integer')
  }

  let resolvedRoots = roots.map((root) => resolve(root))
  const excludeRegExps = [...DEFAULT_EXCLUDES, ...excludeGlobs].map(globToRegExp)

  function isExcluded(relativePath, isDirectory) {
    const candidate = isDirectory ? `${relativePath}/` : relativePath
    return excludeRegExps.some((regexp) => regexp.test(candidate) || regexp.test(relativePath))
  }

  function isUnderAnyRoot(filePath) {
    return resolvedRoots.some((root) => isUnderRoot(filePath, root))
  }

  async function collectFiles(signal, errors) {
    const files = []
    const seen = new Set()
    let aborted = false

    const push = (filePath) => {
      if (seen.has(filePath)) return
      seen.add(filePath)
      files.push(filePath)
    }

    for (const root of resolvedRoots) {
      let info
      try {
        info = await stat(root)
      } catch (error) {
        errors.push({ path: root, message: `root not readable: ${error.message}${permissionHint(error)}` })
        continue
      }
      if (info.isFile()) {
        push(root)
        continue
      }
      if (!info.isDirectory()) {
        errors.push({ path: root, message: 'root is neither a file nor a directory' })
        continue
      }

      const stack = [root]
      while (stack.length > 0) {
        if (signal?.aborted) {
          aborted = true
          break
        }
        const directory = stack.pop()
        let entries
        try {
          entries = await readdir(directory, { withFileTypes: true })
        } catch (error) {
          errors.push({ path: directory, message: `${error.message}${permissionHint(error)}` })
          continue
        }
        for (const entry of entries) {
          const fullPath = join(directory, entry.name)
          const relativePath = relative(root, fullPath).split(sep).join('/')
          if (isExcluded(relativePath, entry.isDirectory())) continue
          if (entry.isDirectory()) stack.push(fullPath)
          else if (entry.isFile()) push(fullPath)
        }
      }
      if (aborted) break
    }

    return { files, aborted }
  }

  async function sync({ signal } = {}) {
    const startedAt = Date.now()
    const errors = []
    const existing = new Map(store.listAllFiles().map((row) => [row.path, row]))
    const walk = await collectFiles(signal, errors)

    let added = 0
    let changed = 0
    let unchanged = 0
    let skippedUnsupported = 0
    let skippedTooLarge = 0
    const skippedByExtension = {}
    const seen = new Set()

    for (const filePath of walk.files) {
      if (signal?.aborted) break
      const extension = extname(filePath).toLowerCase()
      if (!extractorFor(extension) && !isImageExtension(extension)) {
        skippedUnsupported += 1
        const key = extension || '(none)'
        skippedByExtension[key] = (skippedByExtension[key] ?? 0) + 1
        continue
      }

      let info
      try {
        info = await stat(filePath)
      } catch (error) {
        errors.push({ path: filePath, message: `${error.message}${permissionHint(error)}` })
        continue
      }
      if (!info.isFile()) continue
      if (info.size > maxFileBytes) {
        skippedTooLarge += 1
        continue
      }

      seen.add(filePath)
      const mtime = Math.trunc(info.mtimeMs)
      const previous = existing.get(filePath)

      if (!previous) {
        store.upsertFile({
          path: filePath,
          size: info.size,
          mtime,
          status: 'pending',
          extractorVersion: EXTRACTOR_VERSION,
        })
        added += 1
        continue
      }

      const versionChanged = Number(previous.extractor_version ?? 0) !== EXTRACTOR_VERSION
      if (Number(previous.mtime) !== mtime || Number(previous.size) !== info.size || versionChanged) {
        store.upsertFile({
          path: filePath,
          size: info.size,
          mtime,
          status: 'pending',
          extractorVersion: EXTRACTOR_VERSION,
          hash: previous.hash ?? null,
        })
        changed += 1
      } else {
        unchanged += 1
      }
    }

    // Deletions are safe only when the walk completed without unreadable
    // directories; otherwise missing rows may just be invisible, not gone.
    let deleted = 0
    let deletionSkipped = false
    const interrupted = Boolean(signal?.aborted) || walk.aborted
    if (!interrupted && errors.length === 0) {
      for (const filePath of existing.keys()) {
        if (seen.has(filePath)) continue
        if (!isUnderAnyRoot(filePath)) continue
        store.deleteFile(filePath)
        deleted += 1
      }
    } else if (!interrupted) {
      deletionSkipped = true
    }

    const summary = {
      scanned: walk.files.length,
      added,
      changed,
      unchanged,
      deleted,
      deletionSkipped,
      skippedUnsupported,
      skippedTooLarge,
      skippedByExtension,
      errors,
      aborted: interrupted,
      elapsedMs: Date.now() - startedAt,
    }

    store.setMeta('indexer.roots', JSON.stringify(resolvedRoots))
    store.setMeta('indexer.lastSyncAt', String(Date.now()))
    store.setMeta('indexer.lastSyncSummary', JSON.stringify(summary))
    return summary
  }

  function ocrChunk(pageNumber, text, recognized) {
    return {
      kind: 'ocr',
      page: pageNumber,
      text,
      ocrSource: recognized?.source ?? null,
      ocrConfidence:
        typeof recognized?.confidence === 'number' ? recognized.confidence : null,
    }
  }

  async function ocrFromRaster(raster, targetPages) {
    const byPage = new Map()
    for (const image of raster.pages) {
      if (!byPage.has(image.page)) byPage.set(image.page, [])
      byPage.get(image.page).push(image)
    }

    const chunks = []
    const failedPages = new Set()
    const missingPages = []
    for (const pageNumber of targetPages) {
      const images = byPage.get(pageNumber) ?? []
      if (images.length === 0) {
        missingPages.push(pageNumber)
        continue
      }
      const texts = []
      let source = null
      let confidence = null
      for (const image of images) {
        try {
          const recognized = await ocr.recognize({ buffer: image.png })
          const text = String(recognized?.text ?? '').trim()
          if (text) {
            texts.push(text)
            source ??= recognized.source ?? null
            if (confidence == null && typeof recognized.confidence === 'number') {
              confidence = recognized.confidence
            }
          }
        } catch {
          failedPages.add(pageNumber)
        }
      }
      if (texts.length > 0) chunks.push(ocrChunk(pageNumber, texts.join('\n'), { source, confidence }))
    }

    return { chunks, failedPages: [...failedPages], missingPages, raster }
  }

  function ocrNotes({ failedPages, missingPages, raster, totalPages }) {
    const notes = []
    if (raster?.truncated) {
      notes.push(`OCR limited to first ${ocrMaxPages} of ${totalPages} pages`)
    }
    if (missingPages?.length) notes.push(`no embedded page image: ${missingPages.join(',')}`)
    if (failedPages?.length) notes.push(`OCR failed for pages: ${failedPages.join(',')}`)
    return notes
  }

  async function processMixedPdf(row, result) {
    const textChunks = result.chunks ?? []
    const scannedPages = result.scannedPages ?? []

    if (!ocr) {
      store.replaceChunks(row.path, textChunks, {
        status: 'ok',
        extractorVersion: EXTRACTOR_VERSION,
      })
      store.setFileStatus(
        row.path,
        'ok',
        `scanned pages not OCRed: ${scannedPages.join(',')} (OCR disabled)`,
      )
      return
    }

    try {
      const raster = await rasterPdfPages(await readFile(row.path), { maxPages: ocrMaxPages })
      const { chunks, failedPages, missingPages } = await ocrFromRaster(raster, scannedPages)
      const notes = ocrNotes({
        failedPages,
        missingPages,
        raster,
        totalPages: raster.totalPages,
      })
      store.replaceChunks(row.path, [...textChunks, ...chunks], {
        status: 'ok',
        extractorVersion: EXTRACTOR_VERSION,
      })
      if (notes.length > 0) store.setFileStatus(row.path, 'ok', notes.join('; '))
    } catch (error) {
      store.replaceChunks(row.path, textChunks, {
        status: 'ok',
        extractorVersion: EXTRACTOR_VERSION,
      })
      store.setFileStatus(
        row.path,
        'ok',
        `scanned pages OCR failed: ${error?.message ?? error}`,
      )
    }
  }

  async function processScanned(row, result, extension) {
    if (isImageExtension(extension) && ocr) {
      const recognized = await ocr.recognize({ path: row.path })
      const text = String(recognized?.text ?? '').trim()
      if (text) {
        store.replaceChunks(row.path, [ocrChunk(1, text, recognized)], {
          status: 'ocr_ok',
          extractorVersion: EXTRACTOR_VERSION,
        })
        return
      }
      store.setFileStatus(row.path, 'scanned', 'OCR produced no text')
      return
    }

    // Scanned PDFs: extract every embedded page bitmap with pdfjs, then OCR the
    // PNGs. This works on every platform (no native canvas, no Mac-only PDFKit).
    if (extension === '.pdf' && ocr) {
      let raster
      try {
        raster = await rasterPdfPages(await readFile(row.path), { maxPages: ocrMaxPages })
      } catch (error) {
        store.setFileStatus(
          row.path,
          'scanned',
          `scanned PDF: rasterization failed (${error?.message ?? error})`,
        )
        return
      }

      const targetPages = Array.from(
        { length: Math.min(raster.totalPages, ocrMaxPages) },
        (_, index) => index + 1,
      )
      if (raster.pages.length === 0) {
        store.setFileStatus(row.path, 'scanned', 'scanned PDF: no embedded page image found')
        return
      }

      const { chunks, failedPages, missingPages } = await ocrFromRaster(raster, targetPages)
      if (chunks.length === 0) {
        store.setFileStatus(
          row.path,
          'scanned',
          `scanned PDF: OCR produced no text (${failedPages.length} failed, ${missingPages.length} without image)`,
        )
        return
      }

      store.replaceChunks(row.path, chunks, {
        status: 'ocr_ok',
        extractorVersion: EXTRACTOR_VERSION,
      })
      const notes = ocrNotes({
        failedPages,
        missingPages,
        raster,
        totalPages: raster.totalPages,
      })
      if (notes.length > 0) store.setFileStatus(row.path, 'ocr_ok', notes.join('; '))
      return
    }

    const reason = isImageExtension(extension)
      ? 'image: OCR disabled or unavailable'
      : extension === '.pdf'
        ? 'scanned PDF: OCR disabled or unavailable'
        : result.reason ?? 'no text layer'
    store.setFileStatus(row.path, 'scanned', reason)
  }

  async function processFile(row) {
    const extension = extname(row.path).toLowerCase()
    const result = await extract(row.path, { extension })
    const extractorVersion = result?.extractorVersion ?? EXTRACTOR_VERSION

    if (result?.status === 'mixed') {
      await processMixedPdf(row, result)
      return
    }
    if (result?.status === 'ok') {
      const chunks = result.chunks ?? []
      if (chunks.length === 0) {
        store.replaceChunks(row.path, [], { status: 'empty', extractorVersion })
        store.setFileStatus(row.path, 'empty', 'no extractable text (images only?)')
        return
      }
      store.replaceChunks(row.path, chunks, {
        status: 'ok',
        extractorVersion,
      })
      return
    }
    if (result?.status === 'scanned') {
      await processScanned(row, result, extension)
      return
    }
    if (result?.status === 'unsupported') {
      store.replaceChunks(row.path, [], { status: 'unsupported', extractorVersion })
      store.setFileStatus(row.path, 'unsupported', result.reason ?? null)
      return
    }
    throw new Error(result?.error ?? `extraction failed (${result?.status ?? 'unknown'})`)
  }

  async function build({ signal, budgetMs = batchMs, maxFiles = maxFilesPerBatch } = {}) {
    const startedAt = Date.now()
    let processed = 0
    let failed = 0
    let aborted = false
    const errors = []
    let done = false

    for (;;) {
      if (signal?.aborted) {
        aborted = true
        break
      }
      if (processed + failed >= maxFiles) break
      if (Date.now() - startedAt >= budgetMs) break

      const pending = store.listByStatus('pending', 1)
      if (pending.length === 0) {
        done = true
        break
      }

      const row = pending[0]
      try {
        await processFile(row)
        processed += 1
      } catch (error) {
        failed += 1
        const message = error instanceof Error ? error.message : String(error)
        store.setFileStatus(row.path, 'error', message)
        if (errors.length < 20) errors.push({ path: row.path, message })
      }
      store.setMeta('indexer.cursor', row.path)
    }

    const remaining = store.countByStatus('pending')
    if (remaining === 0) done = true

    const summary = {
      done,
      processed,
      failed,
      remaining,
      aborted,
      errors,
      elapsedMs: Date.now() - startedAt,
    }
    store.setMeta('indexer.lastBuildAt', String(Date.now()))
    store.setMeta('indexer.lastBuildSummary', JSON.stringify(summary))
    return summary
  }

  function status() {
    const stats = store.stats()
    const pending = stats.byStatus.find((item) => item.status === 'pending')?.count ?? 0
    return {
      roots: [...resolvedRoots],
      dbPath,
      files: stats.files,
      chunks: stats.chunks,
      pending,
      byStatus: stats.byStatus,
      lastSyncAt: Number(store.getMeta('indexer.lastSyncAt', '0')) || null,
      lastBuildAt: Number(store.getMeta('indexer.lastBuildAt', '0')) || null,
      lastSyncSummary: jsonMeta(store.getMeta('indexer.lastSyncSummary'), null),
      lastBuildSummary: jsonMeta(store.getMeta('indexer.lastBuildSummary'), null),
      cursor: store.getMeta('indexer.cursor', null),
      recoveredFrom: store.getMeta('indexer.recoveredFrom', null),
    }
  }

  /** Replace the scanned roots for subsequent sync/build calls. */
  function setRoots(nextRoots) {
    resolvedRoots = (Array.isArray(nextRoots) ? nextRoots : [])
      .map((root) => String(root).trim())
      .filter(Boolean)
      .map((root) => resolve(root))
    return [...resolvedRoots]
  }

  /** Drop indexed files that are no longer under any configured root. */
  function pruneOutsideRoots() {
    let pruned = 0
    for (const row of store.listAllFiles()) {
      if (!isUnderAnyRoot(row.path)) {
        store.deleteFile(row.path)
        pruned += 1
      }
    }
    return pruned
  }

  const api = { sync, build, status, processFile, setRoots, pruneOutsideRoots }
  Object.defineProperty(api, 'roots', { get: () => [...resolvedRoots], enumerable: true })
  return api
}
