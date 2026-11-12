import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openStore } from '../lib/store.js'
import {
  createSearchService,
  extractQueryHints,
  normalizeQuery,
  rrfFuse,
} from '../lib/search.js'
import { createLlmExpander, parseExpansion } from '../lib/expander.js'
import { createToolDefinitions } from '../lib/tools.js'
import { createIndexer } from '../lib/indexer.js'

const DAY = 86_400_000

function addFile(store, path, mtime, chunks) {
  store.upsertFile({ path, size: 1, mtime, status: 'ok' })
  store.replaceChunks(path, chunks, { status: 'ok' })
}

function seededStore() {
  const store = openStore(':memory:')
  addFile(store, '资料/2023预算说明.pptx', Date.UTC(2023, 5, 1), [
    { kind: 'slide', page: 1, text: '项目背景与目标' },
    { kind: 'slide', page: 2, text: '市场环境与竞争格局' },
    { kind: 'slide', page: 3, text: '部门预算的说明，包含绩效指标。' },
    { kind: 'notes', page: 3, text: '讲解词：重点看这一页的蓝色架构图。' },
  ])
  addFile(store, '资料/2020绩效报告.pdf', Date.UTC(2020, 2, 1), [
    { kind: 'page', page: 1, text: '2020 年度绩效指标与完成情况' },
    { kind: 'page', page: 2, text: '附录：预算明细' },
  ])
  addFile(store, '资料/2024报价方案.pptx', Date.UTC(2024, 0, 1), [
    { kind: 'slide', page: 1, text: '与查询词无关的封面' },
  ])
  addFile(store, '资料/生物笔记.txt', Date.UTC(2019, 8, 1), [
    { kind: 'block', block: 1, text: '龙虾与珊瑚礁生态观察记录。' },
  ])
  addFile(store, '资料/归档/2019年度总结.txt', Date.UTC(2019, 11, 1), [
    { kind: 'block', block: 1, text: '2019 年度总结：预算执行情况。' },
  ])
  addFile(store, '资料/归档/2020年度总结.txt', Date.UTC(2020, 11, 1), [
    { kind: 'block', block: 1, text: '2020 年度总结：预算执行情况。' },
  ])
  return store
}

test('normalizeQuery strips filler phrases but keeps names and years', () => {
  const normalized = normalizeQuery('还记得那个 2019 年的方案吗')
  assert.ok(!normalized.includes('那个'))
  assert.ok(!normalized.includes('还记得'))
  assert.ok(normalized.includes('2019'))
  assert.ok(normalized.includes('方案'))
})

test('extractQueryHints detects years, document types and quoted names', () => {
  const hints = extractQueryHints('PDF 里「珊瑚礁修复」那个 2020 年的绩效报告')
  assert.deepEqual(hints.years, [2020])
  assert.ok(hints.kinds.includes('page'))
  assert.ok(hints.kinds.includes('ocr'))
  assert.deepEqual(hints.quoted, ['珊瑚礁修复'])
})

test('content and path arms fuse: a hit matched by both scores highest', async () => {
  const store = seededStore()
  const service = createSearchService({ store })
  try {
    const result = await service.search({ query: '预算' })
    assert.equal(result.degraded, true)
    assert.match(result.degradedReason, /expander/)
    assert.ok(result.hits.length >= 2)
    assert.ok(result.arms.content > 0)
    assert.ok(result.arms.path > 0)

    const pageThree = result.hits.find(
      (hit) => hit.path.includes('2023预算说明') && hit.page === 3,
    )
    assert.ok(pageThree, 'the slide with the remembered page should be returned')
    assert.match(pageThree.snippet, /预算/)
    assert.equal(pageThree.matchType, 'content+path')
  } finally {
    store.close()
  }
})

test('a filename-only match is returned through the path arm', async () => {
  const store = seededStore()
  const service = createSearchService({ store })
  try {
    const result = await service.search({ query: '报价方案' })
    const hit = result.hits.find((item) => item.path.includes('报价方案'))
    assert.ok(hit)
    assert.equal(hit.matchType, 'path')
    assert.equal(hit.page, 1)
  } finally {
    store.close()
  }
})

test('RRF ranks a chunk matched by both arms above a single-arm chunk', () => {
  const fused = rrfFuse([
    [
      { chunkId: 1, path: 'a', mtime: 1, arm: 'content' },
      { chunkId: 3, path: 'c', mtime: 1, arm: 'content' },
    ],
    [
      { chunkId: 1, path: 'a', mtime: 1, arm: 'path' },
      { chunkId: 2, path: 'b', mtime: 1, arm: 'path' },
    ],
  ])
  assert.equal(fused[0].chunkId, 1)
  assert.equal(fused[0].matchType, 'content+path')
  assert.ok(fused[0].score > fused[1].score)
})

