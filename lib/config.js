/** Plugin configuration defaults and validation (no external schema library). */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { DEFAULT_OCR_CONFIG, normalizeOcrConfig } from './ocr/config.js'

const MB = 1024 * 1024

export const DEFAULT_CONFIG = Object.freeze({
  roots: [],
  excludeGlobs: [],
  dbPath: '',
  maxFileBytes: 50 * MB,
  topK: 8,
  // Expansion is ON by default: it is what turns a vague "说不出" description
  // into searchable terms, and it degrades harmlessly (timeout + lexical
  // fallback) when no model is reachable. `normalizeConfig` treats only an
  // explicit `enabled: false` as opt-out.
  // A reasoning model needs more than a couple of seconds to answer even a
  // short prompt; the search still falls back to lexical matching if it is slow.
  expansion: { enabled: true, provider: '', model: '', timeoutMs: 12_000 },
  index: { batchMs: 20_000, maxFilesPerBatch: 50 },
  ocr: DEFAULT_OCR_CONFIG,
})

function positiveNumber(value, name) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} must be a positive number`)
  return number
}

export function normalizeConfig(input = {}) {
  const raw = input && typeof input === 'object' ? input : {}
  const expansion = { ...DEFAULT_CONFIG.expansion, ...(raw.expansion ?? {}) }
  const index = { ...DEFAULT_CONFIG.index, ...(raw.index ?? {}) }

  const roots = Array.isArray(raw.roots)
    ? raw.roots.map((root) => String(root).trim()).filter(Boolean)
    : []
  const excludeGlobs = Array.isArray(raw.excludeGlobs)
    ? raw.excludeGlobs.map((glob) => String(glob).trim()).filter(Boolean)
    : []

  const topK = Number(raw.topK ?? DEFAULT_CONFIG.topK)
  if (!Number.isInteger(topK) || topK < 1 || topK > 20) {
    throw new Error('topK must be an integer between 1 and 20')
  }

  return {
    roots,
    excludeGlobs,
    dbPath: String(raw.dbPath ?? '').trim(),
    maxFileBytes: positiveNumber(raw.maxFileBytes ?? DEFAULT_CONFIG.maxFileBytes, 'maxFileBytes'),
    topK,
    expansion: {
      // Only an explicit `false` opts out; absent or non-boolean keeps the
      // default, which is enabled.
      enabled: expansion.enabled === undefined ? DEFAULT_CONFIG.expansion.enabled : Boolean(expansion.enabled),
      provider: String(expansion.provider ?? '').trim(),
      model: String(expansion.model ?? '').trim(),
      timeoutMs: positiveNumber(expansion.timeoutMs ?? 12_000, 'expansion.timeoutMs'),
    },
    index: {
      batchMs: positiveNumber(index.batchMs ?? 20_000, 'index.batchMs'),
      maxFilesPerBatch: Math.floor(
        positiveNumber(index.maxFilesPerBatch ?? 50, 'index.maxFilesPerBatch'),
      ),
    },
    ocr: normalizeOcrConfig(raw.ocr),
  }
}

/** `$DSH_HOME/storages/file-recall/index.db` unless an explicit path is set. */
export function resolveDbPath(config) {
  if (config.dbPath === ':memory:') return ':memory:'
  if (config.dbPath) return resolve(config.dbPath)
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'storages', 'file-recall', 'index.db')
}
