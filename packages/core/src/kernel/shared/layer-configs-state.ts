/*!
 * GeoLeaf Core — Shared / Layer configs state
 * © 2026 Mattieu Pottier — MIT License — https://geoleaf.dev
 */

/**
 * The active profile's layer configs — cross-module shared state.
 *
 *
 * ## Pourquoi ce fichier existe (API publique S4.3e)
 *
 * This state used to travel through `globalThis.GeoLeaf._allLayerConfigs`: the
 * profile loader wrote it via the `_loaderDeps` seam of
 * `globals/globals.geojson.ts`, and two modules re-read it on the namespace —
 * `kernel/geojson/layers/integration.ts` and `capabilities/legend/lifecycle.ts`.
 *
 * It was not a facade: nothing public exposed it, no plugin read it, no type
 * declared it. It was **shared state** set on the namespace for lack of a carrier.
 *
 * ⚠️ **And it was out of reach of every instrument.** The key never appeared in
 * the three oracles of `scripts/lib/namespace-surface.mjs`, because it is only
 * written when a profile loads — hence never during the bare boot they measure. It
 * could be renamed at the writer, or at either of the two readers, and keep a
 * suite **green on a broken core**: the six test files mentioning it all planted
 * the value themselves. The only production symptom would have been a `Log.warn`
 * and an empty legend.
 *
 * The contract is now a module, and it is guarded by
 * `__tests__/geojson/layer-configs-state.contract.test.js`, which walks the real
 * writer → reader path.
 *
 * ## What this module is not
 *
 * It is **not** the generic carrier of the 22 `_` keys the core still reads as a
 * service locator (`_VectorTiles`, `_Cluster`…). Those are the capabilities'
 * optionality mechanism — an absent capability simply has no writer — and getting
 * them off the namespace is an architecture work item, recorded as debt. Here it
 * is only state that had no reason to be public.
 */

/**
 * The active profile's layer configs, or `undefined` until a profile is loaded.
 *
 * Deliberately typed `unknown`: the real shape is an array of configuration
 * entries of which each reader narrows what it needs (`integration.ts` declares
 * its own `LayerConfigEntry`). Widening this type here would force
 * `kernel/shared/` — a leaf — to know the profile's shape, which the boundary
 * forbids it.
 */
let _allLayerConfigs: unknown;

/** Returns the active profile's layer configs, or `undefined` before any load. */
export function getAllLayerConfigs(): unknown {
    return _allLayerConfigs;
}

/**
 * Records the active profile's layer configs.
 *
 * Called by the `_loaderDeps.setAllLayerConfigs` seam of
 * `globals/globals.geojson.ts`, itself fed by the profile loader.
 *
 * @param configs - The configuration entries, or `undefined` to clear the state.
 */
export function setAllLayerConfigs(configs: unknown): void {
    _allLayerConfigs = configs;
}
