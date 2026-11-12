/**
 * Feedback learning: persist recall outcomes and turn user corrections into a
 * small, inspectable synonym table. Learned expansions are applied before the
 * LLM expander, so they work offline and are visible in the search result.
 */

const VERDICTS = new Set(['hit', 'wrong', 'partial'])

function parseCorrection(query, correction) {
  const pair = String(correction).match(/^(.{1,60}?)\s*(?:=|＝|→|->)\s*(.{1,60})$/)
  if (pair) {
    const term = pair[1].trim()
    const expansion = pair[2].trim()
    return term && term !== expansion ? { term, expansion } : null
  }
  const term = String(query ?? '').trim().slice(0, 80)
  if (!term || term === correction) return null
  return { term, expansion: String(correction).trim().slice(0, 80) }
}

export function createLearningService(options = {}) {
  const { store } = options
  if (!store) throw new Error('createLearningService: store is required')

  function recordFeedback(input = {}) {
    const verdict = String(input.verdict ?? '')
    if (!VERDICTS.has(verdict)) {
      throw new Error(`feedback verdict must be one of hit|wrong|partial, got ${verdict || '(none)'}`)
    }

    let path = input.path ?? null
    let chunkId = input.chunkId == null ? null : Number(input.chunkId)
    if (chunkId != null) {
      const chunk = store.getChunk(chunkId)
      if (!chunk) throw new Error(`chunk not found: ${chunkId}`)
      path = chunk.path
    }
    if (chunkId == null && !input.query) {
      throw new Error('feedback needs a chunkId or the user query')
    }

    const correction = input.correction ? String(input.correction).trim().slice(0, 200) : null
    const feedbackId = store.recordFeedback({
      query: input.query == null ? null : String(input.query).slice(0, 500),
      chunkId,
      path,
      verdict,
      correction,
      note: input.note == null ? null : String(input.note).slice(0, 500),
    })

    let learned = null
    if (correction) {
      const mapping = parseCorrection(input.query, correction)
      if (mapping && mapping.term !== mapping.expansion) {
        store.upsertSynonym({
          term: mapping.term,
          expansion: mapping.expansion,
          source: 'learned',
        })
        learned = { ...mapping, source: 'learned' }
      }
    }

    return { feedbackId, path, learned }
  }

  function listFeedback(limit = 20) {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100)
    return store.listFeedback(safeLimit)
  }

  function listSynonyms(source = 'learned') {
    return store.listSynonyms(source)
  }

  /** Find learned expansions whose term appears in the query segments/tokens. */
  function applySynonyms({ segments = [], tokens = [] } = {}) {
    const candidates = [...segments, ...tokens]
      .map((value) => String(value).trim().toLowerCase())
      .filter(Boolean)
    if (candidates.length === 0) return []

    return store
      .listSynonyms('learned')
      .filter((row) => {
        const term = String(row.term ?? '').trim().toLowerCase()
        if (!term) return false
        return candidates.some(
          (candidate) => candidate === term || (term.length >= 2 && candidate.includes(term)),
        )
      })
      .map((row) => ({ term: row.term, expansion: row.expansion, source: row.source }))
  }

  return { recordFeedback, listFeedback, listSynonyms, applySynonyms }
}

export { parseCorrection }
