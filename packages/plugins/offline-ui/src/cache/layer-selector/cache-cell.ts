/*!
 * @geoleaf-plugins/offline-ui
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Storage - Layer Selector / cache status cell
 *
 * PLUGINS S7 — the ✓/✗ glyph, its colour and its tooltip were built in THREE
 * places (layer row, basemap row, and the post-download refresh), each with its
 * own inline `style.color` / `style.fontSize`. One builder keeps them from
 * drifting, and moves the colours to the theme.
 *
 * ⚠️ Lives in its own module on purpose: its two consumers, `row-rendering.ts`
 * and `selection-cache.ts`, both mount methods on `LS` via `Object.assign` at
 * load time, and one importing the other would make that side effect depend on
 * import order — which an integration suite deliberately asserts on.
 */

/** Whether the resource is cached, known-missing, or has no cache config at all. */
type CacheCellState = "cached" | "missing" | "none";

/** Class list per state — LITERAL strings, never assembled (purgecss reads sources). */
const CELL_CLASS: Record<CacheCellState, string> = {
    cached: "gl-cache-layers__status gl-cache-layers__status--cached",
    missing: "gl-cache-layers__status gl-cache-layers__status--missing",
    none: "gl-cache-layers__status gl-cache-layers__status--none",
};

const CELL_GLYPH: Record<CacheCellState, string> = {
    cached: "\u2713",
    missing: "\u2717",
    none: "-",
};

/** Appends the status glyph to a cache cell and sets its tooltip. */
export function renderCacheCell(cell: HTMLElement, state: CacheCellState, title: string): void {
    const span = document.createElement("span");
    span.className = CELL_CLASS[state];
    span.textContent = CELL_GLYPH[state];
    cell.appendChild(span);
    cell.title = title;
}
