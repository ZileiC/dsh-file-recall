/**
 * End-to-end smoke: real fixtures -> sync -> batched build -> 5 gold queries
 * -> evidence -> empty-state check. Prints a JSON report and exits non-zero on
 * a failed assertion.
 *
 *   node scripts/e2e.mjs
 */

import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { openStore } from '../lib/store.js'
import { createIndexer } from '../lib/indexer.js'
import { createSearchService } from '../lib/search.js'
import { createLearningService } from '../lib/learning.js'
import { createToolDefinitions } from '../lib/tools.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, '..', 'test', 'fixtures')

const FILES = [
  'deck-basic.pptx',
  'deck-order.pptx',
  'deck-notes-only.pptx',
  'doc-headings.docx',
  'doc-long.docx',
  'doc-mixed.docx',
  'pdf-text.pdf',
  'pdf-mixed.pdf',
  'pdf-scan.pdf',
  'sheet-formulas.xlsx',
  'sheet-multi.xlsx',
  'sheet-wide.xlsx',
  'note-utf8.txt',
  'note-gbk.txt',
  'note-bom.txt',
  'readme.md',
  'ocr-zh.png',
]

const QUERIES = [
  {
    query: '还记得那个 2023 年的部门预算的说明吗，成本同比下降 3%',
    gold: { file: 'deck-basic.pptx', page: 2 },
    note: 'filler words, a vague year, plus one detail unique to the remembered page',
  },
  {
    query: '蓝色架构图',
    gold: { file: 'deck-basic.pptx', page: 2, kind: 'notes' },
    note: 'the remembered detail only lives in speaker notes',
  },
  {
    query: 'Performance indicators',
    gold: { file: 'pdf-text.pdf', page: 2, kind: 'page' },
    note: 'latin text in a PDF page',
  },
  {
    query: '第二张幻灯片',
    gold: { file: 'deck-order.pptx', page: 2 },
    note: 'slide order',
  },
  {
    query: '第120行',
    gold: { file: 'sheet-wide.xlsx', block: 101, kind: 'sheet' },
    note: 'spreadsheet row block locator',
  },
  {
    query: '扫描件里的部门预算',
    gold: { file: 'pdf-scan.pdf', page: 1, kind: 'ocr' },
    note: 'scanned PDF page rasterized then OCRed',
  },
]

function matchesGold(hit, gold) {
  if (!hit.path.endsWith(gold.file)) return false
  if (gold.page != null && hit.page !== gold.page) return false
  if (gold.block != null && hit.block !== gold.block) return false
  if (gold.kind != null && hit.kind !== gold.kind) return false
  return true
}

const dir = mkdtempSync(join(tmpdir(), 'file-recall-e2e-'))
const store = openStore(join(dir, 'index.db'))
const report = { corpus: {}, queries: [], emptyState: null, evidence: null }

try {
  for (const name of FILES) copyFileSync(join(fixtures, name), join(dir, name))

  const ocr = {
    async recognize() {
      return { text: '部门预算的说明（OCR 示例）', confidence: 90, source: 'fake' }
    },
  }
  const indexer = createIndexer({
    store,
    roots: [dir],
    ocr,
    batchMs: 30_000,
    maxFilesPerBatch: 100,
  })
  const search = createSearchService({ store, learning: createLearningService({ store }) })
  const tools = createToolDefinitions({ store, search, indexer })

  const sync = await indexer.sync()
  const buildStarted = Date.now()
  let build
  let rounds = 0
  do {
    build = await indexer.build({ maxFiles: 100, budgetMs: 30_000 })
    rounds += 1
  } while (!build.done && rounds < 20)
  const buildMs = Date.now() - buildStarted
  assert.equal(build.done, true, 'index build did not finish')

  const stats = store.stats()
  assert.ok(stats.chunks >= 20, `expected >= 20 chunks, got ${stats.chunks}`)
  report.corpus = {
    files: stats.files,
    chunks: stats.chunks,
    sync,
    buildRounds: rounds,
    buildMs,
    byStatus: stats.byStatus,
  }

  for (const item of QUERIES) {
    const result = await search.search({ query: item.query, topK: 5 })
    const hit = result.hits.find((candidate) => matchesGold(candidate, item.gold))
    assert.ok(
      hit,
      `query failed: ${item.query}\n` +
        `gold=${JSON.stringify(item.gold)}\n` +
        `hits=${JSON.stringify(result.hits, null, 2)}`,
    )
    report.queries.push({
      query: item.query,
      note: item.note,
      gold: item.gold,
      hit: {
        path: hit.path,
        kind: hit.kind,
        page: hit.page,
        block: hit.block,
        matchType: hit.matchType,
        snippet: hit.snippet,
      },
      relaxed: result.relaxed,
      degraded: result.degraded,
      elapsedMs: result.elapsedMs,
    })
  }

  const empty = await search.search({ query: 'zzzqqqxxx' })
  assert.equal(empty.hits.length, 0, 'empty state must not fabricate hits')
  report.emptyState = { hits: empty.hits.length, reason: empty.reason ?? null }

  const evidenceTool = tools.find((tool) => tool.name === 'file_recall_evidence')
  const first = report.queries[0]
  const searchResult = await search.search({ query: QUERIES[0].query, topK: 5 })
  const candidate = searchResult.hits.find((hit) => matchesGold(hit, QUERIES[0].gold))
  const evidence = await evidenceTool.execute({ chunkId: candidate.chunkId }, {})
  assert.equal(evidence.path, candidate.path)
  assert.equal(evidence.page, QUERIES[0].gold.page)
  report.evidence = {
    chunkId: evidence.chunkId,
    path: evidence.path,
    locator: evidence.locator,
    page: evidence.page,
    quote: evidence.text.slice(0, 80),
    neighbors: evidence.neighbors.length,
  }

  console.log(JSON.stringify(report, null, 2))
} finally {
  store.close()
  rmSync(dir, { recursive: true, force: true })
}
