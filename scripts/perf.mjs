/**
 * Performance smoke on a synthetic 1k-chunk corpus.
 *
 *   node scripts/perf.mjs
 *
 * Prints build time and query p50/p95. Numbers are for this machine only.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openStore } from '../lib/store.js'
import { createIndexer } from '../lib/indexer.js'
import { createSearchService } from '../lib/search.js'

const FILES = 200
const BLOCKS_PER_FILE = 5

function percentile(sorted, ratio) {
  if (sorted.length === 0) return null
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)
  return sorted[index]
}

const dir = mkdtempSync(join(tmpdir(), 'file-recall-perf-'))
const store = openStore(join(dir, 'index.db'))
const report = {}

try {
  for (let file = 0; file < FILES; file += 1) {
    const blocks = []
    for (let block = 0; block < BLOCKS_PER_FILE; block += 1) {
      blocks.push(
        `第${file + 1}份资料第${block + 1}段：这是用于性能测试的中文正文，` +
          '包含预算说明、绩效指标、年度方案与客户诉求等常见词，' +
          '长度控制在分块阈值以内。',
      )
    }
    writeFileSync(join(dir, `doc-${String(file).padStart(3, '0')}.txt`), blocks.join('\n\n'), 'utf8')
  }

  const indexer = createIndexer({
    store,
    roots: [dir],
    batchMs: 120_000,
    maxFilesPerBatch: 100,
  })
  const search = createSearchService({ store })

  const syncStarted = Date.now()
  const sync = await indexer.sync()
  const syncMs = Date.now() - syncStarted

  const buildStarted = Date.now()
  let build
  let rounds = 0
  do {
    build = await indexer.build({ maxFiles: 100, budgetMs: 120_000 })
    rounds += 1
  } while (!build.done && rounds < 50)
  const buildMs = Date.now() - buildStarted

  const stats = store.stats()
  const queries = ['预算说明', '绩效指标', '2023 年度方案', '客户诉求', '第120段']
  for (let index = 0; index < 10; index += 1) {
    await search.search({ query: queries[index % queries.length], topK: 8 })
  }

  const durations = []
  for (let index = 0; index < 100; index += 1) {
    const started = process.hrtime.bigint()
    await search.search({ query: queries[index % queries.length], topK: 8 })
    durations.push(Number(process.hrtime.bigint() - started) / 1e6)
  }
  const sorted = [...durations].sort((a, b) => a - b)

  report.corpus = {
    files: stats.files,
    chunks: stats.chunks,
    syncMs,
    buildMs,
    buildRounds: rounds,
    done: build.done,
  }
  report.queries = {
    samples: durations.length,
    p50Ms: Number(percentile(sorted, 0.5).toFixed(2)),
    p95Ms: Number(percentile(sorted, 0.95).toFixed(2)),
    maxMs: Number(sorted[sorted.length - 1].toFixed(2)),
  }
  report.notes = 'Synthetic Chinese text; single Windows machine; search is lexical (no LLM expansion).'

  console.log(JSON.stringify(report, null, 2))
} finally {
  store.close()
  rmSync(dir, { recursive: true, force: true })
}
