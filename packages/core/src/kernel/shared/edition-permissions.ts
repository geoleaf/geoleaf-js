/*!
 * GeoLeaf Core (kernel/shared) — Layer edition permissions
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * The right to edit a layer — the rule, and access to the declaration carrying it.
 *
 * ## Why this module is in the BOOT GRAPH and not in the offline engine
 *
 * 🛑 **Because the permission is read from the PROFILE, not IndexedDB.** The rule
 * lived until 07/08/2026 as a private function of
 * `capabilities/offline/write/local-edit-api.ts` (`_grants`), hence in the deferred
 * chunk, hence reachable only through the path taken when the network is absent.
 * Measured consequence: a **connected** user went through
 * `editor/src/persistence/rest-adapter.ts`, which emits an unconditional `DELETE`,
 * and a layer declaring `edition.delete: false` stayed deletable. **The permission
 * was applied only on the path where it was reachable.**
 *
 * ⚠️ And leaving it there while routing it through the facade's `edit` bag would
 * have repaired nothing: `@geoleaf-plugins/editor` declares `requires: []` and runs
 * in `persistence.mode: "online"` with no offline engine at all. The predicate
 * would have been unavailable **exactly** in the case carrying the hole.
 *
 * ## One implementation, and that is the duplication counter
 *
 * `applyEdit` and the facade call {@link grantsEdition} — the same function, not
 * two reads of one rule. Two implementations of an authorisation diverge, and the
 * one that diverges last is the one nobody re-reads.
 *
 * @version 1.0.0
 */

import { getGeoLeaf } from "../../utils/general/geoleaf-global.js";
import type { LayerEditionPermissions, SyncOperationKind } from "../../contracts/sync.contract.js";

/**
 * Reads ALL layer declarations of the active profile, in profile order.
 *
 * 🛑 **Does NOT use `getAllLayerConfigs()`, and that is measured.** The neighbouring
 * barrel does expose that accessor, but `kernel/geojson/loader/profile.ts` fills it
 * with a **whitelist projection** — `id, label, layerManagerId, configFile, zIndex,
 * themes, geometry, geometryType, styles, labels`. Neither `edition`, nor
 * `offline`, nor `data`, nor `write`. A permission reader going through it would
 * see `edition === undefined` for **every** layer and refuse everything, silently.
 *
 * ⚠️ **And it is NOT `Config.Profile.getActiveProfileLayersConfig()`**: the
 * `Profile` sub-object is not mounted on `globalThis.GeoLeaf.Config`, and the call
 * throws. Measured in a browser, after a green unit test that mocked the hoped-for
 * shape.
 *
 * @returns The layer declarations, or `[]` when no profile is loaded.
 */
export function profileLayers(): Array<Record<string, unknown>> {
    const profile: unknown = getGeoLeaf()?.Config?.getActiveProfile?.();
    if (!profile || typeof profile !== "object") return [];
    const raw = (profile as { layers?: unknown }).layers;
    if (!Array.isArray(raw)) return [];
    // `Array.isArray` on an `unknown` narrows to `any[]`: re-type explicitly,
    // otherwise `find` yields `any` and the value crosses the typing boundary
    // unchecked.
    const layers = raw as unknown[];
    return layers.filter(
        (layer): layer is Record<string, unknown> => !!layer && typeof layer === "object"
    );
}

/**
 * Reads ONE layer — its entire `<id>_config.json`, as merged into the active profile.
 *
 * Same sources and same traps as {@link profileLayers}, of which this is the
 * unitary projection.
 *
 * @param layerId - Layer identifier.
 * @returns The full configuration, or `null` when the profile or the layer is absent.
 */
export function profileLayerConfig(layerId: string): Record<string, unknown> | null {
    const found = profileLayers().find((layer) => (layer as { id?: unknown }).id === layerId);
    return found ?? null;
}

/**
 * Does the declaration grant this operation? — the per-operation gate.
 *
 * ⚠️ **Absent means REFUSED**, and a present-but-empty `edition` block grants
 * nothing either: declaring is not granting. No key implies another — `update` does
 * not grant `delete`. Deriving one from the other is the exact mechanism by which
 * `enableEditionFull` had acquired a lying name.
 *
 * A malformed `edition` (string, array, `null`) is no better than absent: it grants
 * nothing. We do not throw — the profile schema already refuses the shape at
 * validation, and this branch only covers a profile mounted by hand, by a test or a
 * host.
 *
 * @param declared - The raw value of the layer's `edition` key, unvalidated.
 * @param kind - The submitted operation.
 * @returns `true` only when the matching key is literally `true`.
 */
export function grantsEdition(declared: unknown, kind: SyncOperationKind): boolean {
    if (declared === null || typeof declared !== "object" || Array.isArray(declared)) return false;
    return (declared as LayerEditionPermissions)[kind] === true;
}

/**
 * Does the layer grant this operation? — the predicate, made QUERYABLE before writing.
 *
 * It is what `applyEdit` applies offline, and what the edit plugin now consults
 * **before choosing its path**, hence including when connected.
 *
 * ⚠️ An unknown layer yields `false`. Refusing the unknown is the same choice as
 * `applyEdit` (`layerUnknown`), and the opposite would make a typo an
 * authorisation.
 *
 * @param layerId - The layer identifier from the active profile.
 * @param kind - The submitted operation.
 * @returns `true` only when the layer literally grants this operation.
 */
export function mayEditLayer(layerId: string, kind: SyncOperationKind): boolean {
    const config = profileLayerConfig(layerId);
    if (!config) return false;
    return grantsEdition(config["edition"], kind);
}
