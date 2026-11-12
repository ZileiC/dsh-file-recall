import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { openStore } from '../lib/store.js'
import { createTidyPlanner } from '../lib/tidy.js'
import { renderFishbone } from '../lib/fishbone.js'

const ROOT = 'D:\\vault'
// 2023-05-01T00:00:00Z, so the date prefix is deterministic in any timezone
// that does not cross midnight for this instant.
const MAY_2023 = Date.UTC(2023, 4, 1, 12, 0, 0)

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'file-recall-tidy-'))
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

function addFile(store, path, mtime = MAY_2023) {
  store.upsertFile({ path, size: 10, mtime })
  store.setFileStatus(path, 'ok')
}

test('camera names get a date prefix, and a name the user chose is never rewritten', () => {
  const { store, done } = makeStore()
  try {
    addFile(store, 'D:\\vault\\IMG_2034.jpg')
    addFile(store, 'D:\\vault\\扫描件 001.pdf')
    addFile(store, 'D:\\vault\\课程\\note-unrelated.md')

    const planner = createTidyPlanner({ store, looseRootThreshold: 99 })
    const plan = planner.plan({ roots: [ROOT] })
    const renames = plan.actions.filter((action) => action.kind === 'rename')

    // Only the machine-generated names are touched: mtime is a modification
    // time, so prefixing every undated file would rewrite the user's naming.
    assert.equal(renames.length, 2)
    for (const action of renames) {
      const fromParts = action.from.split('/')
      const toParts = action.to.split('/')
      const fileName = toParts[toParts.length - 1]
      const original = fromParts[fromParts.length - 1]
      assert.match(fileName, /^\d{4}-\d{2}-\d{2}_/)
      assert.ok(fileName.endsWith(original), 'original name preserved')
      assert.deepEqual(toParts.slice(0, -1), fromParts.slice(0, -1), 'folder unchanged')
      assert.equal(action.confidence, 'low', 'mtime is the weakest date source')
      assert.equal(action.dateSource, 'mtime')
      assert.match(action.reason, /自动命名/)
    }
    assert.ok(!renames.some((action) => action.from.includes('note-unrelated')))
    assert.equal(plan.summary.undated >= 1, true, 'undated files are counted, not renamed')
  } finally {
    done()
  }
})

test('build output, dependency trees and caches are excluded from the plan', () => {
  const { store, done } = makeStore()
  try {
    addFile(store, 'D:\\vault\\课程\\2023-01-01_report.pdf')
    addFile(store, 'D:\\vault\\project\\venv\\Lib\\site-packages\\pkg\\IMG_1.png')
    addFile(store, 'D:\\vault\\project\\build\\windows\\IMG_2.png')
    addFile(store, 'D:\\vault\\app\\node_modules\\x\\IMG_3.png')
    addFile(store, 'D:\\vault\\课程\\.pytest_cache\\IMG_4.png')

    const planner = createTidyPlanner({ store, looseRootThreshold: 99 })
    const plan = planner.plan({ roots: [ROOT] })

    assert.equal(plan.summary.ignoredFiles, 4)
    assert.equal(plan.summary.files, 1)
    assert.ok(!plan.actions.some((action) => /venv|build|node_modules|pytest_cache/.test(action.from)))
    assert.ok(!plan.duplicates.some((entry) => /venv|build|node_modules/.test(entry.paths.join())))
  } finally {
    done()
  }
})

test('files that already carry a date are left alone', () => {
  const { store, done } = makeStore()
  try {
    addFile(store, 'D:\\vault\\2023-05-01_汇报.pdf')
    addFile(store, 'D:\\vault\\2021 年度总结\\deck.pptx')
    addFile(store, 'D:\\vault\\随记-20240607.md')

    const planner = createTidyPlanner({ store, looseRootThreshold: 99 })
    const plan = planner.plan({ roots: [ROOT] })
    assert.equal(plan.actions.filter((action) => action.kind === 'rename').length, 0)
  } finally {
    done()
  }
})

test('loose root files are collected into one folder, and nothing else moves', () => {
  const { store, done } = makeStore()
  try {
    addFile(store, 'D:\\vault\\2023-01-01_a.pdf')
    addFile(store, 'D:\\vault\\2023-01-02_b.pdf')
    addFile(store, 'D:\\vault\\2023-01-03_c.pdf')
    addFile(store, 'D:\\vault\\课程\\2023-01-04_d.pdf')

    const planner = createTidyPlanner({ store, looseRootThreshold: 2 })
    const plan = planner.plan({ roots: [ROOT] })
    const moves = plan.actions.filter((action) => action.kind === 'move')

    assert.equal(moves.length, 3)
    assert.ok(moves.every((action) => action.to.startsWith('整理归档/')), 'single target folder')
    assert.ok(!moves.some((action) => action.from.includes('课程/')), 'nested files untouched')
  } finally {
    done()
  }
})

