/**
 * macOS Vision OCR provider — EXPERIMENTAL.
 *
 * Only runs on darwin. The recognizer is a JXA (osascript) script that bridges
 * to Apple's Vision framework; it is untested on this development machine
 * (Windows), so availability is probed and every failure falls back to
 * tesseract. Do not treat this provider as production-verified until it passes
 * the Mac checklist in README.md.
 */

import { execFile } from 'node:child_process'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_VISION_SCRIPT = join(MODULE_DIR, 'vision-ocr.jxa.js')

export function createVisionProvider(options = {}) {
  const platform = options.platform ?? process.platform
  const run = options.execFile ?? execFileAsync
  const scriptPath = options.scriptPath ?? DEFAULT_VISION_SCRIPT
  const probeTimeoutMs = options.probeTimeoutMs ?? 5_000
  const timeoutMs = options.timeoutMs ?? 60_000

  return {
    name: 'vision',
    experimental: true,
    async available() {
      if (platform !== 'darwin') return false
      try {
        const { stdout } = await run(
          'osascript',
          ['-l', 'JavaScript', '-e', 'ObjC.import("Vision"); "ok"'],
          { timeout: probeTimeoutMs },
        )
        return String(stdout).includes('ok')
      } catch {
        return false
      }
    },
    async recognize(input) {
      if (platform !== 'darwin') {
        throw new Error('macOS Vision OCR is only available on darwin')
      }
      let filePath = input?.path
      let temporary = null
      if (!filePath) {
        if (!input?.buffer) throw new Error('vision: an image path or buffer is required')
        temporary = join(tmpdir(), `file-recall-vision-${process.pid}-${Date.now()}.png`)
        await writeFile(temporary, input.buffer)
        filePath = temporary
      }
      try {
        const { stdout } = await run('osascript', ['-l', 'JavaScript', scriptPath, filePath], {
          timeout: timeoutMs,
          maxBuffer: 16 * 1024 * 1024,
        })
        const parsed = JSON.parse(String(stdout).trim())
        const rawConfidence = parsed?.confidence
        return {
          text: String(parsed?.text ?? '').trim(),
          // Vision reports 0..1; normalize to the 0..100 scale tesseract uses.
          confidence:
            typeof rawConfidence === 'number'
              ? Math.round(rawConfidence <= 1 ? rawConfidence * 100 : rawConfidence)
              : null,
        }
      } finally {
        if (temporary) await rm(temporary, { force: true }).catch(() => {})
      }
    },
    async dispose() {},
  }
}
