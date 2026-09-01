/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability installer for the in-core `vector-tiles` capability — presets build (S5).
 *
 * Single self-sufficient anchor: importing THIS file is the only thing a preset does to embark
 * VectorTiles. The `GeoLeaf._VectorTiles` write moved out of `globals.geojson.ts` (which is
 * KERNEL, and whose static import of `VectorTiles` was the last kernel→capability edge left
 * after S4 — it pinned the whole capability, 744 lines at the time, into the eager closure of
 * every bundle; socle B.1 has since moved the MapLibre building to the adapter, leaving ~500).
 *
 * **No `createModule`** — vector-tiles is a *policy* capability (pull-based), exactly like
 * `cluster`: the GeoJSON loader queries it on demand through the service locator. It owns no
 * `ICoreModule` lifecycle and wires no listener, so the module registry stays at 22.
 *
 * Its two consumers already tolerate its absence — that is not a new fallback added for the
 * occasion, it is the path every shipped profile takes today:
 *   - `loader/single-layer.ts` — `const VT = getVectorTiles(); if (VT && VT.shouldUseVectorTiles(def))`
 *     → falls through to OGC API / worker / plain GeoJSON ;
 *   - `layer-manager/style.ts` — `if (layerData.isVectorTile && VectorTiles)` → falls back to
 *     `adapter.setLayerStyle`. Doubly safe: only this capability ever sets `isVectorTile`.
 */

import type { CapabilityInstaller } from "../../contracts/preset.contract.js";
import { VECTOR_TILES_CAPABILITY } from "./vector-tiles-capability.js";
import { VectorTiles } from "./vector-tiles.js";

/** Self-sufficient installer for the VectorTiles capability (MVT business layers). */
export const VECTOR_TILES_INSTALLER: CapabilityInstaller = {
    declaration: VECTOR_TILES_CAPABILITY,

    registerGlobals(gl: Record<string, unknown>): void {
        // Layer B — moved verbatim from globals.geojson.ts (setupGeoJSONKernel, B5).
        // The loader reads it back lazily through `_loaderDeps.getVectorTiles()`, so the
        // write order relative to the geojson kernel setup does not matter.
        //
        // Re-measured 24/08/2026 — this capability DOES mount a namespace (`_VectorTiles`,
        // declared and typed in `global.d.ts`), so the earlier "empty shell" premise for
        // skipping a `public-api.ts` was false. The decision to skip it is KEPT on its real
        // ground: the mount is an underscore seam read back by the geojson loader, not a
        // public facade a re-export file would clarify, and conforming a stable shipped
        // file to an internal pattern would change no observable byte.
        gl._VectorTiles = VectorTiles;
    },
};
