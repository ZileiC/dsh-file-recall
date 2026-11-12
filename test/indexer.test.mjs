import test from 'node:test'
import assert from 'node:assert/strict'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { openStore } from '../lib/store.js'
import { createIndexer, globToRegExp, DEFAULT_EXCLUDES } from '../lib/indexer.js'
import { queryToFts } from '../lib/tokenize.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name) => join(here, 'fixtures', name)

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'file-recall-indexer-'))
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true })
}

function writeTxt(dir, name, text) {
  writeFileSync(join(dir, name), text, 'utf8')
}

function statusCounts(store) {
  return Object.fromEntries(store.stats().byStatus.map((item) => [item.status, item.count]))
}

test('glob subset used by excludeGlobs', () => {
  assert.ok(globToRegExp('**/node_modules/**').test('node_modules'))
  assert.ok(globToRegExp('**/node_modules/**').test('a/node_modules/pkg/x.js'))
  assert.ok(!globToRegExp('**/node_modules/**').test('src/app.js'))
  assert.ok(globToRegExp('**/.DS_Store').test('a/b/.DS_Store'))
  assert.ok(globToRegExp('**/~$*').test('~$deck.pptx'))
  assert.equal(DEFAULT_EXCLUDES.length >= 3, true)
})

test('sync + build processes a corpus in bounded batches and isolates failures', async () => {
  const dir = tempDir()
  const store = openStore(':memory:')
  try {
    for (let index = 0; index < 25; index += 1) {
      writeTxt(
        dir,
        `doc-${String(index).padStart(2, '0')}.txt`,
        `文档编号${index}：部门预算的说明，包含绩效指标。`,
      )
    }
    writeFileSync(join(dir, 'broken.pptx'), 'definitely not a zip')

    const indexer = createIndexer({
      store,
      roots: [dir],
      maxFilesPerBatch: 7,
      batchMs: 60_000,
    })

    const syncResult = await indexer.sync()
    assert.equal(syncResult.added, 26)
    assert.equal(syncResult.errors.length, 0)

    const allErrors = []
    let processed = 0
    let failed = 0
    let rounds = 0
    let result
    do {
      result = await indexer.build({ maxFiles: 7 })
      processed += result.processed
      failed += result.failed
      allErrors.push(...result.errors)
      rounds += 1
    } while (!result.done && rounds < 20)

    assert.equal(processed, 25)
    assert.equal(failed, 1)
    assert.ok(rounds >= 4, `expected multiple batches, got ${rounds}`)
    assert.equal(result.done, true)
    assert.equal(result.remaining, 0)

    const stats = store.stats()
    assert.equal(stats.files, 26)
    assert.equal(stats.chunks, 25)
    const counts = statusCounts(store)
    assert.equal(counts.ok, 25)
    assert.equal(counts.error, 1)

    assert.ok(
      allErrors.some((error) => error.path.endsWith('broken.pptx')),
      'the broken file must be visible in build errors',
    )
  } finally {
    store.close()
    cleanup(dir)
  }
})

test('an interrupted build resumes from pending rows without duplicating work', async () => {
  const dir = tempDir()
  const store = openStore(':memory:')
  try {
    for (let index = 0; index < 25; index += 1) {
      writeTxt(dir, `note-${String(index).padStart(2, '0')}.txt`, `第${index}份资料：预算说明。`)
    }
    const indexer = createIndexer({ store, roots: [dir], batchMs: 60_000 })
    await indexer.sync()

    const first = await indexer.build({ maxFiles: 7 })
    assert.equal(first.done, false)
    assert.equal(first.processed, 7)
    assert.equal(first.remaining, 18)
    assert.equal(store.stats().chunks, 7)

    const second = await indexer.build({ maxFiles: 7 })
    assert.equal(second.processed, 7)
    assert.equal(store.stats().chunks, 14)

    let result
    do {
      result = await indexer.build({ maxFiles: 7 })
    } while (!result.done)
    assert.equal(result.remaining, 0)
    assert.equal(store.stats().chunks, 25)
  } finally {
    store.close()
    cleanup(dir)
  }
})

test('an already-aborted build does no work', async () => {
  const dir = tempDir()
  const store = openStore(':memory:')
  try {
    writeTxt(dir, 'a.txt', '预算说明')
    const indexer = createIndexer({ store, roots: [dir] })
    await indexer.sync()
    const controller = new AbortController()
    controller.abort()
    const result = await indexer.build({ signal: controller.signal })
    assert.equal(result.aborted, true)
    assert.equal(result.processed, 0)
    assert.equal(store.countByStatus('pending'), 1)
  } finally {
    store.close()
    cleanup(dir)
  }
})

