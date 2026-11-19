import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildStandalone } from '../scripts/bundle-guide.mjs'
import { DOCS_FILES, ROOT_FILES } from '../scripts/site-manifest.mjs'

/**
 * Two install guides ship: macOS and Windows. The Windows one must not be a find
 * and replace of the Mac one — the first two steps genuinely differ, and a guide
 * that tells a Windows user to drag an icon into Applications is worse than none.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mac = readFileSync(join(root, 'docs', 'install-universal.html'), 'utf8')
const win = readFileSync(join(root, 'docs', 'install-windows.html'), 'utf8')
const winStandalone = readFileSync(join(root, 'docs', 'install-windows-standalone.html'), 'utf8')

const steps = (html) => [...html.matchAll(/<section class="step" id="(s\d)">/g)].map((m) => m[1])

test('the Windows guide keeps the same seven-step shape as the Mac guide', () => {
  assert.deepEqual(steps(win), steps(mac), 'step ids diverged between the two guides')
  assert.equal((win.match(/<svg /g) || []).length, (mac.match(/<svg /g) || []).length)
  assert.equal((win.match(/data-copy/g) || []).length, (mac.match(/data-copy/g) || []).length)
  assert.equal((win.match(/<figure>/g) || []).length, (mac.match(/<figure>/g) || []).length)
})

test('the Windows guide says what is actually different on Windows', () => {
  // Step 1: no menu to open, the button itself is the Windows download.
  assert.match(win, /直接点它/, 'the Windows guide must say the button is the right one')
  assert.match(win, /Windows 已保护你的电脑/, 'the SmartScreen prompt must be named')
  assert.match(win, /更多信息/, 'the reader has to be told the extra button appears after this')
  assert.match(win, /仍要运行/, 'the reader has to be told the final button')
})

test('the Windows guide carries no macOS-only instruction', () => {
  for (const [why, needle] of [
    ['dragging into Applications is a macOS action', '拖到右边的「应用程序」文件夹'],
    ['Gatekeeper only exists on macOS', 'Gatekeeper'],
    ['Launchpad only exists on macOS', '启动台'],
    ['an Apple-only build choice', 'Apple 芯片'],
    ['opening a .dmg', '.dmg'],
    ['macOS download trap does not apply', '不要直接点它'],
  ]) {
    assert.equal(win.includes(needle), false, `Windows guide still mentions "${needle}" — ${why}`)
  }
})

test('the Windows single file is self-contained and current', () => {
  assert.match(winStandalone, /<style>[\s\S]{500,}<\/style>/, 'stylesheet was not inlined')
  assert.match(winStandalone, /<script>[\s\S]{500,}<\/script>/, 'behaviour was not inlined')
  assert.equal((winStandalone.match(/src="data:image\/png;base64,/g) || []).length, 2)
  assert.doesNotMatch(winStandalone, /(?:href|src)="(?:guide|img\/)/, 'a local path survived bundling')

  const { html } = buildStandalone({ root, source: 'install-windows.html' })
  assert.equal(
    winStandalone,
    html,
    'install-windows-standalone.html is stale — run: node scripts/bundle-guide.mjs --source install-windows.html --out install-windows-standalone.html',
  )
})

test('both platform guides are published, and nothing else is', () => {
  for (const name of [
    'install-universal.html',
    'install-universal-standalone.html',
    'install-windows.html',
    'install-windows-standalone.html',
  ]) {
    assert.ok(DOCS_FILES.includes(name), `${name} must be in the publish manifest`)
  }
  assert.deepEqual(ROOT_FILES, ['index.html', 'icon.svg'])
})

test('the site index offers both platforms', () => {
  const index = readFileSync(join(root, 'index.html'), 'utf8')
  for (const target of [
    './docs/install-universal.html',
    './docs/install-windows.html',
    './docs/install-universal-standalone.html',
    './docs/install-windows-standalone.html',
  ]) {
    assert.ok(index.includes(`href="${target}"`), `index.html does not link ${target}`)
  }
})
