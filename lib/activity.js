/**
 * In-memory log of recent recall activity.
 *
 * The panel cannot see the model's tool calls, so the host records each finished
 * search as a small event the browser half can poll. This is deliberately NOT
 * persisted: it is a presence signal ("something just happened"), not history —
 * durable history lives in the `queries` / `feedback` tables.
 *
 * Bounded and detached: callers get copies, so a poll cannot mutate the log.
 */

const SNIPPET_CHARS = 110

function clip(value, max) {
  const text = String(value ?? '')
  if (text.length <= max) return text
  return text.slice(0, max - 1) + '…'
}

function describeHit(hit) {
  if (!hit || typeof hit !== 'object') return null
  return {
    path: String(hit.path ?? ''),
    locator: hit.locator ? String(hit.locator) : '',
    kind: hit.kind ? String(hit.kind) : '',
    snippet: clip(hit.snippet, SNIPPET_CHARS),
    score: typeof hit.score === 'number' ? hit.score : null,
  }
}

/** Detached copy: nested arrays/objects must not be shared with the log. */
function cloneEvent(event) {
  return {
    ...event,
    terms: event.terms.slice(),
    top: event.top.map((hit) => ({ ...hit })),
  }
}

/**
 * @param {{ limit?: number, now?: () => number }} [options]
 */
export function createActivityLog(options = {}) {
  const limit = Math.max(1, Math.floor(Number(options.limit) || 24))
  const now = typeof options.now === 'function' ? options.now : () => Date.now()

  const events = []
  let nextId = 1

  /**
   * Record one finished search. Never throws: a presence signal must not be able
   * to fail a search that already succeeded.
   *
   * @param {{
   *   query?: string,
   *   result?: object,
   *   ms?: number,
   *   error?: string,
   * }} input
   */
  function record(input = {}) {
    try {
      const result = input.result ?? {}
      const hits = Array.isArray(result.hits) ? result.hits : []
      const terms = Array.isArray(result.expandedTerms) ? result.expandedTerms : []
      const event = {
        id: nextId++,
        at: now(),
        // Which conversation it happened in: the panel strip must not replay a
        // recall from another session (or from an hour ago) when one is opened.
        sessionId: input.sessionId ? clip(input.sessionId, 64) : null,
        query: clip(input.query ?? result.query ?? '', 160),
        terms: terms.slice(0, 8).map((term) => clip(term, 24)),
        hits: hits.length,
        degraded: Boolean(result.degraded),
        degradedReason: result.degradedReason ? clip(result.degradedReason, 160) : null,
        relaxed: Boolean(result.relaxed),
        ms: Math.max(0, Math.round(Number(input.ms) || 0)),
        error: input.error ? clip(input.error, 200) : null,
        top: hits.slice(0, 3).map(describeHit).filter(Boolean),
      }
      events.push(event)
      while (events.length > limit) events.shift()
      return event
    } catch {
      return null
    }
  }

  /** Events newer than `id`, oldest first. `id` 0 returns the whole log. */
  function since(id) {
    const cursor = Number(id)
    if (!Number.isFinite(cursor) || cursor <= 0) return events.map(cloneEvent)
    return events.filter((event) => event.id > cursor).map(cloneEvent)
  }

  /** Newest event id, or 0 when nothing has happened yet. */
  function latestId() {
    return events.length === 0 ? 0 : events[events.length - 1].id
  }

  function list() {
    return events.map(cloneEvent)
  }

  return { record, since, latestId, list, limit }
}