test('sync detects modified files and rebuild replaces their chunks', async () => {
  const dir = tempDir()
  const store = openStore(':memory:')
  try {
    const filePath = join(dir, 'note.txt')
    writeTxt(dir, 'note.txt', '旧内容：阿尔法项目预算。')
    const indexer = createIndexer({ store, roots: [dir] })
    await indexer.sync()
    await indexer.build({ maxFiles: 10 })
    assert.equal(store.searchContent(queryToFts('阿尔法'), { limit: 5 }).length, 1)
    assert.equal(store.searchContent(queryToFts('贝塔'), { limit: 5 }).length, 0)

    writeTxt(dir, 'note.txt', '新内容：贝塔项目预算。')
    const future = new Date(Date.now() + 5_000)
    utimesSync(filePath, future, future)

    const syncResult = await indexer.sync()
    assert.equal(syncResult.changed, 1)
    assert.equal(syncResult.added, 0)
    assert.equal(syncResult.unchanged, 0)

    const buildResult = await indexer.build({ maxFiles: 10 })
    assert.equal(buildResult.done, true)
    assert.equal(store.searchContent(queryToFts('阿尔法'), { limit: 5 }).length, 0)
    assert.equal(store.searchContent(queryToFts('贝塔'), { limit: 5 }).length, 1)
    assert.equal(store.stats().chunks, 1)
  } finally {
    store.close()
    cleanup(dir)
  }
})

test('sync removes rows for files deleted from disk', async () => {
  const dir = tempDir()
  const store = openStore(':memory:')
  try {
    writeTxt(dir, 'keep.txt', '保留：预算说明')
    writeTxt(dir, 'remove.txt', '删除：绩效指标')
    const indexer = createIndexer({ store, roots: [dir] })
    await indexer.sync()
    await indexer.build({ maxFiles: 10 })
    assert.equal(store.stats().files, 2)

    unlinkSync(join(dir, 'remove.txt'))
    const syncResult = await indexer.sync()
    assert.equal(syncResult.deleted, 1)
    assert.equal(store.stats().files, 1)
    assert.equal(store.searchContent(queryToFts('绩效指标'), { limit: 5 }).length, 0)
  } finally {
    store.close()
    cleanup(dir)
  }
})

test('excludeGlobs keep directories out of the corpus', async () => {
  const dir = tempDir()
  const store = openStore(':memory:')
  try {
    writeTxt(dir, 'visible.txt', '可见资料：预算说明')
    mkdirSync(join(dir, 'node_modules'), { recursive: true })
    writeTxt(join(dir, 'node_modules'), 'hidden.txt', '隐藏资料：珊瑚礁')
    mkdirSync(join(dir, 'drafts'), { recursive: true })
    writeTxt(join(dir, 'drafts'), 'draft.txt', '草稿资料：伽马')

    const indexer = createIndexer({
      store,
      roots: [dir],
      excludeGlobs: ['**/drafts/**'],
    })
    const syncResult = await indexer.sync()
    assert.equal(syncResult.added, 1)
    assert.equal(store.stats().files, 1)
    assert.equal(store.searchContent(queryToFts('珊瑚礁'), { limit: 5 }).length, 0)
    assert.equal(store.searchContent(queryToFts('伽马'), { limit: 5 }).length, 0)
  } finally {
    store.close()
    cleanup(dir)
  }
})

test('legacy and oversized files are reported but not stored', async () => {
  const dir = tempDir()
  const store = openStore(':memory:')
  try {
    writeTxt(dir, 'good.txt', '预算说明')
    writeFileSync(join(dir, 'legacy.doc'), Buffer.from('legacy'))
    writeFileSync(join(dir, 'keynote.key'), Buffer.from('keynote'))
    writeFileSync(join(dir, 'big.txt'), Buffer.from('x'.repeat(200)))

    const indexer = createIndexer({ store, roots: [dir], maxFileBytes: 50 })
    const syncResult = await indexer.sync()
    assert.equal(syncResult.added, 1)
    assert.equal(syncResult.skippedUnsupported, 2)
    assert.equal(syncResult.skippedByExtension['.key'], 1)
    assert.equal(syncResult.skippedTooLarge, 1)
    assert.equal(store.stats().files, 1)
  } finally {
    store.close()
    cleanup(dir)
  }
})