test('document type words auto-apply a kind filter', async () => {
  const store = seededStore()
  const service = createSearchService({ store })
  try {
    const result = await service.search({ query: 'PDF 里的绩效' })
    assert.ok(result.hits.length > 0)
    assert.ok(
      result.hits.every((hit) => hit.path.toLowerCase().endsWith('.pdf')),
      `unexpected paths: ${result.hits.map((hit) => hit.path).join(', ')}`,
    )
  } finally {
    store.close()
  }
})

test('explicit kinds and year filters narrow the result set', async () => {
  const store = seededStore()
  const service = createSearchService({ store })
  try {
    const pages = await service.search({ query: '绩效', filters: { kinds: ['page'] } })
    assert.ok(pages.hits.length > 0)
    assert.ok(pages.hits.every((hit) => hit.kind === 'page'))

    const year2019 = await service.search({ query: '年度总结', filters: { years: [2019] } })
    assert.ok(year2019.hits.length > 0)
    assert.ok(year2019.hits.every((hit) => hit.path.includes('2019年度总结')))

    const oldOnly = await service.search({
      query: '绩效',
      filters: { mtimeTo: Date.UTC(2021, 0, 1) },
    })
    assert.ok(oldOnly.hits.every((hit) => hit.mtime <= Date.UTC(2021, 0, 1)))
  } finally {
    store.close()
  }
})

test('strict query with no hits relaxes to OR and says so', async () => {
  const store = seededStore()
  const service = createSearchService({ store })
  try {
    const result = await service.search({ query: '预算说明' })
    assert.equal(result.relaxed, true)
    assert.ok(
      result.hits.some((hit) => hit.path.includes('2023预算说明') && hit.page === 3),
      'relaxed OR should still surface the remembered slide',
    )
  } finally {
    store.close()
  }
})

test('a successful expansion adds terms and clears the degraded flag', async () => {
  const store = seededStore()
  let calls = 0
  const service = createSearchService({
    store,
    expander: async ({ query }) => {
      calls += 1
      assert.equal(query, '甲壳类')
      return { terms: ['龙虾'], synonyms: ['甲壳动物'] }
    },
  })
  try {
    const result = await service.search({ query: '甲壳类' })
    assert.equal(result.degraded, false)
    assert.ok(result.expandedTerms.includes('龙虾'))
    assert.ok(result.hits.some((hit) => hit.path.includes('生物笔记')))

    await service.search({ query: '甲壳类' })
    assert.equal(calls, 1, 'expansion should be cached per normalized query')
  } finally {
    store.close()
  }
})

test('a slow expander degrades to lexical instead of blocking search', async () => {
  const store = seededStore()
  const service = createSearchService({
    store,
    expander: () => new Promise(() => {}),
    expandTimeoutMs: 20,
  })
  try {
    const started = Date.now()
    const result = await service.search({ query: '预算' })
    assert.equal(result.degraded, true)
    assert.match(result.degradedReason, /timeout/)
    assert.ok(Date.now() - started < 1000)
  } finally {
    store.close()
  }
})

test('a throwing expander also degrades to lexical', async () => {
  const store = seededStore()
  const service = createSearchService({
    store,
    expander: async () => {
      throw new Error('model unavailable')
    },
  })
  try {
    const result = await service.search({ query: '预算' })
    assert.equal(result.degraded, true)
    assert.match(result.degradedReason, /model unavailable/)
    assert.ok(result.hits.length > 0)
  } finally {
    store.close()
  }
})

test('empty query returns an explicit empty result', async () => {
  const store = seededStore()
  const service = createSearchService({ store })
  try {
    const result = await service.search({ query: '   ，。 ' })
    assert.equal(result.hits.length, 0)
    assert.equal(result.reason, 'empty query')
  } finally {
    store.close()
  }
})

test('evidence returns the indexed chunk with a recomputable locator', async () => {
  const store = seededStore()
  const service = createSearchService({ store })
  const tools = createToolDefinitions({ store, search: service })
  const searchTool = tools.find((tool) => tool.name === 'file_recall_search')
  const evidenceTool = tools.find((tool) => tool.name === 'file_recall_evidence')
  try {
    const searchResult = await searchTool.execute({ query: '绩效指标' }, {})
    const hit = searchResult.hits.find(
      (item) => item.path.includes('2023预算说明') && item.page === 3,
    )
    assert.ok(hit)

    const evidence = await evidenceTool.execute({ chunkId: hit.chunkId }, {})
    const row = store.getChunk(hit.chunkId)
    assert.equal(evidence.path, row.path)
    assert.equal(evidence.page, row.page)
    assert.equal(evidence.block, row.block)
    assert.equal(evidence.locator, 'page 3')
    assert.match(evidence.text, /部门预算的说明/)
    assert.ok(evidence.neighbors.length > 0)
    assert.ok(evidence.neighbors.every((neighbor) => neighbor.chunkId !== evidence.chunkId))

    await assert.rejects(() => evidenceTool.execute({ chunkId: 999999 }, {}), /not found/)
  } finally {
    store.close()
  }
})

