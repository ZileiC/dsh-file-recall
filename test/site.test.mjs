import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

import { checkSite, localRefs } from '../scripts/check-site.mjs'
import { assemble, badgesIn } from '../scripts/site-postbuild.mjs'
import { ROOT_FILES, DOCS_FILES, FORBIDDEN } from '../scripts/site-manifest.mjs'
import { parse, renderBody, buildPage as buildAgentPage } from '../scripts/agent-guide.mjs'

/**
 * The published site is a real delivery channel, and it leaked once.
 *
 * An earlier version of this script copied `docs/` wholesale onto GitHub Pages,
 * which published an internal acceptance note quoting a real client engagement.
 * These tests exist so that cannot happen again: the site is assembled from an
 * explicit manifest, and a privacy scan runs over everything that ships.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function assembled() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-site-'))
  assemble(dir)
  return dir
}

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

test('the assembled site has no broken local link', () => {
  const site = assembled()
  try {
    const { pages, problems } = checkSite(site)
    assert.ok(pages >= 3, `expected the site pages, saw ${pages}`)
    assert.deepEqual(problems, [], `broken links on the site: ${problems.join('; ')}`)
  } finally {
    rmSync(site, { recursive: true, force: true })
  }
})

test('the link checker actually fails on a broken link', () => {
  // A checker that never fails is decoration. Prove it catches the real thing.
  const site = assembled()
  try {
    const page = join(site, 'docs', 'install-universal.html')
    writeFileSync(page, readFileSync(page, 'utf8') + '<a href="missing-page.html">x</a>', 'utf8')
    const { problems } = checkSite(site)
    assert.ok(
      problems.some((p) => p.includes('missing-page.html')),
      'the checker missed a link that points nowhere',
    )
  } finally {
    rmSync(site, { recursive: true, force: true })
  }
})

test('a url fragment is not mistaken for a root link', () => {
  // "/ZileiC/dsh-file-recall#readme" used to be split at "#" and reported as a
  // missing local directory.
  const html = '<a href="https://github.com/x/y#readme">r</a><a href="/docs/a.html#top">a</a><a href="/">home</a>'
  assert.deepEqual(localRefs(html), ['/docs/a.html#top', '/'])
})

test('both published pages render from the shared stylesheet and script', () => {
  for (const name of ['install-universal.html']) {
    const html = readFileSync(join(root, 'docs', name), 'utf8')
    assert.match(html, /<link rel="stylesheet" href="guide\.css">/, `${name} must use the shared sheet`)
    assert.match(html, /<script src="guide\.js"><\/script>/, `${name} must use the shared script`)
    assert.doesNotMatch(html, /<style>/, `${name} must not carry a private stylesheet`)
  }
})

test('the site index links to every document a reader needs', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8')
  for (const target of [
    './docs/install-universal.html',
    './docs/install-universal-standalone.html',
    './docs/INSTALL-FOR-AGENTS.html',
  ]) {
    assert.ok(html.includes(`href="${target}"`), `index.html does not link ${target}`)
  }
})

test('the agent guide page is generated from its Markdown, not hand-written', () => {
  // Editing docs/INSTALL-FOR-AGENTS.md without re-running the generator must fail
  // here instead of leaving the published page describing the old procedure.
  const md = readFileSync(join(root, 'docs', 'INSTALL-FOR-AGENTS.md'), 'utf8')
  const committed = readFileSync(join(root, 'docs', 'INSTALL-FOR-AGENTS.html'), 'utf8')
  assert.equal(committed, buildAgentPage(md, { inline: false }), 'run: node scripts/agent-guide.mjs')
})

test('the markdown subset renders structure, not raw syntax', () => {
  const blocks = parse('# Title\n\nIntro **bold** and `code`.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- one\n- two\n')
  const html = renderBody(blocks)
  assert.match(html, /<h1 id="title">Title<\/h1>/)
  assert.match(html, /<strong>bold<\/strong>/)
  assert.match(html, /<code>code<\/code>/)
  assert.match(html, /<table>[\s\S]*<th>a<\/th>/)
  assert.match(html, /<li>one<\/li>/)
  assert.doesNotMatch(html, /\*\*/, 'markdown emphasis leaked through as literal asterisks')
  assert.doesNotMatch(html, /^\|/m, 'a table row leaked through as literal pipes')
})

