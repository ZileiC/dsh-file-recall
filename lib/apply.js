/**
 * Apply / undo for a tidy plan.
 *
 * The planner only proposes; this module is the only place that touches the
 * filesystem, and it is built so that "approved" also means "reversible":
 *
 *  - every completed operation is appended to a journal file INSIDE the storage
 *    directory (never the archive), so undo does not depend on memory;
 *  - `dryRun` is the default: it reports what would happen and writes nothing;
 *  - a move never overwrites: an existing target gets a numeric suffix;
 *  - any path that resolves outside the root is refused, so a bad plan cannot
 *    reach any other part of the disk;
 *  - a failure is recorded and the run continues, because stopping halfway
 *    leaves the archive in a state the user did not approve either.
 */

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

function toPosix(value) {
  return String(value ?? '').replace(/\\/g, '/')
}

/** True only when `candidate` is the root itself or inside it. */
export function isInsideRoot(root, candidate) {
  const rootAbs = resolve(root)
  const targetAbs = resolve(candidate)
  if (targetAbs === rootAbs) return true
  return targetAbs.startsWith(rootAbs.endsWith(sep) ? rootAbs : rootAbs + sep)
}

function uniqueTarget(target) {
  if (!existsSync(target)) return target
  const dot = target.lastIndexOf('.')
  const stem = dot > target.lastIndexOf(sep) ? target.slice(0, dot) : target
  const ext = dot > target.lastIndexOf(sep) ? target.slice(dot) : ''
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${stem} (${index})${ext}`
    if (!existsSync(candidate)) return candidate
  }
  throw new Error(`no free name for ${target}`)
}

/**
 * @param {{ captureFs?: {
 *   renameSync: Function, copyFileSync: Function, rmSync: Function,
 *   existsSync: Function, mkdirSync: Function, appendFileSync: Function,
 * } }} options
 */
export function createApplier(options = {}) {
  const fs = options.captureFs ?? { renameSync, copyFileSync, rmSync, existsSync, mkdirSync, appendFileSync }

  /** Move one file, refusing anything outside the root and never overwriting. */
  function moveFile({ root, from, to }) {
    const source = resolve(root, from)
    const wanted = resolve(root, to)
    if (!isInsideRoot(root, source) || !isInsideRoot(root, wanted)) {
      throw new Error(`refused: path escapes the root (${to})`)
    }
    if (!fs.existsSync(source)) throw new Error(`missing source: ${from}`)
    fs.mkdirSync(dirname(wanted), { recursive: true })
    const target = uniqueTarget(wanted)
    try {
      fs.renameSync(source, target)
    } catch (error) {
      if (error && (error.code === 'EXDEV' || error.code === 'EPERM')) {
        // Different volume or a locked file: copy then remove.
        fs.copyFileSync(source, target)
        fs.rmSync(source, { force: true })
      } else {
        throw error
      }
    }
    return target
  }

  /**
   * Apply a list of `{ from, to }` moves. Default is a dry run.
   *
   * @param {{
   *   root: string,
   *   actions: Array<{ from: string, to: string }>,
   *   journalPath: string,
   *   dryRun?: boolean,
   *   limit?: number,
   * }} input
   */
  function apply({ root, actions = [], journalPath, dryRun = true, limit = 500 }) {
    if (!root) throw new Error('apply: root is required')
    const list = Array.isArray(actions) ? actions.slice(0, Math.max(1, Number(limit) || 500)) : []
    const result = { dryRun, planned: list.length, applied: [], failed: [], skipped: [], journalPath }

    for (const action of list) {
      const from = String(action?.from ?? '')
      const to = String(action?.to ?? '')
      if (!from || !to || from === to) {
        result.skipped.push({ from, to, reason: 'nothing to do' })
        continue
      }
      if (dryRun) {
        result.applied.push({ from, to, dryRun: true })
        continue
      }
      try {
        const landed = moveFile({ root, from, to })
        const entry = { ts: Date.now(), from: toPosix(from), to: toPosix(to), landed: toPosix(landed) }
        fs.appendFileSync(journalPath, JSON.stringify(entry) + '\n', 'utf8')
        result.applied.push(entry)
      } catch (error) {
        result.failed.push({ from, to, error: error instanceof Error ? error.message : String(error) })
      }
    }
    return result
  }

  /** Reverse a journal, newest first. Only entries whose target still exists. */
  function undo({ root, journalPath, dryRun = false }) {
    if (!root) throw new Error('undo: root is required')
    if (!existsSync(journalPath)) return { dryRun, restored: [], failed: [], missingJournal: true }
    const lines = readFileSync(journalPath, 'utf8').split('\n').filter(Boolean)
    const entries = []
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line))
      } catch (error) {
        /* a torn line is skipped, not fatal */
      }
    }
    const result = { dryRun, restored: [], failed: [], journalPath }
    for (const entry of entries.reverse()) {
      const current = resolve(root, entry.landed ?? entry.to)
      const original = resolve(root, entry.from)
      if (!isInsideRoot(root, current) || !isInsideRoot(root, original)) {
        result.failed.push({ from: entry.from, error: 'path escapes the root' })
        continue
      }
      if (!existsSync(current)) {
        result.failed.push({ from: entry.from, error: 'already moved away' })
        continue
      }
      if (dryRun) {
        result.restored.push({ from: entry.to, to: entry.from, dryRun: true })
        continue
      }
      try {
        mkdirSync(dirname(original), { recursive: true })
        const target = uniqueTarget(original)
        renameSync(current, target)
        result.restored.push({ from: entry.to, to: toPosix(target) })
      } catch (error) {
        result.failed.push({ from: entry.from, error: error instanceof Error ? error.message : String(error) })
      }
    }
    return result
  }

  return { apply, undo }
}

/** Default journal path: next to the index, never inside the archive. */
export function journalPathFor(storageDir) {
  return join(storageDir, 'tidy-journal.jsonl')
}
