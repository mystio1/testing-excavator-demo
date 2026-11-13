/**
 * One way to flatten text for comparison, used by everything in the agent that
 * compares what someone said against something written down.
 *
 * It lives alone because getting it wrong is silent and the same mistake was
 * made three times: \p{M} is easy to leave out, and without it Devanagari
 * vowel signs — which are combining marks, not letters — are stripped as if
 * they were punctuation. "पाटील" becomes "प ट ल" and "परसों" becomes "परस",
 * so a Hindi or Marathi word matches nothing and no error is raised anywhere.
 *
 * Any new comparison uses this rather than its own regex.
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}
