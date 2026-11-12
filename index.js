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
import { registerUiRoutes, ROUTE_PATH as UI_ROUTE_PATH } from './lib/ui-routes.js'

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
  // Latest context seen by any of this plugin's forks. Injected services appear
  // on the fork's context, not on the apply-time one, so lazy resolution reads
  // from here.
  let liveCtx = ctx

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

  // Query expansion resolves the model LAZILY, on the first search.
  //
  // Same trap as webServer: reading `llm` / `agentDefaultModel` during apply()
  // misses services the host activates afterwards, which left every search
  // reporting "no query expander configured". The search service re-reads
  // `expanderHolder.current` on every call, so filling it later is enough.
  const expanderHolder = { current: null, probed: false, reason: null }
  function resolveExpander(readCtx) {
    if (expanderHolder.probed) return expanderHolder.current
    expanderHolder.probed = true
    if (!config.expansion.enabled) {
      expanderHolder.reason = 'query expansion is disabled'
      return null
    }
    try {
      const llm = readCtx.llm ?? readCtx.get?.('llm')
      const modelService = readCtx.agentDefaultModel ?? readCtx.get?.('agentDefaultModel')
      const selection = modelService?.currentSelection?.()
      const provider = config.expansion.provider || selection?.provider
      const model = config.expansion.model || selection?.model
      if (!llm) {
        expanderHolder.reason = 'llm service unavailable'
        return null
      }
      if (!provider || !model) {
        expanderHolder.reason = 'no default model selection'
        return null
      }
      expanderHolder.current = createLlmExpander({ llm, provider, model })
      expanderHolder.reason = null
    } catch (error) {
      expanderHolder.current = null
      expanderHolder.reason = error instanceof Error ? error.message : String(error)
    }
    return expanderHolder.current
  }

  // Retry resolution on later services; `probed` only sticks on success or a
  // real answer, so a search before `llm` starts is not permanently degraded.
  //
  // The search service calls the expander as a plain function
  // (`expander({ query, hints, signal })`), so this must be callable, not an
  // object with an `expand` method.
  async function expander({ query, hints, signal }) {
    const active = expanderHolder.current ?? resolveExpander(liveCtx)
    if (!active) throw new Error(expanderHolder.reason ?? 'no query expander configured')
    return active({ query, hints, signal })
  }
  const expanderForSearch = config.expansion.enabled ? expander : null

  const learning = createLearningService({ store })
  const search = createSearchService({
    store,
    expander: expanderForSearch,
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

  // Observable state of the optional HTTP carrier. `file_recall_index status`
  // reports it, so a missing panel is diagnosable without reading host logs.
  const uiState = { status: 'waiting', path: UI_ROUTE_PATH, error: null }
  const uiStatus = () => ({ ...uiState })

  // Expansion diagnostics: what the plugin actually resolved, and why not.
  const expansionStatus = () => ({
    enabled: config.expansion.enabled,
    active: Boolean(expanderHolder.current),
    reason: expanderHolder.reason,
    probed: expanderHolder.probed,
    configured: config.expansion.provider
      ? `${config.expansion.provider}/${config.expansion.model || '(default)'}`
      : 'auto (agentDefaultModel)',
  })

  const definitions = createToolDefinitions({
    store,
    search,
    indexer,
    learning,
    ocrStatus,
    uiStatus,
    expansionStatus,
  })
  for (const definition of definitions) {
    ctx.effect(
      () => ctx.tools.register(definition),
      `file-recall: ${definition.name}`,
    )
  }

  const skill = createSkillRegistration()
  ctx.effect(() => ctx.skills.register(skill), 'file-recall: skill')

  // The HTTP carrier is optional: a headless carrier simply has no panel.
  //
  // `ctx.inject` runs this fork as soon as the service is available — including
  // when `webServer` starts AFTER this plugin. A one-shot `ctx.get('webServer')`
  // inside apply() misses exactly that ordering and leaves the panel with a
  // permanent 404 while every tool and the skill keep working.
  function mountUiRoutes(web) {
    const webServer = web.webServer
    if (!webServer?.register) {
      uiState.status = 'unsupported'
      return
    }
    try {
      const dispose = registerUiRoutes({ webServer, indexer, store, ocrStatus })
      uiState.status = 'registered'
      uiState.error = null
      web.effect(
        () => () => {
          if (uiState.status === 'registered') uiState.status = 'disposed'
          try {
            dispose?.()
          } catch {
            // Already unregistered.
          }
        },
        'file-recall: ui routes',
      )
    } catch (error) {
      uiState.status = 'error'
      uiState.error = error instanceof Error ? error.message : String(error)
    }
  }

  if (typeof ctx.inject === 'function') {
    // `llm` and `agentDefaultModel` are the expander's inputs; taking them by
    // injection keeps the fork context (and `liveCtx`) pointed at a context
    // that actually carries them.
    ctx.inject(['webServer'], (web) => {
      liveCtx = web
      mountUiRoutes(web)
    })
    ctx.inject(['llm', 'agentDefaultModel'], (modelCtx) => {
      liveCtx = modelCtx
      expanderHolder.probed = false
      resolveExpander(modelCtx)
      modelCtx.effect(
        () => () => {
          expanderHolder.current = null
          expanderHolder.probed = false
        },
        'file-recall: expander',
      )
    })
  } else {
    // Carriers without the scoped-inject helper: try once, never abort loading.
    const webServer = ctx.get?.('webServer')
    if (webServer?.register) mountUiRoutes({ webServer, effect: ctx.effect.bind(ctx) })
  }
}
