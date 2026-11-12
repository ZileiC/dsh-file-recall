import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openStore } from '../lib/store.js'
import { createGraphBuilder, splitRelative } from '../lib/graph.js'

const ROOT = 'D:\\vault'

/**
 * A folder-only archive: no Obsidian, no wiki links, messy names. This is the
 * shape the real user keeps, so every assertion below must hold for it.
 */
function seed(store) {
  const files = [
    ['D:\\vault\\课程A\\课件\\deck.pptx', 'ok'],
    ['D:\\vault\\课程A\\笔记\\note.md', 'ok'],
    ['D:\\vault\\课程A\\扫描件 001.pdf', 'scanned'],
    ['D:\\vault\\课程B\\IMG_2034.pdf', 'ok'],
    ['D:\\vault\\顶层文件.docx', 'ok'],
  ]
  for (const [path, status] of files) {
    store.upsertFile({ path, size: 10, mtime: 1 })
    store.replaceChunks(path, [{ kind: 'page', page: 1, text: 'x'.repeat(20) }, { kind: 'page', page: 2, text: 'y'.repeat(20) }])
    store.setFileStatus(path, status)
  }
}

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'file-recall-graph-'))
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

test('splitRelative is prefix-correct and case-insensitive on both separators', () => {
  assert.deepEqual(splitRelative(ROOT, 'D:\\vault\\a\\b.md'), ['a', 'b.md'])
  assert.deepEqual(splitRelative(ROOT, 'd:/VAULT/a/b.md'), ['a', 'b.md'])
  assert.equal(splitRelative(ROOT, 'D:\\other\\b.md'), null)
  assert.equal(splitRelative(ROOT, ROOT), null)
})

test('top level lists folders only, with aggregates', () => {
  const { store, done } = makeStore()
  try {
    seed(store)
    const graph = createGraphBuilder({ store })
    const view = graph.build({ roots: [ROOT] })

    assert.equal(view.focus, null)
    const folders = view.nodes.filter((node) => node.type === 'folder')
    assert.deepEqual(folders.map((node) => node.name).sort(), ['课程A', '课程B'].sort())

    const courseA = folders.find((node) => node.name === '课程A')
    assert.equal(courseA.files, 3)
    assert.equal(courseA.chunks, 6)
    assert.equal(courseA.scanned, 1)

    // Root files are listed as nodes too, not silently dropped.
    const loose = view.nodes.filter((node) => node.type === 'file')
    assert.deepEqual(loose.map((node) => node.name), ['顶层文件.docx'])
    assert.equal(view.totals.files, 5)
    assert.equal(view.totals.folders >= 4, true, 'nested folders are counted too')
  } finally {
    done()
  }
})

test('a focus expands one level and reports its breadcrumb', () => {
  const { store, done } = makeStore()
  try {
    seed(store)
    const graph = createGraphBuilder({ store })
    const view = graph.build({ roots: [ROOT], focus: '课程A' })

    assert.equal(view.focus, '课程A')
    assert.deepEqual(view.breadcrumb, ['课程A'])
    const names = view.nodes.map((node) => node.name).sort()
    assert.deepEqual(names, ['扫描件 001.pdf', '笔记', '课件'].sort())
    const scanned = view.nodes.find((node) => node.name === '扫描件 001.pdf')
    assert.equal(scanned.type, 'file')
    assert.equal(scanned.kind, 'pdf')
    assert.equal(scanned.scanned, true)
  } finally {
    done()
  }
})

test('memory edges land on the level-1 folder at the top, and on the file when focused', () => {
  const { store, done } = makeStore()
  try {
    seed(store)
    store.recordQuery({ ts: 1_000, raw: '那个课件', hits: 1, topChunk: 1, topPath: 'D:\\vault\\课程A\\课件\\deck.pptx' })
    const id = store.recordQuery({ ts: 2_000, raw: 'IMG 那个扫描件', hits: 1, topChunk: 2, topPath: 'D:\\vault\\课程B\\IMG_2034.pdf' })
    store.resolveQuery(id, { outcome: 'wrong', source: 'inferred' })

    const graph = createGraphBuilder({ store })
    const top = graph.build({ roots: [ROOT] })
    const targets = top.edges.map((edge) => edge.target).sort()
    assert.equal(targets.length, 2)
    assert.ok(targets.some((target) => target.endsWith('课程A')))
    assert.ok(targets.some((target) => target.endsWith('课程B')))
    const wrong = top.edges.find((edge) => edge.outcome === 'wrong')
    assert.equal(wrong.source, 'inferred')

    // In a folder view the same recall points at the file (or its subfolder when
    // the file sits one level deeper).
    const focused = graph.build({ roots: [ROOT], focus: '课程A' })
    assert.equal(focused.edges.length, 1)
    assert.match(focused.edges[0].target, /课件$/)
  } finally {
    done()
  }
})

test('edges that cannot be drawn in this view are dropped, not left dangling', () => {
  const { store, done } = makeStore()
  try {
    seed(store)
    store.recordQuery({ ts: 1_000, raw: 'q', hits: 1, topPath: 'D:\\vault\\课程A\\课件\\deck.pptx' })
    const graph = createGraphBuilder({ store })
    const view = graph.build({ roots: [ROOT], focus: '课程B' })
    assert.deepEqual(view.edges, [])
  } finally {
    done()
  }
})

test('an empty archive returns an empty view instead of throwing', () => {
  const { store, done } = makeStore()
  try {
    const graph = createGraphBuilder({ store })
    const view = graph.build({ roots: [ROOT] })
    assert.deepEqual(view.nodes, [])
    assert.deepEqual(view.edges, [])
    assert.equal(view.totals.files, 0)
  } finally {
    done()
  }
})

test('files outside every root are ignored', () => {
  const { store, done } = makeStore()
  try {
    seed(store)
    store.upsertFile({ path: 'D:\\elsewhere\\x.pdf', size: 1, mtime: 1 })
    const graph = createGraphBuilder({ store })
    const view = graph.build({ roots: [ROOT] })
    assert.equal(view.totals.files, 5)
  } finally {
    done()
  }
})

test('the snapshot is cached until the ttl expires', () => {
  const { store, done } = makeStore()
  try {
    seed(store)
    let clock = 1_000
    const graph = createGraphBuilder({ store, now: () => clock, ttlMs: 5_000 })
    assert.equal(graph.build({ roots: [ROOT] }).totals.files, 5)
    store.upsertFile({ path: 'D:\\vault\\新文件.pdf', size: 1, mtime: 1 })
    assert.equal(graph.build({ roots: [ROOT] }).totals.files, 5, 'still cached')
    clock += 6_000
    assert.equal(graph.build({ roots: [ROOT] }).totals.files, 6, 'rebuilt after the ttl')
  } finally {
    done()
  }
})
