// ---------------------------------------------------------------------------
// language.ts — pure language-name resolution (NO IO).
//
// pi-oven supports a per-project default RESPONSE language. Two canonical
// languages ("ko"/"en") carry rich, hand-authored directives (see
// rules-injector.ts). ANY OTHER language the user types is accepted as its
// free-form NAME (e.g. "Español", "日本語") and stored verbatim; the runtime
// then injects a GENERIC English directive that names it.
//
// SECURITY BOUNDARY: a stored language string is later inserted VERBATIM into
// the agent system prompt. The length cap + Unicode-letter whitelist exist to
// keep that insertion safe — they block newlines (incl. U+2028/U+2029 line/
// paragraph separators), backticks, angle brackets, "#", "*", "{}", ";", and
// other control/separator/punctuation that could break prompt structure or
// smuggle instructions. resolveLanguage is the single chokepoint: both the
// setup writer (project-config) and the runtime reader (pi-oven.ts) validate
// through it, so a hand-edited config.json can never poison the prompt.
// ---------------------------------------------------------------------------

/** Maximum accepted length (chars) for a free-form language name. */
export const LANGUAGE_MAX_LEN = 40;

/**
 * Safe-name whitelist: must START with a Unicode letter or combining mark,
 * then allow only Unicode letters/marks, spaces, "(", ")", "-", ".".
 * Anchored end-to-end so any disallowed character anywhere fails the match.
 * Notably U+2028/U+2029 and other separators/control chars are NOT \p{L}/\p{M}
 * and are therefore rejected.
 */
const SAFE_NAME = /^[\p{L}\p{M}][\p{L}\p{M} ().-]*$/u;

/**
 * Resolve a human-supplied language token to either a canonical code
 * ("ko"/"en") or a verbatim free-form language name, or `null` when invalid.
 *
 * Rules:
 *   - ko / korean / 한국어 (case-insensitive) → "ko"
 *   - en / english       (case-insensitive) → "en"
 *   - empty / over LANGUAGE_MAX_LEN          → null
 *   - fails the safe-name whitelist          → null
 *   - otherwise → the trimmed input with ORIGINAL casing preserved.
 */
export function resolveLanguage(input: string): string | null {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();
  if (lower === "ko" || lower === "korean" || lower === "한국어") return "ko";
  if (lower === "en" || lower === "english") return "en";
  if (trimmed.length === 0 || trimmed.length > LANGUAGE_MAX_LEN) return null;
  if (!SAFE_NAME.test(trimmed)) return null;
  return trimmed;
}
