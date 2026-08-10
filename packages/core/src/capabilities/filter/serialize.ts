/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Filter capability — active-state serialisation (S13).
 *
 * Bridges the engine's `ActiveField[]` (which carries a live descriptor reference
 * and proximity radius in **metres**) and the DOM-free `SerializedFilterState`
 * (descriptor `id`+`kind`, proximity radius in **kilometres**) persisted by the
 * `permalink` capability. Pure data mapping — no DOM, no side effects.
 */
"use strict";

import type { ActiveField } from "./engine/types.js";
import type { FilterConfig, SerializedFilterField, SerializedFilterState } from "./types.js";
import { kmToMetres, metresToKm } from "./units.js";

/** Serialises the engine active-field list into the URL-stable state shape. */
export function serializeActiveFilter(active: ActiveField[]): SerializedFilterState {
    const fields: SerializedFilterField[] = [];
    for (const af of active) {
        const out: SerializedFilterField = { id: af.descriptor.id, kind: af.descriptor.kind };
        if (af.values?.length) out.values = [...af.values];
        if (typeof af.text === "string" && af.text) out.text = af.text;
        if (af.range && (af.range.min !== undefined || af.range.max !== undefined)) {
            out.range = { ...af.range };
        }
        if (af.bool === true) out.bool = true;
        if (af.proximity) {
            // Engine radius is in metres (haversine); the URL carries kilometres.
            out.proximity = {
                center: { ...af.proximity.center },
                radiusKm: metresToKm(af.proximity.radius),
            };
        }
        fields.push(out);
    }
    return { fields };
}

/**
 * Rebuilds the engine active-field list from a serialised state, re-matching each
 * entry to a live descriptor in `config`. Unknown ids (config changed since the URL
 * was produced) and empty selections are dropped, mirroring `readActiveFilter`.
 */
export function deserializeActiveFilter(
    state: SerializedFilterState,
    config: FilterConfig
): ActiveField[] {
    const byId = new Map((config.fields ?? []).map((f) => [f.id, f]));
    const out: ActiveField[] = [];
    for (const sf of state.fields ?? []) {
        const descriptor = byId.get(sf.id);
        if (!descriptor) continue;
        const af: ActiveField = { descriptor };
        if (sf.values?.length) af.values = [...sf.values];
        if (typeof sf.text === "string" && sf.text) af.text = sf.text;
        if (sf.range && (sf.range.min !== undefined || sf.range.max !== undefined)) {
            af.range = { ...sf.range };
        }
        if (sf.bool === true) af.bool = true;
        if (sf.proximity) {
            af.proximity = {
                center: { ...sf.proximity.center },
                radius: kmToMetres(sf.proximity.radiusKm),
            };
        }
        if (af.values || af.text || af.range || af.bool || af.proximity) out.push(af);
    }
    return out;
}
