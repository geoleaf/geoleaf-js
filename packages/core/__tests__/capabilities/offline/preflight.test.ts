/**
 * `Storage.preflight()` — "can I leave?", answered in one read before going off-network.
 *
 * The facts already existed, each behind its own door: the per-layer report
 * (`getSyncReport`, which no product surface called), the queue (`getSyncStatus`), the quota
 * (`getStats`), the preparation (the cache manifest). And one did not exist at all: whether the
 * browser keeps this origin's data (`navigator.storage.persisted()`), which the PWA requested
 * at boot and only LOGGED. This assembles them, and says what they mean together.
 *
 * The facts are injected here, so what is judged is the ASSEMBLY — which layers are kept,
 * which facts make a device not ready, which only degrade it. The wiring to the real stores
 * is judged on the shipped bundle (`e2e/61`).
 */
import { describe, expect, it } from "vitest";

import type {
    LayerSyncReport,
    PreflightReport,
    TilePreparationTrace,
} from "../../../src/contracts/sync.contract.js";

const { buildPreflight } = await import("../../../src/capabilities/offline/report/preflight.js");

const layer = (layerId: string, status: LayerSyncReport["status"]): LayerSyncReport => ({
    layerId,
    status,
    featureCount: 0,
    pendingCount: 0,
    quarantinedCount: 0,
    lastPullAt: null,
});

const TRACE: TilePreparationTrace = { zone: null, skippedZooms: [], capped: false };

/** Facts of a device that can leave: everything pulled, persistent, nothing owed. */
function facts(overrides: Record<string, unknown> = {}) {
    return {
        persisted: async () => true,
        stats: async () => ({ used: 10, quota: 100, percentage: 10 }),
        syncReport: async () => [layer("sites", "pulled"), layer("fond", "notDeclared")],
        syncStatus: async () => ({ online: true, owed: 0, quarantined: 0, lastSyncAt: null }),
        manifest: async () => ({
            cachedAt: 1_700_000_000_000,
            failedResources: [],
            preparation: TRACE,
        }),
        ...overrides,
    };
}

describe("what the check reads", () => {
    it("reports every fact, and only the layers that declare something to pull", async () => {
        const r: PreflightReport = await buildPreflight(facts());
        expect(r.persistence).toBe("persistent");
        expect(r.quota).toEqual({ used: 10, quota: 100, percentage: 10 });
        expect(r.layers.map((l) => l.layerId)).toEqual(["sites"]);
        expect(r.queue.owed).toBe(0);
        expect(r.preparation).toEqual({
            cachedAt: 1_700_000_000_000,
            failedResources: 0,
            tiles: TRACE,
        });
        expect(r.verdict).toBe("ready");
    });

    it("the persistence regime, read — never assumed", async () => {
        expect((await buildPreflight(facts({ persisted: async () => false }))).persistence).toBe(
            "bestEffort"
        );
        expect((await buildPreflight(facts({ persisted: null }))).persistence).toBe("unsupported");
    });

    it("a device never prepared has no preparation to report", async () => {
        expect(
            (await buildPreflight(facts({ manifest: async () => null }))).preparation
        ).toBeNull();
    });
});

describe("what the facts mean together", () => {
    it.each([
        [
            "a layer declared and never pulled",
            { syncReport: async () => [layer("sites", "declaredNeverPulled")] },
        ],
        ["a pull that failed", { syncReport: async () => [layer("sites", "pullFailed")] }],
    ])("not ready: %s", async (_what, o) => {
        expect((await buildPreflight(facts(o))).verdict).toBe("notReady");
    });

    it.each([
        ["an unfinished pull", { syncReport: async () => [layer("sites", "pulledPartial")] }],
        ["a stale pull", { syncReport: async () => [layer("sites", "pulledStale")] }],
        [
            "entries set aside",
            {
                syncStatus: async () => ({
                    online: true,
                    owed: 0,
                    quarantined: 2,
                    lastSyncAt: null,
                }),
            },
        ],
        ["a best-effort origin — the browser may evict", { persisted: async () => false }],
        [
            "zooms left out",
            {
                manifest: async () => ({
                    preparation: { ...TRACE, skippedZooms: [{ source: "f", zoom: 16, tiles: 9 }] },
                }),
            },
        ],
        [
            "resources that failed to download",
            { manifest: async () => ({ failedResources: ["u"], preparation: TRACE }) },
        ],
    ])("degraded: %s", async (_what, o) => {
        expect((await buildPreflight(facts(o))).verdict).toBe("degraded");
    });

    it("never throws: a fact that cannot be read is reported absent", async () => {
        const broken = async () => {
            throw new Error("base fermée");
        };
        const r = await buildPreflight(facts({ stats: broken, manifest: broken }));
        expect(r.quota).toBeNull();
        expect(r.preparation).toBeNull();
    });
});
