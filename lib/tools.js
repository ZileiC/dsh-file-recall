/**
 * Model-facing tool definitions.
 *
 * Kept as plain objects (no framework import) so the linked plugin directory
 * resolves without extra peer dependencies. The plugin entry registers them via
 * `ctx.tools.register`.
 */

const KIND_ENUM = ['slide', 'notes', 'page', 'ocr', 'block', 'sheet']

function jsonRender(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

function locatorOf(chunk) {
  if (chunk.kind === 'sheet') {
    const match = String(chunk.text ?? '').match(/^\[(.+?)\]/)
    return match ? match[1] : `sheet row ${chunk.block ?? '?'}`
  }
  if (chunk.page != null) return `page ${chunk.page}`
  if (chunk.block != null) return `block ${chunk.block}`
  return chunk.kind
}

function clip(text, limit = 800) {
  const value = String(text ?? '')
  if (value.length <= limit) return { text: value, truncated: false }
  return { text: `${value.slice(0, limit)}…`, truncated: true }
}

function createSearchTool(search) {
  return {
    name: 'file_recall_search',
    description:
      'Search the local document index from a vague description of something the user half-remembers. ' +
      'Returns ranked candidates with file path, page/slide/block locator, a short snippet, match type and score. ' +
      'Candidates are leads, not evidence: call file_recall_evidence on a candidate before quoting it.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            "The user's own wording, including approximate year, project/client names, document type and any remembered detail.",
        },
        topK: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          description: 'Number of candidates to return. Default 8.',
        },
        filters: {
          type: 'object',
          description: 'Optional narrowing when the user gave explicit constraints.',
          properties: {
            kinds: {
              type: 'array',
              items: { type: 'string', enum: KIND_ENUM },
              description: 'Restrict to page/slide/block/sheet/notes/ocr chunks.',
            },
            years: {
              type: 'array',
              items: { type: 'integer' },
              description:
                'Explicit file-year filter (last-save mtime). Only pass when the user means file dates, not text dates.',
            },
            mtimeFrom: { type: 'integer', description: 'Inclusive epoch milliseconds.' },
            mtimeTo: { type: 'integer', description: 'Inclusive epoch milliseconds.' },
            pathPrefix: {
              type: 'string',
              description: 'Limit to files under this path prefix (a folder the user named).',
            },
          },
          additionalProperties: false,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object' }, render: jsonRender },
    async execute(args, exec) {
      return search.search(
        { query: args.query, topK: args.topK, filters: args.filters ?? {} },
        { signal: exec?.signal },
      )
    },
  }
}