test('index tool definitions drive sync/build/status', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'file-recall-search-'))
  const store = openStore(':memory:')
  const service = createSearchService({ store })
  const indexer = createIndexer({ store, roots: [dir] })
  const tool = createToolDefinitions({ store, search: service, indexer }).find(
    (item) => item.name === 'file_recall_index',
  )
  try {
    writeFileSync(join(dir, 'a.txt'), '预算说明', 'utf8')
    const sync = await tool.execute({ action: 'sync' }, {})
    assert.equal(sync.added, 1)

    const built = await tool.execute({ action: 'build' }, {})
    assert.equal(built.done, true)

    const status = await tool.execute({ action: 'status' }, {})
    assert.equal(status.files, 1)
    assert.equal(status.pending, 0)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('LLM expander parses streamed JSON', async () => {
  const llm = {
    async *stream() {
      yield { type: 'text-delta', text: '{"terms":["预算"],' }
      yield { type: 'text-delta', text: '"synonyms":["费用"]}' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  const expander = createLlmExpander({ llm, provider: 'p', model: 'm' })
  const result = await expander({ query: '钱', hints: {} })
  assert.deepEqual(result.terms, ['预算'])
  assert.deepEqual(result.synonyms, ['费用'])
})

test('parseExpansion accepts fenced JSON and rejects garbage', () => {
  assert.deepEqual(parseExpansion('```json\n{"terms":["a"]}\n```'), {
    terms: ['a'],
    synonyms: [],
  })
  assert.throws(() => parseExpansion('not json'), /JSON/)
})

test('a wrong remembered document type relaxes the kind filter', async () => {
  const store = openStore(':memory:')
  store.upsertFile({ path: '资料/方案.txt', size: 1, mtime: 1, status: 'ok' })
  store.replaceChunks('资料/方案.txt', [
    { kind: 'block', block: 1, text: '部门预算说明' },
  ])
  store.upsertFile({ path: '资料/封面.pptx', size: 1, mtime: 1, status: 'ok' })
  store.replaceChunks('资料/封面.pptx', [{ kind: 'slide', page: 1, text: '封面无关内容' }])
  const service = createSearchService({ store })
  try {
    const result = await service.search({ query: '幻灯片 部门预算' })
    assert.equal(result.relaxedKinds, true)
    assert.ok(result.hits.some((hit) => hit.path.endsWith('方案.txt')))
  } finally {
    store.close()
  }
})

test('sheet evidence uses a sheet/row locator and stays within the sheet', async () => {
  const store = openStore(':memory:')
  store.upsertFile({ path: '资料/表.xlsx', size: 1, mtime: 1, status: 'ok' })
  const ids = store.replaceChunks('资料/表.xlsx', [
    { kind: 'sheet', page: 1, block: 1, text: '[明细 第1-50行]\nA ｜ 1' },
    { kind: 'sheet', page: 1, block: 101, text: '[明细 第101-120行]\nB ｜ 2' },
    { kind: 'sheet', page: 2, block: 1, text: '[汇总 第1-50行]\nC ｜ 3' },
  ])
  const service = createSearchService({ store })
  const evidenceTool = createToolDefinitions({ store, search: service }).find(
    (tool) => tool.name === 'file_recall_evidence',
  )
  try {
    const evidence = await evidenceTool.execute({ chunkId: ids[1], radius: 2 }, {})
    assert.equal(evidence.locator, '明细 第101-120行')
    assert.ok(evidence.neighbors.every((neighbor) => neighbor.page === 1))
    assert.ok(evidence.neighbors.some((neighbor) => neighbor.block === 1))

    const searchResult = await service.search({ query: '明细' })
    const hit = searchResult.hits.find((item) => item.block === 101)
    assert.ok(hit)
    assert.equal(hit.locator, '明细 第101-120行')
  } finally {
    store.close()
  }
})

test('mtime filtering uses the day range for explicit years', async () => {
  const store = seededStore()
  store.upsertFile({
    path: '资料/边界.txt',
    size: 1,
    mtime: Date.UTC(2023, 0, 1) - DAY,
    status: 'ok',
  })
  store.replaceChunks('资料/边界.txt', [{ kind: 'block', block: 1, text: '年度总结 预算' }])
  const service = createSearchService({ store })
  try {
    const result = await service.search({ query: '年度总结', filters: { years: [2023] } })
    assert.ok(result.hits.every((hit) => hit.path !== '资料/边界.txt'))
  } finally {
    store.close()
  }
})
