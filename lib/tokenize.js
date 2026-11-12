/**
 * Chinese-friendly tokenization for SQLite FTS5.
 *
 * Why bigrams: FTS5's `trigram` tokenizer needs at least 3 characters, so
 * two-character Chinese queries ("预算", "教案") return zero hits. We instead
 * pre-split CJK runs into overlapping bigrams at write time, and build the same
 * bigrams from queries. Unigrams are also indexed so a single-character query
 * can match anywhere inside a run.
 */

const CJK_RANGES = [
  [0x3400, 0x4dbf], // CJK Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0x3040, 0x30ff], // Hiragana + Katakana
  [0xac00, 0xd7a3], // Hangul syllables
  [0x20000, 0x2fa1f], // CJK Extension B+
]

const WORD_CHAR = /[\p{L}\p{N}_]/u

export function isCjkCodePoint(cp) {
  for (const [lo, hi] of CJK_RANGES) {
    if (cp >= lo && cp <= hi) return true
  }
  return false
}

/**
 * Split text into ordered runs of `{ type: 'cjk' | 'word', chars: string[] }`.
 * Separators (whitespace, punctuation, symbols) end a run.
 */
export function splitRuns(text) {
  const runs = []
  let current = null
  for (const ch of String(text ?? '')) {
    const cp = ch.codePointAt(0)
    let type = 'sep'
    if (isCjkCodePoint(cp)) type = 'cjk'
    else if (WORD_CHAR.test(ch)) type = 'word'

    if (type === 'sep') {
      current = null
      continue
    }
    if (!current || current.type !== type) {
      current = { type, chars: [] }
      runs.push(current)
    }
    current.chars.push(ch)
  }
  return runs
}

function cjkBigrams(chars) {
  if (chars.length === 1) return [chars[0]]
  const out = []
  for (let i = 0; i < chars.length - 1; i += 1) out.push(chars[i] + chars[i + 1])
  return out
}

/**
 * Tokens written into the index: CJK bigrams plus unigrams (single-character
 * lookups), and lowercased word runs.
 */
export function tokenizeText(text) {
  const tokens = []
  for (const run of splitRuns(text)) {
    if (run.type === 'cjk') {
      tokens.push(...cjkBigrams(run.chars))
      if (run.chars.length > 1) {
        // Unigrams make single-character queries match mid-run.
        tokens.push(...run.chars)
      }
    } else {
      tokens.push(run.chars.join('').toLowerCase())
    }
  }
  return tokens
}

/**
 * Tokens for a query: CJK runs of length >= 2 use bigrams only; a
 * single-character run stays a unigram. Duplicates are removed so AND queries
 * do not repeat the same clause.
 */
export function tokenizeQuery(text) {
  const tokens = []
  for (const run of splitRuns(text)) {
    if (run.type === 'cjk') {
      tokens.push(...cjkBigrams(run.chars))
    } else {
      tokens.push(run.chars.join('').toLowerCase())
    }
  }
  return [...new Set(tokens.filter(Boolean))]
}

/** Build a safe FTS5 MATCH expression (all terms required). */
export function toFtsQuery(tokens) {
  const clauses = tokens
    .filter(Boolean)
    .map((token) => `"${String(token).replace(/"/g, '""')}"`)
  return clauses.join(' AND ')
}

/** Convenience: raw text -> FTS5 MATCH expression. */
export function queryToFts(text) {
  return toFtsQuery(tokenizeQuery(text))
}
