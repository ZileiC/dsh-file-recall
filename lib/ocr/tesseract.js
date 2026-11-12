/**
 * tesseract.js OCR provider (WASM, no native dependency).
 *
 * Language data lives beside this module in ./lang/*.traineddata and is loaded
 * without gzip, so OCR works offline. The worker is created lazily and reused
 * across pages; `dispose()` terminates it.
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createWorker } from 'tesseract.js'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_LANG_PATH = join(MODULE_DIR, 'lang')

export function createTesseractProvider(options = {}) {
  const langs = options.langs ?? ['chi_sim']
  const langPath = options.langPath ?? DEFAULT_LANG_PATH
  const timeoutMs = options.timeoutMs ?? 60_000
  let workerPromise = null

  async function getWorker() {
    if (!workerPromise) {
      workerPromise = createWorker(langs, 1, {
        langPath,
        gzip: false,
        cacheMethod: 'none',
        ...(options.workerOptions ?? {}),
      }).catch((error) => {
        workerPromise = null
        throw error
      })
    }
    return workerPromise
  }

  return {
    name: 'tesseract',
    experimental: false,
    async available() {
      return langs.every((lang) => existsSync(join(langPath, `${lang}.traineddata`)))
    },
    async recognize(input) {
      const buffer = input?.buffer ?? (await readFile(input?.path))
      const worker = await getWorker()
      let timer = null
      try {
        const result = await Promise.race([
          worker.recognize(buffer),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              const error = new Error('tesseract OCR timed out')
              error.code = 'OCR_TIMEOUT'
              reject(error)
            }, timeoutMs)
          }),
        ])
        const { data } = result
        return {
          text: String(data?.text ?? '').trim(),
          confidence: typeof data?.confidence === 'number' ? data.confidence : null,
        }
      } catch (error) {
        if (error?.code === 'OCR_TIMEOUT') {
          workerPromise = null
          worker.terminate().catch(() => {})
        }
        throw error
      } finally {
        if (timer) clearTimeout(timer)
      }
    },
    async dispose() {
      if (!workerPromise) return
      const pending = workerPromise
      workerPromise = null
      try {
        const worker = await pending
        await worker.terminate()
      } catch {
        // A worker that failed to start has nothing to terminate.
      }
    },
  }
}
