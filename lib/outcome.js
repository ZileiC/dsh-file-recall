/**
 * Infer whether a recall actually worked, without asking the user.
 *
 * The person who needs this most will never type "找对了": he describes
 * something, looks at the answer, and either keeps going or rephrases. So the
 * verdict is derived from what he does NEXT:
 *
 *   - he searches again, about the same thing   -> the previous recall missed
 *   - he searches for something else             -> the previous recall was fine
 *   - he says nothing                            -> nothing is written (unknown)
 *
 * Two guards keep this from poisoning the learned vocabulary:
 *   1. Inferred verdicts are labelled `inferred`; only `stated` ones feed the
 *      synonym table, so the plugin cannot train itself on its own guesses.
 *   2. A verdict is only inferred inside a time window. Coming back two days
 *      later to search something else says nothing about the old recall.
 *
 * Everything here is deterministic — no model call, no network, no data egress.
 */

import { tokenizeText } from './tokenize.js'

const DEFAULT_WINDOW_MS = 15 * 60 * 1000
const DEFAULT_OVERLAP = 0.5

/**
 * Characters that carry no retrieval meaning in a restated question.
 *
 * Without this, "那个预算的方案" and "预算方案到底在哪" look half-different purely
 * because of filler bigrams (那个 / 算的 / 的方), which would make the plugin read
 * a rephrase as a brand new request and record a false "hit".
 */
const FILLER = new Set('的了着过是有和与及那就这那些个哪什么怎样吗呢吧啊咱很都也还再又把被让给从向对吧嘛呗')

function contentTokens(text) {
  return tokenizeText(String(text ?? ''))
    .map((token) => String(token).toLowerCase())
    .filter((token) => {
      for (const character of token) if (!FILLER.has(character)) return true
      return false
    })
}

/**
 * Symmetric containment: how much of the smaller query is shared.
 *
 * Containment (not Jaccard) is the right measure here: "那个预算的方案" becoming
 * "预算方案 2023" is the same need restated, even though the shorter query has
 * far fewer tokens.
 */
export function queryOverlap(left, right) {
  const a = new Set(contentTokens(left))
  const b = new Set(contentTokens(right))
  if (a.size === 0 || b.size === 0) {
    // Everything was filler: fall back to raw character containment so a short
    // "在哪" style follow-up is not treated as infinitely similar.
    const rawA = new Set(Array.from(String(left ?? '').replace(/\s+/g, '')))
    const rawB = new Set(Array.from(String(right ?? '').replace(/\s+/g, '')))
    if (rawA.size === 0 || rawB.size === 0) return 0
    let sharedRaw = 0
    for (const character of rawA) if (rawB.has(character)) sharedRaw += 1
    return sharedRaw / Math.min(rawA.size, rawB.size)
  }
  let shared = 0
  for (const token of a) if (b.has(token)) shared += 1
  return shared / Math.min(a.size, b.size)
}

/**
 * @param {{
 *   store: object,
 *   now?: () => number,
 *   windowMs?: number,
 *   overlapThreshold?: number,
 * }} options
 */
export function createOutcomeResolver(options = {}) {
  const { store } = options
  if (!store) throw new Error('createOutcomeResolver: store is required')
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const windowMs = Number(options.windowMs) > 0 ? Number(options.windowMs) : DEFAULT_WINDOW_MS
  const threshold =
    Number(options.overlapThreshold) >= 0 ? Number(options.overlapThreshold) : DEFAULT_OVERLAP

  /**
   * Resolve the previous unresolved search in the light of a new one.
   * Returns the resolution decision, or null when there was nothing to resolve.
   */
  function settlePrevious(raw, { at = now() } = {}) {
    if (!String(raw ?? '').trim()) return null
    const previous = store.lastUnresolvedQuery({ sinceTs: at - windowMs })
    if (!previous) return null
    if (!String(previous.raw ?? '').trim()) return null

    const overlap = queryOverlap(previous.raw, raw)
    // Nothing came back last time: it cannot have been a success.
    const missedBefore = Number(previous.hits) === 0
    const restated = overlap >= threshold
    const outcome = missedBefore || restated ? 'wrong' : 'hit'

    const updated = store.resolveQuery(previous.id, {
      outcome,
      source: 'inferred',
      resolvedAt: at,
    })
    return {
      queryId: previous.id,
      query: previous.raw,
      outcome,
      source: 'inferred',
      reason: missedBefore ? 'previous search found nothing' : restated ? 'restated the same need' : 'moved on to another need',
      overlap: Number(overlap.toFixed(3)),
      updated,
    }
  }

  let inserted = 0

  /**
   * Record one search: settle the previous one, then store this one as pending.
   * Never throws — memory must not be able to break a search.
   */
  function observe({ raw, rewritten = null, result = null, elapsedMs = null, at = now() }) {
    const recorded = { settlement: null, queryId: null }
    try {
      recorded.settlement = settlePrevious(raw, { at })
    } catch {
      recorded.settlement = null
    }
    try {
      const hits = Array.isArray(result?.hits) ? result.hits : []
      const top = hits[0] ?? null
      recorded.queryId = store.recordQuery({
        ts: at,
        raw: String(raw ?? '').slice(0, 500),
        rewritten: rewritten == null ? null : String(rewritten).slice(0, 1000),
        elapsedMs: elapsedMs == null ? null : Math.round(Number(elapsedMs) || 0),
        hits: hits.length,
        topChunk: top && Number.isInteger(top.chunkId) ? top.chunkId : null,
        topPath: top && top.path ? String(top.path) : null,
      })
      inserted += 1
      // Amortized bound: check the size occasionally instead of on every search.
      if (inserted % 200 === 0 && typeof store.pruneQueries === 'function') {
        try {
          store.pruneQueries()
        } catch {
          /* pruning is housekeeping */
        }
      }
    } catch {
      recorded.queryId = null
    }
    return recorded
  }

  /**
   * The user told us directly. Prefer the newest unresolved query with the same
   * text; otherwise the newest unresolved one. Marks it `stated`.
   */
  function confirm({ query = null, verdict, chunkId = null, correction = null, at = now() }) {
    if (!verdict) return null
    try {
      const recent = store.listQueries(20)
      const unresolved = recent.filter((row) => row.outcome === null || row.outcome === undefined)
      if (unresolved.length === 0) return null
      const text = String(query ?? '').trim()
      const match =
        (text ? unresolved.find((row) => String(row.raw ?? '').trim() === text) : null) ??
        (text ? unresolved.find((row) => queryOverlap(row.raw, text) >= 0.6) : null) ??
        unresolved[0]
      return store.resolveQuery(match.id, {
        outcome: verdict,
        source: 'stated',
        chosenChunk: chunkId == null ? null : Number(chunkId),
        corrected: correction == null ? null : String(correction).slice(0, 500),
        resolvedAt: at,
      })
    } catch {
      return null
    }
  }

  return { observe, settlePrevious, confirm }
}
