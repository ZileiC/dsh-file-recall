/**
 * Page-level recall evaluation on a synthetic ToT-style set.
 *
 *   node scripts/eval.mjs
 *
 * The set is synthetic (120 slides, 60 queries with a unique remembered
 * phrase, vague year and filler words). It is a baseline, not the father's
 * real corpus.
 */

import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { openStore } from '../lib/store.js'
import { createIndexer } from '../lib/indexer.js'
import { createSearchService } from '../lib/search.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, '..', 'test', 'fixtures')
const corpus = join(fixtures, 'eval-corpus')
const queryFile = join(fixtures, 'eval-queries.json')

function hitGold(hit, gold) {
  return hit.path.endsWith(gold.file) && hit.page === gold.page
}

const dir = await mkdtemp(join(tmpdir(), 'file-recall-eval-'))
const store = openStore(join(dir, 'index.db'))
try {
  await cp(corpus, join(dir, 'corpus'), { recursive: true })
  const queries = JSON.parse(await readFile(queryFile, 'utf8'))
  assert.ok(queries.length >= 60, `expected >= 60 queries, got ${queries.length}`)

  const indexer = createIndexer({
    store,
    roots: [join(dir, 'corpus')],
    batchMs: 120_000,
    maxFilesPerBatch: 100,
  })
  await indexer.sync()
  let build
  let rounds = 0
  do {
    build = await indexer.build({ maxFiles: 100, budgetMs: 120_000 })
    rounds += 1
  } while (!build.done && rounds < 20)
  assert.equal(build.done, true)

  const search = createSearchService({ store })
  let top1 = 0
  let top5 = 0
  let reciprocalRank = 0
  const misses = []
  const started = Date.now()

  for (const item of queries) {
    const result = await search.search({ query: item.query, topK: 5 })
    const rank = result.hits.findIndex((hit) => hitGold(hit, item.gold))
    if (rank === 0) top1 += 1
    if (rank >= 0) {
      top5 += 1
      reciprocalRank += 1 / (rank + 1)
    } else {
      misses.push({ query: item.query, gold: item.gold, hits: result.hits.map((hit) => `${hit.path}#${hit.page}`) })
    }
  }

  const total = queries.length
  const report = {
    corpus: { ...store.stats(), buildRounds: rounds },
    queries: total,
    top1: Number((top1 / total).toFixed(4)),
    top5: Number((top5 / total).toFixed(4)),
    mrr: Number((reciprocalRank / total).toFixed(4)),
    misses: misses.slice(0, 10),
    elapsedMs: Date.now() - started,
    note: 'Synthetic ToT baseline (unique remembered phrases); not real corpus.',
  }
  console.log(JSON.stringify(report, null, 2))
  assert.ok(report.top5 >= 0.7, `top-5 ${report.top5} below PRD gate 0.70`)
} finally {
  store.close()
  await rm(dir, { recursive: true, force: true })
}
