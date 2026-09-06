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
import { LabelButtonManager } from "./label-button-manager.js";
import { getLabelsConfig, type LabelsCapabilityConfig } from "./config.js";
import type { LabelsApi } from "./types.js";

/** Read helpers added to the Labels singleton for integrators / no-code studio. */
export interface LabelsReadApi {
    /** Returns `true` when labels are enabled (`modules.labels.enabled !== false`). */
    isEnabled(): boolean;
    /** Returns the resolved `modules.labels` config (merged over the built-in defaults). */
    getConfig(): LabelsCapabilityConfig;
}

/**
 * Control helpers added to the Labels singleton.
 *
 * Kept apart from {@link LabelsReadApi} because these are not reads: they act on
 * the DOM. Merging them would have made the read interface's name a lie.
 */
export interface LabelsControlApi {
    /**
     * Repaints the label toggle of one layer's row in the layer manager.
     *
     * The rest of this facade drives the label STATE; this drives the CONTROL that
     * displays it. The two part company whenever a host changes a layer's
     * visibility or style through its own path instead of through this facade: the
     * state is right, the button still shows what was true before. Calling this
     * puts the button back in agreement with the layer.
     *
     * Idempotent, synchronous, and a no-op on an empty id or a layer with no row on
     * screen. {@link LabelsApi.refreshLabels} is not a substitute — it re-renders
     * the labels themselves, never the toggle.
     *
     * @param layerId - Layer whose control is repainted.
     *
     * @example
     * ```js
     * // The host switched a layer off through its own UI; put the toggle back in
     * // agreement with it.
     * GeoLeaf?.Labels?.syncLayerControl("poi-restaurants");
     * ```
     */
    syncLayerControl(layerId: string): void;
}

/** The object mounted on `GeoLeaf.Labels` — the full runtime singleton + helpers. */
export type LabelsPublicApi = LabelsApi & LabelsReadApi & LabelsControlApi;

/** Builds the object mounted on `GeoLeaf.Labels` (Full build only). */
export function buildPublicApi(): LabelsPublicApi {
    return Object.assign(Labels, {
        isEnabled: (): boolean => getLabelsConfig().enabled !== false,
        getConfig: (): LabelsCapabilityConfig => getLabelsConfig(),
        syncLayerControl: (layerId: string): void => {
            // The falsy guard is repeated here on purpose, although the manager also
            // early-returns. This facade PROMISES the no-op in its TSDoc, and a
            // published promise must not rest on an internal early-return that
            // nothing stops from moving: the day it moves, the promise breaks
            // silently and only downstream sees it.
            if (!layerId) return;
            LabelButtonManager.syncImmediate(layerId);
        },
    });
}
