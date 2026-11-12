import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { apply } from '../index.js'
import { createSkillRegistration } from '../lib/skill.js'
import { API_VERSION } from '../lib/ui-routes.js'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Cordis-faithful fake: a started service is a context property, a not-yet
 * started one is absent, and `inject` parks the fork until it appears. The old
 * helper handed `webServer` out through `get()` at apply time, which is why the
 * plugin-level 404 regression was invisible to this file.
 */
function fakeContext({ deferWebServer = false } = {}) {
  const tools = []
  const skills = []
  const disposers = []
  const routes = []
  const parked = []
  const webServer = {
    register(route) {
      routes.push(route)
      return () => {}
    },
  }
  const ctx = {
    get(name) {
      return ctx[name]
    },
    inject(dependencies, callback) {
      if (deferWebServer && dependencies.includes('webServer')) {
        parked.push(callback)
        return
      }
      callback(ctx)
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
  }
  if (!deferWebServer) ctx.webServer = webServer
  return {
    ctx,
    tools,
    skills,
    routes,
    parked,
    ready() {
      ctx.webServer = webServer
      for (const callback of parked.splice(0)) callback(ctx)
    },
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
        'file_recall_tidy',
      ],
    )
    assert.equal(skills.length, 2)
    assert.equal(skills[0].name, 'file-recall')
    assert.equal(skills[0].source, 'runtime')
    assert.deepEqual(skills[0].invocation, { modelInvocable: true, userInvocable: true })
    assert.match(skills[0].content, /证据纪律/)
    assert.match(skills[0].content, /空态处理/)
    assert.match(skills[0].content, /file_recall_evidence/)

    // The tidy skill must pair with the gated tool: its body has to state the
    // approval gate and the vault protection, otherwise the model may move
    // files, or rename inside an Obsidian vault, without the user noticing.
    const tidySkill = skills.find((skill) => skill.name === 'file-tidy')
    assert.ok(tidySkill, 'file-tidy skill was not registered')
    assert.equal(tidySkill.source, 'runtime')
    assert.match(tidySkill.content, /confirm: true/)
    assert.match(tidySkill.content, /dryRun: false/)
    assert.match(tidySkill.content, /Obsidian vault/)
    assert.match(tidySkill.content, /undo/)

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
        'file_recall_tidy',
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
  // The host starts webServer after this plugin, so the route must arrive late.
  const { ctx, tools, routes, parked, ready, dispose } = fakeContext({ deferWebServer: true })
  try {
    apply(ctx, { dbPath: join(dir, 'index.db'), roots: [], expansion: { enabled: false }, ocr: { enabled: false } })
    assert.equal(routes.length, 0, 'route registered before webServer was ready')
    assert.equal(parked.length, 1, 'no inject fork parked for webServer')
    ready()
    const registered = routes
    assert.equal(registered.length, 1)
    // The one-shot `ctx.get('webServer')` this replaced reported 'waiting'
    // forever in the live host; the tool must now report the real state.
    const toolStatus = await tools
      .find((tool) => tool.name === 'file_recall_index')
      .execute({ action: 'status' }, {})
    assert.equal(toolStatus.ui.status, 'registered')
    assert.equal(toolStatus.ui.path, '/api/file-recall')
    assert.equal(registered[0].kind, 'prefix')
    assert.equal(registered[0].path, '/api/file-recall')
    // Must be a WebResourceRoute: the handler form is Node (req, res), and
    // returning a Response from it makes the carrier answer 404.
    assert.equal(typeof registered[0].resource, 'function')
    assert.equal(registered[0].handler, undefined)

    function call(method, url) {
      const request = new Request('http://127.0.0.1' + url, { method })
      return Promise.resolve(registered[0].resource(request)).then(async (response) => ({
        status: response.status,
        body: await response.json(),
      }))
    }

    const status = await call('GET', '/api/file-recall/status')
    assert.equal(status.status, 200)
    assert.equal(status.body.files, 0)
    assert.equal(status.body.ocr.enabled, false)
    assert.equal(status.body.apiVersion, API_VERSION, 'the panel rejects a host without this marker')

    const health = await call('GET', '/api/file-recall/health')
    assert.equal(health.status, 200)
    assert.deepEqual(health.body, {
      ok: true,
      service: 'file-recall',
      apiVersion: API_VERSION,
      features: { activity: true },
    })

    // The panel animation is driven by this incremental feed: a real search must
    // leave exactly one event, and the cursor must not replay it.
    const searchTool = tools.find((tool) => tool.name === 'file_recall_search')
    assert.ok(searchTool, 'search tool missing')
    await searchTool.execute({ query: '那个预算的说明' }, {})
    const feed = await call('GET', '/api/file-recall/activity?since=0')
    assert.equal(feed.status, 200)
    assert.equal(feed.body.events.length, 1)
    assert.equal(feed.body.events[0].query, '那个预算的说明')
    assert.ok(Number.isInteger(feed.body.events[0].id))
    assert.equal(feed.body.latest, feed.body.events[0].id)
    const drained = await call('GET', '/api/file-recall/activity?since=' + feed.body.latest)
    assert.deepEqual(drained.body.events, [])

    const recent = await call('GET', '/api/file-recall/recent')
    assert.equal(recent.status, 200)
    assert.deepEqual(recent.body.feedback, [])

    // The graph is folder-first and must answer even on an empty archive.
    const graph = await call('GET', '/api/file-recall/graph')
    assert.equal(graph.status, 200)
    assert.ok(Array.isArray(graph.body.nodes))
    assert.ok(Array.isArray(graph.body.edges))
    assert.equal(graph.body.focus, null)
    assert.equal(graph.body.apiVersion, API_VERSION)
    const drilled = await call('GET', '/api/file-recall/graph?focus=' + encodeURIComponent('whatever'))
    assert.equal(drilled.status, 200)
    assert.equal(drilled.body.focus, 'whatever')

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
  // The recall animation belongs in the conversation, so the client must claim
  // its own Tool view keyed by the wire tool name.
  assert.match(source, /'tool\.call\.toolview'/)
  assert.match(source, /key: 'file_recall_search'/)
  // The unmissable seat: full-width strip above the composer.
  assert.match(source, /'conversation\.input\.dock'/)
  // The strip is dismissible but has no replay control: the animation is a
  // notice, not a toy.
  assert.match(source, /'dock\.dismiss'/)
  assert.doesNotMatch(source, /signal\.replay/)
  assert.match(source, /dfr-metrics/)
  assert.match(source, /prefers-reduced-motion/)
  assert.doesNotMatch(source, /<html|iframe/)
  new Function(source)
})

test('client half expects the same API version the host reports', async () => {
  const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')
  const match = source.match(/const EXPECTED_API_VERSION = (\d+)/)
  assert.ok(match, 'client must declare EXPECTED_API_VERSION')
  assert.equal(
    Number(match[1]),
    API_VERSION,
    'client and host API versions drifted; bump both together',
  )
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
