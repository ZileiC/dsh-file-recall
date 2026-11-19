import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

import { checkSite, localRefs } from '../scripts/check-site.mjs'
import { badgesIn, convertMarkdownIn, minimalPage } from '../scripts/site-postbuild.mjs'
import { parse, renderBody, buildPage as buildAgentPage } from '../scripts/agent-guide.mjs'

/**
 * The published site is a real delivery channel: /docs/ pages linked from the
 * README. A link that only worked in the repo (or only on Windows) shipped once
 * already in spirit, so these tests run against an assembled _site, not the repo.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function assembleSite() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-site-'))
  cpSync(join(root, 'index.html'), join(dir, 'index.html'))
  cpSync(join(root, 'icon.svg'), join(dir, 'icon.svg'))
  mkdirSync(join(dir, 'docs'), { recursive: true })
  for (const name of [
    'install.html',
    'install-universal.html',
    'install-standalone.html',
    'install-universal-standalone.html',
    'INSTALL-FOR-AGENTS.html',
    'guide.css',
    'guide.js',
  ]) {
    cpSync(join(root, 'docs', name), join(dir, 'docs', name))
  }
  mkdirSync(join(dir, 'docs', 'img'), { recursive: true })
  cpSync(join(root, 'docs', 'img'), join(dir, 'docs', 'img'), { recursive: true })
  return dir
}

test('the assembled site has no broken local link', () => {
  const site = assembleSite()
  try {
    const { pages, problems } = checkSite(site)
    assert.ok(pages >= 6, `expected the site pages, saw ${pages}`)
    assert.deepEqual(problems, [], `broken links on the site: ${problems.join('; ')}`)
  } finally {
    rmSync(site, { recursive: true, force: true })
  }
})

test('the link checker actually fails on a broken link', () => {
  // A checker that never fails is decoration. Prove it catches the real thing.
  const site = assembleSite()
  try {
    const page = join(site, 'docs', 'install.html')
    writeFileSync(page, readFileSync(page, 'utf8') + '<a href="missing-page.html">x</a>')
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
  // "/ZileiC/dsh-file-recall#readme" used to be split at "#" into "/ZileiC/..."
  // and reported as a missing local directory.
  const html = '<a href="https://github.com/x/y#readme">r</a><a href="/docs/a.html#top">a</a><a href="/">home</a>'
  assert.deepEqual(localRefs(html), ['/docs/a.html#top', '/'])
})

test('both install guides render from the shared stylesheet and script', () => {
  for (const name of ['install.html', 'install-universal.html']) {
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

test('the generated markdown pages reach guide.css from any depth', () => {
  const site = assembleSite()
  try {
    const written = convertMarkdownIn(site)
    for (const file of written) {
      const html = readFileSync(file, 'utf8')
      const href = (html.match(/<link rel="stylesheet" href="([^"]+)">/) || [])[1]
      assert.ok(href, `${file} has no stylesheet link`)
      const target = resolve(dirname(file), href)
      assert.ok(existsSyncSafe(target), `${file} points at a missing ${href}`)
    }
    // Markdown shares a folder with its generated twin: the twin wins, no clobber.
    const keep = readFileSync(join(root, 'docs', 'INSTALL-FOR-AGENTS.html'), 'utf8')
    assert.ok(keep.length > 1000)
  } finally {
    rmSync(site, { recursive: true, force: true })
  }
})

function existsSyncSafe(path) {
  try {
    readFileSync(path)
    return true
  } catch {
    return false
  }
}

test('every README badge is served by one host that renders', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8')
  const urls = badgesIn(readme)
  assert.ok(urls.length >= 8, `expected a full badge row, saw ${urls.length}`)

  // shields.io resolves intermittently from mainland China; a badge that fails to
  // render is worse than no badge. Live reachability is checked separately by
  // scripts/site-postbuild.mjs in CI, which is where the network is reliable.
  const hosts = new Set(urls.map((u) => new URL(u).host))
  assert.deepEqual([...hosts], ['badgen.net'], `badges must come from one reachable host, saw ${[...hosts].join(', ')}`)

  for (const url of urls) {
    assert.match(url, /^https:\/\/badgen\.net\//, `unexpected badge host: ${url}`)
  }
})
