import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openStore, SCHEMA_VERSION } from '../lib/store.js'
import { queryToFts } from '../lib/tokenize.js'

function freshStore() {
  const store = openStore(':memory:')
  return store
}

function seed(store, path = '资料/2023预算说明.pptx', status = 'ok') {
  store.upsertFile({
    path,
    size: 1024,
    mtime: 1_700_000_000_000,
    status,
  })
  store.replaceChunks(
    path,
    [
      { kind: 'slide', page: 1, text: '项目背景与目标' },
      { kind: 'slide', page: 3, text: '这是部门预算的说明，包含绩效指标。' },
      { kind: 'notes', page: 3, text: '讲解词：重点看这一页的蓝色架构图。' },
    ],
    { status: 'ok' },
  )
}

test('opens an in-memory database with the current schema version', () => {
  const store = freshStore()
  const row = store.db.prepare('PRAGMA user_version').get()
  assert.equal(Number(row.user_version), SCHEMA_VERSION)
  const version = store.db.prepare('SELECT sqlite_version() AS v').get()
  assert.ok(String(version.v).length > 0)
  assert.deepEqual(store.stats(), {
    files: 0,
    chunks: 0,
    ocrChunks: 0,
    errors: 0,
    byStatus: [],
  })
  store.close()
})

test('FTS5 is available: CJK bigram query matches mid-string', () => {
  const store = freshStore()
  seed(store)
  const hits = store.searchContent(queryToFts('预算'), { limit: 5 })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].page, 3)
  assert.equal(hits[0].kind, 'slide')
  assert.match(hits[0].text, /部门预算的说明/)
  store.close()
})

test('single-character query matches anywhere in a CJK run', () => {
  const store = freshStore()
  store.upsertFile({ path: 'a.pptx', size: 1, mtime: 1, status: 'ok' })
  store.replaceChunks('a.pptx', [{ kind: 'slide', page: 1, text: '蓝色大肥鱼' }])
  const hits = store.searchContent(queryToFts('鱼'), { limit: 5 })
  assert.equal(hits.length, 1)
  store.close()
})

test('path arm matches a Chinese path', () => {
  const store = freshStore()
  seed(store)
  const hits = store.searchPaths(queryToFts('预算'), { limit: 5 })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].path, '资料/2023预算说明.pptx')
  store.close()
})

test('metadata filters narrow content results', () => {
  const store = freshStore()
  store.upsertFile({ path: 'old.pptx', size: 1, mtime: 100, status: 'ok' })
  store.replaceChunks('old.pptx', [{ kind: 'slide', page: 1, text: '预算说明' }])
  store.upsertFile({ path: 'new.pptx', size: 1, mtime: 200, status: 'ok' })
  store.replaceChunks('new.pptx', [{ kind: 'page', page: 1, text: '预算说明' }])

  const recent = store.searchContent(queryToFts('预算'), { mtimeFrom: 150, limit: 5 })
  assert.deepEqual(recent.map((hit) => hit.path), ['new.pptx'])

  const pagesOnly = store.searchContent(queryToFts('预算'), { kinds: ['page'], limit: 5 })
  assert.deepEqual(pagesOnly.map((hit) => hit.path), ['new.pptx'])

  const prefixed = store.searchContent(queryToFts('预算'), { pathPrefix: 'old', limit: 5 })
  assert.deepEqual(prefixed.map((hit) => hit.path), ['old.pptx'])
  store.close()
})

test('notes are indexed too', () => {
  const store = freshStore()
  seed(store)
  const hits = store.searchContent(queryToFts('蓝色架构图'), { limit: 5 })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].kind, 'notes')
  store.close()
})

test('replacing chunks removes stale FTS rows', () => {
  const store = freshStore()
  seed(store)
  store.replaceChunks('资料/2023预算说明.pptx', [{ kind: 'slide', page: 1, text: '完全不同的内容' }])
  assert.equal(store.searchContent(queryToFts('绩效指标'), { limit: 5 }).length, 0)
  assert.equal(store.searchContent(queryToFts('完全不同'), { limit: 5 }).length, 1)
  store.close()
})

