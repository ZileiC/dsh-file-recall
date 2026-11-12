import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { normalizeOcrConfig, DEFAULT_OCR_CONFIG } from '../lib/ocr/config.js'
import { createOcrService } from '../lib/ocr/provider.js'
import { createTesseractProvider } from '../lib/ocr/tesseract.js'
import { createVisionProvider } from '../lib/ocr/vision.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name) => join(here, 'fixtures', name)

function fakeProvider(name, options = {}) {
  const {
    available = true,
    text = `${name} text`,
    confidence = 80,
    fail = false,
    experimental = false,
  } = options
  const calls = { available: 0, recognize: 0, dispose: 0 }
  return {
    name,
    experimental,
    calls,
    async available() {
      calls.available += 1
      return available
    },
    async recognize() {
      calls.recognize += 1
      if (fail) throw new Error(`${name} recognize failed`)
      return { text, confidence }
    },
    async dispose() {
      calls.dispose += 1
    },
  }
}

test('ocr config: defaults and validation', () => {
  const config = normalizeOcrConfig()
  assert.equal(config.enabled, true)
  assert.equal(config.provider, 'auto')
  assert.deepEqual(config.langs, ['chi_sim'])
  assert.equal(config.maxPagesPerDoc, DEFAULT_OCR_CONFIG.maxPagesPerDoc)

  assert.throws(() => normalizeOcrConfig({ provider: 'nope' }), /provider/)
  assert.throws(() => normalizeOcrConfig({ langs: [] }), /langs/)
  assert.throws(() => normalizeOcrConfig({ maxPagesPerDoc: 0 }), /maxPagesPerDoc/)
  assert.throws(() => normalizeOcrConfig({ timeoutMs: -1 }), /timeoutMs/)
})

test('auto prefers Vision when the probe succeeds', async () => {
  const tesseract = fakeProvider('tesseract')
  const vision = fakeProvider('vision', { experimental: true })
  const service = await createOcrService({
    config: { provider: 'auto' },
    tesseract,
    vision,
  })
  assert.equal(service.provider, 'vision')
  assert.equal(service.experimental, true)
  const result = await service.recognize({ buffer: Buffer.from('x') })
  assert.equal(result.source, 'vision')
  assert.equal(result.fallbackFrom, null)
})

test('auto falls back to tesseract when Vision is unavailable', async () => {
  const tesseract = fakeProvider('tesseract')
  const vision = fakeProvider('vision', { available: false })
  const service = await createOcrService({
    config: { provider: 'auto' },
    tesseract,
    vision,
  })
  assert.equal(service.provider, 'tesseract')
  assert.equal(service.fallbackFrom, 'vision')
  const result = await service.recognize({ buffer: Buffer.from('x') })
  assert.equal(result.source, 'tesseract')
  assert.equal(result.fallbackFrom, 'vision')
})

test('explicit tesseract never touches Vision', async () => {
  const tesseract = fakeProvider('tesseract')
  const vision = fakeProvider('vision')
  const service = await createOcrService({
    config: { provider: 'tesseract' },
    tesseract,
    vision,
  })
  assert.equal(service.provider, 'tesseract')
  assert.equal(service.fallbackFrom, null)
  assert.equal(vision.calls.available, 0)
})

test('explicit Vision on a non-darwin platform falls back to tesseract', async () => {
  const realVision = createVisionProvider({ platform: 'win32' })
  const service = await createOcrService({
    config: { provider: 'vision' },
    platform: 'win32',
    tesseract: fakeProvider('tesseract'),
    vision: realVision,
  })
  assert.equal(service.provider, 'tesseract')
  assert.equal(service.fallbackFrom, 'vision')
})

test('a provider failure at recognition time falls through to the next provider', async () => {
  const tesseract = fakeProvider('tesseract', { text: '部门预算的说明', confidence: 72 })
  const vision = fakeProvider('vision', { fail: true })
  const service = await createOcrService({
    config: { provider: 'auto' },
    tesseract,
    vision,
  })
  assert.equal(service.provider, 'vision')
  const result = await service.recognize({ buffer: Buffer.from('x') })
  assert.equal(result.source, 'tesseract')
  assert.equal(result.fallbackFrom, 'vision')
  assert.match(result.text, /部门预算/)
  assert.equal(result.confidence, 72)
})

test('no available provider reports that clearly instead of throwing at startup', async () => {
  const service = await createOcrService({
    config: { provider: 'auto' },
    tesseract: fakeProvider('tesseract', { available: false }),
    vision: fakeProvider('vision', { available: false }),
  })
  assert.equal(service.provider, null)
  await assert.rejects(() => service.recognize({ buffer: Buffer.from('x') }), /no OCR provider/)
})

test('disabled OCR is explicit', async () => {
  const service = await createOcrService({ config: { enabled: false } })
  assert.equal(service.enabled, false)
  assert.equal(service.provider, null)
  await assert.rejects(() => service.recognize({}), /disabled/)
})

test('Vision is gated to darwin before any process is spawned', async () => {
  const vision = createVisionProvider({ platform: 'win32' })
  assert.equal(await vision.available(), false)
  await assert.rejects(() => vision.recognize({ path: 'whatever.png' }), /only available on darwin/)
})

test('Vision probe and JSON output are parsed on darwin (injected runner)', async () => {
  const calls = []
  const fakeExec = async (_command, args) => {
    calls.push(args)
    if (args.includes('-e')) return { stdout: 'ok\n' }
    return { stdout: JSON.stringify({ text: '部门预算的说明', confidence: 0.9 }) }
  }
  const vision = createVisionProvider({ platform: 'darwin', execFile: fakeExec })
  assert.equal(await vision.available(), true)
  const result = await vision.recognize({ path: 'scan.png' })
  assert.equal(result.text, '部门预算的说明')
  assert.equal(result.confidence, 90)
  assert.ok(calls.length >= 2)
})

test('Vision probe failure makes it unavailable', async () => {
  const fakeExec = async () => {
    throw new Error('osascript not allowed')
  }
  const vision = createVisionProvider({ platform: 'darwin', execFile: fakeExec })
  assert.equal(await vision.available(), false)
})

test('real tesseract: Chinese PNG produces searchable text', async () => {
  const provider = createTesseractProvider({ langs: ['chi_sim'] })
  try {
    assert.equal(await provider.available(), true)
    const result = await provider.recognize({ path: fixture('ocr-zh.png') })
    assert.ok(result.text.length > 0, 'no OCR text produced')
    assert.match(result.text, /预算/, `unexpected OCR text: ${result.text}`)
    assert.equal(typeof result.confidence, 'number')
    assert.ok(result.confidence > 0)
  } finally {
    await provider.dispose()
  }
})

test('real tesseract through the service records its source', async () => {
  const tesseract = createTesseractProvider({ langs: ['chi_sim'] })
  const service = await createOcrService({
    config: { provider: 'tesseract' },
    tesseract,
  })
  try {
    assert.equal(service.provider, 'tesseract')
    const result = await service.recognize({ path: fixture('ocr-en.png') })
    assert.equal(result.source, 'tesseract')
    assert.match(result.text, /Budget/i)
  } finally {
    await service.dispose()
  }
})
