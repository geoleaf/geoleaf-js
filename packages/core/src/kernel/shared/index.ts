/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Public barrel for the cross-module shared contracts.
 *
 * Mediated entry point for the `capabilities/ → kernel/` boundary (backlog R.8).
 *
 * `StorageContract` is a passive registry: it has NO top-level side effect. `init()` is
 * driven by the `geoleaf.storage.ts` facade when the Storage plugin loads — importing
 * this barrel neither opens IndexedDB nor arms anything.
 */

export { StorageContract } from "./storage-contract.js";

// API publique S4.3e — second export du baril. Il est là parce que la frontière R.8 l'exige :
// `capabilities/legend/lifecycle.ts` lit cet état, et ESLint interdit à `capabilities/**`
// d'importer profondément sous `kernel/**` — seuls les barils, les hubs de types et les seams
// sont atteignables. Élargir ce baril est son usage prévu, pas un contournement ; c'est le
// geste que la règle DÉSIGNE, et il est explicite par construction.
// Seul le LECTEUR traverse la frontière : `capabilities/legend/lifecycle.ts` lit l'état,
// personne ne l'écrit depuis une capacité. L'écrivain (`globals/globals.geojson.ts`) est
// hors `capabilities/`, donc R.8 ne s'applique pas à lui — il importe le fichier
// directement. Ré-exporter `setAllLayerConfigs` ici ouvrirait l'écriture à toutes les
// capacités pour zéro appelant : knip l'a signalé, et il avait raison.
export { getAllLayerConfigs } from "./layer-configs-state.js";

// Tâche 8.7 (B-138) — la règle d'autorisation d'édition ET les deux accesseurs de profil,
// ré-exportés parce que R.8 l'exige : `capabilities/offline/` les consomme (`local-edit-api.ts`
// applique la règle, `config-seam.ts` réexporte les accesseurs sous leurs noms d'origine) et ne
// peut pas importer profondément sous `kernel/**`.
//
// ⚠️ **Élargir ce baril est ici le geste que la règle DÉSIGNE**, pas un contournement — et il
// a été posé APRÈS coup : la première rédaction n'exportait que `grantsEdition`, en pariant que
// les accesseurs resteraient internes au kernel. ESLint a refusé l'import profond de
// `config-seam.ts` et il avait raison, le pari étant faux dès la ligne suivante.
//
// ⚠️ `mayEditLayer` n'est PAS ici, et c'est délibéré : son seul appelant est la façade
// `kernel/storage/facade.ts`, du même côté de la frontière, qui importe le module directement.
// L'exposer n'aurait aucun consommateur de capacité — knip aurait raison de le signaler.
export { grantsEdition, profileLayerConfig, profileLayers } from "./edition-permissions.js";
