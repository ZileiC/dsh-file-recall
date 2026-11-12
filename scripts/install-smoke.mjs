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

function fakeContext() {
  const tools = []
  const skills = []
  const disposers = []
  const routes = []
  const webServer = {
    register(route) {
      routes.push(route)
      return () => {}
    },
  }
  return {
    ctx: {
      get(name) {
        return name === 'webServer' ? webServer : undefined
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
    routes,
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
const { ctx, tools, skills, routes, dispose } = fakeContext()
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
  ])
  assert.equal(report.skill?.name, 'file-recall')

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
  assert.equal(routes.length, 1, 'the UI route was not registered')
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
  report.routes = {
    kind: route.kind,
    path: route.path,
    status: response.status,
    apiVersion: statusBody.apiVersion,
    files: statusBody.files,
    ocrEnabled: statusBody.ocr?.enabled ?? null,
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
  new Function(clientSource)
  report.client = { path: clientPath, bytes: clientSource.length }

  console.log(JSON.stringify(report, null, 2))
} finally {
  dispose()
  rmSync(dir, { recursive: true, force: true })
}
