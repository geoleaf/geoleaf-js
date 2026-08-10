/*!
 * @geoleaf-plugins/measure — Internal helpers
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Thin local vocabulary over the shared seams of `@geoleaf/host-runtime`.
 *
 * STRUCT S2 (F4): this file used to CARRY `_warnNoCore`, `_getNativeMap`, `_el`,
 * `_getLabel` and `applyCssText` — five helpers, all five duplicated elsewhere
 * (`applyCssText` was byte-identical to `@geoleaf/field-renderer`'s, `_getNativeMap`
 * identical to plugin-editor's and plugin-print's bar the cast). They now come from the
 * shared package. The file survives because the underscore names are the plugin's own
 * vocabulary across 49 call sites, and because `_getNativeMap` still owns the cast to
 * {@link MeasureMap} — the caller's assertion, which the generic seam cannot make.
 *
 * ⚠️ SHIP-SPEC (passage public S1.2): the three renames below are LOCAL WRAPPERS with
 * written signatures, and they must stay that way. They were
 * `export { createEl as _el, applyStyleText as applyCssText, tLabel as _getLabel }`, which
 * is one line shorter and re-exports the IMPORTED bindings — so `tsc` emitted
 * `export { … } from "@geoleaf/host-runtime"` into
 * `packages/plugins/measure/dist/types/internal.d.ts`, and the
 * published declarations named a package that is `private: true` and 404 on npm forever.
 * Green here (workspace symlink), `TS2307` for every integrator.
 *
 * Two things not to "simplify" back:
 *   - **Do not derive the signatures with `typeof createEl`.** It reads as the safe way to
 *     stay in sync, and it re-introduces the import into the declaration — the exact fuite,
 *     with none of the visibility.
 *   - **Do not re-export.** A re-export of an imported binding always names its source
 *     module in the emitted `.d.ts`; only a local declaration does not.
 *
 * The cost is real and accepted: these three signatures are a hand-kept copy of
 * host-runtime's, and nothing compiles them against it. `scripts/check-shipped-specifiers.cjs`
 * (SHIP-SPEC-02) is what keeps the fuite from coming back; the drift of the copies is the
 * ordinary risk of any seam, and the wrappers delegate their BODY, so only the types can drift.
 */

import { getNativeMap, warnNoCore, createEl, applyStyleText, tLabel } from "@geoleaf/host-runtime";

import type { MeasureMap } from "./types.js";

/** Logs a warning when the core is unavailable. Returns true if core is missing. */
export function _warnNoCore(fnName: string): boolean {
    return warnNoCore("Measure", fnName);
}

/**
 * Returns the raw MapLibre map instance via GeoLeaf.Core, narrowed to the
 * structural {@link MeasureMap} surface, or null if unavailable.
 *
 * Single seam where the untyped runtime map is cast to `MeasureMap`. Use for project(),
 * unproject(), dragPan, getContainer(), event wiring, etc.
 */
export function _getNativeMap(): MeasureMap | null {
    return getNativeMap<MeasureMap>();
}

/**
 * Creates a typed element with an optional class and attributes.
 *
 * Local wrapper over `createEl` — see the file header for why this is not a re-export.
 *
 * @param tag Tag name; the return type follows it via `HTMLElementTagNameMap`.
 * @param className Assigned verbatim when non-empty.
 * @param attrs Applied with `setAttribute`.
 */
export function _el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    attrs?: Record<string, string>
): HTMLElementTagNameMap[K] {
    return createEl(tag, className, attrs);
}

/**
 * Applies a CSS declaration string property-by-property through the CSSOM.
 *
 * Local wrapper over `applyStyleText` — see the file header for why this is not a re-export.
 *
 * @param el Target element.
 * @param css Declaration string, `;`-separated. `!important` is honoured.
 */
export function applyCssText(el: HTMLElement, css: string): void {
    applyStyleText(el, css);
}

/**
 * Resolves a UI label through the core's i18n, falling back when it is unavailable.
 *
 * Local wrapper over `tLabel` — see the file header for why this is not a re-export.
 *
 * @param key Label key.
 * @param fallback Returned when the key does not resolve; defaults to the key itself.
 */
export function _getLabel(key: string, fallback?: string): string {
    return tLabel(key, fallback);
}
