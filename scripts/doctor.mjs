/**
 * Time one extraction per file in a folder, to find a hang or a slow extractor.
 *
 *   node scripts/doctor.mjs "<folder>"
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { extractBuffer } from '../lib/extract/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const pluginRoot = join(here, '..')
const folder = process.argv[2]
const timeoutMs = Number(process.argv[3] ?? 30_000)

if (!folder) {
  console.error('usage: node scripts/doctor.mjs "<folder>" [timeoutMs]')
  process.exit(2)
}

console.log('plugin root:', pluginRoot)
console.log('folder:', folder)

const names = await readdir(folder)
for (const name of names.sort()) {
  const path = join(folder, name)
  const info = await stat(path)
  if (!info.isFile()) continue
  const extension = extname(name).toLowerCase()
  const started = Date.now()
  let outcome
  try {
    const buffer = await readFile(path)
    const result = await Promise.race([
      extractBuffer(buffer, extension),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
    outcome = `${result.status} chunks=${(result.chunks ?? []).length}`
  } catch (error) {
    outcome = `FAILED: ${error?.message ?? error}`
  }
  console.log(`${name.padEnd(28)} ${String(Date.now() - started).padStart(7)}ms  ${outcome}`)
}
