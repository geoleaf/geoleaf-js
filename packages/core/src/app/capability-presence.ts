/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf App – Capability presence, as the shell reads it.
 *
 * The shell (mobile pill, desktop panel, the host page's filter toggle) draws a control only
 * when the capability that serves it can answer. Reading the configuration alone is not
 * enough: a bundle that does not embark a capability has no `modules.<id>` reader at all, and
 * a configuration that says nothing switches every opt-out capability on — so the shell used
 * to show tabs nobody fills and buttons that do nothing when pressed.
 *
 * The capability registry already holds the two facts the shell needs: a capability is
 * **declared** only when its installer is in the bundle, and its gate says whether the merged
 * configuration switches it on. {@link isCapabilityServed} asks for both at once.
 */

import { CapabilityRegistry, toCapConfig } from "../kernel/api/capability-registry.js";

/**
 * Whether a capability is embarked in the bundle AND switched on by the configuration.
 *
 * Reads the registry at call time — call it after the preset declarations (boot pass 1), with
 * the MERGED configuration (profile included); before pass 1 every capability reads as absent.
 *
 * @param id - Capability id, as declared by its installer (e.g. `"filter"`).
 * @param cfg - The merged configuration object.
 * @returns `false` when the capability is not in the bundle, or when its gate is closed.
 *
 * @example
 * ```ts
 * const showLegend = isCapabilityServed("legend", cfg);
 * ```
 */
export function isCapabilityServed(id: string, cfg: object | null | undefined): boolean {
    return CapabilityRegistry.isEnabled(id, toCapConfig((cfg ?? {}) as Record<string, unknown>));
}
