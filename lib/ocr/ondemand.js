/**
 * On-demand page OCR.
 *
 * Lazy mode exists because the real archive is large and mostly paper: OCRing
 * every scanned page during the build turned a 20-minute index into an
 * all-afternoon one. Instead the build stores the text it can get instantly and
 * records which pages still need recognition; this module recognises them later,
 * one page at a time, only when someone actually reads that page or asks for a
 * warm-up pass.
 *
 * Every path here is idempotent: `ocr_pages` records done/failed per page, and a
 * retry deletes the page's chunks before re-inserting, so reading the same page
 * twice costs one lookup and never duplicates text.
 */

import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

import { rasterPdfPages } from './pdf-raster.js'

function ocrChunk(pageNumber, text, recognized) {
  return {
    kind: 'ocr',
    page: pageNumber,
    text,
    ocrSource: recognized?.source ?? null,
    ocrConfidence: typeof recognized?.confidence === 'number' ? recognized.confidence : null,
  }
}

function isImagePath(path) {
  return ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff'].includes(
    extname(String(path ?? '')).toLowerCase(),
  )
}

/**
 * @param {{
 *   store: object,
 *   ocr: { recognize(input: object): Promise<{ text?: string, confidence?: number, source?: string }> },
 *   raster?: (buffer: Buffer, options: object) => Promise<object>,
 *   maxPagesPerCall?: number,
 * }} options
 */
