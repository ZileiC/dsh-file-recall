/**
 * Extraction dispatch. Unsupported formats and extraction failures are
 * returned as status values, never thrown, so one bad file cannot stop a batch.
 */

import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

import { extractPptx } from './pptx.js'
import { extractDocx } from './docx.js'
import { extractPdf } from './pdf.js'
import { extractXlsx } from './xlsx.js'
import { extractText } from './text.js'

export const EXTRACTOR_VERSION = 1

const EXTRACTORS = {
  '.pptx': extractPptx,
  '.docx': extractDocx,
  '.pdf': extractPdf,
  '.xlsx': extractXlsx,
  '.txt': extractText,
  '.md': extractText,
  '.markdown': extractText,
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff'])
const LEGACY_EXTENSIONS = new Set([
  '.doc',
  '.xls',
  '.ppt',
  '.wps',
  '.et',
  '.dps',
  '.key',
  '.pages',
  '.numbers',
  '.rtf',
  '.csv',
  '.odt',
  '.ods',
  '.odp',
  '.pptm',
  '.docm',
  '.xlsm',
])

export function extractorFor(extension) {
  return EXTRACTORS[String(extension).toLowerCase()] ?? null
}

export function isImageExtension(extension) {
  return IMAGE_EXTENSIONS.has(String(extension).toLowerCase())
}

export function isLegacyExtension(extension) {
  return LEGACY_EXTENSIONS.has(String(extension).toLowerCase())
}

/**
 * @param {Buffer|Uint8Array} buffer
 * @param {string} extension file extension such as ".pptx"
 * @returns {Promise<{status:'ok'|'scanned'|'unsupported'|'error', chunks:Array, reason?:string, error?:string, extractorVersion:number}>}
 */
export async function extractBuffer(buffer, extension, _options = {}) {
  const ext = String(extension).toLowerCase()

  if (IMAGE_EXTENSIONS.has(ext)) {
    return {
      status: 'scanned',
      chunks: [],
      reason: 'image: OCR pending',
      extractorVersion: EXTRACTOR_VERSION,
    }
  }
  if (LEGACY_EXTENSIONS.has(ext)) {
    return {
      status: 'unsupported',
      chunks: [],
      reason: `legacy format ${ext} has no pure-JS extractor`,
      extractorVersion: EXTRACTOR_VERSION,
    }
  }

  const extractor = extractorFor(ext)
  if (!extractor) {
    return {
      status: 'unsupported',
      chunks: [],
      reason: `unsupported extension ${ext || '(none)'}`,
      extractorVersion: EXTRACTOR_VERSION,
    }
  }

  try {
    const result = await extractor(buffer)
    return { ...result, extractorVersion: EXTRACTOR_VERSION }
  } catch (error) {
    return {
      status: 'error',
      chunks: [],
      error: error instanceof Error ? error.message : String(error),
      extractorVersion: EXTRACTOR_VERSION,
    }
  }
}

/** Read a file and extract it; never throws for unsupported/parse failures. */
export async function extractFile(filePath, options = {}) {
  const extension = options.extension ?? extname(filePath)
  let buffer
  try {
    buffer = await readFile(filePath)
  } catch (error) {
    return {
      status: 'error',
      chunks: [],
      error: error instanceof Error ? error.message : String(error),
      extractorVersion: EXTRACTOR_VERSION,
    }
  }
  return extractBuffer(buffer, extension, options)
}
