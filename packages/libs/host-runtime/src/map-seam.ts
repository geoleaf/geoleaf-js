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

import { getGeoLeaf, type HostDeclaredStyleIds, type HostMapAdapter } from "./host.js";

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

/**
 * Declares, to the GeoLeaf adapter that drives `nativeMap`, engine layers and sources the caller
 * placed on it directly — so that a basemap switch replacing the style carries them, as it
 * carries the adapter's own. `null` withdraws the declaration made under `owner`.
 *
 * The adapter is FOUND, not assumed: among the host's maps (`Core.listMaps()`), the one whose
 * engine is `nativeMap` — a plugin may be handed any map, and N maps may coexist. A core without
 * `listMaps` offers its one map, taken only if it is that engine.
 *
 * @param nativeMap - The engine map the caller placed its layers on.
 * @param owner - A stable key naming the caller, e.g. `"measure"` or `"cog:<layerId>"`.
 * @param ids - The engine ids to carry, or `null` to withdraw.
 * @returns `true` when an adapter took the declaration. `false` without a core, when no GeoLeaf
 *   map drives `nativeMap`, or with a core older than the member (3.10.0) — the layers then do
 *   not survive a style replacement, as before, and nothing throws.
 */
export function declareOwnedStyleIds(
    nativeMap: unknown,
    owner: string,
    ids: HostDeclaredStyleIds | null
): boolean {
    const adapter = _adapterDriving(nativeMap);
    if (typeof adapter?.declareOwnedStyleIds !== "function") return false;
    adapter.declareOwnedStyleIds(owner, ids);
    return true;
}

/** The adapter of the host's map whose engine is `nativeMap`, if any. */
function _adapterDriving(nativeMap: unknown): HostMapAdapter | undefined {
    const core = getGeoLeaf()?.Core;
    if (!core || nativeMap === null || nativeMap === undefined) return undefined;
    const candidates =
        typeof core.listMaps === "function"
            ? core.listMaps().map((id) => core.getMap?.(id))
            : [core.getMap?.()];
    return (
        candidates.find((adapter) => !!adapter && adapter.getNativeMap?.() === nativeMap) ??
        undefined
    );
}
