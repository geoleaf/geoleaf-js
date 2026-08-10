/*!
 * @geoleaf-plugins/editor — Host-layer / edit-copy reconciliation
 * © 2026 Mattieu Pottier — MIT License
 *
 * When an EXISTING host-layer feature is selected for editing, Terra Draw works
 * on a COPY while the original stays rendered — causing the visual duplication
 * seen in S8. This module hides the host original during the edit (MapLibre
 * filter), commits the new geometry to the host source on save, removes it on
 * delete, and restores it on cancel / exit.
 *
 * Hiding is filter-based (non-destructive, reversible in one call); the host
 * source data is only rewritten on save/delete, where a rewrite is unavoidable.
 * Features are matched on `properties.id` (the core convention — no `promoteId`
 * is set) with a fallback to the top-level `feature.id`.
 * https://geoleaf.dev
 */

/** Map-facade subset the reconciler needs (from `GeoLeaf.Core.getMap()`). */
export interface HostMapFacade {
    setLayerFilter(id: string, filter: unknown): void;
    updateLayerData(id: string, data: unknown): void;
}

/** Collaborators injected by entry.ts. */
export interface HostReconcileDeps {
    /** Core map adapter facade (filter + data update). */
    facade: HostMapFacade;
    /** Native MapLibre map, for reading the current source data. */
    nativeMap: unknown;
}

interface GeoFeature {
    type: "Feature";
    id?: string | number;
    geometry: unknown;
    properties: Record<string, unknown> | null;
}
interface FeatureCollection {
    type: "FeatureCollection";
    features: GeoFeature[];
}

// ---------------------------------------------------------------------------
// Module state — the feature currently hidden for editing (one at a time).
// ---------------------------------------------------------------------------

let _hidden: { layerId: string; featureId: string } | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Hides the host original by filtering it out of its rendered layer. No-op when
 * `featureId` is empty (feature drawn this session, no host counterpart).
 */
export function hideHostFeature(deps: HostReconcileDeps, layerId: string, featureId: string): void {
    if (!featureId || !layerId) return;
    deps.facade.setLayerFilter(layerId, _excludeFilter(featureId));
    _hidden = { layerId, featureId };
}

/** Restores the most recently hidden host feature (clears the filter). */
export function showHostFeature(deps: HostReconcileDeps, layerId?: string): void {
    const target = layerId ?? _hidden?.layerId;
    if (!target) return;
    deps.facade.setLayerFilter(target, null);
    if (_hidden && (!layerId || layerId === _hidden.layerId)) _hidden = null;
}

/**
 * Returns the currently hidden {layerId, featureId}, or null.
 *
 * Read half of the `_hidden` state pair that {@link hideHostFeature} writes and
 * {@link showHostFeature} clears. No production caller — it exists so the pair
 * can be asserted directly instead of inferred from `setLayerFilter` calls.
 * PLUGINS S4 flagged it as dead and kept it for that reason.
 */
export function getHiddenHost(): { layerId: string; featureId: string } | null {
    return _hidden;
}

/**
 * Commits a new geometry to the host source feature, then clears the hide
 * filter so the updated original becomes visible again.
 */
export function commitHostGeometry(
    deps: HostReconcileDeps,
    layerId: string,
    featureId: string,
    geometry: unknown
): void {
    if (!featureId || !layerId) return;
    const fc = _readSource(deps.nativeMap, layerId);
    if (!fc) {
        _warnNoSource(layerId);
        showHostFeature(deps, layerId);
        return;
    }
    const next: FeatureCollection = {
        type: "FeatureCollection",
        features: fc.features.map((f) => (_matches(f, featureId) ? { ...f, geometry } : f)),
    };
    deps.facade.updateLayerData(layerId, next);
    showHostFeature(deps, layerId);
}

/**
 * Removes the host source feature entirely, then clears the hide filter.
 */
export function removeHostFeature(
    deps: HostReconcileDeps,
    layerId: string,
    featureId: string
): void {
    if (!featureId || !layerId) return;
    const fc = _readSource(deps.nativeMap, layerId);
    if (!fc) {
        _warnNoSource(layerId);
        showHostFeature(deps, layerId);
        return;
    }
    const next: FeatureCollection = {
        type: "FeatureCollection",
        features: fc.features.filter((f) => !_matches(f, featureId)),
    };
    deps.facade.updateLayerData(layerId, next);
    showHostFeature(deps, layerId);
}

/** Resets module state (plugin destroy). */
export function resetHostReconcile(): void {
    _hidden = null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** MapLibre filter excluding the feature whose `id` property equals featureId. */
function _excludeFilter(featureId: string): unknown {
    // `["get","id"]` reads properties.id (the canonical id); the OR with `["id"]`
    // also covers features carrying an intrinsic top-level id.
    return ["all", ["!=", ["get", "id"], featureId], ["!=", ["id"], featureId]];
}

/** True when a feature matches featureId on properties.id or top-level id. */
function _matches(f: GeoFeature, featureId: string): boolean {
    const propId = f.properties?.["id"];
    if (propId != null && String(propId) === featureId) return true;
    return f.id != null && String(f.id) === featureId;
}

/**
 * Reads the current FeatureCollection backing a host layer. There is no
 * `getLayerData` on the adapter contract, so go through the native source's
 * `serialize()` (preferred) or the internal `_data` field as a fallback.
 */
function _readSource(nativeMap: unknown, layerId: string): FeatureCollection | null {
    const map = nativeMap as { getSource?(id: string): unknown } | null;
    if (!map?.getSource) return null;

    const source = (_trySource(map, `gl-${layerId}`) ?? _trySource(map, layerId)) || null;
    if (!source) return null;

    const data = _sourceData(source);
    if (
        data &&
        typeof data === "object" &&
        (data as FeatureCollection).type === "FeatureCollection"
    ) {
        return data as FeatureCollection;
    }
    return null;
}

function _trySource(map: { getSource?(id: string): unknown }, id: string): unknown {
    try {
        return map.getSource?.(id) ?? null;
    } catch {
        return null;
    }
}

/** Extracts GeoJSON data from a MapLibre GeoJSON source, defensively. */
function _sourceData(source: unknown): unknown {
    const s = source as { serialize?(): { data?: unknown }; _data?: unknown };
    try {
        if (typeof s.serialize === "function") {
            const ser = s.serialize();
            if (ser?.data) return ser.data;
        }
    } catch {
        /* fall through to _data */
    }
    return s._data ?? null;
}

function _warnNoSource(layerId: string): void {
    console.warn(
        `[GeoLeaf.Editor] host-reconcile: source for layer "${layerId}" not found; ` +
            "skipped host update to avoid desync."
    );
}
