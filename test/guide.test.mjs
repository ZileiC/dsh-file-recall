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
 * everything looked right in the repo, and the phone showed an empty page. Then
 * the same class of bug nearly shipped again when the stylesheet moved out of the
 * page: a single file pointing at guide.css opens completely unstyled.
 *
 * Local verification in the wrong environment is not verification.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceHtml = readFileSync(join(root, 'docs', 'install-universal.html'), 'utf8')
const standaloneHtml = readFileSync(join(root, 'docs', 'install-universal-standalone.html'), 'utf8')

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
  const external = findExternalReferences(standaloneHtml)
  assert.deepEqual(
    external,
    [],
    `install-universal-standalone.html must not reference local files; found: ${external.join(', ')}`,
  )
})

test('the single file carries its own stylesheet and behaviour', () => {
  // A file that links guide.css opens unstyled when it travels alone.
  assert.match(standaloneHtml, /<style>[\s\S]{500,}<\/style>/, 'stylesheet was not inlined')
  assert.match(standaloneHtml, /<script>[\s\S]{500,}<\/script>/, 'behaviour was not inlined')
  assert.ok(standaloneHtml.includes('--navy-900'), 'design tokens missing from the single file')
  assert.ok(standaloneHtml.includes("querySelectorAll('.tl li')"), 'timeline script missing')
  assert.ok(standaloneHtml.includes('navigator.clipboard'), 'copy behaviour missing')
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
  const { html } = buildStandalone({ root, source: 'install-universal.html' })
  assert.equal(
    standaloneHtml,
    html,
    "install-universal.html's single-file build is stale — run: node scripts/bundle-guide.mjs",
  )
})

test('the source page keeps its images next to it, and they exist', () => {
  const refs = [...sourceHtml.matchAll(/src="(img\/[^"]+)"/g)].map((m) => m[1])
  assert.ok(refs.length >= 2, 'source page should reference the two real screenshots')
  for (const relPath of refs) {
    const bytes = readFileSync(join(root, 'docs', relPath)) // throws when missing
    assert.ok(bytes.length > 10_000, `${relPath} looks truncated (${bytes.length} bytes)`)
    assert.equal(bytes[0], 0x89, `${relPath} is not a PNG`)
  }
})

test('the guide offers no command line to the reader', () => {
  // A reader-facing page must not hand them terminal commands; the copyable blocks
  // are prose addressed to the agent.
  const codeBlocks = [...sourceHtml.matchAll(/<pre class="copy"[^>]*>([\s\S]*?)<\/pre>/g)]
  assert.ok(codeBlocks.length >= 4, 'expected the four copyable blocks')
  for (const [, body] of codeBlocks) {
    assert.doesNotMatch(
      body,
      /(^|\n)\s*(sudo|npm|npx|git clone|brew)\b/,
      `terminal command leaked into the page: ${body.slice(0, 60)}`,
    )
  }
})

test('the guide reads like writing, not like generated text', () => {
  const tells = Object.entries(writingTells(proseOf(sourceHtml))).filter(([, count]) => count > 0)
  assert.deepEqual(tells, [], `install-universal.html still carries machine-writing markers: ${JSON.stringify(tells)}`)
})

test('the public guide addresses a general macOS reader', () => {
  // The public repository must not carry anyone's family context or real name.
  // The words are base64-encoded on purpose: a guard that spells out the real name
  // would republish the thing it protects.
  const forbidden = ['5oiR54i4', '5L2g54i4', '6ZmI5a2c56OK', '5omT5bel55qE', '6ICB54i4'].map(
    (b64) => Buffer.from(b64, 'base64').toString('utf8'),
  )
  for (const word of forbidden) {
    assert.equal(sourceHtml.includes(word), false, `public copy still addresses one specific person ("${word[0]}…")`)
  }
  assert.equal(sourceHtml.includes('自我介绍一下'), false, 'a personal intro does not belong in the public guide')
  // It must still keep the two hard-won instructions.
  assert.match(sourceHtml, /不要直接点它/, 'the Windows button trap must stay explained')
  assert.match(sourceHtml, /releases\/latest/, 'the offline fallback must stay reachable')
})

test('the public guide keeps the seven-step structure', () => {
  const steps = [...sourceHtml.matchAll(/<section class="step" id="(s\d)">/g)].map((m) => m[1])
  assert.deepEqual(steps, ['s1', 's2', 's3', 's4', 's5', 's6', 's7'])
  assert.equal((sourceHtml.match(/<svg /g) || []).length, 6, 'expected six action diagrams')
  assert.equal((sourceHtml.match(/data-copy/g) || []).length, 4, 'expected four copyable blocks')
})