test('duplicate names and overloaded folders are reported, never acted on', () => {
  const { store, done } = makeStore()
  try {
    addFile(store, 'D:\\vault\\2023-a\\report.pdf')
    addFile(store, 'D:\\vault\\2023-b\\report.pdf')
    for (let index = 0; index < 6; index += 1) {
      addFile(store, `D:\\vault\\大文件夹\\2023-02-0${index + 1}_f${index}.txt`)
    }
    const planner = createTidyPlanner({ store, looseRootThreshold: 99, overloadThreshold: 3 })
    const plan = planner.plan({ roots: [ROOT] })

    assert.equal(plan.duplicates.length, 1)
    assert.equal(plan.duplicates[0].name, 'report.pdf')
    assert.equal(plan.duplicates[0].paths.length, 2)
    assert.equal(plan.overloaded.length, 1)
    assert.equal(plan.overloaded[0].files, 6)
    // Neither finding becomes an action.
    assert.ok(!plan.actions.some((action) => action.from.includes('report.pdf')))
  } finally {
    done()
  }
})

test('the plan is explicitly non-executable and never touches the disk', () => {
  const { store, dir, done } = makeStore()
  try {
    addFile(store, 'D:\\vault\\IMG_0001.jpg')
    const before = readdirSync(dir).sort()
    const planner = createTidyPlanner({ store, looseRootThreshold: 99 })
    const plan = planner.plan({ roots: [ROOT] })

    assert.equal(plan.executable, false)
    assert.match(plan.boundary, /不会移动或重命名/)
    assert.deepEqual(readdirSync(dir).sort(), before, 'planner must not write anything')
    assert.ok(plan.generatedAt > 0)
  } finally {
    done()
  }
})

test('files outside the configured roots are ignored', () => {
  const { store, done } = makeStore()
  try {
    addFile(store, 'D:\\vault\\IMG_1111.jpg')
    addFile(store, 'D:\\elsewhere\\IMG_2222.jpg')
    const planner = createTidyPlanner({ store, looseRootThreshold: 99 })
    const plan = planner.plan({ roots: [ROOT] })
    assert.equal(plan.summary.files, 1)
    assert.ok(!plan.actions.some((action) => action.from.includes('IMG_2222')))
  } finally {
    done()
  }
})

test('an empty archive produces an empty plan instead of noise', () => {
  const { store, done } = makeStore()
  try {
    const planner = createTidyPlanner({ store })
    const plan = planner.plan({ roots: [ROOT] })
    assert.deepEqual(plan.actions, [])
    assert.equal(plan.summary.files, 0)
    assert.equal(plan.summary.moves, 0)
    assert.equal(plan.summary.renames, 0)
  } finally {
    done()
  }
})

test('the structure proposal keeps semesters and courses and ignores build trees', () => {
  const { store, done } = makeStore()
  try {
    addFile(store, 'D:\\vault\\Ⅱ 26 Fall\\1077 Chinese communication\\Notes\\Week 3.md')
    addFile(store, 'D:\\vault\\Ⅱ 26 Fall\\1077 Chinese communication\\Slides\\lecture.pdf')
    addFile(store, 'D:\\vault\\Ⅱ 26 Fall\\2102 Matrix Algebra\\Notes\\L05.md')
    addFile(store, 'D:\\vault\\Ⅰ 25 Fall\\calculus\\midterm\\exam.pdf')
    addFile(store, 'D:\\vault\\loose-at-root.md')
    addFile(store, 'D:\\vault\\Ⅱ 26 Fall\\1077 Chinese communication\\venv\\IMG_1.png')

    const planner = createTidyPlanner({ store })
    const structure = planner.structure({ roots: [ROOT] })

    assert.equal(structure.head, '找到东西')
    assert.equal(structure.totals.files, 5)
    assert.equal(structure.totals.ignored, 1)

    const labels = structure.branches.map((branch) => branch.label)
    assert.ok(labels.includes('Ⅱ 26 Fall'))
    assert.ok(labels.includes('Ⅰ 25 Fall'))
    assert.ok(labels.includes('根目录散落文件'), 'loose root files are their own branch')

    const semester = structure.branches.find((branch) => branch.label === 'Ⅱ 26 Fall')
    assert.equal(semester.count, 3)
    const courseLabels = semester.children.map((child) => child.label)
    assert.ok(courseLabels.includes('1077 Chinese communication'))
    assert.ok(courseLabels.includes('2102 Matrix Algebra'))

    // The proposal must state its levels and rules, because that is what the
    // user approves — not the picture alone.
    assert.ok(structure.proposal.levels.length >= 3)
    assert.ok(structure.proposal.levels.some((level) => /Notes|Slides/.test(level)))
    assert.ok(structure.proposal.rules.some((rule) => /不动/.test(rule)))
  } finally {
    done()
  }
})

