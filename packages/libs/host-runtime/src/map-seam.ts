/*!
 * @geoleaf/host-runtime — map access runtime seam
 * © 2026 Mattieu Pottier — MIT License
 *
 * Consolidated at STRUCT S2 (F4) from the three identical `_getNativeMap` bodies of
 * `plugin-editor`, `plugin-measure` and `plugin-print`, plus the two `_warnNoCore` of
 * measure and print (X2e).
 * https://geoleaf.dev
 */

/**
 * Runtime seams for reaching the live map and for reporting a missing core.
 *
 * `Core.getMap().getNativeMap()` is a two-link chain returning `unknown`: the core
 * deliberately does not expose the MapLibre type across the plugin boundary (that would
 * put `maplibre-gl` in every plugin's type graph). Every map-using plugin therefore
 * needed the same three lines plus a cast — and each cast to a DIFFERENT structural
 * type, which is why {@link getNativeMap} is generic rather than typed here. The three
 * plugin copies differed by nothing but that type argument.
 */

import { getGeoLeaf } from "./host.js";

/**
 * Returns the raw map instance behind `GeoLeaf.Core.getMap()`, narrowed to `T`, or
 * `null` when the core is not booted, no map is registered, or the adapter exposes no
 * native handle.
 *
 * The caller supplies the structural surface it needs — `MeasureMap`, `EditorMap`,
 * `maplibre-gl`'s `Map`… This is the single place where the untyped runtime handle is
 * cast, and the cast is the CALLER's assertion, not this module's.
 *
 * @typeParam T The structural map surface the caller requires.
 */
export function getNativeMap<T = unknown>(): T | null {
    const native = getGeoLeaf()?.Core?.getMap?.()?.getNativeMap?.();
    return (native as T | undefined) ?? null;
}

/**
 * Warns that the core is absent, and reports whether it is.
 *
 * Uses `console.warn` rather than the {@link Log} seam **by design**: the one condition
 * it reports is "there is no core", which is precisely when the core logger cannot
 * exist. Routing this through `Log` would make it silent exactly when it matters.
 *
 * @param scope Namespace shown in the message, e.g. `"Measure"` — plugins pass their own.
 * @param fnName The calling function, for the operator reading the console.
 * @returns `true` when the core is MISSING, so callers can `if (warnNoCore(…)) return;`.
 */
export function warnNoCore(scope: string, fnName: string): boolean {
    if (!getGeoLeaf()) {
        console.warn(`[GeoLeaf.${scope}] ${fnName}: GeoLeaf core not loaded.`);
        return true;
    }
    return false;
}
