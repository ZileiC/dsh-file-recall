/**
 * Build the live plugin index for a folder through the plugin's own tools.
 *
 *   node scripts/build-demo.mjs "<folder>"
 *
 * Used for manual verification of the panel: it configures the index through
 * the same tool calls the agent makes, then prints status and one query.
 */

import { apply } from '../index.js'

const folder = process.argv[2]
if (!folder) {
  console.error('usage: node scripts/build-demo.mjs "<folder>"')
  process.exit(2)
}

const tools = []
const ctx = {
  get() {
    return undefined
  },
  effect(callback) {
    return callback()
  },
  tools: {
    register(definition) {
      tools.push(definition)
      return () => {}
    },
  },
  skills: {
    register() {
      return () => {}
    },
  },
}

apply(ctx, { expansion: { enabled: false } })
console.log('plugin applied, tools:', tools.map((tool) => tool.name).join(', '))

const indexTool = tools.find((tool) => tool.name === 'file_recall_index')
const searchTool = tools.find((tool) => tool.name === 'file_recall_search')
const evidenceTool = tools.find((tool) => tool.name === 'file_recall_evidence')

console.log('step: configure')
const configured = await indexTool.execute({ action: 'configure', roots: [folder], confirm: true }, {})
console.log('configured:', JSON.stringify({ roots: configured.roots, pruned: configured.pruned }))
console.log('step: sync')
const sync = await indexTool.execute({ action: 'sync' }, {})
console.log('sync:', JSON.stringify(sync))
let build
let rounds = 0
do {
  console.log('step: build', rounds + 1)
  build = await indexTool.execute({ action: 'build', maxFiles: 50 }, {})
  rounds += 1
  console.log('build:', JSON.stringify(build))
} while (!build.done && rounds < 20)
const status = await indexTool.execute({ action: 'status' }, {})
console.log(JSON.stringify({ sync, rounds, status }, null, 2))

const result = await searchTool.execute({ query: '部门预算的说明 成本同比下降', topK: 3 }, {})
console.log(JSON.stringify(result.hits, null, 2))
if (result.hits[0]) {
  const evidence = await evidenceTool.execute({ chunkId: result.hits[0].chunkId }, {})
  console.log(
    JSON.stringify(
      { path: evidence.path, locator: evidence.locator, page: evidence.page, quote: evidence.text.slice(0, 60) },
      null,
      2,
    ),
  )
}
