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
 * Output: docs/install-standalone.html (the two-source version stays for editing).
 */

import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = join(root, 'docs', 'install.html')
const outPath = join(root, 'docs', 'install-standalone.html')

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
}

let html = readFileSync(sourcePath, 'utf8')
const inlined = []

/** Replace every relative image reference with a data URI. */
html = html.replace(/src="(img\/[^"]+)"/g, (whole, relPath) => {
  const absolute = join(root, 'docs', relPath)
  const bytes = readFileSync(absolute)
  const mime = MIME[extname(absolute).toLowerCase()]
  if (!mime) throw new Error(`unsupported image type: ${relPath}`)
  const dataUri = `data:${mime};base64,${bytes.toString('base64')}`
  inlined.push({ relPath, bytes: bytes.length, encoded: dataUri.length })
  return `src="${dataUri}"`
})

html = html.replace(
  '</title>',
  '</title>\n<!-- single-file build: images are inlined as data URIs -->',
)

writeFileSync(outPath, html, 'utf8')

const total = statSync(outPath).size
console.log(
  JSON.stringify(
    {
      output: outPath,
      kb: Math.round(total / 1024),
      inlined: inlined.map((entry) => ({
        path: entry.relPath,
        kb: Math.round(entry.bytes / 1024),
        encodedKb: Math.round(entry.encoded / 1024),
      })),
      externalImageRefs: (html.match(/src="img\//g) || []).length,
    },
    null,
    2,
  ),
)

if (inlined.length === 0) throw new Error('no images were inlined — did the paths change?')
