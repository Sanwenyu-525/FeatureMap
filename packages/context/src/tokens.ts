/**
 * Deterministic token estimation (Phase 5 / Token Budget).
 *
 * Budgeting must NOT be string-truncation (the spec forbids it), and it
 * must behave identically across formats, so the estimator is a pure
 * function of text. Rough character-based heuristic: ~3.5 ASCII chars
 * per token, ~1 CJK char per token (CJK is denser in BPE vocabularies).
 * Exact values are intentionally approximate — what matters is that the
 * SAME text always estimates the same, and that selection decisions are
 * stable across runs and formats.
 */

/** Estimate tokens for a text string. Pure and deterministic. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    // CJK Unified Ideographs, Hiragana, Katakana, Hangul, CJK symbols.
    if ((code >= 0x3000 && code <= 0x9fff) || (code >= 0xac00 && code <= 0xd7af)) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return Math.max(1, Math.ceil(other / 3.5 + cjk));
}

/** Bound a string to `maxChars`, preserving whole words when cheap. */
export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).replace(/\s+\S*$/, '')}…`;
}