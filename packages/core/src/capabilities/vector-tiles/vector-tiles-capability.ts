/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability declaration for the in-core `vector-tiles` capability (presets build, S5).
 *
 * MVT (Mapbox Vector Tile) support for **business layers**: when a layer config carries an
 * absolute `data.vectorTiles.tilesUrl`, the GeoJSON loader hands it to this capability, which
 * installs a native MapLibre `type: "vector"` source + its sub-layers instead of loading a
 * GeoJSON file. That is what makes a 100 000-feature dataset displayable at all — the browser
 * fetches only the tiles in view, at the generalisation level of the current zoom.
 *
 * **Not to be confused with vector BASEMAPS.** Several profiles point `basemaps.json` at an IGN
 * MapLibre style (`…/vectorTiles/styles/PLAN.IGN/…`); those are rendered natively by MapLibre
 * through the *baselayers* module and never touch this code.
 *
 * ## No `gate` — deliberately
 *
 * The contract allows it (`capability.contract.ts`: *"No `gate` → always enabled"*), and here it
 * is the honest shape: vector-tiles owns no `modules.*` config block. Its activation is decided
 * **per layer**, by `shouldUseVectorTiles()` reading `data.vectorTiles` — an existing, inventoried
 * config family (B5). Inventing a `modules.vectorTiles.enabled` key would add a public parameter
 * that gates nothing the layer config does not already gate.
 *
 * For the same reason there is no `configSchema`: its keys would have to match fields under a
 * capability config path, and this capability has none. The layer-level schema is the source of
 * truth — `profiles/schemas/layer-config.schema.json` (`data.vectorTiles`).
 *
 * ## Why it is a capability at all
 *
 * It is a *policy* capability (pull-based, like `cluster`): a substantial body of code reached
 * through exactly two service-locator sites, both of which already fall back when it is absent.
 * Before S5 it was statically imported by `globals.geojson.ts` — a kernel module — which pinned
 * it into the eager closure of **every** bundle, including one built by a consumer who will never
 * serve a tile. (It weighed **744 lines at the S5 relevé**; socle B.1 has since moved the MapLibre
 * building out to `adapters/maplibre/maplibre-vector-tiles.ts`, and the orchestrator shrank
 * accordingly.)
 *
 * ⚠️ Two live counts stood here until 08/08/2026 — « ~500 lines » for the capability and « ~265 »
 * for the orchestrator — and BOTH had drifted (527 and 292, measured). B-43: a number describing
 * a LIVING state is a second source of truth. The 744 survives because it is explicitly a dated
 * past measurement, which is what makes the shrink traceable at all.
 */
"use strict";

import type { ICapabilityDeclaration } from "../../contracts/capability.contract.js";

/** In-core capability declaration for MVT business layers. */
export const VECTOR_TILES_CAPABILITY: ICapabilityDeclaration = {
    id: "vector-tiles",
    label: "Vector Tiles",
    description:
        "MVT vector-tile business layers (native MapLibre vector source). Activated per layer by an absolute `data.vectorTiles.tilesUrl`.",
    // No gate: activation is per-layer (`data.vectorTiles`), not global — see module TSDoc.
    // No loader: the capability is embarked by its installer appearing in a preset manifest.
};
