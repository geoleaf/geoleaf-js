/**
 * Unit tests for plugin-storage — RetryHandler, CacheStorage (with mocked IndexedDB)
 * Sprint 4 — Tests Plugins & Coverage 50%
 */

import { RetryHandler } from "../../../src/capabilities/offline/cache/retry-handler.js";
import { Downloader as CacheDownloader } from "../../../src/capabilities/offline/cache/downloader.js";

describe("plugin-storage", () => {
    describe("RetryHandler", () => {
        afterEach(() => {
            vi.useRealTimers();
        });

        test("should succeed on first attempt", async () => {
            const op = vi.fn().mockResolvedValue(42);
            const p = RetryHandler.retry(op, { resourceName: "test" });
            await expect(p).resolves.toBe(42);
            expect(op).toHaveBeenCalledTimes(1);
        });

        test("should succeed on second attempt after delay", async () => {
            vi.useFakeTimers();
            const op = jest
                .fn()
                .mockRejectedValueOnce(new Error("fail"))
                .mockResolvedValueOnce("ok");
            const p = RetryHandler.retry(op, { resourceName: "test", maxRetries: 3 });
            await vi.runAllTimersAsync();
            await expect(p).resolves.toBe("ok");
            expect(op).toHaveBeenCalledTimes(2);
        });

        test("should throw after max retries exhausted", async () => {
            const op = vi.fn().mockRejectedValue(new Error("always fail"));
            const p = RetryHandler.retry(op, { resourceName: "x", maxRetries: 1 });
            await expect(p).rejects.toThrow("always fail");
            expect(op).toHaveBeenCalledTimes(1);
        });

        test("should abort immediately when signal is aborted", async () => {
            const op = vi.fn().mockRejectedValue(new Error("never"));
            const controller = new AbortController();
            controller.abort();
            const p = RetryHandler.retry(op, { signal: controller.signal, resourceName: "x" });
            await expect(p).rejects.toThrow("Aborted");
            // When aborted before first attempt, operation is not called
            expect(op).toHaveBeenCalledTimes(0);
        });

        test("getConfig should return config", () => {
            const config = RetryHandler.getConfig();
            // Canonical key since CAPACITÉS B.16 — the budget is a count of ATTEMPTS.
            // The deprecated `maxRetries` spelling is still accepted as an input and is
            // normalised away here (see retry-budget.test.js).
            expect(config).toHaveProperty("maxAttempts");
            expect(config).toHaveProperty("initialDelay");
            expect(config).toHaveProperty("backoffMultiplier");
        });

        // T23 — branch coverage additions (lines 47-48, 145-154)
        test("init() merges provided config and preserves unset defaults", () => {
            RetryHandler.init({ maxAttempts: 7, initialDelay: 500 });
            const cfg = RetryHandler.getConfig();
            expect(cfg.maxAttempts).toBe(7);
            expect(cfg.initialDelay).toBe(500);
            expect(cfg.maxDelay).toBe(5000); // default preserved
            // Restore defaults
            RetryHandler.init({
                maxAttempts: 3,
                initialDelay: 1000,
                maxDelay: 5000,
                backoffMultiplier: 2,
            });
        });

        test("_sleep rejects immediately when signal is already aborted (line 150-153)", async () => {
            const controller = new AbortController();
            controller.abort(); // already aborted
            await expect(RetryHandler._sleep(100, controller.signal)).rejects.toThrow("Aborted");
        });

        test("_sleep rejects when signal is aborted during sleep (line 155-156)", async () => {
            const controller = new AbortController();
            const p = RetryHandler._sleep(10000, controller.signal); // long sleep
            // Abort now — triggers the abortHandler listener (clearTimeout + reject)
            controller.abort();
            await expect(p).rejects.toThrow("Aborted");
        });

        test("retry with AbortError name is not retried", async () => {
            const abortErr = new Error("aborted");
            abortErr.name = "AbortError";
            const op = vi.fn().mockRejectedValue(abortErr);
            await expect(
                RetryHandler.retry(op, { maxRetries: 3, resourceName: "abort-named" })
            ).rejects.toThrow("aborted");
            expect(op).toHaveBeenCalledTimes(1); // no retry on AbortError
        });

        // T23 — default parameter branches (lines 46, 69-70) and ?? fallbacks (lines 102, 123-125)
        test("init() with no args uses default empty config (line 46 default branch)", () => {
            // Call init() without argument → takes the default `config = {}` branch
            RetryHandler.init();
            const cfg = RetryHandler.getConfig();
            expect(cfg.maxAttempts).toBe(3);
            // Restore
            RetryHandler.init({
                maxAttempts: 3,
                initialDelay: 1000,
                maxDelay: 5000,
                backoffMultiplier: 2,
            });
        });

        test("retry() with no options uses default {} (line 69/70 default branch)", async () => {
            // Call retry without 2nd arg → takes the default `options = {}` branch
            const op = vi.fn().mockResolvedValue("default-ok");
            const result = await RetryHandler.retry(op);
            expect(result).toBe("default-ok");
        });

        test("retry uses ?? fallback values in _calculateDelay when config is null (lines 123-125)", async () => {
            // Set config to all nulls so ?? fallbacks fire (initialDelay ?? 1000, etc.)
            RetryHandler.init({
                maxRetries: 2,
                initialDelay: null,
                maxDelay: null,
                backoffMultiplier: null,
            });
            vi.useFakeTimers();
            const op = jest
                .fn()
                .mockRejectedValueOnce(new Error("fail"))
                .mockResolvedValueOnce("recovered");
            const p = RetryHandler.retry(op, { maxRetries: 2 });
            await vi.runAllTimersAsync();
            await expect(p).resolves.toBe("recovered");
            expect(op).toHaveBeenCalledTimes(2);
            // Restore defaults
            RetryHandler.init({
                maxRetries: 3,
                initialDelay: 1000,
                maxDelay: 5000,
                backoffMultiplier: 2,
            });
        });

        test("retry logs message when error has no .message property (line 102 ?? fallback)", async () => {
            // Throw a non-Error object so err?.message is undefined → uses ?? error fallback
            const op = jest
                .fn()
                .mockRejectedValueOnce({ name: "CustomError" }) // no .message property
                .mockResolvedValueOnce("ok-after");
            vi.useFakeTimers();
            const p = RetryHandler.retry(op, { maxRetries: 2 });
            await vi.runAllTimersAsync();
            await expect(p).resolves.toBe("ok-after");
        });

        // ── B.35 (a) — abort-listener accumulation on a SHARED signal ──────────
        //
        // `{ once: true }` only auto-removes when the event FIRES. On the happy
        // path the timer resolves, the abort never comes, and the listener stays
        // on a signal that `downloader.ts` creates ONCE per profile and passes to
        // every `retry()` of every resource. Counting add/remove on the signal is
        // the only way to see it: nothing observable in the resolved value changes.
        function trackAbortListeners(signal) {
            const state = { live: 0, added: 0 };
            const add = signal.addEventListener.bind(signal);
            const remove = signal.removeEventListener.bind(signal);
            signal.addEventListener = (...args) => {
                state.live++;
                state.added++;
                return add(...args);
            };
            signal.removeEventListener = (...args) => {
                state.live--;
                return remove(...args);
            };
            return state;
        }

        test("_sleep releases its abort listener when the timer resolves normally", async () => {
            const controller = new AbortController();
            const tracked = trackAbortListeners(controller.signal);

            for (let i = 0; i < 5; i++) {
                await RetryHandler._sleep(0, controller.signal);
            }

            expect(tracked.added).toBe(5); // one per sleep, as expected
            expect(tracked.live).toBe(0); // …and none of them survives its sleep
        });

        test("retry() does not accumulate abort listeners across resources sharing one signal", async () => {
            // Mirrors `downloader._worker`: ONE AbortController for the whole
            // profile, one `retry()` per resource, each failing once then healing.
            RetryHandler.init({
                maxRetries: 3,
                initialDelay: 0,
                maxDelay: 0,
                backoffMultiplier: 1,
            });
            const controller = new AbortController();
            const tracked = trackAbortListeners(controller.signal);

            for (let i = 0; i < 4; i++) {
                const op = vi
                    .fn()
                    .mockRejectedValueOnce(new Error("flaky"))
                    .mockResolvedValueOnce("ok");
                await expect(
                    RetryHandler.retry(op, { signal: controller.signal, resourceName: `tile-${i}` })
                ).resolves.toBe("ok");
            }

            expect(tracked.added).toBe(4); // one sleep per resource
            expect(tracked.live).toBe(0); // the signal is clean afterwards

            RetryHandler.init({
                maxRetries: 3,
                initialDelay: 1000,
                maxDelay: 5000,
                backoffMultiplier: 2,
            });
        });
    }); // end RetryHandler

    describe("CacheStorage (with mocked IndexedDB)", () => {
        let CacheStorage;
        let clearMockStore;

        beforeAll(async () => {
            const idb = await import("../../__mocks__/indexeddb.js");
            clearMockStore = idb.clearMockStore;
            // B.10 soldé — chargé en `import`, l'alias Vite sert enfin le mock d'IndexedDB
            // (sous `require()`, tsx court-circuitait Vite et c'était le VRAI `core/indexeddb.ts`
            // de 591 lignes qui était chargé). Le mock a été complété pour couvrir ce que
            // `storage.ts` en attend — voir `__tests__/__mocks__/indexeddb.js`.
            ({ CacheStorage } = await import("../../../src/capabilities/offline/cache/storage.js"));
        });

        beforeEach(() => {
            clearMockStore();
        });

        test("loadLayerSelection returns null when key not set", async () => {
            if (!CacheStorage || typeof CacheStorage.loadLayerSelection !== "function") {
                return expect(CacheStorage).toBeDefined();
            }
            const result = await CacheStorage.loadLayerSelection("profile1");
            expect(result).toBeNull();
        });

        test("saveLayerSelection persists and loadLayerSelection returns it", async () => {
            if (!CacheStorage || typeof CacheStorage.saveLayerSelection !== "function") return;
            const selection = {
                layers: ["l1"],
                basemaps: ["osm"],
                layerStyles: {},
                timestamp: Date.now(),
            };
            await CacheStorage.saveLayerSelection("profile1", selection);
            const loaded = await CacheStorage.loadLayerSelection("profile1");
            expect(loaded).toEqual(selection);
        });

        test("saveManifest and getManifest cycle", async () => {
            if (!CacheStorage?.saveManifest || !CacheStorage?.getManifest) return;
            const results = {
                cached: ["https://example.com/layer.json"],
                failed: [],
                totalSize: 1024,
                resourcesCount: 1,
                duration: 100,
            };
            await CacheStorage.saveManifest("tourism", results);
            const manifest = await CacheStorage.getManifest("tourism");
            expect(manifest).toBeTruthy();
            expect(manifest.profileId).toBe("tourism");
            expect(manifest.resources).toHaveLength(1);
            expect(manifest.resources[0].url).toBe(results.cached[0]);
            expect(manifest.totalSize).toBe(results.totalSize);
            expect(manifest.resourcesCount).toBe(results.resourcesCount);
        });

        test("getManifest returns null when no manifest", async () => {
            if (!CacheStorage?.getManifest) return;
            const manifest = await CacheStorage.getManifest("nonexistent");
            expect(manifest).toBeNull();
        });

        test("clearCache removes data and dispatches geoleaf:cache:cleared", async () => {
            if (!CacheStorage?.clearCache || !CacheStorage?.saveLayerSelection) return;
            await CacheStorage.saveLayerSelection("p1", {
                layers: [],
                basemaps: [],
                timestamp: Date.now(),
            });
            let eventDetail;
            const handler = (e) => {
                eventDetail = e.detail;
            };
            document.addEventListener("geoleaf:cache:cleared", handler);
            const deleted = await CacheStorage.clearCache("p1");
            document.removeEventListener("geoleaf:cache:cleared", handler);
            expect(typeof deleted).toBe("number");
            expect(eventDetail).toEqual({ profileId: "p1", deleted: expect.any(Number) });
        });

        // ⚠️ Test retiré (clôture S3c) : `CacheStorage.getStorageQuota` n'existe plus —
        // troisième exemplaire d'un lecteur de quota sans appelant de production. ⚠️ Il portait
        // en outre un `if (!CacheStorage?.getStorageQuota) return;` : il se serait tu tout seul
        // à la suppression, sans jamais rougir. Une garde optionnelle sur son propre sujet ne
        // garde rien.
    });

    describe("CacheDownloader", () => {
        test("isDownloading returns false when no download in progress", () => {
            if (!CacheDownloader?.isDownloading) return;
            expect(CacheDownloader.isDownloading()).toBe(false);
        });

        test("cancelDownload does not throw when no download", () => {
            if (!CacheDownloader?.cancelDownload) return;
            expect(() => CacheDownloader.cancelDownload()).not.toThrow();
        });

        test("cacheProfile with empty resources returns summary", async () => {
            if (!CacheDownloader?.cacheProfile) return;
            const summary = await CacheDownloader.cacheProfile("test-profile", {}, [], {});
            expect(summary).toBeTruthy();
            expect(summary.profileId).toBe("test-profile");
            expect(summary).toHaveProperty("cached");
        });
    });
});
