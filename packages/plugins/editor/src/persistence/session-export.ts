/*!
 * @geoleaf-plugins/editor — Session GeoJSON export
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Tracks entities **created during the current browsing session** and exports
 * them as GeoJSON. Absorbed from `addpoi/src/session-export.ts`.
 *
 * ⚠️ **"Session" means: until reload.** Tracking is an in-memory `Set`, so an
 * F5 empties the list. The source's behaviour, kept as-is — but it must be
 * said, because the word "export" invites believing otherwise. **This is NOT a
 * safety net**: that one is `offline-ui`'s outbox export, which reads IndexedDB
 * and survives reload as well as an origin purge.
 *
 * 🛑 **WHAT IS NOT ABSORBED, AND WHY.** The source carried a second gesture,
 * `submitSessionToServer()`, with its toolbar button. It is **unreachable in
 * two independent ways**:
 *
 *   1. its button declares `profileKey: "ui.showPoiSubmit"` with
 *      `defaultVisible: false`, and `ui.showPoiSubmit` is declared in **no
 *      schema** while `ui.schema.json` is `additionalProperties: false` —
 *      writing it would fail `validate:profiles`. The button is thus **hidden
 *      by default and cannot be shown**;
 *   2. it requires `modules.addpoi.submitEndpoint`, which **only the test
 *      profile** sets.
 *
 * Porting it would have transported a capability nobody can reach — the third
 * orphan of this absorption, after `retryPendingUploads` and
 * `createFileInput`.
 */
import { Log, downloadBlob } from "@geoleaf/host-runtime";

/** Identifiers of the entities created since the page loaded. */
const _sessionIds = new Set<string>();

/** The internal properties, removed before export. */
const _STRIP = new Set([
    "_layerConfig",
    "_popupConfig",
    "_sidepanelConfig",
    "_tooltipConfig",
    "_syncStatus",
]);

/**
 * Records an entity as created during this session.
 *
 * @param id - The entity's identifier, as the host carries it.
 */
export function trackSessionFeature(id: string): void {
    if (id) _sessionIds.add(id);
}

/**
 * Replaces a local identifier with the one the server assigned.
 *
 * Without this, an entity created off-network then synchronised would **drop
 * out** of the export: it would be tracked under its local identifier, which
 * the host layer no longer carries.
 *
 * @param oldId - Local identifier, as tracked.
 * @param newId - Server identifier.
 */
export function renameSessionFeature(oldId: string, newId: string): void {
    if (!_sessionIds.has(oldId)) return;
    _sessionIds.delete(oldId);
    _sessionIds.add(newId);
}

/** @returns the number of entities created during this session. */
export function sessionFeatureCount(): number {
    return _sessionIds.size;
}

/** Clears the tracking — used at plugin teardown and by the tests. */
export function resetSessionTracking(): void {
    _sessionIds.clear();
}

/** Access to the core's layer data, read at call time. */
interface LayerData {
    listLayerIds?(): string[];
    getFeatures?(layerId: string): unknown[];
}

function _layers(): LayerData | null {
    return (
        (Reflect.get(globalThis, "GeoLeaf") as { Layers?: LayerData } | undefined)?.Layers ?? null
    );
}

/**
 * Removes an entity's internal properties.
 *
 * @param feature - Entity as the host layer carries it.
 * @returns an exportable copy.
 */
function _strip(feature: {
    id?: unknown;
    geometry?: unknown;
    properties?: Record<string, unknown> | null;
}): Record<string, unknown> {
    const src = feature.properties ?? {};
    const properties: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
        if (!_STRIP.has(k)) properties[k] = v;
    }
    return { type: "Feature", id: feature.id, geometry: feature.geometry, properties };
}

/**
 * Gathers the session's entities from their host layers.
 *
 * @returns the tracked entities, cleaned of their internal properties.
 */
export function collectSessionFeatures(): Record<string, unknown>[] {
    const layers = _layers();
    if (!layers?.listLayerIds || !layers.getFeatures) return [];
    const out: Record<string, unknown>[] = [];
    for (const layerId of layers.listLayerIds()) {
        let features: unknown[];
        try {
            features = layers.getFeatures(layerId) ?? [];
        } catch (e) {
            // A declared but never-loaded layer throws; it must not blind the
            // export to the others — same guard as `drawing/poi-snap.ts`.
            Log?.debug?.("[editor/session-export] Layer unreadable, skipped:", layerId, e);
            continue;
        }
        for (const raw of features) {
            const f = raw as { id?: unknown; properties?: Record<string, unknown> | null };
            const rawId = f.id ?? f.properties?.id;
            if (rawId === undefined || rawId === null) continue;
            if (!_sessionIds.has(String(rawId))) continue;
            out.push(_strip(f as Parameters<typeof _strip>[0]));
        }
    }
    return out;
}

/** Today's date as `YYYY-MM-DD`, for the file name. */
function _today(): string {
    return new Date().toISOString().slice(0, 10);
}

/**
 * Downloads a GeoJSON of the entities created during this session.
 *
 * ⚠️ `@geoleaf/host-runtime`'s `downloadBlob` rather than a local anchor
 * factory: the source carried a 12-line copy of it (`_download`), while the
 * seam already existed.
 *
 * @returns the number of exported entities — `0` when there is nothing to export.
 */
export async function exportSessionFeatures(): Promise<number> {
    const features = collectSessionFeatures();
    if (!features.length) return 0;
    const json = JSON.stringify({ type: "FeatureCollection", features }, null, 2);
    const blob = new Blob([json], { type: "application/geo+json" });
    await downloadBlob(blob, `geoleaf-session-${_today()}.geojson`);
    return features.length;
}
