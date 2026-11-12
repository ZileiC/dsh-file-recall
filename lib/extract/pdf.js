/**
 * PDF text extraction with pdfjs-dist (legacy build, Node-compatible).
 * Pages are the evidence unit. A PDF whose pages carry no text layer is
 * reported as `scanned` so the indexer can route it to OCR instead of storing
 * an empty document.
 */

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

import { isCjkCodePoint } from '../tokenize.js'
import { normalizeText } from './util.js'

const LINE_TOLERANCE = 3

function joinParts(parts) {
  let out = ''
  for (const part of parts) {
    if (!part) continue
    if (!out) {
      out = part
      continue
    }
    const previous = out[out.length - 1]
    const next = part[0]
    if (/\s$/.test(out) || /^\s/.test(part)) out += part
    else if (isCjkCodePoint(previous.codePointAt(0)) || isCjkCodePoint(next.codePointAt(0))) out += part
    else out += ` ${part}`
  }
  return out
}

/** Group text items into visual lines (top-to-bottom, left-to-right). */
export function layoutText(items) {
  const entries = []
  for (const item of items ?? []) {
    if (typeof item?.str !== 'string' || item.str.length === 0) continue
    const transform = item.transform ?? []
    entries.push({
      text: item.str,
      x: Number(transform[4] ?? 0),
      y: Number(transform[5] ?? 0),
      eol: Boolean(item.hasEOL),
    })
  }
  if (entries.length === 0) return ''

  entries.sort((a, b) => b.y - a.y || a.x - b.x)

  const lines = []
  let current = null
  for (const entry of entries) {
    if (!current || Math.abs(entry.y - current.y) > LINE_TOLERANCE) {
      if (current) lines.push(current)
      current = { y: entry.y, parts: [entry.text] }
    } else {
      current.parts.push(entry.text)
    }
    if (entry.eol) {
      lines.push(current)
      current = null
    }
  }
  if (current) lines.push(current)

  return normalizeText(lines.map((line) => joinParts(line.parts)).join('\n'))
}

export async function extractPdf(buffer) {
  const task = getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  })
  const document = await task.promise
  const chunks = []
  const scannedPages = []

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const text = layoutText(content.items)
      if (text) chunks.push({ kind: 'page', page: pageNumber, text })
      else scannedPages.push(pageNumber)
      page.cleanup?.()
    }
  } finally {
    // pdfjs v6 exposes destroy() on the loading task, not on the document proxy.
    await task.destroy()
  }

  if (chunks.length === 0) return { status: 'scanned', chunks: [], scannedPages }
  if (scannedPages.length > 0) return { status: 'mixed', chunks, scannedPages }
  return { status: 'ok', chunks, scannedPages }
}