test('images are OCRed during build and the OCR source is recorded', async () => {
  const dir = tempDir()
  const store = openStore(':memory:')
  const calls = []
  const ocr = {
    async recognize(input) {
      calls.push(input)
      return { text: '部门预算的说明', confidence: 88, source: 'tesseract' }
    },
  }
  try {
    copyFileSync(fixture('ocr-zh.png'), join(dir, 'scan.png'))
    const indexer = createIndexer({ store, roots: [dir], ocr })
    const syncResult = await indexer.sync()
    assert.equal(syncResult.added, 1)

    const buildResult = await indexer.build({ maxFiles: 10 })
    assert.equal(buildResult.done, true)
    assert.equal(calls.length, 1)
    assert.ok(calls[0].path.endsWith('scan.png'))

    const counts = statusCounts(store)
    assert.equal(counts.ocr_ok, 1)
    const chunks = store.searchContent(queryToFts('预算'), { limit: 5 })
    assert.equal(chunks.length, 1)
    assert.equal(chunks[0].kind, 'ocr')
    assert.equal(chunks[0].ocr_source, 'tesseract')
    assert.equal(chunks[0].ocr_confidence, 88)
  } finally {
    store.close()
    cleanup(dir)
  }
})

test('images without an OCR provider stay visibly scanned', async () => {
  const dir = tempDir()
  const store = openStore(':memory:')
  try {
    copyFileSync(fixture('ocr-zh.png'), join(dir, 'scan.png'))
    const indexer = createIndexer({ store, roots: [dir] })
    await indexer.sync()
    await indexer.build({ maxFiles: 10 })
    const file = store.getFile(join(dir, 'scan.png'))
    assert.equal(file.status, 'scanned')
    assert.match(file.error, /OCR disabled/)
  } finally {
    store.close()
    cleanup(dir)
  }
})

test('scanned PDFs are reported with an explicit reason instead of vanishing', async () => {
  const dir = tempDir()
  const store = openStore(':memory:')
  try {
    copyFileSync(fixture('pdf-blank.pdf'), join(dir, 'scan.pdf'))
    const indexer = createIndexer({ store, roots: [dir] })
    await indexer.sync()
    await indexer.build({ maxFiles: 10 })
    const file = store.getFile(join(dir, 'scan.pdf'))
    assert.equal(file.status, 'scanned')
    assert.match(file.error, /scanned PDF/)
    assert.equal(store.stats().chunks, 0)
  } finally {
    store.close()
    cleanup(dir)
  }
})

test('setRoots switches the scanned corpus for the next sync', async () => {
  const dirA = tempDir()
  const dirB = tempDir()
  const store = openStore(':memory:')
  try {
    writeTxt(dirA, 'a.txt', '阿尔法预算')
    const indexer = createIndexer({ store, roots: [dirA] })
    await indexer.sync()
    await indexer.build({ maxFiles: 10 })
    assert.equal(store.stats().files, 1)

    writeTxt(dirB, 'b.txt', '贝塔预算')
    const roots = indexer.setRoots([dirB])
    assert.deepEqual(roots, [resolve(dirB)])

    const syncResult = await indexer.sync()
    assert.equal(syncResult.added, 1)
    await indexer.build({ maxFiles: 10 })
    assert.equal(store.stats().files, 2)
    assert.equal(store.searchContent(queryToFts('贝塔'), { limit: 5 }).length, 1)
    assert.equal(store.searchContent(queryToFts('阿尔法'), { limit: 5 }).length, 1)
  } finally {
    store.close()
    cleanup(dirA)
    cleanup(dirB)
  }
})

test('scanned PDF pages are OCRed page by page when a provider exists', async () => {
  const dir = tempDir()
  const store = openStore(':memory:')
  const calls = []
  const ocr = {
    async recognize({ buffer }) {
      calls.push(buffer.length)
      return {
        text: `扫描页文本：部门预算的说明（第 ${calls.length} 页）`,
        confidence: 80,
        source: 'fake',
      }
    },
  }
  try {
    copyFileSync(fixture('pdf-scan.pdf'), join(dir, 'scan.pdf'))
    const indexer = createIndexer({ store, roots: [dir], ocr, ocrMaxPages: 2 })
    const syncResult = await indexer.sync()
    assert.equal(syncResult.added, 1)
    const buildResult = await indexer.build({ maxFiles: 10 })
    assert.equal(buildResult.done, true)

    const file = store.getFile(join(dir, 'scan.pdf'))
    assert.equal(file.status, 'ocr_ok')
    assert.equal(calls.length, 2)
    assert.equal(store.stats().chunks, 2)
    const hits = store.searchContent(queryToFts('预算'), { limit: 5 })
    assert.equal(hits.length, 2)
    assert.deepEqual(
      hits.map((hit) => hit.page).sort((a, b) => a - b),
      [1, 2],
    )
    assert.equal(hits[0].kind, 'ocr')
    assert.equal(hits[0].ocr_source, 'fake')
  } finally {
    store.close()
    cleanup(dir)
  }
})

