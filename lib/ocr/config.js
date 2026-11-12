/** OCR configuration defaults and validation. */

export const OCR_PROVIDERS = ['auto', 'tesseract', 'vision']

/**
 * When OCR runs:
 *  - `lazy`  (default) — build stores text only; a scanned page is recognised when
 *            someone actually asks to read it, or when `action: "ocr"` warms it up.
 *            A large messy archive becomes searchable in minutes instead of hours.
 *  - `eager` — recognise during the build, the pre-lazy behaviour.
 *  - `off`   — never.
 *
 * The tradeoff of `lazy` is real and documented: a scanned page is invisible to
 * CONTENT search until it has been recognised. Folder and filename search still
 * find the file.
 */
export const OCR_MODES = ['lazy', 'eager', 'off']

export const DEFAULT_OCR_CONFIG = Object.freeze({
  enabled: true,
  mode: 'lazy',
  provider: 'auto',
  // chi_sim's model also reads Latin script; loading eng simultaneously made
  // tesseract.js mis-read Chinese in our tests, so Chinese is the default.
  langs: ['chi_sim'],
  maxPagesPerDoc: 50,
  timeoutMs: 60_000,
})

export function normalizeOcrConfig(input = {}) {
  const raw = input ?? {}
  const merged = { ...DEFAULT_OCR_CONFIG, ...raw }

  // `enabled: false` (the pre-mode spelling) means off, not "lazy".
  const requested = raw.mode ?? (raw.enabled === false ? 'off' : DEFAULT_OCR_CONFIG.mode)
  const mode = String(requested)
  if (!OCR_MODES.includes(mode)) {
    throw new Error(`ocr.mode must be one of ${OCR_MODES.join('|')}, got ${mode}`)
  }
  merged.mode = mode
  merged.enabled = mode !== 'off'

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
  return merged
}
