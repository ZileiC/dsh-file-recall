/**
 * Inline every referenced image into a single self-contained HTML file.
 *
 *   node scripts/bundle-guide.mjs
 *
 * Why: docs/install.html references `img/hero-shot.png` and `img/step-01-menu.png`
 * by relative path. That works when the folder travels together, and breaks the
 * moment the file is sent on its own — which is exactly how this guide gets
 * delivered (a .html in a chat message, opened on a phone). Base64 data URIs make
 * one file that works anywhere, with no network and no sibling folder.
 *
 * The build is exposed as a pure function so a test can rebuild in memory and
 * compare against the committed file: editing install.html without re-running this
 * then fails the suite instead of shipping stale images.
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
 * @param {{ root: string }} input repository root
 * @returns {{ html: string, inlined: Array<{ relPath: string, bytes: number }> }}
 */
export function buildStandalone({ root }) {
  const sourcePath = join(root, 'docs', 'install.html')
  let html = readFileSync(sourcePath, 'utf8')
  const inlined = []

  html = html.replace(/src="(img\/[^"]+)"/g, (whole, relPath) => {
    const absolute = join(root, 'docs', relPath)
    const bytes = readFileSync(absolute)
    const mime = MIME[extname(absolute).toLowerCase()]
    if (!mime) throw new Error(`unsupported image type: ${relPath}`)
    inlined.push({ relPath, bytes: bytes.length })
    return `src="data:${mime};base64,${bytes.toString('base64')}"`
  })

  html = html.replace(
    '</title>',
    '</title>\n<!-- single-file build: images are inlined as data URIs -->',
  )

  if (inlined.length === 0) {
    throw new Error('no images were inlined — did the image paths change?')
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
  const outPath = join(root, 'docs', 'install-standalone.html')
  const { html, inlined } = buildStandalone({ root })
  writeFileSync(outPath, html, 'utf8')
  console.log(
    JSON.stringify(
      {
        output: outPath,
        kb: Math.round(statSync(outPath).size / 1024),
        inlined: inlined.map((entry) => ({
          path: entry.relPath,
          kb: Math.round(entry.bytes / 1024),
        })),
        externalImageRefs: (html.match(/src="img\//g) || []).length,
      },
      null,
      2,
    ),
  )
}
