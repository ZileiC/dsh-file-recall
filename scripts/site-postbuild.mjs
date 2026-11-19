#!/usr/bin/env node
/**
 * Two post-build steps for the Pages artifact:
 *
 *   node scripts/site-postbuild.mjs <site-dir>
 *
 * 1. Turn the .md files that ship in docs/ into pages. Pages otherwise serves
 *    them as raw text, which looks broken next to a styled guide. This looks for
 *    the generated twin (<name>.html next to <name>.md) and, when there is none,
 *    wraps the Markdown in a minimal shell so the link still lands somewhere.
 * 2. Check the badges in the README through this machine's network. A badge in
 *    this repo is a promise that the image renders; adding one that silently 502s
 *    is worse than having none, so the deploy fails instead.
 */
import { readdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Markdown -> the smallest useful HTML, for docs Pages has no generated twin for. */
export function minimalPage(markdown, title, cssHref = 'guide.css') {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const out = []
  let inCode = false
  const code = []

  for (const line of lines) {
    if (/^```/.test(line)) {
      if (inCode) {
        out.push(`<pre class="code"><code>${escapeHtml(code.join('\n'))}</code></pre>`)
        code.length = 0
        inCode = false
      } else {
        inCode = true
      }
      continue
    }
    if (inCode) { code.push(line); continue }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      out.push(`<h${heading[1].length}>${escapeHtml(heading[2])}</h${heading[1].length}>`)
      continue
    }
    if (!line.trim()) continue
    const text = escapeHtml(line)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    out.push(`<p>${text}</p>`)
  }
  if (inCode && code.length) out.push(`<pre class="code"><code>${escapeHtml(code.join('\n'))}</code></pre>`)

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · dsh-file-recall</title>
<link rel="stylesheet" href="${cssHref}">
<style>
  .prose { max-width: 62rem; margin: 0 auto; padding: 3rem 1.5rem 6rem; }
  .prose h1 { font-size: 1.9rem; margin: 0 0 1.4rem; }
  .prose h2 { font-size: 1.25rem; margin: 2.4rem 0 .8rem; }
  .prose h3 { font-size: 1.05rem; margin: 1.8rem 0 .6rem; }
  .prose p { color: var(--ink-2); margin: 0 0 .9rem; }
  .prose code { font-family: var(--mono); font-size: .9em; background: var(--rule-2); padding: .08em .32em; border-radius: 4px; }
  .prose pre.code { font-family: var(--mono); font-size: 14px; background: var(--surface); border: 1px solid var(--rule); border-radius: 10px; padding: 1rem; overflow-x: auto; }
  .prose pre.code code { background: none; padding: 0; }
</style></head>
<body><div class="prose">
<p class="back"><a href="/">全部文档</a></p>
${out.join('\n')}
</div></body></html>
`
}

export function convertMarkdownIn(siteDir) {
  const written = []
  // One sheet lives in docs/. A page at <site>/docs/ needs "guide.css"; a page at
  // <site>/docs/img/ needs "../guide.css". Depth is counted from docs/, not from
  // the site root, because that is where guide.css actually sits.
  const docsDir = join(siteDir, 'docs')
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!entry.name.endsWith('.md')) continue
      const twin = full.slice(0, -'.md'.length) + '.html'
      if (existsSync(twin)) continue // a generated page already exists
      const title = entry.name.replace(/\.md$/, '')
      const depth = relative(docsDir, dirname(full)).split(/[\\/]/).filter((seg) => seg && seg !== '.').length
      const cssHref = depth > 0 ? '../'.repeat(depth) + 'guide.css' : 'guide.css'
      writeFileSync(twin, minimalPage(readFileSync(full, 'utf8'), title, cssHref), 'utf8')
      written.push(twin)
    }
  }
  walk(siteDir)
  return written
}

/** Every badge image referenced by the README, in document order. */
export function badgesIn(readme) {
  const urls = []
  for (const m of readme.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)) urls.push(m[1])
  return urls
}

export async function checkBadges(urls, { timeoutMs = 20000 } = {}) {
  const results = []
  for (const url of urls) {
    const started = Date.now()
    try {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
      const body = await res.text()
      const type = res.headers.get('content-type') || ''
      // A badge service that cannot reach GitHub still answers 200 with an error
      // picture, so the body has to be inspected, not just the status.
      const title = (body.match(/<title>([^<]*)<\/title>/) || [, ''])[1]
      const broken = /error|not found|invalid|upgrade required|too large|resource/i.test(title)
      results.push({
        url,
        ok: res.status === 200 && /svg/.test(type) && !broken,
        status: res.status,
        type,
        title,
        ms: Date.now() - started
      })
    } catch (error) {
      results.push({ url, ok: false, status: 0, error: error.message, ms: Date.now() - started })
    }
  }
  return results
}

async function main() {
  const siteDir = process.argv[2]
  if (siteDir) {
    const written = convertMarkdownIn(siteDir)
    console.log(`markdown pages generated: ${written.length}`)
    for (const f of written) console.log(`  + ${f}`)
  } else {
    console.log('no site dir given: skipping markdown conversion')
  }

  const readme = readFileSync(join(repo, 'README.md'), 'utf8')
  const urls = badgesIn(readme)
  console.log(`\nbadges in README: ${urls.length}`)
  const results = await checkBadges(urls)
  const failed = []
  for (const r of results) {
    const label = r.url.replace(/^https?:\/\//, '')
    if (r.ok) {
      console.log(`  ok   ${String(r.ms).padStart(5)}ms  ${r.title || '(no title)'}  ${label}`)
    } else {
      failed.push(r)
      console.log(`  FAIL ${String(r.ms).padStart(5)}ms  status=${r.status} type=${r.type || '-'} title="${r.title || ''}" ${r.error || ''}  ${label}`)
    }
  }
  if (failed.length) {
    console.error(`\n${failed.length} badge(s) do not render; remove or fix them before deploying`)
    process.exit(1)
  }
  console.log('\nall badges render')
}

if (process.argv[1] && process.argv[1].endsWith('site-postbuild.mjs')) main()
