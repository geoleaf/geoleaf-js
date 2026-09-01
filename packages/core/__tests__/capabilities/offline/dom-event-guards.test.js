/**
 * Unit tests — offline engine must not require a `document` to emit its DOM events.
 *
 * `cache/storage.ts:clearCache` already guards its `document.dispatchEvent` with
 * `typeof document !== "undefined"`. Three sibling emitters did not:
 * `cache/downloader.ts` (completion event) and `cache/progress-tracker.ts`
 * (progress event, both the throttled and the forced emitter). In a DOM-less host
 * — a Web Worker, a Node-side prerender, the Service Worker context that shares
 * this engine's modules — the unguarded ones threw and took the whole download
 * down with them, while the guarded one degraded silently.
 *
 * The guard here is exactly the one `storage.ts` uses: EXISTENCE of `document`,
 * nothing else (no `dispatchEvent` capability probe, no try/catch swallow).
 */

import { ProgressTracker } from "../../../src/capabilities/offline/cache/progress-tracker.js";
import { Downloader } from "../../../src/capabilities/offline/cache/downloader.js";

describe("offline engine — DOM event emission is guarded on `document`", () => {
    let CacheStorage;
    let realDocument;

    beforeAll(async () => {
        // Loaded via `import`: the Vite alias serves the IndexedDB mock,
        // completed to cover what `storage.ts` expects of it (see
        // `__tests__/__mocks__/indexeddb.js`).
        ({ CacheStorage } = await import("../../../src/capabilities/offline/cache/storage.js"));
        realDocument = globalThis.document;
    });

    /** Runs `fn` with no `document` at all — the DOM-less host case. */
    async function withoutDocument(fn) {
        // `delete` (not `= undefined`) so `typeof document` is genuinely "undefined"
        // whichever way the property was installed by the environment.
        delete globalThis.document;
        try {
            return await fn();
        } finally {
            globalThis.document = realDocument;
        }
    }

    beforeEach(() => {
        ProgressTracker.reset();
    });

    test("the reference guard: CacheStorage.clearCache survives a missing document", async () => {
        await withoutDocument(async () => {
            // Reaches the emission site: clearProfile + deleteManifest both resolve
            // against the mocked IndexedDB, then the event would be dispatched.
            await expect(CacheStorage.clearCache("tourism")).resolves.toEqual(expect.any(Number));
        });
    });

    test("ProgressTracker.emitProgress does not throw without a document", async () => {
        await withoutDocument(() => {
            ProgressTracker.init({ total: 4 });
            expect(() => ProgressTracker.emitProgress()).not.toThrow();
        });
    });

    test("ProgressTracker.recordSuccess does not throw without a document", async () => {
        await withoutDocument(() => {
            // total === completed → `_emitProgressIfNeeded` always emits.
            ProgressTracker.init({ total: 1 });
            expect(() =>
                ProgressTracker.recordSuccess({ url: "https://x.test/a.json", size: 10 })
            ).not.toThrow();
        });
    });

    test("ProgressTracker.recordFailure does not throw without a document", async () => {
        await withoutDocument(() => {
            ProgressTracker.init({ total: 1 });
            expect(() =>
                ProgressTracker.recordFailure({ url: "https://x.test/a.json" }, "boom")
            ).not.toThrow();
        });
    });

    test("Downloader.cacheProfile emits its completion event without a document", async () => {
        await withoutDocument(async () => {
            Downloader.init({ enableProfileCache: true });
            const summary = await Downloader.cacheProfile("tourism", {}, []);
            expect(summary).toMatchObject({ profileId: "tourism", successful: 0, failed: 0 });
        });
    });

    test("with a document present the events are still dispatched", () => {
        const seen = [];
        const onProgress = (e) => seen.push(e.type);
        document.addEventListener("geoleaf:cache:progress", onProgress);
        try {
            ProgressTracker.init({ total: 2 });
            ProgressTracker.emitProgress();
        } finally {
            document.removeEventListener("geoleaf:cache:progress", onProgress);
        }
        expect(seen).toEqual(["geoleaf:cache:progress"]);
    });
});
