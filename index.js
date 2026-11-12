/**
 * dsh-file-recall — local page-level recall for personal documents.
 *
 * M1 registers four tools and one runtime skill:
 *   file_recall_index / file_recall_search / file_recall_evidence / file_recall_feedback
 *   skill: file-recall
 */

import { mkdirSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'

import { normalizeConfig, resolveDbPath } from './lib/config.js'
import { openStore } from './lib/store.js'
import { createIndexer } from './lib/indexer.js'
import { createLearningService } from './lib/learning.js'
import { createSearchService } from './lib/search.js'
import { createToolDefinitions } from './lib/tools.js'
import { createLlmExpander } from './lib/expander.js'
import { createOcrService } from './lib/ocr/provider.js'
import { createSkillRegistration } from './lib/skill.js'
import { registerUiRoutes } from './lib/ui-routes.js'

export const name = 'file-recall'

export const inject = ['tools', 'skills']

function openStoreWithRecovery(dbPath) {
  try {
    return { store: openStore(dbPath), recoveredFrom: null }
  } catch (error) {
    if (dbPath === ':memory:') throw error
    const backup = `${dbPath}.corrupt-${Date.now()}`
    try {
      renameSync(dbPath, backup)
    } catch {
      throw error
    }
    const store = openStore(dbPath)
    store.setMeta('indexer.recoveredFrom', backup)
    return { store, recoveredFrom: backup }
  }
}

export function apply(ctx, rawConfig = {}) {
  const config = normalizeConfig(rawConfig)
  const dbPath = resolveDbPath(config)
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true })

  const { store } = openStoreWithRecovery(dbPath)

  // Runtime `configure` persists roots in meta; explicit plugin config wins.
  let persistedRoots = []
  try {
    const raw = store.getMeta('indexer.rootsOverride', '[]')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) persistedRoots = parsed.map(String)
  } catch {
    persistedRoots = []
  }
  const effectiveRoots = config.roots.length > 0 ? config.roots : persistedRoots

  // OCR is created on first use: worker/vision probes must not slow plugin load.
  let ocrPromise = null
  const ocrProxy = config.ocr.enabled
    ? {
        async recognize(input) {
          ocrPromise ??= createOcrService({ config: config.ocr })
          const service = await ocrPromise
          if (!service?.provider) return { text: '', confidence: null, source: 'none' }
          return service.recognize(input)
        },
      }
    : null

  const indexer = createIndexer({
    store,
    roots: effectiveRoots,
    excludeGlobs: config.excludeGlobs,
    maxFileBytes: config.maxFileBytes,
    batchMs: config.index.batchMs,
    maxFilesPerBatch: config.index.maxFilesPerBatch,
    ocrMaxPages: config.ocr.maxPagesPerDoc,
    ocr: ocrProxy,
    dbPath,
  })

  let expander = null
  if (config.expansion.enabled) {
    try {
      const llm = ctx.get?.('llm')
      const selection = ctx.get?.('agentDefaultModel')?.currentSelection?.()
      const provider = config.expansion.provider || selection?.provider
      const model = config.expansion.model || selection?.model
      if (llm && provider && model) expander = createLlmExpander({ llm, provider, model })
    } catch {
      expander = null
    }
  }

  const learning = createLearningService({ store })
  const search = createSearchService({
    store,
    expander,
    learning,
    expandTimeoutMs: config.expansion.timeoutMs,
    defaultTopK: config.topK,
  })

  async function ocrStatus() {
    if (!config.ocr.enabled) return { enabled: false, provider: null }
    try {
      ocrPromise ??= createOcrService({ config: config.ocr })
      const service = await ocrPromise
      return {
        enabled: true,
        provider: service?.provider ?? null,
        fallbackFrom: service?.fallbackFrom ?? null,
        experimental: Boolean(service?.experimental),
      }
    } catch (error) {
      return {
        enabled: true,
        provider: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  // Register the lifecycle first so tools unregister before the store closes.
  ctx.effect(
    () => () => {
      try {
        store.close()
      } catch {
        // Already closed.
      }
      if (ocrPromise) ocrPromise.then((service) => service?.dispose?.()).catch(() => {})
    },
    'file-recall: lifecycle',
  )

  const definitions = createToolDefinitions({ store, search, indexer, learning, ocrStatus })
  for (const definition of definitions) {
    ctx.effect(
      () => ctx.tools.register(definition),
      `file-recall: ${definition.name}`,
    )
  }

  const skill = createSkillRegistration()
  ctx.effect(() => ctx.skills.register(skill), 'file-recall: skill')

  // Client panel data (read-only). Absent in headless carriers.
  try {
    const webServer = ctx.get?.('webServer')
    if (webServer?.register) {
      ctx.effect(
        () => registerUiRoutes({ webServer, indexer, store, ocrStatus }),
        'file-recall: ui routes',
      )
    }
  } catch {
    // A carrier without an HTTP server simply has no panel.
  }
}
