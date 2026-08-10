/*!
 * @geoleaf-plugins/editor — Placement mode API surface
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Builds the `GeoLeaf.Editor.PlacementMode` slice: the plugin-facing wrapper that binds the
 * raw {@link PlacementMode} to the plugin configuration.
 *
 * ⚠️ This module exists because INV-FACADE forbids `public-api.ts` from carrying logic, and
 * reading `modules.editor.poiSnapMeters` before delegating IS logic. The façade keeps a
 * single delegation; the binding lives here, next to the mode it binds.
 */
import { PlacementMode, DEFAULT_SNAP_METERS, type PlacementResult } from "./placement-mode.js";
import { getEditorConfig } from "../config.js";

/** Options accepted by the public `activate`. */
export interface PublicPlacementOptions {
    /** Disable map panning while placing. */
    disableDrag?: boolean;
    /** Snap radius in metres, overriding `modules.editor.poiSnapMeters`. */
    snapMeters?: number;
}

/** The `GeoLeaf.Editor.PlacementMode` surface. */
export interface PlacementApi {
    activate(
        map: unknown,
        callback: (result: PlacementResult) => void,
        options?: PublicPlacementOptions
    ): void;
    deactivate(): void;
    isActive(): boolean;
    clearMarker(): void;
}

/**
 * Resolves the duplicate-guard radius: explicit argument, then plugin config, then default.
 *
 * ⚠️ `??` and never `||` — a configured `0` DISABLES the guard, and `||` would silently
 * restore the 50 m default on it. Guarded by `public-api-placement.test.ts`.
 *
 * @param options - Caller options, possibly absent.
 * @returns the radius in metres.
 */
function _resolveSnapMeters(options?: PublicPlacementOptions): number {
    return options?.snapMeters ?? getEditorConfig().poiSnapMeters ?? DEFAULT_SNAP_METERS;
}

/**
 * @returns the placement slice mounted at `GeoLeaf.Editor.PlacementMode`.
 *
 * ⚠️ **Corrected 05/08/2026 — the previous clause was false at the present tense, and it
 * shipped in `dist/types/`.** It said the key and the `activate(map, callback)` signature
 * mirror `GeoLeaf.AddPOI.PlacementMode`, "which the core's `poi-addform-seam.ts` reads
 * today", to make 5.1-f a repoint. Neither survives: `GeoLeaf.AddPOI` disappeared with the
 * plugin (V2, no alias), and `poi-addform-seam.ts` was **deleted** rather than repointed
 * (D9) — the core's probe ran once at boot, which a lazy plugin cannot satisfy.
 *
 * The mirrored shape was nonetheless load-bearing while it lasted: it is what let 5.1-a
 * absorb the capability without redesigning it. It is kept because it is a good signature,
 * not because anything reads the old one.
 *
 * @example
 * ```ts
 * const api = buildPlacementApi();
 * api.activate(null, (r) => console.log(r.latlng));
 * ```
 */
export function buildPlacementApi(): PlacementApi {
    return {
        activate: (map, callback, options) =>
            PlacementMode.activate(map, callback, {
                snapMeters: _resolveSnapMeters(options),
                // Written out rather than spread: under `exactOptionalPropertyTypes`, a
                // spread of an optional field injects an explicit `undefined`, which is NOT
                // the same as absent and would erase the configured radius.
                ...(options?.disableDrag !== undefined && { disableDrag: options.disableDrag }),
            }),
        deactivate: () => PlacementMode.deactivate(),
        isActive: () => PlacementMode.isActive(),
        clearMarker: () => PlacementMode.clearMarker(),
    };
}
