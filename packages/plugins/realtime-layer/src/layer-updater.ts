/*!
 * @geoleaf-plugins/realtime-layer
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * LayerUpdater — applies decoded feature updates to a GeoLeaf layer using
 * `GeoLeaf.GeoJSON.*` public API only (no access to core internals).
 *
 * Supported update modes:
 *  - `"replace"` — replaces the entire FeatureCollection with the incoming data.
 *  - `"upsert"`  — adds or updates individual features identified by `idField`.
 *  - `"merge"`   — merges properties onto existing features identified by `idField`.
 */

import type { DecodedUpdate, GeoJSONGeometry } from "./decoders/i-decoder.js";
import type { RealtimeConfig } from "./config.js";
import { touch } from "./stale-tracking.js";
import { findFeatureIndex } from "./feature-index.js";

interface GeoLeafGeoJSON {
    getLayerData(layerId: string): {
        features: Array<{
            properties?: Record<string, unknown> | null;
            geometry?: GeoJSONGeometry | null;
            type?: string;
        }>;
    } | null;
    updateLayerData(layerId: string, data: unknown): void;
}

const _g = globalThis as { GeoLeaf?: { GeoJSON?: GeoLeafGeoJSON } };

type GeoJSONFeature = {
    type: "Feature";
    properties: Record<string, unknown> | null;
    geometry: GeoJSONGeometry | null;
};

/**
 * Apply a batch of decoded updates to a layer according to the config's `updateMode`.
 *
 * @param layerId  - GeoLeaf layer ID to update.
 * @param updates  - Decoded updates from the decoder.
 * @param config   - Realtime config for the layer (mode, idField, …).
 * @param targetLayerId - Optional override for the layer to update (gtfs-rt mapping.targetLayerId).
 */
export function applyUpdates(
    layerId: string,
    updates: DecodedUpdate[],
    config: RealtimeConfig,
    targetLayerId?: string
): void {
    const targetId = targetLayerId ?? layerId;
    const GeoJSON = _g.GeoLeaf?.GeoJSON;
    if (!GeoJSON) {
        console.warn("[realtime-layer] GeoLeaf.GeoJSON is not available.");
        return;
    }

    const mode = config.updateMode ?? "upsert";

    if (mode === "replace") {
        _applyReplace(GeoJSON, targetId, updates);
        return;
    }

    const idField = config.idField;
    _applyUpsertOrMerge(GeoJSON, targetId, updates, idField, mode === "merge");
}

// ── replace ──────────────────────────────────────────────────────────────────

/**
 * Replace the whole FeatureCollection with the incoming updates.
 *
 * Deliberately does NOT call `touch()`: `replace` swaps the entire set every tick,
 * so per-feature freshness tracking is meaningless — the previous generation is gone
 * regardless of staleTimeoutMs. Only `upsert`/`merge` accumulate features over time
 * and thus feed the stale-tracking. Do not "fix" this by touching here.
 */
function _applyReplace(GeoJSON: GeoLeafGeoJSON, layerId: string, updates: DecodedUpdate[]): void {
    const features: GeoJSONFeature[] = updates.map((u) => ({
        type: "Feature",
        properties: { ...u.properties, _realtimeId: u.id },
        geometry: u.geometry ?? null,
    }));
    GeoJSON.updateLayerData(layerId, { type: "FeatureCollection", features });
}

// ── upsert / merge ────────────────────────────────────────────────────────────

/** Clone a layer's current features into a mutable working set. */
function _cloneExisting(
    layerData: {
        features: Array<{
            properties?: Record<string, unknown> | null;
            geometry?: GeoJSONGeometry | null;
        }>;
    } | null
): GeoJSONFeature[] {
    if (!layerData) return [];
    return layerData.features.map((f) => ({
        type: "Feature" as const,
        properties: f.properties ? { ...f.properties } : {},
        geometry: f.geometry ?? null,
    }));
}

/** Apply a single decoded update (delete / upsert / merge) to the working set. */
function _applyOne(
    existing: GeoJSONFeature[],
    update: DecodedUpdate,
    idField: string | undefined,
    mergeOnly: boolean,
    layerId: string
): void {
    if (update.action === "delete") {
        const idx = findFeatureIndex(existing, update.id, idField);
        if (idx !== -1) existing.splice(idx, 1);
        return; // deletes do not record a touch
    }

    const idx = findFeatureIndex(existing, update.id, idField);
    const target = existing[idx];
    if (target) {
        // Update existing feature
        if (!mergeOnly && update.geometry) target.geometry = update.geometry;
        target.properties = { ...target.properties, ...update.properties };
    } else if (!mergeOnly) {
        // upsert: insert new feature
        existing.push({
            type: "Feature",
            properties: { ...update.properties, [idField ?? "_realtimeId"]: update.id },
            geometry: update.geometry ?? null,
        });
    }

    // Record touch time for stale tracking (non-delete updates only)
    touch(layerId, update.id);
}

function _applyUpsertOrMerge(
    GeoJSON: GeoLeafGeoJSON,
    layerId: string,
    updates: DecodedUpdate[],
    idField: string | undefined,
    mergeOnly: boolean
): void {
    const existing = _cloneExisting(GeoJSON.getLayerData(layerId));
    for (const update of updates) {
        _applyOne(existing, update, idField, mergeOnly, layerId);
    }
    GeoJSON.updateLayerData(layerId, { type: "FeatureCollection", features: existing });
}
