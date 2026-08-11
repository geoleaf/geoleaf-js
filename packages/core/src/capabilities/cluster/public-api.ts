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
"use strict";

import { getClusterConfig } from "./config.js";
import type { ClusterConfig } from "./types.js";

/**
 * The object mounted on `GeoLeaf.Cluster`.
 *
 * ⚠️ **Named on purpose, and it was the LAST capability without a name.** `global.d.ts`
 * declared `Cluster?: typeof import("./public-api.js").Cluster` — a member this module has
 * never exported. The declaration compiled everywhere `skipLibCheck` is on (the common case)
 * and rendered `TS2694` the moment an integrator turned it off. Trouvé par la tâche 10.8 du
 * passage public, l'épreuve hors monorepo, **avant** la publication : `npm` grave un `.d.ts`
 * par version, et le corriger après aurait coûté un 3.0.1.
 *
 * 📌 Les 20 autres capacités suivent déjà ce patron (`BrandingPublicApi`,
 * `CoordinatesPublicApi`…). Celle-ci était la 21ᵉ, et la seule dont le commentaire admettait
 * l'écart — « Pas de type public nommé » — tout en référençant un nom.
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
