/**
 * Model-facing tool definitions.
 *
 * Kept as plain objects (no framework import) so the linked plugin directory
 * resolves without extra peer dependencies. The plugin entry registers them via
 * `ctx.tools.register`.
 */

import { renderFishbone } from './fishbone.js'

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

function createEvidenceTool(store, onDemandOcr = null) {
  return {
    name: 'file_recall_evidence',
    description:
      'Read one indexed page/block by chunkId, plus a little neighbouring context. ' +
      'Returns the exact stored text and the locator derived from the index. ' +
      'Use this before quoting: page numbers and quotes must come from here, never from memory. ' +
      'When the target is a scanned page that has not been recognised yet, pass `path` and `page` ' +
      'instead of `chunkId`: the page is OCRed on demand and returned.',
    parameters: {
      type: 'object',
      properties: {
        chunkId: { type: 'integer', description: 'chunkId from a file_recall_search hit.' },
        path: {
          type: 'string',
          description:
            'Absolute file path. Use with `page` for a scanned page that search cannot see yet.',
        },
        page: {
          type: 'integer',
          minimum: 1,
          description: 'Page number to read (with `path`); triggers on-demand OCR when needed.',
        },
        radius: {
          type: 'integer',
          minimum: 0,
          maximum: 2,
          description: 'Neighbouring pages/blocks to include. Default 1.',
        },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'object' }, render: jsonRender },
    async execute(args) {
      let chunk = args.chunkId == null ? null : store.getChunk(args.chunkId)

      // Lazy OCR path: the caller knows the file and page but no chunk exists yet.
      if (!chunk && args.path && args.page != null) {
        if (!onDemandOcr) throw new Error('on-demand OCR is not available in this carrier')
        const outcome = await onDemandOcr.ensurePage(String(args.path), Number(args.page))
        if (outcome.status !== 'done') {
          return {
            path: String(args.path),
            page: Number(args.page),
            locator: `page ${Number(args.page)}`,
            text: '',
            recognized: outcome.recognized,
            ocrStatus: outcome.status,
            error: outcome.error ?? null,
            hint:
              outcome.status === 'missing'
                ? 'this page has no embedded image; nothing to recognise'
                : 'OCR could not read this page; it stays unavailable until retried',
          }
        }
        const rows = store.getChunkByPage?.(String(args.path), Number(args.page)) ?? null
        chunk = rows
        if (!chunk) {
          return {
            path: String(args.path),
            page: Number(args.page),
            locator: `page ${Number(args.page)}`,
            text: '',
            recognized: true,
            ocrStatus: 'done',
            hint: 'page was recognised but produced no stored text',
          }
        }
      }

      if (!chunk) {
        throw new Error(
          args.chunkId == null
            ? 'evidence needs a chunkId, or a path and page'
            : `chunk not found: ${args.chunkId}`,
        )
      }
      const radius = args.radius == null ? 1 : args.radius
      const context = store.getChunkContext(chunk.id, radius)
      const payload = {
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
      // Only present when this call recognised the page: an `undefined` field
      // makes the tool result non-lossless JSON, which the carrier rejects.
      if (args.chunkId == null) payload.recognized = true
      return payload
    },
  }
}

function createTidyTool(tidy, indexer) {
  return {
    name: 'file_recall_tidy',
    description:
      'Propose a tidy plan for the indexed archive (read-only). Reports loose files sitting in a root, ' +
      'camera/scanner auto-names and names with no date signal (rename proposals only ADD a date prefix), ' +
      'duplicate file names, and folders holding too many files. It never moves, renames or deletes anything; ' +
      'the full plan is written to a JSON file and a summary is returned.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['plan', 'structure', 'detail', 'apply', 'undo'],
          description:
            '`structure` returns the ideal folder layout as a fishbone (SVG) plus its rules; `detail` returns the ' +
            'per-file target, one fishbone per top folder; `plan` lists concrete move/rename proposals. ' +
            '`apply` executes the persisted plan (dry run unless confirm=true) and `undo` reverses the journal. ' +
            'Only apply touches files, and only with confirm=true.',
        },
        confirm: {
          type: 'boolean',
          description: 'apply/undo only: must be true to touch files. Without it, nothing moves and nothing is undone.',
        },
        dryRun: {
          type: 'boolean',
          description: 'apply/undo only: default true. Set false together with confirm=true to execute.',
        },
        maxActions: {
          type: 'integer',
          minimum: 1,
          maximum: 400,
          description: 'Cap on proposed actions. Default 400.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object' }, render: jsonRender },
    async execute(args) {
      if (!tidy || !tidy.planner) throw new Error('tidy planner is not available in this carrier')
      const status = indexer ? indexer.status() : { roots: [] }

      if (args.action === 'structure') {
        const proposal = tidy.planner.structure({ roots: status.roots ?? [] })
        let svgPath = null
        try {
          const svg = renderFishbone({
            head: proposal.head,
            subtitle: proposal.subtitle,
            branches: proposal.branches,
            rules: proposal.proposal.rules,
          })
          svgPath = tidy.saveArtifact ? tidy.saveArtifact('tidy-structure.svg', svg) : null
        } catch (error) {
          svgPath = null
        }
        return {
          head: proposal.head,
          subtitle: proposal.subtitle,
          branches: proposal.branches,
          totals: proposal.totals,
          proposal: proposal.proposal,
          diagramPath: svgPath,
          executable: false,
          boundary:
            '这是结构预览：只画图、不动文件。你确认之后才会生成可执行清单，执行时另写日志以便撤销。',
        }
      }

      if (args.action === 'apply' || args.action === 'undo') {
        const isApply = args.action === 'apply'
        // A real run requires BOTH: dryRun:false and confirm:true. Anything else
        // stays a dry run, so a model cannot move files by accident.
        const execute = args.dryRun === false && args.confirm === true
        const root = (status.roots ?? [])[0]
        if (!root) throw new Error('no configured root: nothing to apply')
        if (!tidy.applier) throw new Error('applier is not available in this carrier')
        if (isApply) {
          const plan = tidy.loadPlan ? tidy.loadPlan() : null
          if (!plan || !Array.isArray(plan.actions)) {
            throw new Error('no persisted plan: run action "plan" first, so what executes is what was approved')
          }
          const actions = plan.actions
            .filter((action) => action.kind === 'move' || action.kind === 'rename')
            .map((action) => ({ from: action.from, to: action.to }))
          const result = tidy.applier.apply({
            root,
            actions,
            journalPath: tidy.journalPath,
            dryRun: !execute,
          })
          return {
            ...result,
            confirmRequired: true,
            executes: execute,
            hint: execute
              ? '已完成，可用 action "undo" 整批撤销。'
              : '这是演练（dry run），没有移动任何文件。真要执行需要 confirm=true 且 dryRun=false。',
          }
        }
        const result = tidy.applier.undo({
          root,
          journalPath: tidy.journalPath,
          dryRun: !execute,
        })
        return { ...result, executes: execute }
      }

      if (args.action === 'detail') {
        const detail = tidy.planner.detail({ roots: status.roots ?? [] })
        const diagramPaths = []
        if (tidy.saveArtifact) {
          detail.views.forEach((view, index) => {
            try {
              const svg = renderFishbone({
                head: view.top,
                subtitle: `${view.total} 个文件将移动 · 骨架：内容类型 · 每类最多列出 5 个文件名`,
                branches: view.kinds.map((kind) => ({
                  label: kind.kind,
                  count: kind.count,
                  children: kind.files.map((file) => ({
                    label: file.more ? file.name : `${file.name} → ${file.targetDir.split('/').slice(-1)[0] || ''}`,
                  })),
                })),
                maxChildren: 5,
              })
              const saved = tidy.saveArtifact(`tidy-detail-${index + 1}.svg`, svg)
              if (saved) diagramPaths.push(saved)
            } catch (error) {
              /* a failed render must not fail the proposal */
            }
          })
        }
        if (tidy.saveArtifact) {
          try {
            tidy.saveArtifact('tidy-detail.json', JSON.stringify(detail, null, 2))
          } catch (error) {
            /* optional */
          }
        }
        return {
          head: detail.head,
          protection: detail.protection,
          renameAllowed: detail.renameAllowed,
          totals: detail.totals,
          views: detail.views,
          omittedViews: detail.omittedViews,
          diagramPaths,
          executable: false,
          boundary:
            '这是逐文件预览：仍然不动任何文件。执行必须再确认一次，并写 journal 以便整批撤销。',
        }
      }

      if (args.action !== 'plan') {
        throw new Error(`unsupported action: ${args.action}`)
      }
      const plan = tidy.planner.plan({
        roots: status.roots ?? [],
        maxActions: args.maxActions,
      })
      let planPath = null
      try {
        planPath = tidy.savePlan ? tidy.savePlan(plan) : null
      } catch (error) {
        planPath = null
      }
      const sample = plan.actions.slice(0, 40)
      return {
        generatedAt: plan.generatedAt,
        roots: plan.roots,
        summary: plan.summary,
        actions: sample,
        actionsTotal: plan.actions.length,
        actionsShown: sample.length,
        duplicates: plan.duplicates,
        overloaded: plan.overloaded,
        notes: plan.notes,
        executable: plan.executable,
        boundary: plan.boundary,
        planPath,
      }
    },
  }
}

