/**
 * Installed-bundle smoke: import the package exactly as DSH resolves it from
 * the profile, apply it with a minimal fake context, then run one real query
 * through the registered tools.
 *
 *   node scripts/install-smoke.mjs
 */

import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const localEntry = join(here, '..', 'index.js')
const installedEntry = join(
  process.env.USERPROFILE ?? '',
  '.dsh',
  'profiles',
  'desktop',
  'node_modules',
  'dsh-file-recall',
  'index.js',
)
const entryArg = process.argv.indexOf('--entry')
const explicitEntry = entryArg >= 0 ? process.argv[entryArg + 1] : null
const entry = explicitEntry
  ? resolve(explicitEntry)
  : existsSync(installedEntry)
    ? installedEntry
    : localEntry
const fixtures = join(here, '..', 'test', 'fixtures')

/**
 * Minimal faithful context.
 *
 * `inject` mirrors Cordis: the callback runs at once when the service is ready,
 * otherwise it is parked and runs when the service appears. `get()` must NOT
 * hand out an unstarted service — the real host does not either, and that gap is
 * what made a one-shot `ctx.get('webServer')` skip route registration forever.
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
    // Cordis exposes a started service as a context property; an unstarted one
    // is simply absent. Both `get(name)` and `ctx[name]` must agree on that.
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

const dir = mkdtempSync(join(tmpdir(), 'file-recall-install-'))
// The real host starts `webServer` after this plugin, so the default scenario is
// the deferred one: the route must still appear once the service is ready.
const { ctx, tools, skills, routes, parked, ready, dispose } = fakeContext({ deferWebServer: true })
const report = { entry, tools: [], skill: null, query: null, routes: null, client: null }

try {
  const module = await import(pathToFileURL(entry).href)
  assert.equal(typeof module.apply, 'function')
  module.apply(ctx, {
    dbPath: join(dir, 'index.db'),
    roots: [dir],
    expansion: { enabled: false },
    ocr: { enabled: false },
  })
  report.tools = tools.map((tool) => tool.name).sort()
  report.skill = skills[0]
    ? { name: skills[0].name, source: skills[0].source, hasEvidenceRules: /证据纪律/.test(skills[0].content) }
    : null
  assert.deepEqual(report.tools, [
    'file_recall_evidence',
    'file_recall_feedback',
    'file_recall_index',
    'file_recall_search',
    'file_recall_tidy',
  ])
  assert.equal(report.skill?.name, 'file-recall')
  // The tidy skill ships with the bundle and must state its read-only boundary.
  const tidySkill = skills.find((skill) => skill.name === 'file-tidy')
  assert.ok(tidySkill, 'file-tidy skill was not registered')
  assert.match(tidySkill.content, /只能出方案/)
  report.tidySkill = { name: tidySkill.name, source: tidySkill.source }

  copyFileSync(join(fixtures, 'deck-basic.pptx'), join(dir, 'deck-basic.pptx'))
  copyFileSync(join(fixtures, 'pdf-text.pdf'), join(dir, 'pdf-text.pdf'))

  const indexTool = tools.find((tool) => tool.name === 'file_recall_index')
  const searchTool = tools.find((tool) => tool.name === 'file_recall_search')
  const evidenceTool = tools.find((tool) => tool.name === 'file_recall_evidence')

  const sync = await indexTool.execute({ action: 'sync' }, {})
  assert.equal(sync.added, 2)
  let build
  do {
    build = await indexTool.execute({ action: 'build', maxFiles: 50 }, {})
  } while (!build.done)

  const result = await searchTool.execute({ query: '部门预算的说明', topK: 5 }, {})
  assert.ok(result.hits.length > 0, 'installed bundle returned no hits')
  const hit = result.hits.find((candidate) => candidate.path.endsWith('deck-basic.pptx') && candidate.page === 2)
  assert.ok(hit, 'installed bundle missed the gold page')
  const evidence = await evidenceTool.execute({ chunkId: hit.chunkId }, {})
  assert.equal(evidence.page, 2)
  assert.match(evidence.text, /部门预算的说明/)
  report.query = {
    query: '部门预算的说明',
    hits: result.hits.length,
    gold: { path: evidence.path, page: evidence.page, locator: evidence.locator },
    quote: evidence.text.slice(0, 60),
  }

  // The panel API must answer from this exact bundle. A WebRoute (handler)
  // instead of a WebResourceRoute makes the carrier answer 404, which is
  // exactly what a user sees as "无法连接插件服务".
  //
  // Apply alone must not have registered anything yet: the service was not up.
  assert.equal(routes.length, 0, 'route registered before webServer was ready')
  assert.equal(parked.length, 1, 'the plugin did not park an inject fork for webServer')
  ready()
  assert.equal(routes.length, 1, 'the UI route was not registered after webServer started')
  const route = routes[0]
  assert.equal(route.kind, 'prefix')
  assert.equal(route.path, '/api/file-recall')
  assert.equal(typeof route.resource, 'function', 'route must be a WebResourceRoute')
  assert.equal(route.handler, undefined, 'route must not use the Node handler form')
  const response = await route.resource(new Request('http://127.0.0.1/api/file-recall/status'))
  assert.equal(response.status, 200)
  const statusBody = await response.json()
  assert.equal(statusBody.files, 2)
  assert.ok(statusBody.roots.some((root) => root.endsWith(dir)))
  // The panel's live signal reads this incremental feed; the tool search below
  // has already run once, so at least one event must be there.
  const feed = await (
    await route.resource(new Request('http://127.0.0.1/api/file-recall/activity?since=0'))
  ).json()
  assert.ok(Array.isArray(feed.events) && feed.events.length > 0, 'activity feed is empty')
  assert.equal(feed.events[0].query, '部门预算的说明')
  assert.ok(Array.isArray(feed.events[0].terms))

  // Folder-first graph: two loose files at the root, both currently indexed.
  const graph = await (
    await route.resource(new Request('http://127.0.0.1/api/file-recall/graph'))
  ).json()
  assert.equal(graph.totals.files, 2)
  assert.ok(Array.isArray(graph.nodes))
  assert.ok(graph.nodes.length >= 1, 'graph returned no nodes for an indexed archive')
  report.graph = { nodes: graph.nodes.length, edges: graph.edges.length, totals: graph.totals }
  // The tool-level marker is the only way to diagnose a dead panel without host
  // logs, so the bundle must report it from the same state the route used.
  const toolStatus = await tools
    .find((tool) => tool.name === 'file_recall_index')
    .execute({ action: 'status' }, {})
  assert.equal(toolStatus.ui?.status, 'registered', 'tool status did not report the live UI route')
  assert.equal(toolStatus.ui?.path, '/api/file-recall')
  // Memory must be observable: the search above is already persisted history.
  assert.ok(toolStatus.memory, 'status did not report memory')
  assert.ok(toolStatus.memory.total >= 1, 'the search was not persisted to recall history')
  assert.equal(typeof toolStatus.memory.stated, 'number')
  assert.equal(typeof toolStatus.memory.inferred, 'number')
  report.routes = {
    kind: route.kind,
    path: route.path,
    status: response.status,
    apiVersion: statusBody.apiVersion,
    files: statusBody.files,
    ocrEnabled: statusBody.ocr?.enabled ?? null,
    ui: toolStatus.ui,
  }
  // The panel refuses a host that does not report the API it was built for, so
  // a missing or stale marker is a release blocker, not a warning.
  const clientSourceCheck = readFileSync(join(dirname(entry), 'lib', 'client.js'), 'utf8')
  const expected = Number(
    (clientSourceCheck.match(/const EXPECTED_API_VERSION = (\d+)/) || [])[1] ?? NaN,
  )
  assert.equal(
    statusBody.apiVersion,
    expected,
    'host apiVersion must equal the client EXPECTED_API_VERSION',
  )

  // The client half must be a loadable harness module declaring both surfaces.
  const clientPath = join(dirname(entry), 'lib', 'client.js')
  const clientSource = readFileSync(clientPath, 'utf8')
  assert.match(clientSource, /__ModuleLoader__\.load\(\{/)
  assert.match(clientSource, /'sidebar\.panellist'/)
  assert.match(clientSource, /name: 'main'/)
  assert.match(clientSource, /'tool\.call\.toolview'/)
  assert.match(clientSource, /key: 'file_recall_search'/)
  assert.match(clientSource, /'conversation\.input\.dock'/)
  new Function(clientSource)
  report.client = { path: clientPath, bytes: clientSource.length }

  // Opposite startup order: `webServer` is already up when apply() runs. The
  // route must be registered synchronously and no fork may be left parked.
  const earlyDir = mkdtempSync(join(tmpdir(), 'file-recall-install-early-'))
  const early = fakeContext({ deferWebServer: false })
  try {
    module.apply(early.ctx, {
      dbPath: join(earlyDir, 'index.db'),
      roots: [earlyDir],
      expansion: { enabled: false },
      ocr: { enabled: false },
    })
    assert.equal(early.parked.length, 0, 'a fork was parked although webServer was ready')
    assert.equal(early.routes.length, 1, 'route missing when webServer was ready at apply time')
    const earlyStatus = await early.tools
      .find((tool) => tool.name === 'file_recall_index')
      .execute({ action: 'status' }, {})
    assert.equal(earlyStatus.ui?.status, 'registered')
    report.routes.readyAtApply = earlyStatus.ui.status
  } finally {
    early.dispose()
    rmSync(earlyDir, { recursive: true, force: true })
  }

  console.log(JSON.stringify(report, null, 2))
} finally {
  dispose()
  rmSync(dir, { recursive: true, force: true })
}
