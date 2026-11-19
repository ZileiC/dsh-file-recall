import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildStandalone, findExternalReferences } from '../scripts/bundle-guide.mjs'

/**
 * The guide is delivered as ONE file, opened on a phone, with no sibling folder.
 *
 * The bug these tests exist for shipped once: every image was a relative path,
 * everything looked right in the repo, and the phone showed an empty page. Local
 * verification in the wrong environment is not verification.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceHtml = readFileSync(join(root, 'docs', 'install.html'), 'utf8')
const standaloneHtml = readFileSync(join(root, 'docs', 'install-standalone.html'), 'utf8')
const universalHtml = readFileSync(join(root, 'docs', 'install-universal.html'), 'utf8')
const universalStandaloneHtml = readFileSync(
  join(root, 'docs', 'install-universal-standalone.html'),
  'utf8',
)

/** Strip tags so the checks read prose, not markup. */
function proseOf(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}

/** Markers that make text read machine-written rather than human-written. */
function writingTells(text) {
  return {
    'em dash': (text.match(/——/g) || []).length,
    ellipsis: (text.match(/……/g) || []).length,
    arrow: (text.match(/→/g) || []).length,
    'halfwidth comma between CJK': (text.match(/[^\x00-\x7F],[^\x00-\x7F]/g) || []).length,
    'curly quotes': (text.match(/[“”]/g) || []).length,
    'signposting (让我们/接下来)': (text.match(/让我们|接下来我们/g) || []).length,
    'template connectives (首先/其次/总之)': (text.match(/首先|其次|总之|综上/g) || []).length,
    'hype words (赋能/助力/打造)': (text.match(/赋能|助力|打造|护航/g) || []).length,
  }
}

test('the deliverable has no local file references at all', () => {
  for (const [name, html] of [
    ['install-standalone.html', standaloneHtml],
    ['install-universal-standalone.html', universalStandaloneHtml],
  ]) {
    const external = findExternalReferences(html)
    assert.deepEqual(
      external,
      [],
      `${name} must not reference local files; found: ${external.join(', ')}`,
    )
  }
})

test('every image in the deliverable is a data URI', () => {
  const imgTags = standaloneHtml.match(/<img[^>]*>/g) || []
  assert.ok(imgTags.length >= 2, 'expected the hero portrait and the step-1 close-up')
  for (const tag of imgTags) {
    assert.match(tag, /src="data:image\//, `image is not inlined: ${tag.slice(0, 80)}`)
  }
})

test('the committed single file is up to date with the source page', () => {
  // Rebuild in memory and compare: editing a page without re-running the bundler
  // must fail here, not in the recipient's hands.
  for (const [source, committed] of [
    ['install.html', standaloneHtml],
    ['install-universal.html', universalStandaloneHtml],
  ]) {
    const { html } = buildStandalone({ root, source })
    assert.equal(
      committed,
      html,
      `${source}'s single-file build is stale — run: node scripts/bundle-guide.mjs`,
    )
  }
})

test('the source page keeps its images next to it, and they exist', () => {
  const refs = [...sourceHtml.matchAll(/src="(img\/[^"]+)"/g)].map((m) => m[1])
  assert.ok(refs.length >= 2, 'source page should reference the two real screenshots')
  for (const relPath of refs) {
    const absolute = join(root, 'docs', relPath)
    const bytes = readFileSync(absolute) // throws when missing
    assert.ok(bytes.length > 10_000, `${relPath} looks truncated (${bytes.length} bytes)`)
    assert.equal(bytes[0], 0x89, `${relPath} is not a PNG`)
  }
})

test('the guide offers no command line to the reader', () => {
  // A reader-facing page must not hand him terminal commands; the two copyable
  // blocks in step 4 are prose addressed to the agent.
  const codeBlocks = [...sourceHtml.matchAll(/<pre class="copy"[^>]*>([\s\S]*?)<\/pre>/g)]
  assert.ok(codeBlocks.length >= 4, 'expected the four copyable blocks')
  for (const [, body] of codeBlocks) {
    assert.doesNotMatch(body, /(^|\n)\s*(sudo|npm|npx|git clone|brew)\b/, `terminal command leaked into the page: ${body.slice(0, 60)}`)
  }
})

test('both guides read like writing, not like generated text', () => {
  for (const [name, html] of [
    ['install.html', sourceHtml],
    ['install-universal.html', universalHtml],
  ]) {
    const tells = Object.entries(writingTells(proseOf(html))).filter(([, count]) => count > 0)
    assert.deepEqual(tells, [], `${name} still carries machine-writing markers: ${JSON.stringify(tells)}`)
  }
})

test('the universal guide addresses a general macOS reader', () => {
  // It must not assume the father: no family references, and no joke persona.
  assert.doesNotMatch(universalHtml, /陈孜磊|打工的|老爸|爸/, 'universal copy still talks to one specific person')
  assert.doesNotMatch(universalHtml, /自我介绍一下/, 'the personal intro belongs to the father version only')
  // It must still keep the two hard-won instructions.
  assert.match(universalHtml, /不要直接点它/, 'the Windows button trap must stay explained')
  assert.match(universalHtml, /releases\/latest/, 'the offline fallback must stay reachable')
})

test('the universal guide keeps the same structure as the father version', () => {
  const steps = (html) => [...html.matchAll(/<section class="step" id="(s\d)">/g)].map((m) => m[1])
  assert.deepEqual(steps(universalHtml), steps(sourceHtml), 'step ids diverged between the two guides')
  assert.equal((universalHtml.match(/<svg /g) || []).length, (sourceHtml.match(/<svg /g) || []).length)
  assert.equal((universalHtml.match(/data-copy/g) || []).length, (sourceHtml.match(/data-copy/g) || []).length)
})
