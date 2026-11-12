/**
 * docx text extraction through mammoth's HTML projection.
 * Word has no fixed pages, so the evidence unit is a paragraph block with its
 * heading path (honest: never claim a page number for docx).
 */

import mammoth from 'mammoth'

import { blocksFromText, normalizeText, stripTags } from './util.js'

const BLOCK_LIMIT = 600

export async function extractDocx(buffer) {
  const { value: html } = await mammoth.convertToHtml({ buffer })
  if (!html) return { status: 'ok', chunks: [] }

  const chunks = []
  let headingPath = []
  let bufferText = ''
  let blockIndex = 0

  const flush = () => {
    const text = normalizeText(bufferText)
    if (text) {
      blockIndex += 1
      chunks.push({ kind: 'block', block: blockIndex, text })
    }
    bufferText = ''
  }

  const append = (line) => {
    if (!line) return
    if (bufferText.length > 0 && bufferText.length + line.length + 1 > BLOCK_LIMIT) flush()
    bufferText = bufferText ? `${bufferText}\n${line}` : line
    if (bufferText.length >= BLOCK_LIMIT) flush()
  }

  const blockPattern = /<(h[1-6]|p|table)\b[^>]*>([\s\S]*?)<\/\1>/gi
  let match
  while ((match = blockPattern.exec(html)) !== null) {
    const tag = match[1].toLowerCase()
    const inner = match[2]

    if (tag.startsWith('h')) {
      const level = Number(tag[1])
      const text = normalizeText(stripTags(inner))
      if (text) {
        headingPath = headingPath.slice(0, level - 1)
        headingPath[level - 1] = text
      }
      continue
    }

    if (tag === 'p') {
      const text = normalizeText(stripTags(inner))
      if (!text) continue
      const prefix = headingPath.filter(Boolean).join(' > ')
      append(prefix ? `[${prefix}] ${text}` : text)
      continue
    }

    if (tag === 'table') {
      const rows = inner.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? []
      for (const row of rows) {
        const cells = (row.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map((cell) =>
          normalizeText(stripTags(cell)),
        )
        if (cells.some(Boolean)) append(`表格：${cells.join(' ｜ ')}`)
      }
    }
  }

  flush()

  // A fallback for documents mammoth renders without block tags.
  if (chunks.length === 0) {
    const text = normalizeText(stripTags(html))
    return {
      status: 'ok',
      chunks: blocksFromText(text, BLOCK_LIMIT).map((value, index) => ({
        kind: 'block',
        block: index + 1,
        text: value,
      })),
    }
  }

  return { status: 'ok', chunks }
}
