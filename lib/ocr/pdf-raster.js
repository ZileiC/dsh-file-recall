/**
 * Rasterize scanned PDF pages from their embedded images.
 *
 * Scanned PDFs normally embed one large bitmap per page, so we can extract that
 * bitmap with pdfjs and encode a PNG without a native canvas. This makes scanned
 * PDF OCR work on Windows too, and lets macOS Vision receive a plain PNG.
 */

import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'

import { encodePng } from './png.js'

const MIN_PIXELS = 10_000

function imageObjectFrom(page, arg) {
  let candidate = arg
  if (typeof arg === 'string') {
    try {
      candidate = page.objs.get(arg)
    } catch {
      return null
    }
  }
  if (candidate && typeof candidate.then === 'function') return candidate
  return candidate
}

/**
 * @param {Buffer|Uint8Array} buffer PDF bytes
 * @param {{maxPages?:number,minPixels?:number}} [options]
 * @returns {Promise<{pages:Array<{page:number,width:number,height:number,png:Buffer}>, totalPages:number, truncated:boolean}>}
 */
export async function rasterPdfPages(buffer, options = {}) {
  const { maxPages = 50, minPixels = MIN_PIXELS } = options
  const task = getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  })
  const document = await task.promise
  const pages = []

  try {
    const limit = Math.min(document.numPages, Math.max(1, maxPages))
    for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const candidates = []
      try {
        const operatorList = await page.getOperatorList()
        for (let index = 0; index < operatorList.fnArray.length; index += 1) {
          const fn = operatorList.fnArray[index]
          if (fn !== OPS.paintImageXObject && fn !== OPS.paintInlineImageXObject) continue

          let image = imageObjectFrom(page, operatorList.argsArray[index][0])
          image = await image
          if (!image?.width || !image?.height || !image?.data) continue
          const pixels = image.width * image.height
          if (pixels < minPixels) continue
          candidates.push({ image, pixels })
        }
      } catch {
        // A page whose image cannot be decoded is skipped; other pages still count.
      } finally {
        page.cleanup?.()
      }

      candidates.sort((left, right) => right.pixels - left.pixels)
      for (const candidate of candidates) {
        pages.push({
          page: pageNumber,
          width: candidate.image.width,
          height: candidate.image.height,
          png: encodePng(candidate.image),
        })
      }
    }

    return {
      pages,
      totalPages: document.numPages,
      truncated: document.numPages > limit,
    }
  } finally {
    await task.destroy()
  }
}
