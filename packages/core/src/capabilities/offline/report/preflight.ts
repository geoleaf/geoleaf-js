/*!
 * GeoLeaf Core (offline capability) — Pre-departure check
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * "Can I leave?" — the body of `GeoLeaf.Storage.preflight()`.
 *
 * Every fact it reports already existed, each behind its own door: the per-layer report
 * (`sync-report.ts` — which no product surface called), the queue (`write/sync-status.ts`),
 * the quota (`IndexedDB.getStorageStats`), the last preparation (the cache manifest). One did
 * not: whether the browser keeps this origin's data. The PWA asks for persistence at boot and
 * LOGGED the answer; nothing read it back. It is read here — `navigator.storage.persisted()`,
 * mapped to the contract's `StoragePersistenceRegime`, which had waited for an implementer.
 *
 * The facts are read in parallel and each one on its own: a fact that cannot be read is
 * reported absent (`null`), never invented, and never takes the others down — the check is
 * made to be read before leaving, so it must answer. The layers kept are the ones that declare
 * something to pull: a layer with nothing to pull has no offline state to report
 * (`notDeclared`).
 *
 * ⚠️ The session is not in it — see `PreflightReport` in the contract.
 */

import { Log } from "../../../utils/log/index.js";
import { coreConfigGet } from "../config-seam.js";
import { IndexedDB } from "../db/indexeddb.js";
import { CacheStorage } from "../cache/storage.js";
import { buildSyncReport } from "./sync-report.js";
import { readSyncStatus } from "../write/sync-status.js";
import type {
    LayerOfflineStatus,
    LayerSyncReport,
    PreflightReport,
    StoragePersistenceRegime,
    SyncStatus,
    TilePreparationTrace,
} from "../../../contracts/sync.contract.js";

/** The manifest fields the check reads — written by `CacheStorage.saveManifest`. */
interface ManifestFacts {
    cachedAt?: number | null;
    generatedAt?: string;
    failedResources?: unknown[];
    preparation?: TilePreparationTrace | null;
}

/** Where each fact comes from — injectable, so the ASSEMBLY can be tested on its own. */
interface PreflightSources {
    /** `navigator.storage.persisted`, or `null` when the browser has none. */
    persisted: (() => Promise<boolean>) | null;
    stats: () => Promise<{ used: number; quota: number; percentage: number }>;
    syncReport: () => Promise<readonly LayerSyncReport[]>;
    syncStatus: () => Promise<SyncStatus>;
    manifest: () => Promise<ManifestFacts | null>;
}

/** Statuses that mean the layer's entities are not on the device. */
const NOT_ON_DEVICE: ReadonlySet<LayerOfflineStatus> = new Set([
    "declaredNeverPulled",
    "pullFailed",
]);

/** Statuses that mean the layer is on the device, but not whole or not fresh. */
const INCOMPLETE: ReadonlySet<LayerOfflineStatus> = new Set(["pulledPartial", "pulledStale"]);

/** The real sources, read at call time. */
function realSources(): PreflightSources {
    const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
    return {
        persisted: storage?.persisted ? () => storage.persisted() : null,
        stats: async () => {
            const s = await IndexedDB.getStorageStats();
            return { used: s.used, quota: s.quota, percentage: s.percentage };
        },
        syncReport: () => buildSyncReport(),
        syncStatus: () => readSyncStatus(),
        manifest: async () => {
            const profileId = coreConfigGet("data.activeProfile", "") as string;
            if (!profileId) return null;
            return (await CacheStorage.getManifest(profileId)) as ManifestFacts | null;
        },
    };
}

/** Reads one fact; a failure is reported as `null`, with its cause logged. */
async function _read<T>(what: string, read: () => Promise<T>): Promise<T | null> {
    try {
        return await read();
    } catch (err) {
        Log.warn(`[Offline.Preflight] ${what} unreadable:`, (err as Error)?.message);
        return null;
    }
}

/** The persistence regime, read — `unsupported` when the browser cannot say. */
async function _regime(
    persisted: PreflightSources["persisted"]
): Promise<StoragePersistenceRegime> {
    if (!persisted) return "unsupported";
    const kept = await _read("persistence", persisted);
    if (kept === null) return "unsupported";
    return kept ? "persistent" : "bestEffort";
}

/** The last preparation, in the contract's shape — `null` when the device was never prepared. */
function _preparation(m: ManifestFacts | null): PreflightReport["preparation"] {
    if (!m) return null;
    const legacy = m.generatedAt ? Date.parse(m.generatedAt) : NaN;
    return {
        cachedAt: m.cachedAt ?? (Number.isFinite(legacy) ? legacy : null),
        failedResources: Array.isArray(m.failedResources) ? m.failedResources.length : 0,
        tiles: m.preparation ?? null,
    };
}

/** What the facts mean together — see `PreflightReport.verdict`. */
function _verdict(
    layers: readonly LayerSyncReport[],
    queue: SyncStatus,
    persistence: StoragePersistenceRegime,
    preparation: PreflightReport["preparation"]
): PreflightReport["verdict"] {
    if (layers.some((l) => NOT_ON_DEVICE.has(l.status))) return "notReady";
    const tiles = preparation?.tiles;
    const degraded =
        layers.some((l) => INCOMPLETE.has(l.status)) ||
        queue.quarantined > 0 ||
        persistence !== "persistent" ||
        (tiles?.skippedZooms.length ?? 0) > 0 ||
        tiles?.capped === true ||
        (preparation?.failedResources ?? 0) > 0;
    return degraded ? "degraded" : "ready";
}

/**
 * Assembles the pre-departure check.
 *
 * @param sources - Where each fact is read; the real stores by default.
 * @returns The check — it never throws.
 */
export async function buildPreflight(
    sources: PreflightSources = realSources()
): Promise<PreflightReport> {
    const [persistence, quota, report, status, manifest] = await Promise.all([
        _regime(sources.persisted),
        _read("quota", sources.stats),
        _read("sync report", sources.syncReport),
        _read("queue", sources.syncStatus),
        _read("preparation", sources.manifest),
    ]);
    const layers = (report ?? []).filter((l) => l.status !== "notDeclared");
    const queue: SyncStatus = status ?? {
        online: typeof navigator === "undefined" || navigator.onLine !== false,
        owed: 0,
        quarantined: 0,
        lastSyncAt: null,
    };
    const preparation = _preparation(manifest);
    return {
        at: Date.now(),
        // A report that could not be read cannot vouch for any layer.
        verdict: report === null ? "notReady" : _verdict(layers, queue, persistence, preparation),
        persistence,
        quota,
        layers,
        queue,
        preparation,
    };
}
