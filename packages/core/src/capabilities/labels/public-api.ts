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
 * `geoleaf.labels.ts` — Full build only (labels are excluded from the Lite build,
 * PERF-02, so this façade is never pulled into the Lite graph).
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
