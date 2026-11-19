import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The two guides have separate screenshots and must stay separate: swapping one
 * guide's image once silently changed the other's page, which nobody asked for.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (name) => readFileSync(join(root, 'docs', name), 'utf8')

const macHtml = read('install-universal.html')
const winHtml = read('install-windows.html')
const macBundle = read('install-universal-standalone.html')
const winBundle = read('install-windows-standalone.html')

const images = (html) => [...html.matchAll(/src="(img\/[^"]+)"/g)].map((m) => m[1])

test('each guide uses its own screenshots', () => {
  assert.deepEqual(images(macHtml), ['img/hero-shot.png', 'img/step-01-menu.png'])
  assert.deepEqual(images(winHtml), ['img/windows-page.png', 'img/windows-button.png'])
})

test('the macOS page keeps its expanded-menu screenshots', () => {
  const [hero, step] = ['hero-shot.png', 'step-01-menu.png'].map((n) => readFileSync(join(root, 'docs', 'img', n)))
  assert.ok(hero.length > 150_000, `hero-shot.png looks like the wrong image (${hero.length} bytes)`)
  assert.ok(step.length > 100_000, `step-01-menu.png looks like the wrong image (${step.length} bytes)`)
  for (const [name, bytes] of [['hero-shot.png', hero], ['step-01-menu.png', step]]) {
    assert.equal(bytes[0], 0x89, `${name} is not a PNG`)
  }
})

test('each single-file build inlines only its own images', () => {
  // Both bundle two images; the check is that they are not the same two.
  const macInlined = [...macBundle.matchAll(/src="(data:image\/png;base64,[^"]{80})/g)].map((m) => m[1])
  const winInlined = [...winBundle.matchAll(/src="(data:image\/png;base64,[^"]{80})/g)].map((m) => m[1])
  assert.equal(macInlined.length, 2)
  assert.equal(winInlined.length, 2)
  assert.notDeepEqual(macInlined, winInlined, 'both guides inlined the same screenshots')
})

test('the Windows screenshots exist and are PNGs', () => {
  for (const name of ['windows-page.png', 'windows-button.png']) {
    const bytes = readFileSync(join(root, 'docs', 'img', name))
    assert.equal(bytes[0], 0x89, `${name} is not a PNG`)
    assert.ok(bytes.length > 20_000, `${name} looks truncated (${bytes.length} bytes)`)
  }
})
