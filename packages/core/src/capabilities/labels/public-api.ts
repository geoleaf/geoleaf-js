/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Labels capability — public API surface.
 *
 * Returns the full `Labels` runtime singleton augmented with capability read
 * helpers (`isEnabled` / `getConfig`). Mounted on `GeoLeaf.Labels` via
 * `geoleaf.labels.ts`.
 *
 * ⚠️ This header named the « Lite build » until 2026-08-19. **That build no longer exists** — its removal is motivated where it happened, in the bundle configuration, and the alternate mounting site these headers implied does not exist either. A build distinction that is gone does not read as stale: it reads as a live constraint, and a reader plans around it. Here it announced an EXCLUSION — a reader would look for the graph it names.
 *
 * The full singleton is re-exported (not a thin read-only wrapper): the kernel
 * and the layer manager consume `initializeLayerLabels` / `enableLabels` /
 * `toggleLabels` / … through this object.
 */

import { Labels } from "./labels.js";
import { getLabelsConfig, type LabelsCapabilityConfig } from "./config.js";
import type { LabelsApi } from "./types.js";

/** Read helpers added to the Labels singleton for integrators / no-code studio. */
export interface LabelsReadApi {
    /** Returns `true` when labels are enabled (`modules.labels.enabled !== false`). */
    isEnabled(): boolean;
    /** Returns the resolved `modules.labels` config (merged over the built-in defaults). */
    getConfig(): LabelsCapabilityConfig;
}

/** The object mounted on `GeoLeaf.Labels` — the full runtime singleton + read helpers. */
export type LabelsPublicApi = LabelsApi & LabelsReadApi;

/** Builds the object mounted on `GeoLeaf.Labels` (Full build only). */
export function buildPublicApi(): LabelsPublicApi {
    return Object.assign(Labels, {
        isEnabled: (): boolean => getLabelsConfig().enabled !== false,
        getConfig: (): LabelsCapabilityConfig => getLabelsConfig(),
    });
}