test('mixed text+scan PDFs OCR only the scanned pages and keep text pages', async () => {
  const dir = tempDir()
  const store = openStore(':memory:')
  const calls = []
  const ocr = {
    async recognize({ buffer }) {
      calls.push(buffer.length)
      return { text: '第二页扫描内容：部门预算的说明', confidence: 82, source: 'fake' }
    },
  }
  try {
    copyFileSync(fixture('pdf-mixed-scan.pdf'), join(dir, 'mixed.pdf'))
    const indexer = createIndexer({ store, roots: [dir], ocr, ocrMaxPages: 2 })
    await indexer.sync()
    const buildResult = await indexer.build({ maxFiles: 10 })
    assert.equal(buildResult.done, true)

    const file = store.getFile(join(dir, 'mixed.pdf'))
    assert.equal(file.status, 'ok')
    assert.equal(file.error, null)
    assert.equal(calls.length, 1, 'only the scanned page should be OCRed')

    const chunks = store.searchContent(queryToFts('预算'), { limit: 5 })
    assert.equal(chunks.length, 1)
    assert.equal(chunks[0].page, 2)
    assert.equal(chunks[0].kind, 'ocr')
    assert.equal(store.stats().chunks, 2, 'text page + OCR page')

    const textPage = store.searchContent(queryToFts('Page one'), { limit: 5 })
    assert.equal(textPage.length, 1)
    assert.equal(textPage[0].page, 1)
  } finally {
    store.close()
    cleanup(dir)
  }
})

test('mixed PDFs without OCR stay searchable but expose the missing pages', async () => {
  const dir = tempDir()
  const store = openStore(':memory:')
  try {
    copyFileSync(fixture('pdf-mixed-scan.pdf'), join(dir, 'mixed.pdf'))
    const indexer = createIndexer({ store, roots: [dir] })
    await indexer.sync()
    await indexer.build({ maxFiles: 10 })
    const file = store.getFile(join(dir, 'mixed.pdf'))
    assert.equal(file.status, 'ok')
    assert.match(file.error, /scanned pages not OCRed: 2/)
    assert.equal(store.stats().chunks, 1)
  } finally {
    store.close()
    cleanup(dir)
  }
})

test('files with no extractable text are marked empty, not ok', async () => {
  const dir = tempDir()
  const store = openStore(':memory:')
  try {
    writeTxt(dir, 'empty.txt', '')
    const indexer = createIndexer({ store, roots: [dir] })
    await indexer.sync()
    await indexer.build({ maxFiles: 10 })
    const file = store.getFile(join(dir, 'empty.txt'))
    assert.equal(file.status, 'empty')
    assert.match(file.error, /no extractable text/)
    assert.equal(store.stats().chunks, 0)
  } finally {
    store.close()
    cleanup(dir)
  }
})

test('mixed PDF OCR failures are recorded instead of silently dropped', async () => {
  const dir = tempDir()
  const store = openStore(':memory:')
  const ocr = {
    async recognize() {
      throw new Error('vision unavailable')
    },
  }
  try {
    copyFileSync(fixture('pdf-mixed-scan.pdf'), join(dir, 'mixed.pdf'))
    const indexer = createIndexer({ store, roots: [dir], ocr, ocrMaxPages: 2 })
    await indexer.sync()
    await indexer.build({ maxFiles: 10 })
    const file = store.getFile(join(dir, 'mixed.pdf'))
    assert.equal(file.status, 'ok')
    assert.match(file.error, /OCR failed for pages: 2/)
    assert.equal(store.stats().chunks, 1)
  } finally {
    store.close()
    cleanup(dir)
  }
})

test('status() exposes coverage, pending work and last summaries', async () => {
  const dir = tempDir()
  const store = openStore(':memory:')
  try {
    writeTxt(dir, 'a.txt', '预算说明')
    const indexer = createIndexer({ store, roots: [dir] })
    await indexer.sync()
    const before = indexer.status()
    assert.equal(before.pending, 1)
    assert.equal(before.files, 1)
    assert.ok(before.lastSyncSummary)

    await indexer.build({ maxFiles: 10 })
    const after = indexer.status()
    assert.equal(after.pending, 0)
    assert.equal(after.chunks, 1)
    assert.ok(after.lastBuildSummary)
    assert.equal(after.lastBuildSummary.done, true)
  } finally {
    store.close()
    cleanup(dir)
  }
})
