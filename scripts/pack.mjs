/**
 * Build a self-contained, cross-platform plugin folder for the target Mac.
 *
 *   node scripts/pack.mjs
 *
 * Output: ../dist/dsh-file-recall/ (source + production node_modules built with
 * `--omit=optional`, so no platform-specific native binary such as
 * @napi-rs/canvas is shipped; pdfjs text extraction works without it).
 */

import { execFile } from 'node:child_process'
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = resolve(root, '..', 'dist', 'dsh-file-recall')

const COPY = [
  'index.js',
  'cordis.patch.yml',
  'README.md',
  'LICENSE',
  'icon.svg',
  'lib',
  'skills',
  'locale',
]

async function directorySize(path) {
  let total = 0
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const full = join(path, entry.name)
    if (entry.isDirectory()) total += await directorySize(full)
    else if (entry.isFile()) total += (await stat(full)).size
  }
  return total
}

async function findNativeBinaries(path) {
  const found = []
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const full = join(path, entry.name)
    if (entry.isDirectory()) found.push(...(await findNativeBinaries(full)))
    else if (entry.name.endsWith('.node')) found.push(full)
  }
  return found
}

await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })
for (const item of COPY) {
  await cp(join(root, item), join(target, item), { recursive: true, dereference: true })
}
await mkdir(join(target, 'scripts'), { recursive: true })
await cp(join(root, 'scripts', 'ocr-selfcheck.mjs'), join(target, 'scripts', 'ocr-selfcheck.mjs'))

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
pkg.scripts = { 'ocr:selfcheck': 'node scripts/ocr-selfcheck.mjs' }
await writeFile(join(target, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
await execFileAsync(
  npm,
  [
    'install',
    '--omit=dev',
    '--omit=optional',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
  ],
  {
    cwd: target,
    timeout: 600_000,
    maxBuffer: 8 * 1024 * 1024,
    // Node 24 refuses to spawn .cmd files without a shell on Windows.
    shell: process.platform === 'win32',
  },
)

const natives = await findNativeBinaries(join(target, 'node_modules'))
if (natives.length > 0) {
  throw new Error(`packed bundle still contains native binaries:\n${natives.join('\n')}`)
}

const module = await import(`${pathToFileURL(join(target, 'index.js')).href}?pack=${Date.now()}`)
const sizeMb = (await directorySize(target)) / 1024 / 1024

console.log(
  JSON.stringify(
    {
      target,
      exports: Object.keys(module),
      nativeBinaries: 0,
      sizeMb: Number(sizeMb.toFixed(1)),
      scripts: pkg.scripts,
    },
    null,
    2,
  ),
)
