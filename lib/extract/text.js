/**
 * Plain-text extraction with encoding detection for legacy Chinese files.
 * Covers UTF-8 (with/without BOM), UTF-16 LE/BE and GBK.
 */

import { blocksFromText } from './util.js'

const BLOCK_LIMIT = 600

export function decodeTextBuffer(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)

  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3))
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // Not valid UTF-8; legacy Chinese documents are usually GBK.
    try {
      return new TextDecoder('gbk').decode(bytes)
    } catch {
      return new TextDecoder('utf-8').decode(bytes)
    }
  }
}

export function extractText(buffer) {
  const text = decodeTextBuffer(buffer)
  const chunks = blocksFromText(text, BLOCK_LIMIT).map((value, index) => ({
    kind: 'block',
    block: index + 1,
    text: value,
  }))
  return { status: 'ok', chunks }
}
