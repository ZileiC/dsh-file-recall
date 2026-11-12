import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { rasterPdfPages } from '../lib/ocr/pdf-raster.js'
import { createTesseractProvider } from '../lib/ocr/tesseract.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name) => join(here, 'fixtures', name)

test('scanned PDF pages are rasterized from embedded images', async () => {
  const result = await rasterPdfPages(readFileSync(fixture('pdf-scan.pdf')), { maxPages: 2 })
  assert.equal(result.totalPages, 2)
  assert.equal(result.truncated, false)
  assert.equal(result.pages.length, 2)
  assert.deepEqual(
    result.pages.map((page) => page.page),
    [1, 2],
  )
  for (const page of result.pages) {
    assert.equal(page.width, 1200)
    assert.equal(page.height, 260)
    assert.deepEqual([...page.png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])
    assert.ok(page.png.length > 1000)
  }
})

test('mixed PDF rasterization finds the scanned page image', async () => {
  const result = await rasterPdfPages(readFileSync(fixture('pdf-mixed-scan.pdf')), { maxPages: 2 })
  assert.equal(result.totalPages, 2)
  assert.deepEqual(
    result.pages.map((page) => page.page),
    [2],
  )
  assert.deepEqual([...result.pages[0].png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])
  assert.equal(result.pages[0].width, 1200)
})

test('real tesseract OCRs a rasterized scanned PDF page', async () => {
  const result = await rasterPdfPages(readFileSync(fixture('pdf-scan.pdf')), { maxPages: 1 })
  assert.equal(result.pages.length, 1)
  const provider = createTesseractProvider({ langs: ['chi_sim'] })
  try {
    const recognized = await provider.recognize({ buffer: result.pages[0].png })
    assert.ok(recognized.text.length > 0)
    assert.match(recognized.text, /预算/)
    assert.equal(typeof recognized.confidence, 'number')
  } finally {
    await provider.dispose()
  }
})
