/*!
 * GeoLeaf Core (offline capability) — runtime config accessor
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import { getGeoLeaf } from "../../utils/general/geoleaf-global.js";
// 🛑 LES DEUX ACCESSEURS DE PROFIL ONT DÉMÉNAGÉ DANS LE GRAPHE DE BOOT (tâche 8.7).
// Ils sont ré-exportés ici sous leurs noms d'origine — les 6 sites appelants du moteur ne
// bougent pas — mais ils ne sont plus DÉFINIS ici : la façade `GeoLeaf.Storage` doit pouvoir
// lire une permission de couche sans que le chunk hors-ligne soit chargé, ce que `editor`
// exige puisqu'il déclare `requires: []`. Deux copies auraient divergé (compteur C4).
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
 * Alias moteur de {@link profileLayerConfig} — lit UNE couche du profil actif.
 *
 * ⚠️ **La documentation de fond vit dans `kernel/shared/edition-permissions.ts`, et elle n'est
 * PAS recopiée ici** (tâche 8.7). Elle porte les deux pièges qui ont coûté cher — la
 * projection en liste blanche de `getAllLayerConfigs()`, qui n'expose ni `edition` ni
 * `offline`, et `Config.Profile.getActiveProfileLayersConfig()`, non monté sur le namespace.
 * Dupliquer ces avertissements en ferait deux versions à tenir, et la seconde à diverger
 * serait celle que personne ne relit (compteur C4).
 *
 * L'alias existe pour que les 6 sites appelants du moteur gardent leur nom d'import.
 *
 * @param layerId - Identifiant de la couche.
 * @returns La configuration complète, ou `null` si le profil ou la couche est absent.
 */
export const coreProfileLayerConfig = profileLayerConfig;

/**
 * Alias moteur de {@link profileLayers} — lit TOUTES les couches déclarées du profil actif.
 *
 * ⚠️ Mêmes sources, mêmes pièges et même remarque de non-duplication que
 * {@link coreProfileLayerConfig} : la documentation de fond est dans
 * `kernel/shared/edition-permissions.ts`.
 *
 * @returns Les déclarations de couche, ou `[]` si aucun profil n'est chargé.
 * @example
 * const declarees = coreProfileLayers().filter((l) => l.offline);
 * console.info(`${declarees.length} couche(s) déclarée(s) hors-ligne`);
 */
export const coreProfileLayers = profileLayers;
