/**
 * Manual OCR self-check.
 *
 *   node scripts/ocr-selfcheck.mjs <image-path> [auto|tesseract|vision]
 *
 * On Windows this exercises the tesseract path. On the target Mac it also
 * probes and, if available, exercises the experimental Vision provider.
 */

import { createOcrService } from '../lib/ocr/provider.js'

const [imagePath, providerMode = 'auto'] = process.argv.slice(2)

if (!imagePath) {
  console.error('usage: node scripts/ocr-selfcheck.mjs <image-path> [auto|tesseract|vision]')
  process.exit(2)
}

const service = await createOcrService({ config: { provider: providerMode } })
console.log(`platform: ${process.platform}`)
console.log(`requested: ${providerMode}`)
console.log(`active provider: ${service.provider ?? '(none)'}`)
console.log(`fallbackFrom: ${service.fallbackFrom ?? '(none)'}`)
console.log(`experimental: ${service.experimental}`)

if (!service.provider) {
  console.error('no OCR provider available')
  process.exit(1)
}

const started = Date.now()
try {
  const result = await service.recognize({ path: imagePath })
  console.log(`source: ${result.source}`)
  console.log(`fallbackFrom: ${result.fallbackFrom ?? '(none)'}`)
  console.log(`confidence: ${result.confidence ?? '(none)'}`)
  console.log(`elapsedMs: ${Date.now() - started}`)
  console.log('text:')
  console.log(result.text)
} finally {
  await service.dispose()
}
