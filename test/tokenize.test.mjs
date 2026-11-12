import test from 'node:test'
import assert from 'node:assert/strict'

import {
  splitRuns,
  tokenizeText,
  tokenizeQuery,
  toFtsQuery,
  queryToFts,
} from '../lib/tokenize.js'

test('splits CJK and latin runs, dropping separators', () => {
  const runs = splitRuns('2023年度 Budget-Plan，预算')
  assert.deepEqual(
    runs.map((run) => [run.type, run.chars.join('')]),
    [
      ['word', '2023'],
      ['cjk', '年度'],
      ['word', 'Budget'],
      ['word', 'Plan'],
      ['cjk', '预算'],
    ],
  )
})

test('index text keeps overlapping bigrams and unigrams', () => {
  const tokens = tokenizeText('部门预算的说明')
  for (const expected of ['部门', '门预', '预算', '算的', '的说', '说明']) {
    assert.ok(tokens.includes(expected), `missing bigram ${expected}`)
  }
  // unigrams make single-character queries work mid-run
  for (const expected of ['部', '门', '预', '算', '说', '明']) {
    assert.ok(tokens.includes(expected), `missing unigram ${expected}`)
  }
})

test('two-character query becomes one bigram', () => {
  assert.deepEqual(tokenizeQuery('预算'), ['预算'])
  assert.equal(queryToFts('预算'), '"预算"')
})

test('four-character query becomes overlapping bigrams joined by AND', () => {
  assert.deepEqual(tokenizeQuery('绩效指标'), ['绩效', '效指', '指标'])
  assert.equal(queryToFts('绩效指标'), '"绩效" AND "效指" AND "指标"')
})

test('single-character query stays a unigram', () => {
  assert.deepEqual(tokenizeQuery('鱼'), ['鱼'])
  assert.deepEqual(tokenizeQuery('鱼'), tokenizeQuery('  鱼  '))
})

test('mixed Chinese / latin / digits', () => {
  assert.deepEqual(tokenizeQuery('2023 年度 Budget Plan 预算'), [
    '2023',
    '年度',
    'budget',
    'plan',
    '预算',
  ])
})

test('duplicates are removed from queries', () => {
  assert.deepEqual(tokenizeQuery('预算 预算'), ['预算'])
})

test('empty and punctuation-only input produce no tokens', () => {
  assert.deepEqual(tokenizeQuery('，。！？  '), [])
  assert.equal(queryToFts('，。！？'), '')
})

test('FTS expression escapes double quotes', () => {
  assert.equal(toFtsQuery(['a"b']), '"a""b"')
})
