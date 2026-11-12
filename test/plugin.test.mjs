import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { apply } from '../index.js'
import { createSkillRegistration } from '../lib/skill.js'

const here = dirname(fileURLToPath(import.meta.url))

function fakeContext() {
  const tools = []
  const skills = []
  const disposers = []
  return {
    ctx: {
      get() {
        return undefined
      },
      effect(callback) {
        const disposer = callback()
        if (typeof disposer === 'function') disposers.push(disposer)
        return disposer
      },
      tools: {
        register(definition) {
          tools.push(definition)
          return () => {}
        },
      },
      skills: {
        register(definition) {
          skills.push(definition)
          return () => {}
        },
      },
    },
    tools,
    skills,
    dispose() {
      for (const disposer of disposers.reverse()) {
        try {
          disposer()
        } catch {
          // best effort
        }
      }
    },
  }
}

test('plugin apply registers the tools and the runtime skill', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'file-recall-plugin-'))
  const { ctx, tools, skills, dispose } = fakeContext()
  try {
    apply(ctx, { dbPath: join(dir, 'index.db'), roots: [], expansion: { enabled: false } })

    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      [
        'file_recall_evidence',
        'file_recall_feedback',
        'file_recall_index',
        'file_recall_search',
      ],
    )
    assert.equal(skills.length, 1)
    assert.equal(skills[0].name, 'file-recall')
    assert.equal(skills[0].source, 'runtime')
    assert.deepEqual(skills[0].invocation, { modelInvocable: true, userInvocable: true })
    assert.match(skills[0].content, /证据纪律/)
    assert.match(skills[0].content, /空态处理/)
    assert.match(skills[0].content, /file_recall_evidence/)

    const indexTool = tools.find((tool) => tool.name === 'file_recall_index')
    const status = await indexTool.execute({ action: 'status' }, {})
    assert.equal(status.files, 0)
    assert.equal(status.pending, 0)
    assert.equal(status.ocr.enabled, true)
    assert.ok(
      status.ocr.provider === 'tesseract' || status.ocr.provider === 'vision',
      `unexpected OCR provider: ${JSON.stringify(status.ocr)}`,
    )
  } finally {
    dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('configure persists roots and enables a real query through the tools', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'file-recall-configure-'))
  const dbPath = join(dir, 'index.db')
  writeFileSync(join(dir, 'note.txt'), '部门预算的说明与绩效指标。', 'utf8')

  const first = fakeContext()
  try {
    apply(first.ctx, { dbPath, roots: [], expansion: { enabled: false }, ocr: { enabled: false } })
    const indexTool = first.tools.find((tool) => tool.name === 'file_recall_index')
    const configured = await indexTool.execute(
      { action: 'configure', roots: [dir], confirm: true },
      {},
    )
    assert.deepEqual(configured.roots, [resolve(dir)])
    await assert.rejects(
      () => indexTool.execute({ action: 'configure', roots: [dir] }, {}),
      /confirm=true/,
    )
    await assert.rejects(
      () => indexTool.execute({ action: 'configure', roots: [], confirm: true }, {}),
      /non-empty roots/,
    )

    const sync = await indexTool.execute({ action: 'sync' }, {})
    assert.equal(sync.added, 1)
    let build
    do {
      build = await indexTool.execute({ action: 'build', maxFiles: 10 }, {})
    } while (!build.done)

    const searchTool = first.tools.find((tool) => tool.name === 'file_recall_search')
    const result = await searchTool.execute({ query: '预算说明', topK: 5 }, {})
    assert.ok(result.hits.some((hit) => hit.path.endsWith('note.txt')))
  } finally {
    first.dispose()
  }

  // A second apply on the same database must reuse the persisted roots.
  const second = fakeContext()
  try {
    apply(second.ctx, { dbPath, roots: [], expansion: { enabled: false }, ocr: { enabled: false } })
    const status = await second.tools
      .find((tool) => tool.name === 'file_recall_index')
      .execute({ action: 'status' }, {})
    assert.deepEqual(status.roots, [resolve(dir)])
    assert.equal(status.files, 1)
    assert.equal(status.ocr.enabled, false)
  } finally {
    second.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('corrupt databases are archived and the plugin still starts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'file-recall-corrupt-'))
  const dbPath = join(dir, 'index.db')
  writeFileSync(dbPath, 'definitely not a sqlite database', 'utf8')
  const { ctx, tools, dispose } = fakeContext()
  try {
    apply(ctx, { dbPath, roots: [], expansion: { enabled: false }, ocr: { enabled: false } })
    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      [
        'file_recall_evidence',
        'file_recall_feedback',
        'file_recall_index',
        'file_recall_search',
      ],
    )
    const status = await tools
      .find((tool) => tool.name === 'file_recall_index')
      .execute({ action: 'status' }, {})
    assert.match(status.recoveredFrom, /index\.db\.corrupt-/)
    assert.equal(status.files, 0)
  } finally {
    dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('configure prunes files outside the new roots', async () => {
  const dirA = mkdtempSync(join(tmpdir(), 'file-recall-prune-a-'))
  const dirB = mkdtempSync(join(tmpdir(), 'file-recall-prune-b-'))
  const dbPath = join(dirA, 'index.db')
  const { ctx, tools, dispose } = fakeContext()
  try {
    writeFileSync(join(dirA, 'a.txt'), '甲方案预算说明', 'utf8')
    apply(ctx, { dbPath, roots: [dirA], expansion: { enabled: false }, ocr: { enabled: false } })
    const indexTool = tools.find((tool) => tool.name === 'file_recall_index')
    await indexTool.execute({ action: 'sync' }, {})
    let build
    do {
      build = await indexTool.execute({ action: 'build', maxFiles: 10 }, {})
    } while (!build.done)

    const configured = await indexTool.execute(
      { action: 'configure', roots: [dirB], confirm: true },
      {},
    )
    assert.equal(configured.pruned, 1)
    assert.equal(configured.files, 0)

    const searchTool = tools.find((tool) => tool.name === 'file_recall_search')
    const old = await searchTool.execute({ query: '甲方案', topK: 5 }, {})
    assert.equal(old.hits.length, 0)

    writeFileSync(join(dirB, 'b.txt'), '乙方案预算说明', 'utf8')
    await indexTool.execute({ action: 'sync' }, {})
    do {
      build = await indexTool.execute({ action: 'build', maxFiles: 10 }, {})
    } while (!build.done)
    const fresh = await searchTool.execute({ query: '乙方案', topK: 5 }, {})
    assert.ok(fresh.hits.some((hit) => hit.path.endsWith('b.txt')))
  } finally {
    dispose()
    rmSync(dirA, { recursive: true, force: true })
    rmSync(dirB, { recursive: true, force: true })
  }
})

test('plugin registers read-only UI routes when an HTTP server is present', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'file-recall-routes-'))
  const registered = []
  const { ctx, dispose } = fakeContext()
  ctx.get = (name) =>
    name === 'webServer'
      ? {
          register(route) {
            registered.push(route)
            return () => {}
          },
        }
      : undefined
  try {
    apply(ctx, { dbPath: join(dir, 'index.db'), roots: [], expansion: { enabled: false }, ocr: { enabled: false } })
    assert.equal(registered.length, 1)
    assert.equal(registered[0].kind, 'prefix')
    assert.equal(registered[0].path, '/api/file-recall')

    function call(method, url) {
      return new Promise((resolve, reject) => {
        const res = {
          statusCode: 0,
          headers: {},
          body: '',
          setHeader(name, value) {
            this.headers[name] = value
          },
          end(body) {
            this.body = body
            resolve({ status: this.statusCode, body: JSON.parse(body) })
          },
        }
        Promise.resolve(registered[0].handler({ method, url }, res)).catch(reject)
      })
    }

    const status = await call('GET', '/api/file-recall/status')
    assert.equal(status.status, 200)
    assert.equal(status.body.files, 0)
    assert.equal(status.body.ocr.enabled, false)

    const recent = await call('GET', '/api/file-recall/recent')
    assert.equal(recent.status, 200)
    assert.deepEqual(recent.body.feedback, [])

    const missing = await call('GET', '/api/file-recall/nope')
    assert.equal(missing.status, 404)

    const rejected = await call('POST', '/api/file-recall/status')
    assert.equal(rejected.status, 405)
  } finally {
    dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('client half is a loadable harness module with panel and sidebar surfaces', async () => {
  const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')
  assert.match(source, /__ModuleLoader__\.load\(\{/)
  assert.match(source, /require\('react'\)/)
  assert.match(source, /name: 'main'/)
  assert.match(source, /'sidebar\.panellist'/)
  assert.match(source, /dfr-metrics/)
  assert.match(source, /prefers-reduced-motion/)
  assert.doesNotMatch(source, /<html|iframe/)
  new Function(source)
})

test('skill registration content is complete and model-usable', () => {
  const skill = createSkillRegistration()
  assert.equal(skill.name, 'file-recall')
  assert.ok(skill.description.length > 10)
  assert.ok(skill.whenToUse.length > 10)
  assert.equal(skill.source, 'runtime')
  assert.equal(skill.invocation.modelInvocable, true)
  assert.equal(skill.invocation.userInvocable, true)
  for (const required of ['何时使用', '工作流', '证据纪律', '空态处理', '反馈']) {
    assert.ok(skill.content.includes(required), `skill is missing section: ${required}`)
  }
  assert.match(skill.content, /不许模型自己数/)
  assert.match(skill.content, /绝不编造/)
})
