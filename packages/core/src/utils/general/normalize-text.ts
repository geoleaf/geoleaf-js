/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Text matching rule — the single place that decides whether a text "matches" a query.
 *
 * Two readers: the filter capability's `text` field (it HIDES what does not match) and the
 * layer search (`GeoLeaf.Layers.search`, it FINDS what matches). Kept here, below both, so a
 * feature the filter shows can never be missed by the search for the same words — two
 * matchers drift, and the drift is invisible to both suites. Held by the edge 5 of
 * `__tests__/capabilities/kernel-reuse.test.js`.
 *
 * The rule: diacritics and case are ignored (`recif` matches `Récif`), the query is split on
 * whitespace, and a text matches when it contains EVERY term, in any order (`gilles récif`
 * matches `Le Récif — Saint-Gilles`).
 */

/**
 * Normalizes a text for matching: decomposes accents (NFD), drops the combining marks, then
 * lowercases. Nothing else changes — punctuation and spacing are kept.
 *
 * @param s - Text to normalize.
 * @returns The normalized text.
 * @example
 * normalizeText("Élévation À-Côté"); // "elevation a-cote"
 */
export function normalizeText(s: string): string {
    return s
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase();
}

/**
 * Splits a query into normalized terms. A blank query yields no term — and no term
 * constrains nothing.
 *
 * @param query - Raw user input.
 * @returns The normalized, non-empty terms.
 * @example
 * searchTerms("  Gilles  Récif "); // ["gilles", "recif"]
 */
export function searchTerms(query: string): string[] {
    return normalizeText(query).split(/\s+/).filter(Boolean);
}

/**
 * Whether a value contains every term, in any order. The value is coerced with `String()`
 * and normalized; the terms are expected already normalized (see {@link searchTerms}).
 *
 * @param value - Value to test (a property value, typically).
 * @param terms - Normalized terms.
 * @returns `true` when every term occurs in the value — `true` as well for no term.
 * @example
 * containsAllTerms("Le Récif — Saint-Gilles", searchTerms("gilles recif")); // true
 */
export function containsAllTerms(value: unknown, terms: readonly string[]): boolean {
    return matchesNormalized(normalizeText(String(value)), terms);
}

/**
 * {@link containsAllTerms} for a text ALREADY normalized — the form an index keeps, so a
 * keystroke over a large layer does not normalize every value again. Same rule, one place.
 *
 * @param normalized - A text passed through {@link normalizeText}.
 * @param terms - Normalized terms.
 * @returns `true` when every term occurs in the text — `true` as well for no term.
 * @example
 * matchesNormalized(normalizeText("Le Récif"), searchTerms("recif")); // true
 */
export function matchesNormalized(normalized: string, terms: readonly string[]): boolean {
    return terms.every((t) => normalized.includes(t));
}
