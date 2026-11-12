import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openStore } from '../lib/store.js'
import { createOutcomeResolver, queryOverlap } from '../lib/outcome.js'

function hits(count = 2) {
  return Array.from({ length: count }, (_unused, index) => ({
    chunkId: 100 + index,
    path: `D:/vault/deck-${index}.pptx`,
    locator: `slide ${index + 1}`,
  }))
}

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'file-recall-outcome-'))
  const store = openStore(join(dir, 'index.db'))
  return {
    store,
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

const WINDOW = 15 * 60 * 1000

test('a search is persisted with its hits and top page', () => {
  const { store, done } = makeStore()
  try {
    const resolver = createOutcomeResolver({ store, now: () => 1_000_000 })
    const recorded = resolver.observe({
      raw: '那个预算的方案',
      result: { hits: hits(3) },
      elapsedMs: 41,
      at: 1_000_000,
    })
    assert.ok(recorded.queryId)
    const row = store.getQuery(recorded.queryId)
    assert.equal(row.raw, '那个预算的方案')
    assert.equal(row.hits, 3)
    assert.equal(row.top_path, 'D:/vault/deck-0.pptx')
    assert.equal(row.top_chunk, 100)
    assert.equal(row.elapsed_ms, 41)
    assert.equal(row.outcome, null, 'a fresh search is unresolved')
  } finally {
    done()
  }
})

test('searching again about the same thing marks the previous recall wrong', () => {
  const { store, done } = makeStore()
  try {
    let clock = 1_000_000
    const resolver = createOutcomeResolver({ store, now: () => clock })
    const first = resolver.observe({ raw: '那个预算的方案', result: { hits: hits() }, at: clock })
    clock += 60_000
    const second = resolver.observe({ raw: '预算方案到底在哪', result: { hits: hits() }, at: clock })

    assert.equal(second.settlement.queryId, first.queryId)
    assert.equal(second.settlement.outcome, 'wrong')
    assert.equal(second.settlement.source, 'inferred')
    assert.match(second.settlement.reason, /restated/)
    assert.equal(store.getQuery(first.queryId).outcome, 'wrong')
    assert.equal(store.getQuery(second.queryId).outcome, null)
  } finally {
    done()
  }
})

test('moving on to a different need marks the previous recall as a hit', () => {
  const { store, done } = makeStore()
  try {
    let clock = 2_000_000
    const resolver = createOutcomeResolver({ store, now: () => clock })
    const first = resolver.observe({ raw: '关于文化相对主义的讲义', result: { hits: hits() }, at: clock })
    clock += 90_000
    const second = resolver.observe({ raw: '矩阵代数的作业在哪', result: { hits: hits() }, at: clock })

    assert.equal(second.settlement.outcome, 'hit')
    assert.match(second.settlement.reason, /another need/)
    assert.equal(store.getQuery(first.queryId).outcome, 'hit')
  } finally {
    done()
  }
})

test('a previous search that found nothing is never a hit', () => {
  const { store, done } = makeStore()
  try {
    let clock = 3_000_000
    const resolver = createOutcomeResolver({ store, now: () => clock })
    const first = resolver.observe({ raw: '完全无关的查询词', result: { hits: [] }, at: clock })
    clock += 30_000
    const second = resolver.observe({ raw: '矩阵代数的作业', result: { hits: hits() }, at: clock })

    assert.equal(second.settlement.outcome, 'wrong')
    assert.match(second.settlement.reason, /found nothing/)
    assert.equal(store.getQuery(first.queryId).outcome, 'wrong')
  } finally {
    done()
  }
})

test('silence leaves the recall unresolved, and an old search is not settled later', () => {
  const { store, done } = makeStore()
  try {
    let clock = 4_000_000
    const resolver = createOutcomeResolver({ store, now: () => clock })
    const first = resolver.observe({ raw: '那个预算的方案', result: { hits: hits() }, at: clock })

    // Nothing happens at all: the row stays unresolved rather than guessing.
    assert.equal(store.getQuery(first.queryId).outcome, null)

    // Two days later, searching something else says nothing about that recall.
    clock += 2 * 24 * 60 * 60 * 1000
    const later = resolver.observe({ raw: '矩阵代数的作业', result: { hits: hits() }, at: clock })
    assert.equal(later.settlement, null)
    assert.equal(store.getQuery(first.queryId).outcome, null)
    assert.equal(store.lastUnresolvedQuery({ sinceTs: clock - WINDOW }).id, later.queryId)
  } finally {
    done()
  }
})

test('an explicit verdict is recorded as stated and wins over inference', () => {
  const { store, done } = makeStore()
  try {
    const clock = 5_000_000
    const resolver = createOutcomeResolver({ store, now: () => clock })
    const first = resolver.observe({ raw: '那个预算的方案', result: { hits: hits() }, at: clock })
    const resolved = resolver.confirm({
      query: '那个预算的方案',
      verdict: 'hit',
      chunkId: 101,
      at: clock + 5_000,
    })
    assert.equal(resolved.id, first.queryId)
    assert.equal(resolved.outcome, 'hit')
    assert.equal(resolved.outcome_source, 'stated')
    assert.equal(resolved.chosen_chunk, 101)
    // Already resolved, so a later search must not settle it again.
    const second = resolver.observe({ raw: '那个预算的方案', result: { hits: hits() }, at: clock + 10_000 })
    assert.equal(second.settlement, null)
  } finally {
    done()
  }
})

test('outcome stats separate settled from pending and stated from inferred', () => {
  const { store, done } = makeStore()
  try {
    let clock = 6_000_000
    const resolver = createOutcomeResolver({ store, now: () => clock })
    resolver.observe({ raw: '甲 项目 图纸', result: { hits: hits() }, at: clock })
    clock += 10_000
    resolver.observe({ raw: '乙 报告 结论', result: { hits: hits() }, at: clock })
    clock += 10_000
    resolver.observe({ raw: '丙 合同 附件', result: { hits: hits() }, at: clock })
    resolver.confirm({ verdict: 'partial', at: clock + 1_000 })

    const stats = store.queryOutcomeStats()
    assert.equal(stats.total, 3)
    // 甲 was settled by 乙's arrival, 乙 by 丙's; 丙 is the one the user spoke about.
    assert.equal(stats.hit, 2)
    assert.equal(stats.pending, 0)
    assert.equal(stats.partial, 1)
    assert.equal(stats.inferred, 2)
    assert.equal(stats.stated, 1)
  } finally {
    done()
  }
})

test('query overlap uses containment, not set size', () => {
  assert.ok(queryOverlap('那个预算的方案', '预算方案 2023') > 0.4)
  assert.equal(queryOverlap('矩阵代数', '文化相对主义'), 0)
  assert.equal(queryOverlap('', 'anything'), 0)
})

test('history pruning keeps the newest rows (floor of 100 protects against a tiny keep)', () => {
  const { store, done } = makeStore()
  try {
    let clock = 7_000_000
    for (let index = 0; index < 140; index += 1) {
      store.recordQuery({ ts: clock, raw: `q${index}`, hits: 1 })
      clock += 1_000
    }
    // A keep below the floor is clamped to 100, so the table never collapses.
    assert.equal(store.pruneQueries(10), 40)
    assert.equal(store.listQueries(200).length, 100)
    assert.equal(store.pruneQueries(120), 0, 'already below the keep: no-op')
  } finally {
    done()
  }
})

test('observe never throws on a broken store', () => {
  const broken = {
    lastUnresolvedQuery() {
      throw new Error('db gone')
    },
    recordQuery() {
      throw new Error('db gone')
    },
  }
  const resolver = createOutcomeResolver({ store: broken })
  assert.doesNotThrow(() => resolver.observe({ raw: 'q', result: { hits: [] } }))
  assert.doesNotThrow(() => resolver.confirm({ verdict: 'hit' }))
})
