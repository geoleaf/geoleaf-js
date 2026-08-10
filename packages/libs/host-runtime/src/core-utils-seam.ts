/*!
 * @geoleaf/host-runtime — pure core utilities, shared
 * © 2026 Mattieu Pottier — MIT License
 *
 * Consolidated at STRUCT S2 (F3) from `plugin-table`'s repatriated copies
 * (`utils/object-utils.ts`, `utils/dom-security.ts` — X2e).
 * https://geoleaf.dev
 */

/**
 * The three PURE utilities plugins kept re-copying from the core.
 *
 * ⚠️ Unlike its sibling `*-seam.ts` modules, this file is NOT an accessor: there is no
 * `globalThis.GeoLeaf` lookup and nothing is resolved at call time. These are real
 * implementations, and they are therefore genuine TWINS of the core's own
 * (`utils/general/object-utils.ts`, `kernel/security/dom-security.ts` — ce second a rejoint
 * `kernel/security/` au STRUCT S6) — measured
 * byte-identical after normalization at S2. That is exactly why they are pinned in
 * `scripts/verify-seam-drift.cjs`: the core cannot import this package (bundle
 * contract), so nothing but the pin re-confronts the two sides when one changes.
 *
 * They are duplicated rather than accessed because they are needed BEFORE boot and in
 * unit tests with no core at all, and because routing a pure `path.split(".")` through
 * the global namespace would buy nothing.
 */

/** Declarative overrides for {@link createSVGIcon}. */
export interface IconOptions {
    viewBox?: string;
    fill?: string;
    stroke?: string;
    strokeWidth?: string | number;
    strokeLinecap?: string;
    strokeLinejoin?: string;
}

/**
 * Retrieves a nested value from an object via a dotted property path
 * (e.g. `"properties.name"`). Returns `null` when the path is absent, when a segment
 * resolves to `null`/`undefined`, or when the input is not an object.
 *
 * @param obj Source object.
 * @param path Dotted property path.
 */
export function getNestedValue<T = unknown>(
    obj: object | null | undefined,
    path: string
): T | null {
    if (!obj || typeof obj !== "object") {
        return null;
    }
    if (!path || typeof path !== "string") {
        return null;
    }
    const keys = path.split(".");
    let result: unknown = obj;
    for (const key of keys) {
        if (result == null) {
            return null;
        }
        result = (result as Record<string, unknown>)[key];
    }
    return result !== undefined ? (result as T) : null;
}

/**
 * Builds a stroked SVG icon.
 *
 * @security Assembled node-by-node through `createElementNS` — never `innerHTML`, so a
 * path string can never introduce markup.
 */
export function createSVGIcon(
    width: number,
    height: number,
    pathData: string,
    options: IconOptions = {}
): SVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("viewBox", options.viewBox ?? "0 0 24 24");
    svg.setAttribute("fill", options.fill ?? "none");
    svg.setAttribute("stroke", options.stroke ?? "currentColor");
    svg.setAttribute("stroke-width", String(options.strokeWidth ?? "2"));
    svg.setAttribute("stroke-linecap", options.strokeLinecap ?? "round");
    svg.setAttribute("stroke-linejoin", options.strokeLinejoin ?? "round");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.appendChild(path);

    return svg;
}

/**
 * Empties an element's content.
 *
 * @security Writes `textContent`, never `innerHTML` — the emptied content can never be
 * re-interpreted as markup. Tolerates `null`/`undefined` and non-nodes so callers do
 * not have to guard.
 */
export function clearElementFast(element: HTMLElement | null | undefined): void {
    if (!element || !element.nodeType) return;
    element.textContent = "";
}