test('the publish manifest names every file that actually ships', () => {
  // Nothing may reach the site that the manifest does not name. If someone adds a
  // file to docs/ expecting it online, this is where they find out it does not.
  const site = assembled()
  try {
    const shipped = walk(site)
      .map((f) => f.slice(site.length + 1).split('\\').join('/'))
      .sort()
    const expected = [
      ...ROOT_FILES,
      ...DOCS_FILES.map((f) => 'docs/' + f),
    ].sort()
    assert.deepEqual(shipped, expected)
  } finally {
    rmSync(site, { recursive: true, force: true })
  }
})

test('no published page or asset mentions a person, a client or an internal note', () => {
  // The regression this exists for: an internal acceptance note quoting a real
  // client engagement shipped to a public URL. Scan what actually ships, not what
  // the manifest claims.
  //
  // The words are stored base64-encoded on purpose. A guard that lists the real
  // name and the real client names in plain text would republish exactly what it
  // is meant to protect. Decode at run time; never paste the literals here.
  const encoded = [
    ['2', '54i25Lqy'],       // family: father
    ['2', '5YS/5a2Q'],       // family: son
    ['2', '54i454i4'],       // family: dad
    ['2', '6ZW/6L6I'],       // family: elder
    ['2', '6ICB5aaI'],       // family: mother
    ['2', '5aaI5aaI'],       // family: mum
    ['2', '5Z2m5YWL'],       // client name (1 char)
    ['2', '5p6B5rCq'],       // client name (1 char)
    ['2', '54yb5aOr'],       // client name (1 char)
    ['4', '5L2T5qOA5oql5ZGK'], // personal record type
    ['2', '55eF5Y6G'],
    ['4', '6aqM5pS25riF5Y2V'], // internal process word
    ['4', '5Lq65bel6aqM5pS2'], // internal process word
    ['3', '6ZmI5a2c56OK'],     // the repo owner's real name
    ['3', '5omT5bel55qE'],
    ['2', '6ICB54i4']
  ]
  const forbiddenText = encoded.map(([len, b64]) => {
    const word = Buffer.from(b64, 'base64').toString('utf8')
    assert.equal(word.length, Number(len), 'encoded guard word is corrupt')
    return new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  })
  // Local machine paths, also encoded: a username in a regex is the same leak.
  const user = Buffer.from('amhhcmF5ZGVu', 'base64').toString('utf8')
  forbiddenText.push(new RegExp(`C:\\\\Users|D:\\\\obsidian|${user}`, 'i'))
  const site = assembled()
  try {
    const offenders = []
    for (const file of walk(site)) {
      const name = file.slice(site.length + 1)
      for (const word of FORBIDDEN) {
        if (name.toLowerCase().includes(word.toLowerCase())) offenders.push(`${name} (filename)`)
      }
      if (!/\.(html|css|js|md|json|svg)$/i.test(file)) continue
      const text = readFileSync(file, 'utf8')
      for (const re of forbiddenText) {
        const hit = text.match(re)
        if (hit) offenders.push(`${name}: ${hit[0]}`)
      }
    }
    assert.deepEqual(offenders, [], `published site carries private content: ${offenders.join('; ')}`)
  } finally {
    rmSync(site, { recursive: true, force: true })
  }
})

test('internal development notes are not in the repository at all', () => {
  // They live outside the repo now (../private-notes). Making them public was the
  // incident, so this asserts they are simply absent.
  for (const gone of ['docs/ACCEPTANCE.md', 'docs/design-notes.md', 'docs/GUIDE-SPEC.md']) {
    let exists = true
    try {
      statSync(join(root, gone))
    } catch {
      exists = false
    }
    assert.equal(exists, false, `${gone} must not live in a public repo`)
  }
})

test('every README badge is served by one reachable host', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8')
  const urls = badgesIn(readme)
  assert.ok(urls.length >= 8, `expected a full badge row, saw ${urls.length}`)

  // shields.io resolves intermittently from mainland China; a badge that fails to
  // render is worse than no badge. Live reachability is checked by
  // scripts/site-postbuild.mjs in CI, where the network is reliable.
  for (const url of urls) {
    assert.match(url, /^https:\/\/badgen\.net\//, `unexpected badge host: ${url}`)
  }
})
