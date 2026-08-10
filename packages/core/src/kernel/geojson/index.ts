/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Public barrel for the GeoJSON sub-system.
 *
 * Mediated entry point for the `capabilities/ → kernel/` boundary (backlog R.8) —
 * the busiest edge of that boundary (9 of the 25 mediated imports).
 *
 * ⚠️ **Types are NOT re-exported here.** The domain type hubs (`core-types.ts`,
 * `loader/loader-types.ts`) are a documented category of their own
 * (`ARCHITECTURE.md` §Hubs `<module>-types.ts`) and stay directly importable: routing
 * compile-time-only imports through a runtime barrel would pull the implementation
 * modules into the graph for consumers that need nothing but a shape.
 *
 * Named re-exports only — never `export *`.
 */

export { GeoJSONCore } from "./core.js";
export { GeoJSONShared } from "./shared.js";
export { VisibilityManager } from "./visibility-manager.js";
export { bindFeatureInteractionEvents } from "./feature-interaction.js";

/**
 * OGC API Features transport — médiation ajoutée par la tâche 4.1.
 *
 * Le rapatriement hors-ligne vit sous `capabilities/offline/pull/` et doit atteindre
 * `loader/ogc-api-loader.js`, que R.8 lui interdit d'importer en profondeur. Élargir ce
 * baril est le geste que la règle **désigne** — pas un contournement : la médiation reste
 * visible ici, et elle est motivée.
 *
 * ⚠️ Coût bundle **nul**, et c'est ce qui rend le geste sûr : `loader/single-layer.ts`
 * importe déjà `fetchOgcApiFeatures` **statiquement**, donc `ogc-api-loader.js` est dans la
 * clôture eager du chunk geojson depuis longtemps. Ce ré-export n'y ajoute aucun module.
 */
export { fetchOgcApiFeatures } from "./loader/ogc-api-loader.js";
