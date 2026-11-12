/**
 * Optional LLM query expansion.
 *
 * The expander turns the user's vague description into extra search terms and
 * synonyms. It is deliberately a plain injectable function: search.js owns the
 * timeout and the lexical fallback, so an unavailable or slow model can never
 * fail a search.
 */

const SYSTEM_PROMPT = [
  '你是中文资料检索的查询改写器。用户描述一份只记得模糊细节的旧文档。',
  '输出严格 JSON：{"terms":["..."],"synonyms":["..."]}。',
  'terms 是从原话可补充的检索词（项目名、年份、缩写、别名）；synonyms 是同义或近义表达。',
  '不要输出解释，不要编造用户没有暗示的事实。最多各 6 个词。',
].join('\n')

export function parseExpansion(text) {
  const raw = String(text ?? '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) {
    const preview = raw.replace(/\s+/g, ' ').slice(0, 120)
    throw new Error(`expander returned no JSON object (got: ${preview || '<empty>'})`)
  }

  const parsed = JSON.parse(raw.slice(start, end + 1))
  const pick = (value, fallback) => (Array.isArray(value) ? value : value == null ? [] : [value])
  return {
    terms: pick(parsed.terms ?? parsed.keywords ?? fallback).map(String).filter(Boolean),
    synonyms: pick(parsed.synonyms).map(String).filter(Boolean),
  }
}

export function createLlmExpander(options = {}) {
  const {
    llm,
    provider,
    model,
    systemPrompt = SYSTEM_PROMPT,
    // A reasoning model spends tokens on its reasoning block before emitting any
    // text. 240 was small enough that the budget ran out mid-reasoning and the
    // answer arrived as reasoning-only, so expansion silently degraded every
    // time. This is a shape-constrained, ~120-token answer; give it room.
    maxOutputTokens = 1_200,
    temperature = 0,
  } = options

  if (!llm) throw new Error('createLlmExpander: llm service is required')
  if (!provider || !model) throw new Error('createLlmExpander: provider and model are required')

  return async function expand({ query, hints, signal }) {
    const userText = [
      `用户原话：${query}`,
      hints?.years?.length ? `提到的年份：${hints.years.join(', ')}` : '',
      hints?.kinds?.length ? `文档类型线索：${hints.kinds.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n')

    const stream = llm.stream({
      provider,
      model,
      system: systemPrompt,
      temperature,
      maxTokens: maxOutputTokens,
      signal,
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    })

    let text = ''
    let reasoning = ''
    let finishReason = null
    for await (const chunk of stream) {
      if (chunk?.type === 'text-delta') text += chunk.text ?? ''
      if (chunk?.type === 'reasoning-delta') reasoning += chunk.text ?? ''
      if (chunk?.type === 'finish') {
        finishReason = chunk.reason?.kind ?? null
        if (chunk.reason?.kind === 'error') {
          throw new Error(chunk.reason.failure?.message ?? 'model call failed')
        }
        break
      }
    }

    // A truncated reasoning run can still contain a usable JSON object, so try
    // the reasoning text before giving up.
    if (!text.trim()) {
      if (reasoning.includes('{')) return parseExpansion(reasoning)
      if (reasoning) {
        throw new Error(
          `expander produced reasoning but no text output (finish: ${finishReason ?? 'none'}, reasoning chars: ${reasoning.length})`,
        )
      }
      throw new Error(`expander returned empty text (finish: ${finishReason ?? 'none'})`)
    }
    return parseExpansion(text)
  }
}
