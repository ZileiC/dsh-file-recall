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

test('the deliverable has no local file references at all', () => {
  const external = findExternalReferences(standaloneHtml)
  assert.deepEqual(
    external,
    [],
    `single-file build must not reference local files; found: ${external.join(', ')}`,
  )
})

test('every image in the deliverable is a data URI', () => {
  const imgTags = standaloneHtml.match(/<img[^>]*>/g) || []
  assert.ok(imgTags.length >= 2, 'expected the hero portrait and the step-1 close-up')
  for (const tag of imgTags) {
    assert.match(tag, /src="data:image\//, `image is not inlined: ${tag.slice(0, 80)}`)
  }
})

test('the committed single file is up to date with the source page', () => {
  // Rebuild in memory and compare: editing docs/install.html without re-running
  // the bundler must fail here, not in the recipient's hands.
  const { html } = buildStandalone({ root })
  assert.equal(
    standaloneHtml,
    html,
    'docs/install-standalone.html is stale — run: node scripts/bundle-guide.mjs',
  )
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
