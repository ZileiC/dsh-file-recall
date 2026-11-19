#!/usr/bin/env node
/**
 * Assembles the publishable site from an explicit manifest.
 *
 *   node scripts/site-postbuild.mjs <site-dir>
 *
 * The manifest is the whole point: an earlier version copied `docs/` wholesale,
 * which published an internal acceptance note containing a real client engagement.
 * Nothing is published unless it is named in scripts/site-manifest.mjs, and the
 * build refuses if a forbidden name manages to get in anyway.
 *
 * Also checks that every badge in the README actually renders: a badge that 200s
 * with an error picture is broken too.
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ROOT_FILES, DOCS_FILES, FORBIDDEN } from './site-manifest.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')

/** Copy exactly what the manifest allows. Returns the published file list. */
export function assemble(siteDir) {
  const published = []
  for (const name of ROOT_FILES) {
    const from = join(repo, name)
    if (!existsSync(from)) throw new Error(`manifest names a root file that does not exist: ${name}`)
    mkdirSync(siteDir, { recursive: true })
    copyFileSync(from, join(siteDir, name))
    published.push(name)
  }
  for (const name of DOCS_FILES) {
    const from = join(repo, 'docs', name)
    if (!existsSync(from)) throw new Error(`manifest names a docs file that does not exist: ${name}`)
    const to = join(siteDir, 'docs', name)
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
    published.push(join('docs', name))
  }

  // Belt and braces: nothing forbidden may reach the output, whatever the manifest says.
  for (const item of published) {
    const hit = FORBIDDEN.find((word) => item.toLowerCase().includes(word.toLowerCase()))
    if (hit) throw new Error(`refusing to publish ${item}: matches forbidden pattern "${hit}"`)
  }
  return published
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
    const published = assemble(siteDir)
    console.log(`published ${published.length} files from the manifest:`)
    for (const f of published) console.log(`  + ${f}`)
  } else {
    console.log('no site dir given: skipping assembly')
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
