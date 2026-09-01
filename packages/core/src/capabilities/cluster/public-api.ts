/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Cluster capability — public API surface.
 *
 * Thin read wrappers over the config reader — no business logic here. Mounted on
 * `GeoLeaf.Cluster` via `geoleaf.cluster.ts`. Exposed for integrators / no-code
 * studio; core consumers (GeoJSON loader, POI) import the pure resolvers directly.
 *
 * @example
 * // Integrator checks whether clustering is active
 * if (GeoLeaf.Cluster.isEnabled()) { … }
 */

import { getClusterConfig } from "./config.js";
import type { ClusterConfig } from "./types.js";

/**
 * The object mounted on `GeoLeaf.Cluster`.
 *
 * ⚠️ **Named on purpose, and it was the LAST capability without a name.** `global.d.ts`
 * declared `Cluster?: typeof import("./public-api.js").Cluster` — a member this module has
 * never exported. The declaration compiled everywhere `skipLibCheck` is on (the common case)
 * and rendered `TS2694` the moment an integrator turned it off. Found by the
 * out-of-monorepo trial of the public release, **before** publication: `npm`
 * engraves one `.d.ts` per version, and fixing it after would have cost a 3.0.1.
 *
 * 📌 The 20 other capabilities already follow this pattern (`BrandingPublicApi`,
 * `CoordinatesPublicApi`…). This one was the 21st, and the only one whose comment
 * admitted the gap — "No named public type" — while referencing a name.
 */
export type ClusterPublicApi = {
    /** Returns `true` when clustering is enabled (`modules.cluster.enabled !== false`). */
    isEnabled: () => boolean;

    /** Returns the resolved `modules.cluster` config (merged over the built-in defaults). */
    getConfig: () => ClusterConfig;
};

/** Builds the object mounted on `GeoLeaf.Cluster`. */
export function buildPublicApi(): ClusterPublicApi {
    return {
        /** Returns `true` when clustering is enabled (`modules.cluster.enabled !== false`). */
        isEnabled: (): boolean => getClusterConfig().enabled !== false,

        /** Returns the resolved `modules.cluster` config (merged over the built-in defaults). */
        getConfig: (): ClusterConfig => getClusterConfig(),
    };
}
