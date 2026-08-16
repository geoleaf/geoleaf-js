/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability installer for the in-core `cluster` capability — presets build (S2, S7).
 *
 * Single self-sufficient anchor: importing THIS file is the only thing a preset does
 * to embark Cluster. The `GeoLeaf.Cluster` write moved out of `globals.api.ts`
 * (`assignApiFacades`).
 *
 * **No `createModule`** — cluster is a *policy* capability (pull-based): the GeoJSON
 * loader queries its pure resolvers on demand through the service locator, so there is
 * no `ICoreModule` lifecycle to register and no listener to wire. The gate is enforced
 * by the config reader (`getClusterConfig().enabled`), not at boot. `registerPresetModules`
 * skips installers without a factory — same no-op as the legacy boot block.
 *
 * S7: `gl._Cluster` (the two pure resolvers) is a second, private write — split from the
 * public `GeoLeaf.Cluster` policy facade — so the GeoJSON loader
 * (`kernel/geojson/loader/{single-layer,adapter-options}.ts`) can read them
 * back lazily instead of importing `capabilities/cluster/{strategy,options}.js`
 * statically. Same template as `vector-tiles` (S5): an entry that leaves this capability
 * out simply has no writer, and the loader falls back to `{ shouldCluster: false }` —
 * the same outcome as a present-but-disabled `modules.cluster.enabled: false`.
 */

import type { CapabilityInstaller } from "../../contracts/preset.contract.js";
import { CLUSTER_CAPABILITY } from "./cluster-capability.js";
import { Cluster } from "../../api/geoleaf.cluster.js";
import { getClusteringStrategy } from "./strategy.js";
import { applyGeoJSONClusterOptions } from "./options.js";

/** Self-sufficient installer for the Cluster capability (point clustering policy). */
export const CLUSTER_INSTALLER: CapabilityInstaller = {
    declaration: CLUSTER_CAPABILITY,

    registerGlobals(gl: Record<string, unknown>): void {
        // Layer B — moved verbatim from globals.api.ts (assignApiFacades, B11).
        gl.Cluster = Cluster;
        // Layer B (S7) — private resolver bag for the GeoJSON loader's service locator.
        gl._Cluster = { getClusteringStrategy, applyGeoJSONClusterOptions };
    },
};
