/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability installer for the in-core `taxonomy` capability.
 *
 * Single self-sufficient anchor: importing THIS file is the only thing a preset
 * does to embark Taxonomy (declaration + facade globals).
 *
 * Taxonomy owns NO module and NO lifecycle — it is purely pull-based. It hands
 * out symbol ids, paint expressions and badge colours to whoever asks (the
 * GeoJSON symbol injector, the MapLibre adapter, feature-info, the legend, the
 * filter); it subscribes to nothing. Hence no `createModule`.
 *
 * It also ships no preset config overlay: its gate is now opt-out, so it activates
 * correctly on its own (see `taxonomy-capability.ts`).
 */

import type { CapabilityInstaller } from "../../contracts/preset.contract.js";
import { TAXONOMY_CAPABILITY } from "./taxonomy-capability.js";
import { Taxonomy } from "../../api/geoleaf.taxonomy.js";

/** Self-sufficient installer for the Taxonomy capability (the point symbol). */
export const TAXONOMY_INSTALLER: CapabilityInstaller = {
    declaration: TAXONOMY_CAPABILITY,

    registerGlobals(gl: Record<string, unknown>): void {
        // Layer B — moved verbatim from globals.api.ts (assignApiFacades, B11).
        gl.Taxonomy = Taxonomy;
    },
};
