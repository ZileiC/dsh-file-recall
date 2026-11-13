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

test('the default view spans three levels, each node tagged with its depth', () => {
  const { store, done } = makeStore()
  try {
    seed(store)
    const graph = createGraphBuilder({ store })
    const view = graph.build({ roots: [ROOT] })

    assert.equal(view.focus, null)
    assert.equal(view.depth, 3)

    const level1 = view.nodes.filter((node) => node.depth === 1 && node.type === 'folder')
    assert.deepEqual(level1.map((node) => node.name).sort(), ['课程A', '课程B'].sort())
    assert.ok(level1.every((node) => node.parentRel === null), 'level 1 hangs off the root')

    const courseA = level1.find((node) => node.name === '课程A')
    assert.equal(courseA.files, 3)
    assert.equal(courseA.chunks, 6)
    assert.equal(courseA.scanned, 1)

    // Level 2 and 3 are what make the archive's shape visible at a glance.
    const level2 = view.nodes.filter((node) => node.depth === 2)
    const nested = level2.filter((node) => node.type === 'folder').map((node) => node.name)
    assert.ok(nested.includes('课件') && nested.includes('笔记'))

    const level3 = view.nodes.filter((node) => node.depth === 3)
    assert.ok(level3.some((node) => node.type === 'file' && node.name === 'deck.pptx'))
    assert.ok(level3.every((node) => typeof node.parentRel === 'string' && node.parentRel.length > 0))

    const loose = view.nodes.filter((node) => node.type === 'file' && node.depth === 1)
    assert.deepEqual(loose.map((node) => node.name), ['顶层文件.docx'])
    assert.equal(view.totals.files, 5)
  } finally {
    done()
  }
})

test('depth 1 is still available when only one level is wanted', () => {
  const { store, done } = makeStore()
  try {
    seed(store)
    const graph = createGraphBuilder({ store })
    const view = graph.build({ roots: [ROOT], depth: 1 })
    assert.equal(view.depth, 1)
    // The root is a real node now (depth 0); everything else is one level down.
    const rootNode = view.nodes.find((node) => node.type === 'root')
    assert.ok(rootNode, 'the configured root must be drawn as a node')
    assert.equal(rootNode.name, 'vault')
    assert.ok(view.nodes.filter((node) => node.type !== 'root').every((node) => node.depth === 1))
    assert.deepEqual(
      view.nodes.filter((node) => node.type === 'folder').map((node) => node.name).sort(),
      ['课程A', '课程B'].sort(),
    )
  } finally {
    done()
  }
})

test('two roots are drawn as two real folders, never merged into one hub', () => {
  const { store, done } = makeStore()
  const other = 'E:\\Archive'
  try {
    seed(store)
    // Same relative folder name under both roots on purpose: a rel-keyed link
    // would put one tree's branch under the other root.
    for (const [path, status] of [
      ['E:\\Archive\\课程A\\课件\\other.pptx', 'ok'],
      ['E:\\Archive\\独立资料\\report.pdf', 'ok'],
    ]) {
      store.upsertFile({ path, size: 10, mtime: 1 })
      store.replaceChunks(path, [{ kind: 'page', page: 1, text: 'z'.repeat(20) }])
      store.setFileStatus(path, status)
    }

    const graph = createGraphBuilder({ store })
    const view = graph.build({ roots: [ROOT, other], depth: 2 })

    const roots = view.nodes.filter((node) => node.type === 'root')
    assert.equal(roots.length, 2, 'one node per configured root')
    assert.deepEqual(roots.map((node) => node.name).sort(), ['Archive', 'vault'].sort())
    // Each root owns a distinct id, and there is no synthetic centre node.
    assert.equal(new Set(roots.map((node) => node.id)).size, 2)
    assert.ok(!view.nodes.some((node) => node.id === 'root:' || node.name === '全部资料'))

    // Every non-root node hangs off a node that exists in this payload.
    const ids = new Set(view.nodes.map((node) => node.id))
    for (const node of view.nodes) {
      if (node.type === 'root') continue
      assert.ok(ids.has(node.parentId), `${node.name} points at a missing parent ${node.parentId}`)
      assert.ok(String(node.parentId).startsWith('root:') || String(node.parentId).startsWith('folder:'))
    }

    // 课程A exists under both roots and must appear twice, each under its own root.
    const courses = view.nodes.filter((node) => node.name === '课程A')
    assert.equal(courses.length, 2, 'a shared relative name must not collapse into one node')
    const parents = new Set(courses.map((node) => node.parentId))
    assert.equal(parents.size, 2, 'each 课程A belongs to a different root')

    // The second root's own children are attached to it, not to the first root.
    const archive = roots.find((node) => node.name === 'Archive')
    const indep = view.nodes.find((node) => node.name === '独立资料')
    assert.equal(indep.parentId, archive.id)
  } finally {
    done()
  }
})

test('each level is capped and the overflow is reported', () => {
  const { store, done } = makeStore()
  try {
    for (let index = 0; index < 8; index += 1) {
      const path = `D:\\vault\\big\\folder${index}\\f.md`
      store.upsertFile({ path, size: 1, mtime: 1 })
      store.replaceChunks(path, [{ kind: 'block', block: 1, text: 'x'.repeat(10) }])
      store.setFileStatus(path, 'ok')
    }
    const graph = createGraphBuilder({ store })
    const view = graph.build({ roots: [ROOT], perDepth: 3 })
    assert.equal(view.nodes.filter((node) => node.depth === 2).length, 3)
    assert.equal(view.hidden['2'], 5)
  } finally {
    done()
  }
})

test('a focus expands two levels and reports its breadcrumb', () => {
  const { store, done } = makeStore()
  try {
    seed(store)
    const graph = createGraphBuilder({ store })
    const view = graph.build({ roots: [ROOT], focus: '课程A' })

    assert.equal(view.focus, '课程A')
    assert.deepEqual(view.breadcrumb, ['课程A'])
    const names = view.nodes.map((node) => node.name).sort()
    // 'vault' is the real root folder, kept so the tree is anchored in reality.
    assert.deepEqual(names, ['deck.pptx', 'note.md', '扫描件 001.pdf', '笔记', '课件', 'vault'].sort())
    assert.ok(view.nodes.every((node) => node.type === 'root' || (node.depth >= 1 && node.depth <= 2)))
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
    // With two levels visible, a recall points at the exact file it landed on.
    assert.ok(targets.some((target) => target.endsWith('deck.pptx')))
    assert.ok(targets.some((target) => target.endsWith('IMG_2034.pdf')))
    const wrong = top.edges.find((edge) => edge.outcome === 'wrong')
    assert.equal(wrong.source, 'inferred')

    // It resolves to the node itself inside a folder view too.
    const focused = graph.build({ roots: [ROOT], focus: '课程A' })
    assert.equal(focused.edges.length, 1)
    assert.match(focused.edges[0].target, /deck\.pptx$/)

    // A single-level view must still draw the recall, on the nearest visible
    // ancestor folder rather than dropping it.
    const shallow = graph.build({ roots: [ROOT], depth: 1 })
    assert.equal(shallow.edges.length, 2)
    assert.ok(shallow.edges.every((edge) => /课程[AB]$/.test(edge.target)))
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
