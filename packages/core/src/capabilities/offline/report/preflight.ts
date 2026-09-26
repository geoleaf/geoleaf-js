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
 * The write session is the one fact the core cannot read: the token is its holder's. The holder
 * TELLS it, through the slot `GeoLeaf.Sync.registerSessionReader` fills
 * (`kernel/shared/session-reader-seam.ts`). That reader is foreign code — the connector's, or a
 * host's — so it is bounded in time as well as in failure: one that does not answer leaves the
 * session unknown, never the check unanswered.
 */

import { Log } from "../../../utils/log/index.js";
import { coreConfigGet } from "../config-seam.js";
import { IndexedDB } from "../db/indexeddb.js";
import { CacheStorage } from "../cache/storage.js";
import { buildSyncReport } from "./sync-report.js";
import { readSyncStatus } from "../write/sync-status.js";
import { SessionReaderContract } from "../../../kernel/shared/session-reader-seam.js";
import type {
    LayerOfflineStatus,
    LayerSyncReport,
    PreflightReport,
    StoragePersistenceRegime,
    SyncStatus,
    TilePreparationTrace,
    WriteSession,
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
    /** What the registered reader tells of the write session, as it answered it. */
    session: () => Promise<unknown>;
}

/** Statuses that mean the layer's entities are not on the device. */
const NOT_ON_DEVICE: ReadonlySet<LayerOfflineStatus> = new Set([
    "declaredNeverPulled",
    "pullFailed",
]);

/** Statuses that mean the layer is on the device, but not whole or not fresh. */
const INCOMPLETE: ReadonlySet<LayerOfflineStatus> = new Set(["pulledPartial", "pulledStale"]);

/** Session states under which a capture made off-network will wait for a sign-in. */
const SESSION_UNUSABLE: ReadonlySet<WriteSession["state"]> = new Set(["expired", "absent"]);

/** Every state the contract names — a reader's answer outside them is not believed. */
const SESSION_STATES: ReadonlySet<unknown> = new Set(["valid", "expired", "absent"]);

/** How long the session reader is given to answer, ms. */
const SESSION_READ_TIMEOUT_MS = 2000;

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
        session: async () => {
            const reader = SessionReaderContract._get();
            return reader ? await reader() : null;
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

/**
 * The reader's answer, bounded in time — it must not hold up the check.
 *
 * @returns The answer, or a rejection when the reader fails or does not answer within
 *   {@link SESSION_READ_TIMEOUT_MS} — which `_read` reports like any failure.
 */
async function _boundedSession(read: PreflightSources["session"]): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`no answer within ${SESSION_READ_TIMEOUT_MS} ms`)),
            SESSION_READ_TIMEOUT_MS
        );
    });
    try {
        return await Promise.race([read(), late]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * The session in the contract's shape, or `null` — an answer outside it is not believed: a
 * state the check does not know cannot say whether captures will reach the server.
 */
function _session(answer: unknown): WriteSession | null {
    if (answer === null || answer === undefined) return null;
    const { state, expiresAt } = answer as { state?: unknown; expiresAt?: unknown };
    if (!SESSION_STATES.has(state)) {
        Log.warn("[Offline.Preflight] session reader answered outside the contract:", answer);
        return null;
    }
    return {
        state: state as WriteSession["state"],
        expiresAt: typeof expiresAt === "number" && Number.isFinite(expiresAt) ? expiresAt : null,
    };
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
    preparation: PreflightReport["preparation"],
    session: WriteSession | null
): PreflightReport["verdict"] {
    if (layers.some((l) => NOT_ON_DEVICE.has(l.status))) return "notReady";
    const tiles = preparation?.tiles;
    const degraded =
        layers.some((l) => INCOMPLETE.has(l.status)) ||
        queue.quarantined > 0 ||
        persistence !== "persistent" ||
        (tiles?.skippedZooms.length ?? 0) > 0 ||
        tiles?.capped === true ||
        (preparation?.failedResources ?? 0) > 0 ||
        (session !== null && SESSION_UNUSABLE.has(session.state));
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
    const [persistence, quota, report, status, manifest, answer] = await Promise.all([
        _regime(sources.persisted),
        _read("quota", sources.stats),
        _read("sync report", sources.syncReport),
        _read("queue", sources.syncStatus),
        _read("preparation", sources.manifest),
        _read("session", () => _boundedSession(sources.session)),
    ]);
    const session = _session(answer);
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
        verdict:
            report === null
                ? "notReady"
                : _verdict(layers, queue, persistence, preparation, session),
        persistence,
        quota,
        layers,
        queue,
        preparation,
        session,
    };
}
