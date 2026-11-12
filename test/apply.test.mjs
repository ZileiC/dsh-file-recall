import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createApplier, isInsideRoot, journalPathFor } from '../lib/apply.js'

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'file-recall-apply-'))
  const root = join(dir, 'archive')
  const storage = join(dir, 'storage')
  mkdirSync(root, { recursive: true })
  mkdirSync(storage, { recursive: true })
  return {
    dir,
    root,
    journal: journalPathFor(storage),
    write(rel, text = 'x') {
      const target = join(root, rel)
      mkdirSync(join(target, '..'), { recursive: true })
      writeFileSync(target, text, 'utf8')
      return target
    },
    done() {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

test('dry run reports the plan and changes nothing', () => {
  const space = workspace()
  try {
    space.write('a/IMG_1.jpg', 'photo')
    const applier = createApplier()
    const result = applier.apply({
      root: space.root,
      actions: [{ from: 'a/IMG_1.jpg', to: 'a/2023-01-01_IMG_1.jpg' }],
      journalPath: space.journal,
    })
    assert.equal(result.dryRun, true)
    assert.equal(result.applied.length, 1)
    assert.ok(existsSync(join(space.root, 'a/IMG_1.jpg')), 'dry run must not move anything')
    assert.equal(existsSync(space.journal), false, 'dry run must not write a journal')
  } finally {
    space.done()
  }
})

test('apply moves the file, writes a journal, and undo puts it back', () => {
  const space = workspace()
  try {
    space.write('a/IMG_1.jpg', 'photo')
    const applier = createApplier()
    const applied = applier.apply({
      root: space.root,
      actions: [{ from: 'a/IMG_1.jpg', to: 'a/2023-01-01_IMG_1.jpg' }],
      journalPath: space.journal,
      dryRun: false,
    })
    assert.equal(applied.applied.length, 1)
    assert.ok(existsSync(join(space.root, 'a/2023-01-01_IMG_1.jpg')))
    assert.ok(existsSync(space.journal), 'a successful apply must journal')

    const undone = applier.undo({ root: space.root, journalPath: space.journal })
    assert.equal(undone.restored.length, 1)
    assert.ok(existsSync(join(space.root, 'a/IMG_1.jpg')), 'undo restores the original path')
    assert.equal(existsSync(join(space.root, 'a/2023-01-01_IMG_1.jpg')), false)
    assert.equal(readFileSync(join(space.root, 'a/IMG_1.jpg'), 'utf8'), 'photo')
  } finally {
    space.done()
  }
})

test('a move never overwrites an existing file', () => {
  const space = workspace()
  try {
    space.write('a/IMG_1.jpg', 'first')
    space.write('a/2023-01-01_IMG_1.jpg', 'existing')
    const applier = createApplier()
    const result = applier.apply({
      root: space.root,
      actions: [{ from: 'a/IMG_1.jpg', to: 'a/2023-01-01_IMG_1.jpg' }],
      journalPath: space.journal,
      dryRun: false,
    })
    assert.equal(result.applied.length, 1)
    assert.equal(readFileSync(join(space.root, 'a/2023-01-01_IMG_1.jpg'), 'utf8'), 'existing')
    assert.equal(readFileSync(join(space.root, 'a/2023-01-01_IMG_1 (2).jpg'), 'utf8'), 'first')
  } finally {
    space.done()
  }
})

test('a path outside the root is refused, not executed', () => {
  const space = workspace()
  try {
    space.write('a/IMG_1.jpg')
    const applier = createApplier()
    const result = applier.apply({
      root: space.root,
      actions: [{ from: 'a/IMG_1.jpg', to: '../escaped.jpg' }],
      journalPath: space.journal,
      dryRun: false,
    })
    assert.equal(result.failed.length, 1)
    assert.match(result.failed[0].error, /escapes the root/)
    assert.ok(existsSync(join(space.root, 'a/IMG_1.jpg')))
  } finally {
    space.done()
  }
})

test('a missing source is recorded as a failure and the rest continues', () => {
  const space = workspace()
  try {
    space.write('a/keep.jpg')
    const applier = createApplier()
    const result = applier.apply({
      root: space.root,
      actions: [
        { from: 'a/gone.jpg', to: 'a/moved.jpg' },
        { from: 'a/keep.jpg', to: 'a/kept.jpg' },
      ],
      journalPath: space.journal,
      dryRun: false,
    })
    assert.equal(result.failed.length, 1)
    assert.equal(result.applied.length, 1)
    assert.ok(existsSync(join(space.root, 'a/kept.jpg')))
  } finally {
    space.done()
  }
})

test('undo is newest-first so chained moves unwind correctly', () => {
  const space = workspace()
  try {
    space.write('a/one.txt', 'one')
    const applier = createApplier()
    applier.apply({
      root: space.root,
      actions: [{ from: 'a/one.txt', to: 'a/two.txt' }],
      journalPath: space.journal,
      dryRun: false,
    })
    applier.apply({
      root: space.root,
      actions: [{ from: 'a/two.txt', to: 'a/three.txt' }],
      journalPath: space.journal,
      dryRun: false,
    })
    assert.ok(existsSync(join(space.root, 'a/three.txt')))

    applier.undo({ root: space.root, journalPath: space.journal })
    assert.ok(existsSync(join(space.root, 'a/one.txt')), 'the oldest name is restored')
    assert.equal(existsSync(join(space.root, 'a/three.txt')), false)
  } finally {
    space.done()
  }
})

test('isInsideRoot rejects traversal and sibling-prefix tricks', () => {
  const root = 'C:\\archive'
  assert.equal(isInsideRoot(root, 'C:\\archive\\a\\b.txt'), true)
  assert.equal(isInsideRoot(root, 'C:\\archive'), true)
  assert.equal(isInsideRoot(root, 'C:\\archive-evil\\b.txt'), false)
  assert.equal(isInsideRoot(root, 'C:\\archive\\..\\escape.txt'), false)
  assert.equal(isInsideRoot(root, 'D:\\other\\b.txt'), false)
})
