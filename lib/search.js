/**
 * Query understanding, dual-arm retrieval (content + path), RRF fusion and
 * evidence-sized snippets.
 *
 * The first-pass query is strict (a segment's bigrams must all match). When it
 * returns nothing, the same tokens are OR-ed instead, which covers the common
 * "有点印象但词语没连在一起" case. The agent then reads the candidate page and
 * verifies the quote, so recall-first behaviour is intentional.
 */

import { tokenizeQuery, tokenizeText } from './tokenize.js'

const SEGMENT_SPLIT = /[\s,，。.;；、!！?？:：/\\|｜()（）[\]【】{}…·]+/

const FILLERS = [
  /请?帮我(?:找|查|翻|搜)(?:一下|找|查)?/g,
  /还?记得/g,
  /好像|大概|差不多|似乎/g,
  /那个|这个|那份|这份|那一次|这次/g,
  /之前|以前|从前/g,
  /一份|一个|一次/g,
  /关于/g,
]

const KIND_EXTENSIONS = {
  slide: ['.pptx', '.ppt'],
  notes: ['.pptx', '.ppt'],
  page: ['.pdf'],
  ocr: ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff'],
  block: ['.docx', '.doc', '.txt', '.md', '.markdown'],
  sheet: ['.xlsx', '.xls'],
}

export function normalizeQuery(raw) {
  let text = String(raw ?? '')
    .normalize('NFKC')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  for (const filler of FILLERS) text = text.replace(filler, ' ')
  return text.replace(/\s+/g, ' ').trim()
}

