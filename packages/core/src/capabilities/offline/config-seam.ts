/*!
 * GeoLeaf Core (offline capability) — runtime config accessor
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import { getGeoLeaf } from "../../utils/general/geoleaf-global.js";
// 🛑 BOTH PROFILE ACCESSORS MOVED INTO THE BOOT GRAPH.
// They are re-exported here under their original names — the engine's 6 call sites
// do not move — but they are no longer DEFINED here: the `GeoLeaf.Storage` facade
// must be able to read a layer permission without the offline chunk being loaded,
// which `editor` requires since it declares `requires: []`. Two copies would have
// diverged.
import { profileLayerConfig, profileLayers } from "../../kernel/shared/index.js";

/**
 * Reads configuration from the running core instance (`globalThis.GeoLeaf.Config`).
 *
 * The offline engine loads via a dynamic `import()` after boot, once the core
 * `Config` singleton is fully initialised with the active profile. Reading through
 * the global `GeoLeaf.Config` (rather than importing the `Config` module) guarantees
 * the live, accessor-augmented instance regardless of chunk-load timing.
 *
 * @remarks PLUGINS S1 — this was the ninth copy of a helper duplicated across eight
 * plugins. The other eight now import it from `@geoleaf/host-runtime`; this one does
 * NOT, deliberately. That package is the plugin-side shim for the namespace **this**
 * core assembles, so importing it here would invert the dependency for no gain. The
 * duplication that remained is removed by delegating to the core's own `getGeoLeaf()`,
 * already the established route from `capabilities/` (8+ call sites).
 *
 * ⚠️ Not to be confused with `capabilities/feature-info/layer-config-seam.ts`, which
 * exports `coreLayerConfigGet()` — a different function.
 *
 * @param key Dotted config path (e.g. "data.activeProfile").
 * @param defaultValue Returned when the core/config/value is unavailable.
 * @returns The config value, or `defaultValue` when absent.
 */
export function coreConfigGet<T = unknown>(key: string, defaultValue?: T): T {
    const value = getGeoLeaf()?.Config?.get?.(key, defaultValue);
    return (value === undefined ? defaultValue : value) as T;
}

/**
 * Engine alias of {@link profileLayerConfig} — reads ONE layer of the active profile.
 *
 * ⚠️ **The substantive documentation lives in
 * `kernel/shared/edition-permissions.ts`, and it is NOT copied here.** It carries the
 * two traps that cost dearly — `getAllLayerConfigs()`'s whitelist projection, which
 * exposes neither `edition` nor `offline`, and
 * `Config.Profile.getActiveProfileLayersConfig()`, not mounted on the namespace.
 * Duplicating those warnings would make two versions to keep, and the second to
 * diverge would be the one nobody re-reads.
 *
 * The alias exists so the engine's 6 call sites keep their import name.
 *
 * @param layerId - Layer identifier.
 * @returns The full configuration, or `null` when the profile or the layer is absent.
 */
export const coreProfileLayerConfig = profileLayerConfig;

/**
 * Engine alias of {@link profileLayers} — reads ALL declared layers of the active profile.
 *
 * ⚠️ Same sources, same traps and same no-duplication note as
 * {@link coreProfileLayerConfig}: the substantive documentation is in
 * `kernel/shared/edition-permissions.ts`.
 *
 * @returns The layer declarations, or `[]` when no profile is loaded.
 * @example
 * const declarees = coreProfileLayers().filter((l) => l.offline);
 * console.info(`${declarees.length} couche(s) déclarée(s) hors-ligne`);
 */
export const coreProfileLayers = profileLayers;