test('the fishbone renders a standalone SVG with the head and every branch', () => {
  const svg = renderFishbone({
    head: '找到东西',
    subtitle: '5 个文件',
    branches: [
      { label: 'Ⅱ 26 Fall', count: 3, children: [{ label: '1077 Chinese', count: 2 }, { label: '2102 Matrix', count: 1 }] },
      { label: 'Ⅰ 25 Fall', count: 1, children: [{ label: 'calculus', count: 1 }] },
    ],
    width: 1000,
  })
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.match(svg, /找到东西/)
  assert.match(svg, /Ⅱ 26 Fall/)
  assert.match(svg, /1077 Chinese/)
  assert.match(svg, /<\/svg>$/)
  // No raw ampersands: XML would be invalid.
  assert.doesNotMatch(svg, /&(?!(amp|lt|gt|quot);)/)
})

test('a date the author wrote in the content beats the file mtime', () => {
  const { store, done } = makeStore()
  try {
    // mtime is 2023-05-01; the note says it was written 2021-09-14.
    addFile(store, 'D:\\vault\\IMG_7788.jpg', MAY_2023)
    store.replaceChunks('D:\\vault\\IMG_7788.jpg', [
      { kind: 'ocr', page: 1, text: '---\ndate: 2021-09-14\n---\n课堂板书照片' },
    ])

    const planner = createTidyPlanner({ store, looseRootThreshold: 99 })
    const plan = planner.plan({ roots: [ROOT] })
    const rename = plan.actions.find((action) => action.kind === 'rename')

    assert.ok(rename, 'a machine name should still be renamed')
    assert.match(rename.to, /2021-09-14_/)
    assert.equal(rename.dateSource, 'content')
    assert.equal(rename.confidence, 'medium')
  } finally {
    done()
  }
})

test('an Obsidian vault is move-only until the caller opts in', () => {
  const { store, done } = makeStore()
  const root = join(mkdtempSync(join(tmpdir(), 'vault-detect-')), 'vault')
  try {
    mkdirSync(join(root, '.obsidian'), { recursive: true })
    addFile(store, join(root, 'IMG_9001.jpg'))
    addFile(store, join(root, 'loose notes.md'))

    const guarded = createTidyPlanner({ store })
    const guardedPlan = guarded.plan({ roots: [root] })
    assert.equal(guardedPlan.actions.filter((action) => action.kind === 'rename').length, 0)
    assert.ok(guardedPlan.notes.some((note) => /Obsidian vault/.test(note)))

    const allowed = createTidyPlanner({ store, allowVaultRename: true })
    const allowedPlan = allowed.plan({ roots: [root] })
    assert.equal(allowedPlan.actions.filter((action) => action.kind === 'rename').length, 1)
  } finally {
    done()
    rmSync(dirname(root), { recursive: true, force: true })
  }
})

test('the per-file detail names each target and hides the rest with counts', () => {
  const { store, done } = makeStore()
  try {
    addFile(store, 'D:\\vault\\Ⅱ 26 Fall\\1077 Chinese communication\\Notes\\IMG_1001.jpg')
    addFile(store, 'D:\\vault\\Ⅱ 26 Fall\\1077 Chinese communication\\Notes\\IMG_1002.jpg')
    addFile(store, 'D:\\vault\\Ⅱ 26 Fall\\1077 Chinese communication\\Slides\\lecture.pdf')
    addFile(store, 'D:\\vault\\Ⅱ 26 Fall\\1077 Chinese communication\\Slides\\IMG_1003.png')

    const planner = createTidyPlanner({ store })
    const detail = planner.detail({ roots: [ROOT], ticksPerKind: 1 })

    assert.equal(detail.totals.files, 4)
    const view = detail.views.find((entry) => entry.top === 'Ⅱ 26 Fall')
    assert.ok(view, 'the semester is its own view')
    const notes = view.kinds.find((kind) => kind.kind === 'notes')
    assert.equal(notes.count, 2)
    assert.equal(notes.files.length, 1, 'ticks are capped')
    assert.equal(notes.hidden, 1)
    assert.ok(notes.files[0].targetDir.endsWith('notes'))
    assert.equal(detail.renameAllowed, true)
  } finally {
    done()
  }
})

test('the fishbone escapes markup in labels', () => {
  const svg = renderFishbone({
    head: '<script>alert(1)</script>',
    branches: [{ label: 'a & b', count: 1 }],
  })
  assert.doesNotMatch(svg, /<script>/)
  assert.match(svg, /&lt;script&gt;/)
  assert.match(svg, /a &amp; b/)
})

test('actions are capped and the truncation is reported', () => {
  const { store, done } = makeStore()
  try {
    for (let index = 0; index < 12; index += 1) {
      addFile(store, `D:\\vault\\IMG_90${String(index).padStart(2, '0')}.jpg`)
    }
    const planner = createTidyPlanner({ store, looseRootThreshold: 99, maxActions: 5 })
    const plan = planner.plan({ roots: [ROOT] })
    assert.equal(plan.actions.length, 5)
    assert.equal(plan.summary.truncated, true)
  } finally {
    done()
  }
})
