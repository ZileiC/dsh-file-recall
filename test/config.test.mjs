import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_CONFIG, normalizeConfig, resolveDbPath } from '../lib/config.js'

/**
 * Query expansion is the only thing that turns a vague "说不出" description into
 * searchable terms. It shipped defaulting to OFF, which made every search report
 * `no query expander configured` while the tool looked healthy. These tests pin
 * the default so that regression cannot come back silently.
 */
test('query expansion defaults to enabled', () => {
  assert.equal(DEFAULT_CONFIG.expansion.enabled, true)
  assert.equal(normalizeConfig({}).expansion.enabled, true)
  assert.equal(normalizeConfig({ expansion: {} }).expansion.enabled, true)
  assert.equal(normalizeConfig({ expansion: { provider: 'p', model: 'm' } }).expansion.enabled, true)
})

test('only an explicit false opts out of query expansion', () => {
  assert.equal(normalizeConfig({ expansion: { enabled: false } }).expansion.enabled, false)
  assert.equal(normalizeConfig({ expansion: { enabled: true } }).expansion.enabled, true)
})

test('expansion timeout has a usable default and must be positive', () => {
  assert.ok(normalizeConfig({}).expansion.timeoutMs > 0)
  assert.throws(() => normalizeConfig({ expansion: { timeoutMs: 0 } }))
})

test('topK is validated', () => {
  assert.equal(normalizeConfig({}).topK, DEFAULT_CONFIG.topK)
  assert.throws(() => normalizeConfig({ topK: 0 }))
  assert.throws(() => normalizeConfig({ topK: 21 }))
  assert.throws(() => normalizeConfig({ topK: 2.5 }))
})

test('db path resolves under DSH_HOME unless explicitly set', () => {
  const previous = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = 'C:/tmp/dsh-home'
    assert.match(resolveDbPath(normalizeConfig({})).replace(/\\/g, '/'), /C:\/tmp\/dsh-home\/storages\/file-recall\/index\.db$/)
    assert.equal(resolveDbPath(normalizeConfig({ dbPath: ':memory:' })), ':memory:')
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})
