import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { extractFile, extractBuffer, EXTRACTOR_VERSION } from '../lib/extract/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name) => join(here, 'fixtures', name)

function joined(result) {
  return result.chunks.map((chunk) => chunk.text).join('\n')
}

// --- pptx -----------------------------------------------------------------

test('pptx: slides keep presentation order and notes are separate chunks', async () => {
  const result = await extractFile(fixture('deck-basic.pptx'))
  assert.equal(result.status, 'ok')
  assert.equal(result.extractorVersion, EXTRACTOR_VERSION)

  const slides = result.chunks.filter((chunk) => chunk.kind === 'slide')
  assert.deepEqual(slides.map((chunk) => chunk.page), [1, 2, 3])
  assert.match(slides[0].text, /2023 年度业务复盘/)
  assert.match(slides[1].text, /部门预算的说明/)
  assert.match(slides[1].text, /绩效指标/)

  const notes = result.chunks.filter((chunk) => chunk.kind === 'notes')
  assert.equal(notes.length, 1)
  assert.equal(notes[0].page, 2)
  assert.match(notes[0].text, /蓝色架构图/)
})

test('pptx: order follows sldIdLst, not zip entry order', async () => {
  const result = await extractFile(fixture('deck-order.pptx'))
  const slides = result.chunks.filter((chunk) => chunk.kind === 'slide')
  assert.equal(slides.length, 2)
  assert.match(slides[0].text, /第一张幻灯片/)
  assert.match(slides[1].text, /第二张幻灯片/)
})

test('pptx: notes-only keywords are still collected', async () => {
  const result = await extractFile(fixture('deck-notes-only.pptx'))
  const notes = result.chunks.filter((chunk) => chunk.kind === 'notes')
  assert.equal(notes.length, 1)
  assert.match(notes[0].text, /珊瑚礁/)
})

// --- docx -----------------------------------------------------------------

test('docx: headings, paragraphs and tables are extracted', async () => {
  const result = await extractFile(fixture('doc-headings.docx'))
  assert.equal(result.status, 'ok')
  const text = joined(result)
  assert.match(text, /项目背景/)
  assert.match(text, /部门预算的说明/)
  assert.match(text, /绩效指标/)
  assert.match(text, /差旅/)
  assert.match(text, /12 万/)
  assert.ok(result.chunks.every((chunk) => chunk.kind === 'block'))
})

test('docx: long text splits into multiple paragraph blocks', async () => {
  const result = await extractFile(fixture('doc-long.docx'))
  assert.ok(result.chunks.length >= 2)
  assert.match(joined(result), /第1段/)
  assert.match(joined(result), /第3段/)
  for (const chunk of result.chunks) {
    assert.ok(chunk.text.length <= 1200, `chunk too large: ${chunk.text.length}`)
  }
})

test('docx: mixed Chinese/latin content survives', async () => {
  const result = await extractFile(fixture('doc-mixed.docx'))
  const text = joined(result)
  assert.match(text, /2023 年度 Budget Plan/)
  assert.match(text, /ops@example\.com/)
})

// --- pdf ------------------------------------------------------------------

test('pdf: text pages are extracted per page', async () => {
  const result = await extractFile(fixture('pdf-text.pdf'))
  assert.equal(result.status, 'ok')
  assert.deepEqual(result.chunks.map((chunk) => chunk.page), [1, 2])
  assert.match(result.chunks[0].text, /Budget plan for 2023/)
  assert.match(result.chunks[1].text, /Performance indicators/)
})

test('pdf: a PDF without a text layer is reported as scanned', async () => {
  const result = await extractFile(fixture('pdf-blank.pdf'))
  assert.equal(result.status, 'scanned')
  assert.deepEqual(result.chunks, [])
})

test('pdf: mixed PDF reports pages that need OCR instead of dropping them', async () => {
  const result = await extractFile(fixture('pdf-mixed.pdf'))
  assert.equal(result.status, 'mixed')
  assert.equal(result.chunks.length, 1)
  assert.equal(result.chunks[0].page, 1)
  assert.deepEqual(result.scannedPages, [2])
})

test('pdf: a text page plus an embedded scan is reported as mixed', async () => {
  const result = await extractFile(fixture('pdf-mixed-scan.pdf'))
  assert.equal(result.status, 'mixed')
  assert.deepEqual(
    result.chunks.map((chunk) => chunk.page),
    [1],
  )
  assert.deepEqual(result.scannedPages, [2])
})

// --- xlsx -----------------------------------------------------------------

test('xlsx: cached formula results are indexed, formulas are not', async () => {
  const result = await extractFile(fixture('sheet-formulas.xlsx'))
  assert.equal(result.status, 'ok')
  const text = joined(result)
  assert.match(text, /预算科目/)
  assert.match(text, /绩效指标-收入/)
  assert.match(text, /200/)
  assert.match(text, /25/)
  assert.doesNotMatch(text, /B1\*2/)
})

test('xlsx: multiple sheets keep their names', async () => {
  const result = await extractFile(fixture('sheet-multi.xlsx'))
  const text = joined(result)
  assert.match(text, /预算表/)
  assert.match(text, /人员表/)
  assert.match(text, /张三/)
})

test('xlsx: wide sheets split into 50-row blocks', async () => {
  const result = await extractFile(fixture('sheet-wide.xlsx'))
  assert.equal(result.chunks.length, 3)
  assert.deepEqual(result.chunks.map((chunk) => chunk.block), [1, 51, 101])
  assert.match(result.chunks[2].text, /第120行/)
})

// --- text / markdown ------------------------------------------------------

test('txt: UTF-8 content is extracted', async () => {
  const result = await extractFile(fixture('note-utf8.txt'))
  assert.equal(result.status, 'ok')
  assert.match(joined(result), /部门预算的说明/)
})

test('txt: GBK content is decoded', async () => {
  const result = await extractFile(fixture('note-gbk.txt'))
  assert.match(joined(result), /珊瑚礁/)
})

test('txt: UTF-8 BOM is stripped from the first line', async () => {
  const result = await extractFile(fixture('note-bom.txt'))
  const text = joined(result)
  assert.match(text, /^带 BOM 的 UTF-8 文本/)
  assert.equal(text.charCodeAt(0), '带'.codePointAt(0))
})

test('md: markdown text is extracted', async () => {
  const result = await extractFile(fixture('readme.md'))
  assert.match(joined(result), /绩效指标/)
})

// --- unsupported / errors -------------------------------------------------

test('legacy office formats return unsupported instead of throwing', async () => {
  for (const name of ['legacy.doc', 'legacy.xls', 'legacy.ppt', 'legacy.wps']) {
    const result = await extractFile(fixture(name))
    assert.equal(result.status, 'unsupported', name)
    assert.deepEqual(result.chunks, [])
  }
})

test('images are marked scanned so OCR can pick them up later', async () => {
  const result = await extractBuffer(Buffer.from([1, 2, 3]), '.png')
  assert.equal(result.status, 'scanned')
})

test('a corrupt pptx becomes an error result, never a throw', async () => {
  const result = await extractBuffer(Buffer.from('not a zip'), '.pptx')
  assert.equal(result.status, 'error')
  assert.equal(result.chunks.length, 0)
  assert.ok(result.error)
})
