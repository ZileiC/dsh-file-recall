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
  expansion: { enabled: false, provider: '', model: '', timeoutMs: 3_000 },
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
      enabled: expansion.enabled !== false,
      provider: String(expansion.provider ?? '').trim(),
      model: String(expansion.model ?? '').trim(),
      timeoutMs: positiveNumber(expansion.timeoutMs ?? 3_000, 'expansion.timeoutMs'),
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
