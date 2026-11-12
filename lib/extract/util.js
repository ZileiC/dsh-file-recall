/** Small XML/HTML text helpers shared by the extractors. */

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

export function decodeXmlEntities(value) {
  return String(value ?? '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
    if (body[0] === '#') {
      const hex = body[1]?.toLowerCase() === 'x'
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10)
      if (!Number.isFinite(code)) return match
      try {
        return String.fromCodePoint(code)
      } catch {
        return match
      }
    }
    return NAMED_ENTITIES[body] ?? match
  })
}

/** Remove HTML/XML tags and decode entities (inline-safe: tags become nothing). */
export function stripTags(value) {
  return decodeXmlEntities(String(value ?? '').replace(/<[^>]*>/g, ''))
}

export function normalizeText(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Split text into blocks of at most `limit` characters, preferring newlines. */
export function blocksFromText(text, limit = 600) {
  const chunks = []
  let buffer = ''

  const flush = () => {
    const value = normalizeText(buffer)
    if (value) chunks.push(value)
    buffer = ''
  }

  for (const line of String(text ?? '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) {
      flush()
      continue
    }
    if (buffer.length > 0 && buffer.length + trimmed.length + 1 > limit) flush()
    buffer = buffer ? `${buffer}\n${trimmed}` : trimmed
    if (buffer.length >= limit) flush()
  }
  flush()
  return chunks
}