/** Years and document-type words become explicit query hints. */
export function extractQueryHints(rawQuery) {
  const normalized = normalizeQuery(rawQuery)
  const years = [...new Set((normalized.match(/(?:19|20)\d{2}/g) ?? []).map(Number))]

  const kinds = new Set()
  if (/(?:ppt|pptx|幻灯片|演示文稿|deck)/i.test(normalized)) {
    kinds.add('slide')
    kinds.add('notes')
  }
  if (/pdf/i.test(normalized)) {
    kinds.add('page')
    kinds.add('ocr')
  }
  if (/(?:word|docx)/i.test(normalized)) kinds.add('block')
  if (/(?:excel|xlsx|表格|工作表)/i.test(normalized)) kinds.add('sheet')

  const quoted = [...normalized.matchAll(/[「“"《]([^」”"》]{2,60})[」”"》]/g)]
    .map((match) => match[1].trim())
    .filter(Boolean)

  return { normalized, years, kinds: [...kinds], quoted }
}

export function querySegments(hints) {
  return hints.normalized
    .split(SEGMENT_SPLIT)
    .map((segment) => segment.trim())
    .filter(Boolean)
}

/**
 * Strict groups: each segment is an AND of its bigrams; groups are OR-ed.
 * `relaxedTokens` is the OR-of-everything fallback.
 */
export function buildQueryPlan(hints) {
  const groups = []
  const tokens = []
  const seenGroups = new Set()

  for (const segment of [...querySegments(hints), ...hints.quoted]) {
    const segmentTokens = tokenizeQuery(segment)
    if (segmentTokens.length === 0) continue
    const key = segmentTokens.join('\u0000')
    if (seenGroups.has(key)) continue
    seenGroups.add(key)
    groups.push(segmentTokens)
    for (const token of segmentTokens) tokens.push(token)
  }

  return {
    segments: querySegments(hints),
    groups: groups.slice(0, 12),
    tokens: [...new Set(tokens)],
  }
}

function quoteToken(token) {
  return `"${String(token).replace(/"/g, '""')}"`
}

export function groupsToFts(groups) {
  const clauses = groups
    .map((group) => group.map(quoteToken).join(' AND '))
    .filter(Boolean)
  return clauses.map((clause) => `(${clause})`).join(' OR ')
}

export function tokensToFts(tokens) {
  const clauses = tokens.filter(Boolean).map(quoteToken)
  return clauses.map((clause) => `(${clause})`).join(' OR ')
}

function locatorFor(hit) {
  if (hit.kind === 'sheet') {
    const match = String(hit.text ?? '').match(/^\[(.+?)\]/)
    return match ? match[1] : `sheet row ${hit.block ?? '?'}`
  }
  if (hit.page != null) return `page ${hit.page}`
  if (hit.block != null) return `block ${hit.block}`
  return hit.kind
}

export function makeSnippet(text, rawTerms, maxLength = 320) {  const source = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!source) return ''
  if (source.length <= maxLength) return source

  const terms = (rawTerms ?? []).filter((term) => typeof term === 'string' && term.length >= 2)
  let index = -1
  for (const term of terms) {
    const found = source.indexOf(term)
    if (found >= 0 && (index < 0 || found < index)) index = found
  }
  if (index < 0) return `${source.slice(0, maxLength)}…`

  const start = Math.max(0, index - 80)
  const end = Math.min(source.length, start + maxLength)
  return `${start > 0 ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`
}

/** Reciprocal-rank fusion over arms that share a `chunkId`. */
export function rrfFuse(rankedLists, k = 60) {
  const merged = new Map()
  for (const list of rankedLists) {
    list.forEach((item, index) => {
      const key = String(item.chunkId)
      const existing = merged.get(key)
      if (existing) {
        existing.score += 1 / (k + index + 1)
        existing.arms.add(item.arm)
        return
      }
      merged.set(key, {
        item: { ...item },
        score: 1 / (k + index + 1),
        arms: new Set([item.arm]),
      })
    })
  }

  return [...merged.values()]
    .map(({ item, score, arms }) => ({
      ...item,
      score,
      matchType: arms.size > 1 ? 'content+path' : [...arms][0],
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        (right.mtime ?? 0) - (left.mtime ?? 0) ||
        String(left.path).localeCompare(String(right.path)),
    )
}

function normalizeTerms(value) {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value
        .map((item) => String(item ?? '').trim())
        .filter((item) => item.length > 0),
    ),
  ].slice(0, 12)
}

function allowedExtensions(kinds) {
  if (!Array.isArray(kinds) || kinds.length === 0) return null
  const extensions = new Set()
  for (const kind of kinds) {
    for (const extension of KIND_EXTENSIONS[kind] ?? []) extensions.add(extension)
  }
  return extensions.size > 0 ? extensions : null
}

export function createSearchService(options = {}) {
  const {
    store,
    expander = null,
    learning = null,
    expandTimeoutMs = 3_000,
    defaultTopK = 8,
    candidateLimit = 20,
    rrfK = 60,
  } = options

  if (!store) throw new Error('createSearchService: store is required')
  if (!Number.isFinite(expandTimeoutMs) || expandTimeoutMs <= 0) {
    throw new Error('expandTimeoutMs must be positive')
  }

  const expansionCache = new Map()

  async function expand(query, hints, signal) {
    if (!expander) {
      return { terms: [], synonyms: [], degraded: true, reason: 'no query expander configured' }
    }
    const cacheKey = hints.normalized
    const cached = expansionCache.get(cacheKey)
    if (cached) return { ...cached, cached: true }

    const controller = new AbortController()
    const onAbort = () => controller.abort()
    signal?.addEventListener?.('abort', onAbort, { once: true })
    let timer = null
    try {
      const result = await Promise.race([
        Promise.resolve().then(() =>
          expander({ query, hints, signal: controller.signal }),
        ),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort()
            const error = new Error('query expansion timed out')
            error.code = 'EXPANSION_TIMEOUT'
            reject(error)
          }, expandTimeoutMs)
        }),
      ])
      const entry = {
        terms: normalizeTerms(result?.terms ?? result?.keywords),
        synonyms: normalizeTerms(result?.synonyms),
        degraded: false,
        reason: null,
      }
      expansionCache.set(cacheKey, entry)
      if (expansionCache.size > 200) {
        expansionCache.delete(expansionCache.keys().next().value)
      }
      return entry
    } catch (error) {
      const timedOut = error?.code === 'EXPANSION_TIMEOUT'
      return {
        terms: [],
        synonyms: [],
        degraded: true,
        reason: timedOut ? 'timeout' : error?.message ?? 'expansion failed',
      }
    } finally {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
    }
  }

  async function search(args = {}, context = {}) {
    const startedAt = Date.now()
    const rawQuery = String(args.query ?? '')
    const topK = Math.min(Math.max(Number(args.topK) || defaultTopK, 1), 20)
    const filters = args.filters ?? {}
    const hints = extractQueryHints(rawQuery)

    if (!hints.normalized) {
      return {
        query: rawQuery,
        normalized: '',
        hints,
        hits: [],
        degraded: false,
        degradedReason: null,
        reason: 'empty query',
        elapsedMs: Date.now() - startedAt,
      }
    }

    const plan = buildQueryPlan(hints)
    if (plan.tokens.length === 0) {
      return {
        query: rawQuery,
        normalized: hints.normalized,
        hints,
        hits: [],
        degraded: false,
        degradedReason: null,
        reason: 'empty query',
        elapsedMs: Date.now() - startedAt,
      }
    }
    const expansion = await expand(rawQuery, hints, context.signal)
    let learned = []
    try {
      learned = learning?.applySynonyms({ segments: plan.segments, tokens: plan.tokens }) ?? []
    } catch {
      learned = []
    }
    const learnedGroups = learned
      .map((item) => tokenizeQuery(item.expansion))
      .filter((group) => group.length > 0)
    const expansionGroups = [...expansion.terms, ...expansion.synonyms]
      .map((term) => tokenizeQuery(term))
      .filter((group) => group.length > 0)

    const strictGroups = [...plan.groups, ...learnedGroups, ...expansionGroups]
    const relaxedTokens = [
      ...new Set([...plan.tokens, ...learnedGroups.flat(), ...expansionGroups.flat()]),
    ]
    const strictFts = groupsToFts(strictGroups)
    const relaxedFts = tokensToFts(relaxedTokens)

    const autoKinds = hints.kinds.length > 0 ? hints.kinds : null
    const explicitKinds = Array.isArray(filters.kinds) && filters.kinds.length > 0
    let kinds = explicitKinds ? filters.kinds : autoKinds

    // Explicit year filters map to file mtimes. Query years are NOT applied
    // automatically: mtime is last-save time, not content year, so filtering on
    // it silently would drop old documents that were copied recently.
    let mtimeFrom = filters.mtimeFrom ?? null
    let mtimeTo = filters.mtimeTo ?? null
    if (Array.isArray(filters.years) && filters.years.length > 0) {
      const years = filters.years.map(Number).filter(Number.isFinite)
      if (years.length > 0) {
        if (mtimeFrom == null) mtimeFrom = Date.UTC(Math.min(...years), 0, 1)
        if (mtimeTo == null) mtimeTo = Date.UTC(Math.max(...years), 11, 31, 23, 59, 59, 999)
      }
    }

    const coverageTokens = [
      ...new Set([...plan.tokens, ...learnedGroups.flat(), ...expansionGroups.flat()]),
    ]

    function collectPool(kindFilter) {
      const baseFilters = {
        limit: candidateLimit,
        kinds: kindFilter,
        mtimeFrom,
        mtimeTo,
        pathPrefix: filters.pathPrefix ?? null,
      }
      const poolFilters = { ...baseFilters, limit: 50 }
      const strictHits = strictFts ? store.searchContent(strictFts, poolFilters) : []
      const relaxedHits = relaxedFts ? store.searchContent(relaxedFts, poolFilters) : []
      const relaxed = strictHits.length === 0 || relaxedHits.length > strictHits.length

      // Merge both passes and order by how many query tokens the chunk actually
      // contains. BM25 alone can rank a short "2023 title" page above a page
      // that matches the whole remembered phrase.
      const pool = new Map()
      for (const hit of [...strictHits, ...relaxedHits]) {
        const id = String(hit.id)
        if (!pool.has(id)) pool.set(id, hit)
      }
      const coverage = new Map()
      for (const [id, hit] of pool) {
        const textTokens = new Set(tokenizeText(hit.text))
        coverage.set(id, coverageTokens.filter((token) => textTokens.has(token)).length)
      }
      const contentHits = [...pool.entries()]
        .sort(
          ([leftId, left], [rightId, right]) =>
            coverage.get(rightId) - coverage.get(leftId) || left.rank - right.rank,
        )
        .map(([, hit]) => hit)
        .slice(0, candidateLimit)

      return { contentHits, relaxed }
    }

    let collected = collectPool(kinds)
    let relaxedKinds = false
    // A remembered document type can be wrong. If the auto (hint) filter leaves
    // almost nothing, retry without it and report that the kind filter was relaxed.
    if (!explicitKinds && autoKinds && collected.contentHits.length === 0) {
      const withoutKinds = collectPool(null)
      if (withoutKinds.contentHits.length > collected.contentHits.length) {
        collected = withoutKinds
        kinds = null
        relaxedKinds = true
      }
    }
    const { contentHits, relaxed } = collected
    const extensions = allowedExtensions(kinds)

    const pathHitsRaw = relaxedFts
      ? store.searchPaths(relaxedFts, {
          limit: candidateLimit,
          mtimeFrom,
          mtimeTo,
          pathPrefix: filters.pathPrefix ?? null,
        })
      : []
    const pathHits = extensions
      ? pathHitsRaw.filter((hit) =>
          [...extensions].some((extension) => hit.path.toLowerCase().endsWith(extension)),
        )
      : pathHitsRaw

    const contentByPath = new Map()
    for (const hit of contentHits) {
      if (!contentByPath.has(hit.path)) contentByPath.set(hit.path, hit)
    }

    const contentArm = contentHits.map((hit) => ({
      chunkId: Number(hit.id),
      path: hit.path,
      kind: hit.kind,
      page: hit.page,
      block: hit.block,
      text: hit.text,
      mtime: Number(hit.mtime),
      ocrSource: hit.ocr_source ?? null,
      ocrConfidence: hit.ocr_confidence ?? null,
      arm: 'content',
    }))

    const pathArm = []
    for (const hit of pathHits) {
      const representative = contentByPath.get(hit.path) ?? store.getFirstChunk(hit.path)
      if (!representative) continue
      pathArm.push({
        chunkId: Number(representative.id),
        path: representative.path,
        kind: representative.kind,
        page: representative.page,
        block: representative.block,
        text: representative.text,
        mtime: Number(hit.mtime),
        ocrSource: representative.ocr_source ?? null,
        ocrConfidence: representative.ocr_confidence ?? null,
        arm: 'path',
      })
    }

    const fused = rrfFuse([contentArm, pathArm], rrfK).slice(0, topK)
    const rawTerms = [...plan.segments, ...hints.quoted, ...expansion.terms, ...expansion.synonyms]
    const hits = fused.map((entry) => ({
      chunkId: entry.chunkId,
      path: entry.path,
      kind: entry.kind,
      page: entry.page,
      block: entry.block,
      locator: locatorFor(entry),
      snippet: makeSnippet(entry.text, rawTerms),
      score: Number(entry.score.toFixed(6)),
      matchType: entry.matchType,
      mtime: entry.mtime,
      ocrSource: entry.ocrSource,
      ocrConfidence: entry.ocrConfidence,
    }))

    return {
      query: rawQuery,
      normalized: hints.normalized,
      hints,
      relaxed,
      relaxedKinds,
      degraded: expansion.degraded,
      degradedReason: expansion.reason,
      expandedTerms: [...expansion.terms, ...expansion.synonyms],
      appliedSynonyms: learned,
      learnedTerms: learned.map((item) => item.expansion),
      arms: { content: contentArm.length, path: pathArm.length },
      hits,
      elapsedMs: Date.now() - startedAt,
    }
  }

  return { search, store }
}
