import test from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { openStore } from '../lib/store.js'
import { createIndexer } from '../lib/indexer.js'
import { createOnDemandOcr } from '../lib/ocr/ondemand.js'
import { normalizeOcrConfig } from '../lib/ocr/config.js'
import { createToolDefinitions } from '../lib/tools.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name) => join(here, 'fixtures', name)

/** A provider that never touches tesseract: the contract is what is tested. */
function fakeProvider(text = '识别出来的部门预算说明') {
  const calls = []
  return {
    calls,
    async recognize(input) {
      calls.push(input)
      return { text, confidence: 77, source: 'fake' }
    },
  }
}

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'file-recall-lazy-ocr-'))
  const store = openStore(join(dir, 'index.db'))
  return {
    store,
    dir,
    done() {
      try {
        store.close()
      } catch {
        /* already closed */
      }
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

test('ocr.mode defaults to lazy, and enabled:false still means off', () => {
  assert.equal(normalizeOcrConfig({}).mode, 'lazy')
  assert.equal(normalizeOcrConfig({}).enabled, true)
  assert.equal(normalizeOcrConfig({ enabled: false }).mode, 'off')
  assert.equal(normalizeOcrConfig({ enabled: false }).enabled, false)
  assert.equal(normalizeOcrConfig({ mode: 'eager' }).mode, 'eager')
  assert.equal(normalizeOcrConfig({ mode: 'off' }).enabled, false)
  assert.throws(() => normalizeOcrConfig({ mode: 'sometimes' }))
})

test('a lazy build queues scanned pages without touching the provider', async () => {
  const { store, dir, done } = makeStore()
  try {
    copyFileSync(fixture('pdf-scan.pdf'), join(dir, 'scan.pdf'))
    const provider = fakeProvider()
    const indexer = createIndexer({ store, roots: [dir], ocr: provider })
    await indexer.sync()
    await indexer.build({ maxFiles: 10 })

    assert.equal(provider.calls.length, 0, 'lazy build must not recognise anything')
    assert.equal(store.stats().chunks, 0)
    const pending = store.pendingOcrPages({ limit: 10 })
    assert.deepEqual(pending.map((row) => row.page).sort(), [1, 2])
    assert.equal(store.getFile(join(dir, 'scan.pdf')).status, 'scanned')
  } finally {
    done()
  }
})

test('ensurePage recognises one page, stores it, and is idempotent', async () => {
  const { store, dir, done } = makeStore()
  try {
    copyFileSync(fixture('pdf-scan.pdf'), join(dir, 'scan.pdf'))
    const provider = fakeProvider('第一页的识别文本')
    const indexer = createIndexer({ store, roots: [dir], ocr: provider })
    await indexer.sync()
    await indexer.build({ maxFiles: 10 })

    const onDemand = createOnDemandOcr({ store, ocr: provider })
    const first = await onDemand.ensurePage(join(dir, 'scan.pdf'), 1)
    assert.equal(first.status, 'done')
    assert.equal(first.recognized, true)
    assert.equal(provider.calls.length, 1, 'only the requested page is recognised')

    const chunk = store.getChunkByPage(join(dir, 'scan.pdf'), 1)
    assert.ok(chunk, 'page text was not stored')
    assert.equal(chunk.kind, 'ocr')
    assert.match(chunk.text, /第一页的识别文本/)
    assert.equal(chunk.ocr_source, 'fake')
    assert.equal(chunk.ocr_confidence, 77)
    assert.equal(store.getOcrPage(join(dir, 'scan.pdf'), 1).status, 'done')
    assert.equal(store.getFile(join(dir, 'scan.pdf')).status, 'ocr_ok')

    // Second read: no provider call, no duplicate chunk.
    const second = await onDemand.ensurePage(join(dir, 'scan.pdf'), 1)
    assert.equal(second.recognized, false)
    assert.equal(provider.calls.length, 1)
    assert.equal(store.chunkCountByPath().find((row) => row.path.endsWith('scan.pdf')).n, 1)
  } finally {
    done()
  }
})

test('page 2 is recognised independently and does not wipe page 1', async () => {
  const { store, dir, done } = makeStore()
  try {
    copyFileSync(fixture('pdf-scan.pdf'), join(dir, 'scan.pdf'))
    const provider = fakeProvider('页面文本')
    const indexer = createIndexer({ store, roots: [dir], ocr: provider })
    await indexer.sync()
    await indexer.build({ maxFiles: 10 })

    const onDemand = createOnDemandOcr({ store, ocr: provider })
    await onDemand.ensurePage(join(dir, 'scan.pdf'), 1)
    await onDemand.ensurePage(join(dir, 'scan.pdf'), 2)
    const rows = store.chunkCountByPath().find((row) => row.path.endsWith('scan.pdf'))
    assert.equal(rows.n, 2, 'reading page 2 must keep page 1')
    assert.equal(store.ocrPageStats().pending, 0)
    assert.equal(store.ocrPageStats().done, 2)
  } finally {
    done()
  }
})

test('warm() works through pending pages within a budget and reports what is left', async () => {
  const { store, dir, done } = makeStore()
  try {
    copyFileSync(fixture('pdf-scan.pdf'), join(dir, 'scan.pdf'))
    const provider = fakeProvider('预热文本')
    const indexer = createIndexer({ store, roots: [dir], ocr: provider })
    await indexer.sync()
    await indexer.build({ maxFiles: 10 })

    const onDemand = createOnDemandOcr({ store, ocr: provider })
    const first = await onDemand.warm({ limit: 1 })
    assert.equal(first.processed, 1)
    assert.equal(first.remaining, 1)
    assert.equal(provider.calls.length, 1)

    const second = await onDemand.warm({ limit: 5 })
    assert.equal(second.processed, 1)
    assert.equal(second.remaining, 0)
    assert.equal(store.ocrPageStats().done, 2)

    const idle = await onDemand.warm({ limit: 5 })
    assert.equal(idle.processed, 0)
  } finally {
    done()
  }
})

test('a page with no embedded image is reported, not retried forever as pending', async () => {
  const { store, dir, done } = makeStore()
  try {
    copyFileSync(fixture('pdf-scan.pdf'), join(dir, 'scan.pdf'))
    const provider = fakeProvider('x')
    const indexer = createIndexer({ store, roots: [dir], ocr: provider })
    await indexer.sync()
    await indexer.build({ maxFiles: 10 })

    const onDemand = createOnDemandOcr({ store, ocr: provider })
    // Page 99 does not exist in a two-page document.
    const result = await onDemand.ensurePage(join(dir, 'scan.pdf'), 99)
    assert.equal(result.status, 'missing')
    const row = store.getOcrPage(join(dir, 'scan.pdf'), 99)
    assert.equal(row.status, 'failed')
    assert.match(row.error, /no embedded page image/)
    // Failed pages are not pending, so a warm-up loop cannot spin on them.
    assert.equal(store.ocrPageStats().pending, 2)
  } finally {
    done()
  }
})

test('the provider failing is recorded per page instead of throwing', async () => {
  const { store, dir, done } = makeStore()
  try {
    copyFileSync(fixture('pdf-scan.pdf'), join(dir, 'scan.pdf'))
    const provider = {
      async recognize() {
        throw new Error('worker crashed')
      },
    }
    const indexer = createIndexer({ store, roots: [dir], ocr: provider })
    await indexer.sync()
    await indexer.build({ maxFiles: 10 })

    const onDemand = createOnDemandOcr({ store, ocr: provider })
    const result = await onDemand.ensurePage(join(dir, 'scan.pdf'), 1)
    assert.equal(result.status, 'failed')
    assert.equal(store.getOcrPage(join(dir, 'scan.pdf'), 1).status, 'failed')
    assert.equal(store.stats().chunks, 0)
  } finally {
    done()
  }
})

test('the evidence tool reads a queued scanned page by path and page', async () => {
  const { store, dir, done } = makeStore()
  try {
    copyFileSync(fixture('pdf-scan.pdf'), join(dir, 'scan.pdf'))
    const provider = fakeProvider('这一页写着部门预算的说明')
    const indexer = createIndexer({ store, roots: [dir], ocr: provider })
    await indexer.sync()
    await indexer.build({ maxFiles: 10 })
    const onDemand = createOnDemandOcr({ store, ocr: provider })

    const tools = createToolDefinitions({
      store,
      search: { search: async () => ({ hits: [] }) },
      onDemandOcr: onDemand,
    })
    const evidence = tools.find((tool) => tool.name === 'file_recall_evidence')

    // No chunk exists yet: the tool must recognise the page and return its text.
    const result = await evidence.execute({ path: join(dir, 'scan.pdf'), page: 1 }, {})
    assert.equal(result.locator, 'page 1')
    assert.equal(result.recognized, true)
    assert.match(result.text, /部门预算的说明/)
    assert.equal(result.ocrSource, 'fake')

    // Reading it again serves the stored text without another provider call.
    const again = await evidence.execute({ path: join(dir, 'scan.pdf'), page: 1 }, {})
    assert.match(again.text, /部门预算的说明/)
    assert.equal(provider.calls.length, 1)

    // A page with no image returns an explanation instead of throwing.
    const missing = await evidence.execute({ path: join(dir, 'scan.pdf'), page: 42 }, {})
    assert.equal(missing.ocrStatus, 'missing')
    assert.equal(missing.text, '')

    // Neither a chunkId nor a path/page is a usage error.
    await assert.rejects(() => evidence.execute({}, {}), /needs a chunkId/)
  } finally {
    done()
  }
})

test('the index tool exposes a bounded warm-up action', async () => {
  const { store, dir, done } = makeStore()
  try {
    copyFileSync(fixture('pdf-scan.pdf'), join(dir, 'scan.pdf'))
    const provider = fakeProvider('预热')
    const indexer = createIndexer({ store, roots: [dir], ocr: provider })
    await indexer.sync()
    await indexer.build({ maxFiles: 10 })
    const onDemand = createOnDemandOcr({ store, ocr: provider })

    const tools = createToolDefinitions({ store, search: { search: async () => ({ hits: [] }) }, indexer, onDemandOcr: onDemand })
    const indexTool = tools.find((tool) => tool.name === 'file_recall_index')
    const result = await indexTool.execute({ action: 'ocr', maxFiles: 1 }, {})
    assert.equal(result.processed, 1)
    assert.equal(result.remaining, 1)
  } finally {
    done()
  }
})

test('retry requeues legacy scanned files that have no OCR queue entry', async () => {
  const { store, dir, done } = makeStore()
  try {
    copyFileSync(fixture('pdf-scan.pdf'), join(dir, 'scan.pdf'))
    const provider = fakeProvider('x')
    const indexer = createIndexer({ store, roots: [dir], ocr: provider })
    await indexer.sync()
    await indexer.build({ maxFiles: 10 })
    const path = join(dir, 'scan.pdf')

    // Simulate a library built before lazy OCR: scanned, but no queue rows.
    store.setOcrPage({ path, page: 1, status: 'pending' })
    store.setOcrPage({ path, page: 2, status: 'pending' })
    store.db.exec('DELETE FROM ocr_pages')
    store.setFileStatus(path, 'scanned', 'scanned PDF: pre-lazy build')

    assert.equal(store.retryErrors(), 1, 'the legacy scanned file should be requeued')
    assert.equal(store.getFile(path).status, 'pending')

    // A file that already has queue rows is NOT requeued again.
    await indexer.build({ maxFiles: 10 })
    assert.ok(store.pendingOcrPages({ limit: 5 }).length > 0)
    assert.equal(store.retryErrors(), 0)
  } finally {
    done()
  }
})

test('an image file is recognised as its single page', async () => {
  const { store, dir, done } = makeStore()
  try {
    copyFileSync(fixture('ocr-zh.png'), join(dir, 'scan.png'))
    const provider = fakeProvider('图片里的文字')
    const indexer = createIndexer({ store, roots: [dir], ocr: provider })
    await indexer.sync()
    await indexer.build({ maxFiles: 10 })
    assert.equal(store.stats().chunks, 0)

    const onDemand = createOnDemandOcr({ store, ocr: provider })
    const result = await onDemand.ensurePage(join(dir, 'scan.png'), 1)
    assert.equal(result.status, 'done')
    const chunk = store.getChunkByPage(join(dir, 'scan.png'), 1)
    assert.equal(chunk.kind, 'ocr')
    assert.match(chunk.text, /图片里的文字/)
  } finally {
    done()
  }
})
