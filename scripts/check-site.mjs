#!/usr/bin/env node
/**
 * Checks the assembled site for links and assets that would 404 once deployed.
 *
 * Deliberately dumb and dependency-free: it walks every .html under the given
 * directory, pulls out href/src values, and asserts that every *local* one
 * resolves to a file that exists. External URLs are listed but not fetched:
 * a deploy must not depend on someone else's uptime.
 *
 * Usage: node scripts/check-site.mjs _site
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, relative } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')

export function htmlFiles(root) {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.html')) out.push(full)
    }
  }
  walk(root)
  return out
}

/** Every href/src in a page, minus anchors, mailto and data URIs. */
export function localRefs(html) {
  const refs = []
  const re = /(?:href|src)\s*=\s*"([^"]*)"/g
  let m
  while ((m = re.exec(html)) !== null) {
    const value = m[1].trim()
    if (!value) continue
    // The protocol allow-list goes FIRST. Checking for a leading "#" first would
    // treat the "#" inside a url fragment such as "/docs/x#readme" as an anchor.
    if (/^(data:|https?:|mailto:|javascript:|#|\/\/)/i.test(value)) continue
    refs.push(value)
  }
  return refs
}

export function checkSite(root) {
  const problems = []
  const external = new Set()
  const pages = htmlFiles(root)

  if (pages.length === 0) problems.push(`${root}: no .html files found`)

  for (const page of pages) {
    const html = readFileSync(page, 'utf8')
    const refs = localRefs(html)
    for (const ref of refs) {
      const clean = ref.split('#')[0].split('?')[0]
      if (!clean || clean === '/') {
        // "" or "/" means the site root, which is index.html.
        if (!existsSync(join(root, 'index.html'))) {
          problems.push(`${relative(root, page)} -> ${ref || '(empty)'} (site root has no index.html)`)
        }
        continue
      }
      // A root-relative path means "from the site root" for the browser, but on
      // disk the site root is what the server publishes, i.e. <site>/docs.
      const target = clean.startsWith('/')
        // join() would treat a leading "/" as absolute and throw the base away:
        // on Windows it even lands on drive C:. Strip it, then join.
        ? join(root, 'docs', clean.replace(/^\/+/, ''))
        : resolve(dirname(page), clean)
      if (!existsSync(target)) {
        problems.push(`${relative(root, page)} -> ${ref} (missing)`)
        continue
      }
      // A link to a directory is fine only if it has an index.html.
      if (statSync(target).isDirectory() && !existsSync(join(target, 'index.html'))) {
        problems.push(`${relative(root, page)} -> ${ref} (directory without index.html)`)
      }
    }
    const re = /(?:href|src)\s*=\s*"(https?:[^"]*)"/g
    let m
    while ((m = re.exec(html)) !== null) external.add(m[1])
  }

  return { pages: pages.length, problems, external: [...external] }
}

function main() {
  const arg = process.argv[2]
  if (!arg) {
    console.error('usage: node scripts/check-site.mjs <site-dir>')
    process.exit(2)
  }
  const root = resolve(arg)
  const { pages, problems, external } = checkSite(root)

  console.log(`pages: ${pages}`)
  console.log(`external links (not fetched): ${external.length}`)
  for (const url of external) console.log(`  ~ ${url}`)

  if (problems.length) {
    console.error(`\n${problems.length} broken local reference(s):`)
    for (const p of problems) console.error(`  x ${p}`)
    process.exit(1)
  }
  console.log('all local references resolve')
}

if (process.argv[1] && process.argv[1].endsWith('check-site.mjs')) main()
