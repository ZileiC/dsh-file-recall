/**
 * OCR provider selection and fallback.
 *
 * Order for `auto`: macOS Vision first (better Chinese, when the probe works),
 * then tesseract. Every recognition failure falls through to the next available
 * provider, and the result records which provider actually produced the text.
 */

import { normalizeOcrConfig } from './config.js'
import { createTesseractProvider } from './tesseract.js'
import { createVisionProvider } from './vision.js'

async function refuse() {
  throw new Error('OCR is disabled')
}

/**
 * @param {{
 *   config?: object,
 *   platform?: string,
 *   langPath?: string,
 *   tesseract?: object,
 *   vision?: object,
 * }} options
 */
export async function createOcrService(options = {}) {
  const config = normalizeOcrConfig(options.config)

  if (!config.enabled) {
    return {
      enabled: false,
      provider: null,
      fallbackFrom: null,
      reason: 'disabled',
      config,
      recognize: refuse,
      dispose: async () => {},
    }
  }

  const tesseract =
    options.tesseract ??
    createTesseractProvider({
      langs: config.langs,
      langPath: options.langPath,
      timeoutMs: config.timeoutMs,
    })
  const vision =
    options.vision ??
    createVisionProvider({ platform: options.platform, timeoutMs: config.timeoutMs })

  let order
  if (config.provider === 'vision') order = [vision, tesseract]
  else if (config.provider === 'tesseract') order = [tesseract]
  else order = [vision, tesseract]

  const available = []
  for (const provider of order) {
    let usable = false
    try {
      usable = Boolean(await provider.available())
    } catch {
      usable = false
    }
    if (usable) available.push(provider)
  }

  const preferred = order[0]
  const active = available[0] ?? null

  const service = {
    enabled: true,
    provider: active?.name ?? null,
    fallbackFrom:
      active && preferred && active.name !== preferred.name ? preferred.name : null,
    experimental: Boolean(active?.experimental),
    config,
    async recognize(input) {
      let lastError = null
      for (const provider of available) {
        try {
          const result = await provider.recognize(input)
          return {
            text: String(result?.text ?? '').trim(),
            confidence: typeof result?.confidence === 'number' ? result.confidence : null,
            source: provider.name,
            fallbackFrom: provider.name === preferred.name ? null : preferred.name,
          }
        } catch (error) {
          lastError = error
        }
      }
      if (lastError) throw lastError
      throw new Error('no OCR provider available (run the Mac self-check in README.md)')
    },
    async dispose() {
      const seen = new Set()
      for (const provider of order) {
        if (seen.has(provider)) continue
        seen.add(provider)
        try {
          await provider.dispose?.()
        } catch {
          // teardown is best effort
        }
      }
    },
  }

  return service
}
