import test from 'node:test'
import assert from 'node:assert/strict'

import { openStore } from '../lib/store.js'
import { createLearningService, parseCorrection } from '../lib/learning.js'
import { createSearchService } from '../lib/search.js'
import { createToolDefinitions } from '../lib/tools.js'

function seededStore() {
  const store = openStore(':memory:')
  store.upsertFile({ path: '资料/生物笔记.txt', size: 1, mtime: Date.UTC(2022, 0, 1), status: 'ok' })
  store.replaceChunks('资料/生物笔记.txt', [
    { kind: 'block', block: 1, text: '龙虾与珊瑚礁生态观察记录。' },
  ])
  return store
}

test('feedback is persisted and listable', () => {
  const store = seededStore()
  const learning = createLearningService({ store })
  try {
    const chunk = store.getFirstChunk('资料/生物笔记.txt')
    const result = learning.recordFeedback({
      verdict: 'hit',
      chunkId: Number(chunk.id),
      query: '龙虾',
      note: '第一条',
    })
    assert.ok(result.feedbackId > 0)
    assert.equal(result.path, '资料/生物笔记.txt')
    assert.equal(result.learned, null)

    const rows = learning.listFeedback()
    assert.equal(rows.length, 1)
    assert.equal(rows[0].verdict, 'hit')
    assert.equal(rows[0].chunk_id, Number(chunk.id))
    assert.equal(rows[0].note, '第一条')
  } finally {
    store.close()
  }
})

test('feedback validates verdict and chunk id', () => {
  const store = seededStore()
  const learning = createLearningService({ store })
  try {
    assert.throws(() => learning.recordFeedback({ verdict: 'maybe', query: 'x' }), /verdict/)
    assert.throws(
      () => learning.recordFeedback({ verdict: 'hit', chunkId: 9999 }),
      /chunk not found/,
    )
    assert.throws(() => learning.recordFeedback({ verdict: 'hit' }), /chunkId or the user query/)
  } finally {
    store.close()
  }
})

test('a correction becomes a learned synonym', () => {
  const store = seededStore()
  const learning = createLearningService({ store })
  try {
    const result = learning.recordFeedback({
      verdict: 'partial',
      query: '甲壳类',
      correction: '甲壳类=龙虾',
    })
    assert.deepEqual(result.learned, { term: '甲壳类', expansion: '龙虾', source: 'learned' })

    const synonyms = learning.listSynonyms()
    assert.equal(synonyms.length, 1)
    assert.equal(synonyms[0].term, '甲壳类')
    assert.equal(synonyms[0].expansion, '龙虾')
    assert.equal(synonyms[0].source, 'learned')
  } finally {
    store.close()
  }
})

test('free-text correction maps the whole query to the correction', () => {
  assert.deepEqual(parseCorrection('那个蓝色的东西', '珊瑚礁'), {
    term: '那个蓝色的东西',
    expansion: '珊瑚礁',
  })
  assert.deepEqual(parseCorrection('x', '甲壳类 → 龙虾'), {
    term: '甲壳类',
    expansion: '龙虾',
  })
})

test('learned synonyms are matched against query segments and tokens', () => {
  const store = seededStore()
  const learning = createLearningService({ store })
  try {
    learning.recordFeedback({ verdict: 'partial', query: '甲壳类', correction: '甲壳类=龙虾' })
    const applied = learning.applySynonyms({
      segments: ['甲壳类项目'],
      tokens: ['甲壳类'],
    })
    assert.equal(applied.length, 1)
    assert.equal(applied[0].expansion, '龙虾')
    assert.equal(applied[0].source, 'learned')

    assert.deepEqual(learning.applySynonyms({ segments: ['完全无关'] }), [])
  } finally {
    store.close()
  }
})

test('a learned synonym affects the next search without any model', async () => {
  const store = seededStore()
  const learning = createLearningService({ store })
  const search = createSearchService({ store, learning })
  try {
    learning.recordFeedback({ verdict: 'partial', query: '甲壳类', correction: '甲壳类=龙虾' })
    const result = await search.search({ query: '甲壳类' })
    assert.ok(
      result.hits.some((hit) => hit.path.includes('生物笔记')),
      `learned synonym did not reach retrieval: ${JSON.stringify(result.hits)}`,
    )
    assert.equal(result.appliedSynonyms.length, 1)
    assert.equal(result.appliedSynonyms[0].term, '甲壳类')
    assert.equal(result.appliedSynonyms[0].source, 'learned')
    assert.ok(result.learnedTerms.includes('龙虾'))
    // still lexical-only, but the learned expansion worked
    assert.equal(result.degraded, true)
  } finally {
    store.close()
  }
})

test('file_recall_feedback tool records, lists and shows synonyms', async () => {
  const store = seededStore()
  const learning = createLearningService({ store })
  const search = createSearchService({ store, learning })
  const tool = createToolDefinitions({ store, search, learning }).find(
    (item) => item.name === 'file_recall_feedback',
  )
  assert.ok(tool)
  const chunk = store.getFirstChunk('资料/生物笔记.txt')
  try {
    const recorded = await tool.execute(
      {
        action: 'record',
        verdict: 'partial',
        chunkId: Number(chunk.id),
        query: '甲壳类',
        correction: '甲壳类=龙虾',
      },
      {},
    )
    assert.ok(recorded.feedbackId > 0)
    assert.equal(recorded.learned.expansion, '龙虾')

    const listed = await tool.execute({ action: 'list' }, {})
    assert.equal(listed.feedback.length, 1)
    assert.equal(listed.feedback[0].verdict, 'partial')

    const synonyms = await tool.execute({ action: 'synonyms' }, {})
    assert.equal(synonyms.synonyms.length, 1)
    assert.equal(synonyms.synonyms[0].term, '甲壳类')
  } finally {
    store.close()
  }
})