test('deleting a file removes chunks, path row and FTS entries', () => {
  const store = freshStore()
  seed(store)
  assert.equal(store.stats().files, 1)
  assert.equal(store.stats().chunks, 3)

  store.deleteFile('资料/2023预算说明.pptx')
  assert.equal(store.stats().files, 0)
  assert.equal(store.stats().chunks, 0)
  assert.equal(store.searchContent(queryToFts('预算'), { limit: 5 }).length, 0)
  assert.equal(store.searchPaths(queryToFts('预算'), { limit: 5 }).length, 0)
  store.close()
})

test('upserting a file keeps its rowid stable and updates status', () => {
  const store = freshStore()
  const first = store.upsertFile({ path: 'a.pptx', size: 1, mtime: 1, status: 'pending' })
  const second = store.upsertFile({ path: 'a.pptx', size: 2, mtime: 2, status: 'ok' })
  assert.equal(first, second)
  assert.equal(store.getFile('a.pptx').status, 'ok')
  assert.equal(store.getFile('a.pptx').size, 2)
  store.close()
})

test('chunk context returns neighbours around a page', () => {
  const store = freshStore()
  seed(store)
  const page3 = store.searchContent(queryToFts('预算'), { limit: 1 })[0]
  const context = store.getChunkContext(page3.id, 1)
  assert.deepEqual(context.map((chunk) => chunk.page), [3, 3])
  assert.equal(context[0].id, page3.id)
  store.close()
})

test('meta key/value round-trips', () => {
  const store = freshStore()
  assert.equal(store.getMeta('cursor', null), null)
  store.setMeta('cursor', '42')
  assert.equal(store.getMeta('cursor'), '42')
  store.setMeta('cursor', '43')
  assert.equal(store.getMeta('cursor'), '43')
  store.close()
})

test('reset clears derived data and keeps a valid schema', () => {
  const store = freshStore()
  seed(store)
  store.reset()
  assert.deepEqual(store.stats(), {
    files: 0,
    chunks: 0,
    ocrChunks: 0,
    errors: 0,
    byStatus: [],
  })
  const row = store.db.prepare('PRAGMA user_version').get()
  assert.equal(Number(row.user_version), SCHEMA_VERSION)
  store.close()
})

test('reset clears derived data but keeps learned vocabulary and persisted roots', () => {
  const store = freshStore()
  seed(store)
  store.recordFeedback({ query: '预算', chunkId: null, path: 'a.pptx', verdict: 'hit' })
  store.upsertSynonym({ term: '甲壳类', expansion: '龙虾', source: 'learned' })
  store.setMeta('indexer.rootsOverride', JSON.stringify(['C:\\资料']))
  store.setMeta('indexer.lastSyncAt', '123')

  store.reset()
  assert.equal(store.stats().files, 0)
  assert.equal(store.stats().chunks, 0)
  assert.equal(store.listFeedback(10).length, 1)
  assert.equal(store.listSynonyms('learned').length, 1)
  assert.equal(store.getMeta('indexer.rootsOverride'), JSON.stringify(['C:\\资料']))
  assert.equal(store.getMeta('indexer.lastSyncAt'), null)
  store.close()
})

test('retryErrors requeues failed files', () => {
  const store = freshStore()
  store.upsertFile({ path: 'bad.pptx', size: 1, mtime: 1, status: 'error' })
  assert.equal(store.retryErrors(), 1)
  assert.equal(store.getFile('bad.pptx').status, 'pending')
  assert.equal(store.retryErrors(), 0)
  store.close()
})

test('a file-backed database survives close and reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'file-recall-'))
  const dbPath = join(dir, 'index.db')
  try {
    const first = openStore(dbPath)
    seed(first)
    first.close()

    const second = openStore(dbPath)
    assert.equal(second.stats().files, 1)
    assert.equal(second.searchContent(queryToFts('预算'), { limit: 5 }).length, 1)
    second.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
