import test from 'node:test'
import assert from 'node:assert/strict'

import { createActivityLog } from '../lib/activity.js'

function searchResult(overrides = {}) {
  return {
    query: '讲文化相对主义的那堂课',
    expandedTerms: ['文化相对论', '课堂笔记'],
    hits: [
      { path: 'D:/vault/a/deck.pptx', locator: 'slide 4', kind: 'slide', snippet: '文化相对主义', score: 0.9 },
      { path: 'D:/vault/a/notes.md', locator: 'block 12', kind: 'block', snippet: '笔记', score: 0.4 },
    ],
    degraded: false,
    degradedReason: null,
    relaxed: false,
    ...overrides,
  }
}

test('record captures the fields the panel animates', () => {
  const log = createActivityLog({ now: () => 1_700_000_000_000 })
  const event = log.record({ query: '讲文化相对主义的那堂课', result: searchResult(), ms: 42 })

  assert.deepEqual(event.terms, ['文化相对论', '课堂笔记'])
  assert.equal(event.hits, 2)
  assert.equal(event.ms, 42)
  assert.equal(event.at, 1_700_000_000_000)
  assert.equal(event.degraded, false)
  assert.equal(event.relaxed, false)
  assert.equal(event.top.length, 2)
  assert.equal(event.top[0].locator, 'slide 4')
  assert.equal(event.top[0].kind, 'slide')
})

test('only the first three hits are kept', () => {
  const log = createActivityLog()
  const hits = Array.from({ length: 6 }, (_unused, index) => ({
    path: `D:/vault/f${index}.md`,
    locator: `block ${index}`,
  }))
  const event = log.record({ query: 'q', result: searchResult({ hits }) })
  assert.equal(event.hits, 6)
  assert.equal(event.top.length, 3)
})

test('ids are monotonic and since() returns only newer events', () => {
  const log = createActivityLog()
  const first = log.record({ query: 'one', result: searchResult() })
  const second = log.record({ query: 'two', result: searchResult() })
  assert.equal(second.id, first.id + 1)

  assert.deepEqual(log.since(first.id).map((event) => event.query), ['two'])
  assert.deepEqual(log.since(second.id), [])
  // A cursor of 0 (fresh page) gets everything.
  assert.equal(log.since(0).length, 2)
  assert.equal(log.latestId(), second.id)
})

test('the log is bounded and keeps the newest events', () => {
  const log = createActivityLog({ limit: 3 })
  for (let index = 0; index < 5; index += 1) log.record({ query: `q${index}`, result: searchResult() })
  const all = log.list()
  assert.equal(all.length, 3)
  assert.deepEqual(all.map((event) => event.query), ['q2', 'q3', 'q4'])
})

test('degraded and relaxed searches are reported, not hidden', () => {
  const log = createActivityLog()
  const event = log.record({
    query: 'q',
    result: searchResult({ degraded: true, degradedReason: 'no query expander configured', relaxed: true }),
  })
  assert.equal(event.degraded, true)
  assert.match(event.degradedReason, /expander/)
  assert.equal(event.relaxed, true)
})

test('a failed search is recorded with its message and error field', () => {
  const log = createActivityLog()
  const event = log.record({ query: 'q', ms: 12, error: 'boom' })
  assert.equal(event.error, 'boom')
  assert.equal(event.hits, 0)
  assert.deepEqual(event.top, [])
})

test('record keeps the session id so a strip cannot leak between conversations', () => {
  const log = createActivityLog()
  const withSession = log.record({
    query: 'q1',
    result: searchResult(),
    sessionId: 'session-a',
  })
  const withoutSession = log.record({ query: 'q2', result: searchResult() })
  assert.equal(withSession.sessionId, 'session-a')
  assert.equal(withoutSession.sessionId, null)
  // Long ids are clipped like every other free-text field.
  const clipped = log.record({ query: 'q3', result: searchResult(), sessionId: 'x'.repeat(200) })
  assert.ok(clipped.sessionId.length <= 64)
})

test('returned events are detached copies', () => {
  const log = createActivityLog()
  log.record({ query: 'q', result: searchResult() })
  const snapshot = log.list()
  snapshot[0].query = 'mutated'
  snapshot[0].terms.push('injected')
  assert.equal(log.list()[0].query, 'q')
  assert.deepEqual(log.list()[0].terms, ['文化相对论', '课堂笔记'])
})

test('record never throws on junk input', () => {
  const log = createActivityLog()
  assert.doesNotThrow(() => log.record())
  assert.doesNotThrow(() => log.record({ result: null }))
  assert.equal(log.latestId(), 2)
})

test('long text is clipped so a poll stays small', () => {
  const log = createActivityLog()
  const event = log.record({
    query: 'x'.repeat(400),
    result: searchResult({
      hits: [{ path: 'D:/' + 'y'.repeat(400), locator: 'p1', snippet: 'z'.repeat(400) }],
    }),
  })
  assert.ok(event.query.length <= 160)
  assert.ok(event.top[0].snippet.length <= 110)
})