export function createOnDemandOcr(options = {}) {
  const { store, ocr } = options
  if (!store) throw new Error('createOnDemandOcr: store is required')
  if (!ocr) throw new Error('createOnDemandOcr: ocr service is required')
  const raster = typeof options.raster === 'function' ? options.raster : rasterPdfPages
  const maxPagesPerCall = Number(options.maxPagesPerCall) > 0 ? Number(options.maxPagesPerCall) : 6

  /** Recognise one image file (jpg/png/...): a single implicit page. */
  async function recognizeImage(path) {
    try {
      const recognized = await ocr.recognize({ path })
      const text = String(recognized?.text ?? '').trim()
      store.deleteChunksForPage(path, 1)
      if (!text) {
        store.setOcrPage({ path, page: 1, status: 'failed', error: 'OCR produced no text' })
        return { path, pages: [], failed: 1, status: 'failed', error: 'OCR produced no text' }
      }
      store.addChunks(path, [ocrChunk(1, text, recognized)])
      store.setOcrPage({ path, page: 1, status: 'done' })
      if (store.getFile?.(path)) store.setFileStatus(path, 'ocr_ok')
      return { path, pages: [1], text, chunks: 1, failed: 0, status: 'done' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      store.setOcrPage({ path, page: 1, status: 'failed', error: message })
      return { path, pages: [], failed: 1, status: 'failed', error: message }
    }
  }

  /**
   * Recognise specific pages of one PDF. Pages without an embedded bitmap are
   * reported as missing rather than silently skipped: that is a fact about the
   * file the caller may want to tell the user.
   */
  async function recognizePdfPages(path, pages) {
    const wanted = [...new Set(pages.map((page) => Number(page)).filter((page) => page >= 1))].sort(
      (left, right) => left - right,
    )
    if (wanted.length === 0) return { path, pages: [], failed: 0, missing: [], status: 'skipped' }

    let buffer
    try {
      buffer = await readFile(path)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      for (const page of wanted) store.setOcrPage({ path, page, status: 'failed', error: message })
      return { path, pages: [], failed: wanted.length, missing: [], status: 'failed', error: message }
    }

    // The raster bounds which pages carry an embedded image, so it must reach the
    // highest page we want instead of stopping at the default window.
    const highest = Math.max(...wanted)
    let rasterized
    try {
      rasterized = await raster(buffer, { maxPages: highest })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      for (const page of wanted) store.setOcrPage({ path, page, status: 'failed', error: message })
      return { path, pages: [], failed: wanted.length, missing: [], status: 'failed', error: message }
    }

    const byPage = new Map()
    for (const image of rasterized.pages ?? []) {
      if (!byPage.has(image.page)) byPage.set(image.page, [])
      byPage.get(image.page).push(image)
    }

    const done = []
    const missing = []
    let failed = 0
    let chars = 0
    for (const page of wanted) {
      const images = byPage.get(page) ?? []
      if (images.length === 0) {
        store.setOcrPage({ path, page, status: 'failed', error: 'no embedded page image' })
        missing.push(page)
        continue
      }
      const texts = []
      let source = null
      let confidence = null
      let pageFailed = false
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
          pageFailed = true
        }
      }
      if (texts.length === 0) {
        const message = pageFailed ? 'OCR failed' : 'OCR produced no text'
        store.setOcrPage({ path, page, status: 'failed', error: message })
        failed += 1
        continue
      }
      const text = texts.join('\n')
      store.deleteChunksForPage(path, page)
      store.addChunks(path, [ocrChunk(page, text, { source, confidence })])
      store.setOcrPage({ path, page, status: 'done' })
      done.push(page)
      chars += text.length
    }

    if (done.length > 0 && store.getFile?.(path)) {
      const current = store.getFile(path)
      if (current?.status === 'scanned') store.setFileStatus(path, 'ocr_ok')
    }
    return {
      path,
      pages: done,
      missing,
      failed,
      chars,
      status: done.length > 0 ? 'done' : failed > 0 ? 'failed' : 'missing',
    }
  }

  /**
   * Read one page, recognising it first when it has never been read. This is the
   * call the evidence tool makes, so "open page 7 of that scanned PDF" works.
   */
  async function ensurePage(path, page) {
    const number = Number(page)
    if (!Number.isInteger(number) || number < 1) {
      throw new Error(`page must be a positive integer, got ${page}`)
    }
    const existing = store.getOcrPage(path, number)
    if (existing?.status === 'done') return { path, page: number, recognized: false, status: 'done' }
    const result = isImagePath(path)
      ? await recognizeImage(path)
      : await recognizePdfPages(path, [number])
    return {
      path,
      page: number,
      recognized: true,
      status: result.status,
      error: result.error ?? null,
      pages: result.pages ?? [],
    }
  }

  /**
   * Warm-up pass: recognise a bounded number of pages that are still pending.
   * The user (or the agent, on their behalf) runs this when convenient; it is the
   * bridge between "searchable now" and "fully searchable eventually".
   */
  async function warm({ limit = maxPagesPerCall, path = null } = {}) {
    const budget = Math.max(1, Math.floor(Number(limit) || maxPagesPerCall))
    const pending = store.pendingOcrPages({ path, limit: budget })
    if (pending.length === 0) {
      return { processed: 0, pages: [], remaining: store.ocrPageStats().pending, files: [] }
    }

    const byPath = new Map()
    for (const row of pending) {
      if (!byPath.has(row.path)) byPath.set(row.path, [])
      byPath.get(row.path).push(row.page)
    }

    const results = []
    let remaining = budget
    for (const [filePath, pages] of byPath) {
      if (remaining <= 0) break
      const slice = pages.slice(0, remaining)
      remaining -= slice.length
      const result = isImagePath(filePath)
        ? await recognizeImage(filePath)
        : await recognizePdfPages(filePath, slice)
      results.push(result)
    }

    const stats = store.ocrPageStats()
    return {
      processed: results.reduce((sum, result) => sum + (result.pages?.length ?? 0), 0),
      failed: results.reduce((sum, result) => sum + (result.failed ?? 0), 0),
      files: results.map((result) => ({ path: result.path, pages: result.pages, status: result.status })),
      remaining: stats.pending,
      done: stats.done,
    }
  }

  return { ensurePage, warm, recognizeImage, recognizePdfPages }
}
