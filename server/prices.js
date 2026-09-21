/**
 * What a request would have cost at the public API price list.
 *
 * With a subscription nobody pays per message, so this is not a bill: it is the one yardstick that
 * puts a Fable hour and a Haiku hour on the same scale. The Usage page says so wherever it shows a
 * dollar sign.
 *
 * Anthropic's first-party rates, dollars per million tokens, as published on 2026-06-24. Cache
 * writes are 1.25× input for the five-minute lifetime and 2× for the hour; cache reads 0.1× input,
 * except on Fable 5.1, whose reads are a flat $0.25. Fast mode on Opus 5 is $10/$50, twice the
 * standard rate, and the multiplier is applied to the whole request.
 *
 * A model that is not in this table costs `null`, never zero: a page that added up an unknown
 * model as free would be telling you the wrong thing with complete confidence.
 */
export const LIST_DATE = '2026-06-24'

const RATES = {
  'claude-fable-5-1': { input: 10, output: 50, read: 0.25 },
  'claude-fable-5': { input: 10, output: 50, read: 1 },
  'claude-mythos-5-1': { input: 10, output: 50, read: 0.25 },
  'claude-mythos-5': { input: 10, output: 50, read: 1 },
  'claude-opus-5': { input: 5, output: 25, fast: 2 },
  'claude-opus-4-8': { input: 5, output: 25, fast: 2 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
}

/** `claude-haiku-4-5-20251001` is `claude-haiku-4-5`: the snapshot date changes nothing here. */
export function modelId(raw) {
  const m = String(raw || '').trim()
  return m.replace(/-\d{8}$/, '')
}

export const known = (model) => Object.hasOwn(RATES, modelId(model))

/**
 * Dollars for one request's `usage`, or null for a model not on the list.
 *
 * `tokens` is the shape k0 keeps, not the API's: `input`, `output`, `cacheRead`, `write5m`,
 * `write1h`. Thinking tokens are already inside `output` — the API bills them as output — so they
 * are not added a second time.
 */
export function cost(model, tokens, speed = 'standard') {
  const r = RATES[modelId(model)]
  if (!r) return null
  const read = r.read ?? r.input * 0.1
  const perMillion =
    (tokens.input || 0) * r.input +
    (tokens.output || 0) * r.output +
    (tokens.cacheRead || 0) * read +
    (tokens.write5m || 0) * r.input * 1.25 +
    (tokens.write1h || 0) * r.input * 2
  const fast = speed === 'fast' ? r.fast ?? 1 : 1
  return (perMillion * fast) / 1e6
}
