/** OCR configuration defaults and validation. */

export const OCR_PROVIDERS = ['auto', 'tesseract', 'vision']

export const DEFAULT_OCR_CONFIG = Object.freeze({
  enabled: true,
  provider: 'auto',
  // chi_sim's model also reads Latin script; loading eng simultaneously made
  // tesseract.js mis-read Chinese in our tests, so Chinese is the default.
  langs: ['chi_sim'],
  maxPagesPerDoc: 50,
  timeoutMs: 60_000,
})

export function normalizeOcrConfig(input = {}) {
  const merged = { ...DEFAULT_OCR_CONFIG, ...(input ?? {}) }

  if (!OCR_PROVIDERS.includes(merged.provider)) {
    throw new Error(`ocr.provider must be one of ${OCR_PROVIDERS.join('|')}, got ${merged.provider}`)
  }
  if (!Array.isArray(merged.langs) || merged.langs.length === 0) {
    throw new Error('ocr.langs must be a non-empty array')
  }
  merged.langs = merged.langs.map((lang) => String(lang).trim()).filter(Boolean)
  if (merged.langs.length === 0) throw new Error('ocr.langs must contain at least one language')

  if (!Number.isFinite(merged.maxPagesPerDoc) || merged.maxPagesPerDoc <= 0) {
    throw new Error('ocr.maxPagesPerDoc must be a positive number')
  }
  if (!Number.isFinite(merged.timeoutMs) || merged.timeoutMs <= 0) {
    throw new Error('ocr.timeoutMs must be a positive number')
  }
  merged.enabled = Boolean(merged.enabled)
  return merged
}
