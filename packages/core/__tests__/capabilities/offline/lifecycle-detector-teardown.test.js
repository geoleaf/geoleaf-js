/**
 * Unit tests — the offline teardown must release the connectivity listeners (CAPACITÉS B.21).
 *
 * `OfflineDetector.init` attaches two `window` listeners (`online` / `offline`,
 * `offline-detector.ts:230-248`). `OfflineLifecycle._reset()` — the capability's
 * `sharedTeardown` (`install.ts:83`) — only re-armed the storage-ready deferred and
 * left them attached, delegating them IN A COMMENT to `Storage.close()`.
 *
 * ⚠️ This is NOT a cumulative leak, and nothing here pretends it is: `init()` tears the
 * previous instance down before re-attaching (`offline-detector.ts:145-148`), so a
 * re-boot does not stack listeners. The defect is the other direction — a teardown
 * WITHOUT a re-init never releases them, because `Storage.close()`, the delegate named
 * in that comment, has ZERO production callers in `core/src`:
 *
 *     $ grep -rn "Storage.close" packages/core/src
 *     packages/core/src/capabilities/offline/lifecycle.ts:125:  … owned by `Storage.close()` …
 *
 * i.e. the only hit is the comment doing the delegating. After a teardown the badge
 * therefore kept reacting to connectivity changes on a torn-down capability.
 */

describe("OfflineLifecycle._reset — connectivity listeners", () => {
    let OfflineLifecycle;
    let OfflineDetector;

    beforeAll(async () => {
        OfflineLifecycle = (await import("../../../src/capabilities/offline/lifecycle.ts"))
            .OfflineLifecycle;
        OfflineDetector = (await import("../../../src/kernel/storage/offline-detector.ts"))
            .OfflineDetector;
    });

    afterEach(() => {
        OfflineDetector.destroy();
        OfflineLifecycle._reset();
    });

    /** Counts `document` events emitted by the detector's window handlers. */
    function watchConnectivityEvents() {
        const seen = [];
        const onOffline = () => seen.push("offline");
        const onOnline = () => seen.push("online");
        document.addEventListener("geoleaf:offline", onOffline);
        document.addEventListener("geoleaf:online", onOnline);
        return {
            seen,
            stop() {
                document.removeEventListener("geoleaf:offline", onOffline);
                document.removeEventListener("geoleaf:online", onOnline);
            },
        };
    }

    test("the detector is live after init — the baseline this test rests on", () => {
        OfflineLifecycle.init(
            { storage: undefined, offlineDetector: OfflineDetector },
            { enabled: false, pwaEnabled: false, offlineDetectorEnabled: true }
        );

        const watcher = watchConnectivityEvents();
        try {
            window.dispatchEvent(new Event("offline"));
            expect(watcher.seen).toEqual(["offline"]);
        } finally {
            watcher.stop();
        }
    });

    test("_reset releases them: a later connectivity event is no longer handled", () => {
        OfflineLifecycle.init(
            { storage: undefined, offlineDetector: OfflineDetector },
            { enabled: false, pwaEnabled: false, offlineDetectorEnabled: true }
        );

        OfflineLifecycle._reset();

        const watcher = watchConnectivityEvents();
        try {
            window.dispatchEvent(new Event("offline"));
            window.dispatchEvent(new Event("online"));
            expect(watcher.seen).toEqual([]);
        } finally {
            watcher.stop();
        }
    });

    test("_reset calls destroy() on the detector it was handed", () => {
        const detector = { init: vi.fn(), destroy: vi.fn() };

        OfflineLifecycle.init(
            { storage: undefined, offlineDetector: detector },
            { enabled: false, pwaEnabled: false, offlineDetectorEnabled: true }
        );
        expect(detector.init).toHaveBeenCalledTimes(1);

        OfflineLifecycle._reset();
        expect(detector.destroy).toHaveBeenCalledTimes(1);
    });

    test("engine mode too: the detector is started by the façade, torn down here", () => {
        const detector = { init: vi.fn(), destroy: vi.fn() };
        // Engine branch: init() returns early after wiring the fire-and-forget chain and
        // never touches the detector — the façade starts it via enableOfflineDetector.
        // The handle must still be remembered, or teardown has nothing to release.
        OfflineLifecycle.init(
            { storage: { init: vi.fn().mockResolvedValue(true) }, offlineDetector: detector },
            { enabled: true, pwaEnabled: true, offlineDetectorEnabled: true }
        );

        OfflineLifecycle._reset();
        expect(detector.destroy).toHaveBeenCalledTimes(1);
    });

    test("_reset is safe with no detector, and does not destroy twice", () => {
        const detector = { init: vi.fn(), destroy: vi.fn() };

        OfflineLifecycle.init(
            { storage: undefined, offlineDetector: detector },
            { enabled: false, pwaEnabled: false, offlineDetectorEnabled: true }
        );

        OfflineLifecycle._reset();
        OfflineLifecycle._reset();

        expect(detector.destroy).toHaveBeenCalledTimes(1);
        expect(() => OfflineLifecycle._reset()).not.toThrow();
    });

    test("a detector without destroy() (older shape) does not break teardown", () => {
        const detector = { init: vi.fn() };

        OfflineLifecycle.init(
            { storage: undefined, offlineDetector: detector },
            { enabled: false, pwaEnabled: false, offlineDetectorEnabled: true }
        );

        expect(() => OfflineLifecycle._reset()).not.toThrow();
    });
});