function createEvidenceTool(store) {
  return {
    name: 'file_recall_evidence',
    description:
      'Read one indexed page/block by chunkId, plus a little neighbouring context. ' +
      'Returns the exact stored text and the locator derived from the index. ' +
      'Use this before quoting: page numbers and quotes must come from here, never from memory.',
    parameters: {
      type: 'object',
      properties: {
        chunkId: { type: 'integer', description: 'chunkId from a file_recall_search hit.' },
        radius: {
          type: 'integer',
          minimum: 0,
          maximum: 2,
          description: 'Neighbouring pages/blocks to include. Default 1.',
        },
      },
      required: ['chunkId'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object' }, render: jsonRender },
    async execute(args) {
      const chunk = store.getChunk(args.chunkId)
      if (!chunk) throw new Error(`chunk not found: ${args.chunkId}`)
      const radius = args.radius == null ? 1 : args.radius
      const context = store.getChunkContext(chunk.id, radius)
      return {
        chunkId: Number(chunk.id),
        path: chunk.path,
        kind: chunk.kind,
        page: chunk.page,
        block: chunk.block,
        locator: locatorOf(chunk),
        text: chunk.text,
        ocrSource: chunk.ocr_source ?? null,
        ocrConfidence: chunk.ocr_confidence ?? null,
        neighbors: context
          .filter((item) => Number(item.id) !== Number(chunk.id))
          .map((item) => ({
            chunkId: Number(item.id),
            kind: item.kind,
            page: item.page,
            block: item.block,
            locator: locatorOf(item),
            ...clip(item.text),
          })),
      }
    },
  }
}

function createIndexTool(indexer, store, ocrStatus, uiStatus, expansionStatus, memoryStatus) {
  return {
    name: 'file_recall_index',
    description:
      'Manage the local document index. `sync` scans configured roots for new/changed/deleted files, ' +
      '`build` indexes a bounded batch and must be repeated until `done` is true, `status` reports coverage ' +
      'and the OCR provider self-check, `configure` replaces the scanned folders (persisted, prunes files ' +
      'outside the new roots, requires confirm=true), `retry` requeues failed files, and `reset` drops the ' +
      'derived index while keeping learned vocabulary and roots (requires confirm=true).',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'sync', 'build', 'configure', 'retry', 'reset'],
        },
        maxFiles: {
          type: 'integer',
          minimum: 1,
          maximum: 500,
          description: 'build only: files per batch. Defaults to the plugin setting.',
        },
        budgetMs: {
          type: 'integer',
          minimum: 100,
          description: 'build only: time budget for this batch.',
        },
        roots: {
          type: 'array',
          items: { type: 'string' },
          description:
            'configure only: absolute folders to scan, e.g. the user\'s Documents/资料 directory.',
        },
        confirm: {
          type: 'boolean',
          description:
            'configure/reset only: must be true for configure (it prunes indexed files outside the new roots) and for reset.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object' }, render: jsonRender },
    async execute(args, exec) {
      const action = args.action
      if (action === 'status') {
        const base = indexer.status()
        const ui = uiStatus ? uiStatus() : { status: 'unknown' }
        const expansion = expansionStatus ? expansionStatus() : { enabled: false }
        const memory = memoryStatus ? memoryStatus() : null
        let ocr = null
        try {
          ocr = ocrStatus ? await ocrStatus() : null
        } catch (error) {
          ocr = { enabled: true, provider: null, error: String(error?.message ?? error) }
        }
        const payload = { ...base, ui, expansion, memory }
        return ocr ? { ...payload, ocr } : payload
      }
      if (action === 'sync') return indexer.sync({ signal: exec?.signal })
      if (action === 'build') {
        return indexer.build({
          signal: exec?.signal,
          maxFiles: args.maxFiles,
          budgetMs: args.budgetMs,
        })
      }
      if (action === 'configure') {
        if (args.confirm !== true) {
          throw new Error(
            'configure requires confirm=true: it replaces the scanned folders and prunes files outside them',
          )
        }
        if (!Array.isArray(args.roots) || args.roots.length === 0) {
          throw new Error('configure requires a non-empty roots array')
        }
        const roots = indexer.setRoots(args.roots)
        const pruned = indexer.pruneOutsideRoots()
        store.setMeta('indexer.rootsOverride', JSON.stringify(roots))
        return { configured: roots, pruned, ...indexer.status() }
      }
      if (action === 'retry') {
        const retried = store.retryErrors()
        return { retried, ...(await indexer.status()) }
      }
      if (action === 'reset') {
        if (args.confirm !== true) throw new Error('reset requires confirm=true')
        store.reset()
        return { reset: true, ...(await indexer.status()) }
      }
      throw new Error(`unknown index action: ${action}`)
    },
  }
}

function createFeedbackTool(learning) {
  return {
    name: 'file_recall_feedback',
    description:
      'Record whether a recall candidate was right and optionally teach the index the user vocabulary. ' +
      '`record` stores one hit/wrong/partial outcome; a correction like "甲壳类=龙虾" becomes a learned synonym ' +
      'used by later searches. `list` shows recent outcomes, `synonyms` shows the learned vocabulary.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['record', 'list', 'synonyms'] },
        verdict: {
          type: 'string',
          enum: ['hit', 'wrong', 'partial'],
          description: 'record only: required.',
        },
        chunkId: { type: 'integer', description: 'record only: the candidate that was judged.' },
        query: {
          type: 'string',
          description: 'record only: the original user query (used as the learned term when correcting).',
        },
        correction: {
          type: 'string',
          description:
            'record only: the correct wording, either "原词=标准词" or free text. Stored locally.',
        },
        note: { type: 'string', description: 'record only: optional short note.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'list only: default 20.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object' }, render: jsonRender },
    async execute(args) {
      if (args.action === 'record') {
        return learning.recordFeedback({
          verdict: args.verdict,
          chunkId: args.chunkId,
          query: args.query,
          correction: args.correction,
          note: args.note,
        })
      }
      if (args.action === 'list') return { feedback: learning.listFeedback(args.limit ?? 20) }
      if (args.action === 'synonyms') return { synonyms: learning.listSynonyms('learned') }
      throw new Error(`unknown feedback action: ${args.action}`)
    },
  }
}

/**
 * @param {{store: object, search: object, indexer?: object, learning?: object}} services
 * @returns {Array<object>} tool definitions ready for ctx.tools.register
 */
export function createToolDefinitions({ store, search, indexer = null, learning = null, ocrStatus = null, uiStatus = null, expansionStatus = null, memoryStatus = null }) {
  if (!store) throw new Error('createToolDefinitions: store is required')
  if (!search) throw new Error('createToolDefinitions: search service is required')

  const tools = [createSearchTool(search), createEvidenceTool(store)]
  if (indexer) tools.push(createIndexTool(indexer, store, ocrStatus, uiStatus, expansionStatus, memoryStatus))
  if (learning) tools.push(createFeedbackTool(learning))
  return tools
}