function createIndexTool(indexer, store, ocrStatus, uiStatus, expansionStatus, memoryStatus, onDemandOcr) {
  return {
    name: 'file_recall_index',
    description:
      'Manage the local document index. `sync` scans configured roots for new/changed/deleted files, ' +
      '`build` indexes a bounded batch and must be repeated until `done` is true, `status` reports coverage ' +
      'and the OCR provider self-check, `configure` replaces the scanned folders (persisted, prunes files ' +
      'outside the new roots, requires confirm=true), `retry` requeues failed files, `ocr` recognises a bounded ' +
      'number of pending scanned pages (the archive defaults to lazy OCR so a build stays fast), and `reset` ' +
      'drops the derived index while keeping learned vocabulary and roots (requires confirm=true).',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'sync', 'build', 'configure', 'retry', 'reset', 'ocr'],
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
        path: {
          type: 'string',
          description: 'ocr only: recognise the pending pages of this one file (absolute path).',
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
        if (ocr && typeof store.ocrPageStats === 'function') {
          ocr = { ...ocr, pages: store.ocrPageStats() }
        }
        const payload = { ...base, ui, expansion, memory }
        return ocr ? { ...payload, ocr } : payload
      }
      if (action === 'ocr') {
        if (!onDemandOcr) throw new Error('on-demand OCR is not available in this carrier')
        return onDemandOcr.warm({ limit: args.maxFiles, path: args.path ?? null })
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
export function createToolDefinitions({ store, search, indexer = null, learning = null, ocrStatus = null, uiStatus = null, expansionStatus = null, memoryStatus = null, onDemandOcr = null, tidy = null }) {
  if (!store) throw new Error('createToolDefinitions: store is required')
  if (!search) throw new Error('createToolDefinitions: search service is required')

  const tools = [createSearchTool(search), createEvidenceTool(store, onDemandOcr)]
  if (indexer) {
    tools.push(
      createIndexTool(indexer, store, ocrStatus, uiStatus, expansionStatus, memoryStatus, onDemandOcr),
    )
  }
  if (tidy) tools.push(createTidyTool(tidy, indexer))
  if (learning) tools.push(createFeedbackTool(learning))
  return tools
}
