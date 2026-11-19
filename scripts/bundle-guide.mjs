/**
 * Inline every local reference into a single self-contained HTML file.
 *
 *   node scripts/bundle-guide.mjs
 *
 * Why: the guide references `img/hero-shot.png` and `guide.css` / `guide.js` by
 * relative path. That works when the folder travels together, and breaks the
 * moment the file is sent on its own — which is exactly how this guide gets
 * delivered (a .html in a chat message, opened on a phone). Data URIs and inline
 * blocks make one file that works anywhere, with no network and no sibling folder.
 *
 * Only the universal guide is committed. Pass --source / --out / --docs-dir to
 * bundle a different page.
 *
 * The build is exposed as a pure function so a test can rebuild in memory and
 * compare against the committed file: editing the source page without re-running
 * this then fails the suite instead of shipping a stale bundle.
 */

import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
}

/**
 * Build the single-file HTML in memory.
 *
 * @param {{ root: string, source?: string, docsDir?: string }} input repository
 *   root, the page to bundle (relative to docs/), and an optional different
 *   directory to read the page and its assets from
 * @returns {{ html: string, inlined: Array<{ relPath: string, bytes: number }> }}
 */
export function buildStandalone({ root, source = 'install-universal.html', docsDir = 'docs' }) {
  const base = join(root, docsDir)
  const sourcePath = join(base, source)
  let html = readFileSync(sourcePath, 'utf8')
  const inlined = []

  html = html.replace(/src="(img\/[^"]+)"/g, (whole, relPath) => {
    const absolute = join(base, relPath)
    const bytes = readFileSync(absolute)
    const mime = MIME[extname(absolute).toLowerCase()]
    if (!mime) throw new Error(`unsupported image type: ${relPath}`)
    inlined.push({ relPath, bytes: bytes.length })
    return `src="data:${mime};base64,${bytes.toString('base64')}"`
  })

  // The shared stylesheet becomes a <style> block with its relative url()s inlined.
  html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (whole, relPath) => {
    const absolute = join(base, relPath)
    let css = readFileSync(absolute, 'utf8')
    css = css.replace(/url\((['"]?)([^)'"]+)\1\)/g, (inner, quote, ref) => {
      if (/^(data:|https?:)/.test(ref)) return inner
      const assetPath = join(base, ref)
      const bytes = readFileSync(assetPath)
      const mime = MIME[extname(assetPath).toLowerCase()]
      if (!mime) throw new Error(`unsupported asset in ${relPath}: ${ref}`)
      inlined.push({ relPath: join(dirname(relPath), ref), bytes: bytes.length })
      return `url("data:${mime};base64,${bytes.toString('base64')}")`
    })
    return `<style>\n${css}\n</style>`
  })

  // The shared behaviour becomes an inline <script>.
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (whole, relPath) => {
    const absolute = join(base, relPath)
    const js = readFileSync(absolute, 'utf8')
    inlined.push({ relPath, bytes: Buffer.byteLength(js, 'utf8') })
    return `<script>\n${js}\n</script>`
  })

  // Site navigation ("back to the index") makes no sense in a file that travels
  // alone: there is no ../index.html next to it. Drop those, never inline them.
  html = html.replace(/[ \t]*<p class="back">[\s\S]*?<\/p>\n?/g, '')

  html = html.replace(
    '</title>',
    '</title>\n<!-- single-file build: images, stylesheet and script are inlined -->',
  )

  if (inlined.length === 0) {
    throw new Error('nothing was inlined — did the image paths change?')
  }
  return { html, inlined }
}

/** Paths the guide may not reference, because delivery is one file on a phone. */
export function findExternalReferences(html) {
  const external = []
  const pattern = /(?:src|href)="([^"]+)"/g
  let match
  while ((match = pattern.exec(html)) !== null) {
    const value = match[1]
    if (value.startsWith('data:')) continue
    if (value.startsWith('http://') || value.startsWith('https://')) continue
    if (value.startsWith('#')) continue
    external.push(value)
  }
  return external
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  // Only the public, generic guide is committed. Pass --source / --out / --docs-dir
  // to bundle a different page (for example the personal one kept outside the repo).
  const args = process.argv.slice(2)
  const arg = (name, fallback) => {
    const at = args.indexOf(`--${name}`)
    return at >= 0 && args[at + 1] ? args[at + 1] : fallback
  }
  const source = arg('source', 'install-universal.html')
  const output = arg('out', 'install-universal-standalone.html')
  const docsDir = arg('docs-dir', 'docs')

  const outPath = join(root, docsDir, output)
  const { html, inlined } = buildStandalone({ root, source, docsDir })
  writeFileSync(outPath, html, 'utf8')

  const externalRefs = findExternalReferences(html)
  if (externalRefs.length) {
    throw new Error(`${output} still references local files: ${externalRefs.join(', ')}`)
  }
  console.log(
    JSON.stringify(
      {
        output: outPath,
        kb: Math.round(statSync(outPath).size / 1024),
        inlined: inlined.map((entry) => ({ path: entry.relPath, kb: Math.round(entry.bytes / 1024) })),
        externalImageRefs: (html.match(/src="img\//g) || []).length,
      },
      null,
      2,
    ),
  )
}
