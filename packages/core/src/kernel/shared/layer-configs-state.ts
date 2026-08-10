/*!
 * GeoLeaf Core — Shared / Layer configs state
 * © 2026 Mattieu Pottier — MIT License — https://geoleaf.dev
 */

/**
 * Les configs de couches du profil actif — état partagé inter-modules.
 *
 *
 * ## Pourquoi ce fichier existe (API publique S4.3e)
 *
 * Cet état transitait par `globalThis.GeoLeaf._allLayerConfigs` : le chargeur de profil
 * l'écrivait via le seam `_loaderDeps` de `globals/globals.geojson.ts`, et deux modules le
 * relisaient sur le namespace — `kernel/geojson/layers/integration.ts` et
 * `capabilities/legend/lifecycle.ts`.
 *
 * Ce n'était pas une façade : rien de public ne l'exposait, aucun plugin ne le lisait, aucun
 * type ne le déclarait. C'était de l'**état partagé** posé sur le namespace faute de porteur.
 *
 * ⚠️ **Et il était hors de portée de tout instrument.** La clé n'a jamais figuré dans les trois
 * oracles de `scripts/lib/namespace-surface.mjs`, parce qu'elle n'est écrite qu'au chargement
 * d'un profil — donc jamais pendant le boot nu qu'ils mesurent. On pouvait la renommer chez
 * l'écrivain, ou chez l'un des deux lecteurs, et garder une suite **verte sur un core cassé** :
 * les six fichiers de test qui la mentionnaient plantaient tous la valeur eux-mêmes. Le seul
 * symptôme en production aurait été un `Log.warn` et une légende vide.
 *
 * Le contrat est désormais un module, et il est gardé par
 * `__tests__/geojson/layer-configs-state.contract.test.js`, qui traverse le chemin réel
 * écrivain → lecteur.
 *
 * ## Ce que ce module n'est pas
 *
 * Il n'est **pas** le porteur générique des 22 clés `_` que le core lit encore en
 * service-locator (`_VectorTiles`, `_Cluster`…). Celles-là sont le mécanisme d'optionalité des
 * capacités — une capacité absente n'a tout simplement pas d'écrivain — et les sortir du
 * namespace est un chantier d'architecture, consigné à la dette. Ici il ne s'agit que d'un état
 * qui n'avait aucune raison d'être public.
 */
"use strict";

/**
 * Les configs de couches du profil actif, ou `undefined` tant qu'aucun profil n'est chargé.
 *
 * Volontairement typé `unknown` : la forme réelle est un tableau d'entrées de configuration
 * dont chaque lecteur narrow ce dont il a besoin (`integration.ts` déclare son propre
 * `LayerConfigEntry`). Élargir ce type ici obligerait `kernel/shared/` — une feuille — à
 * connaître la forme du profil, ce que la frontière R.8 lui interdit.
 */
let _allLayerConfigs: unknown;

/** Rend les configs de couches du profil actif, ou `undefined` avant tout chargement. */
export function getAllLayerConfigs(): unknown {
    return _allLayerConfigs;
}

/**
 * Enregistre les configs de couches du profil actif.
 *
 * Appelé par le seam `_loaderDeps.setAllLayerConfigs` de `globals/globals.geojson.ts`, lui-même
 * alimenté par le chargeur de profil.
 *
 * @param configs - Les entrées de configuration, ou `undefined` pour vider l'état.
 */
export function setAllLayerConfigs(configs: unknown): void {
    _allLayerConfigs = configs;
}
