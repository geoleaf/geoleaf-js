/**
 * Tests of the Service Worker registration module (sw-register.ts).
 * Mocks navigator.serviceWorker and Log.
 */
"use strict";

vi.mock("../../src/utils/log/index.js", () => ({
    Log: {
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
    },
}));
import { Log } from "../../src/utils/log/index.js";

const mockRegister = vi.fn();
const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockUnregister = vi.fn().mockResolvedValue(true);

function createRegistration() {
    return {
        scope: "/",
        addEventListener: vi.fn(),
        update: mockUpdate,
        unregister: mockUnregister,
        installing: null,
        waiting: null,
        active: null,
    };
}

describe("sw-register (R4)", () => {
    let registration;
    let SWRegister;

    // LOAD-BEARING deferral: the hook installs `navigator.serviceWorker`
    // before loading. Inert target or not, the sequence is intended —
    // `await import()` preserves it.
    beforeAll(async () => {
        if (!global.navigator) global.navigator = {};
        global.navigator.serviceWorker = {
            register: mockRegister,
            // ⚠️ ADDED with the eviction bridge, and the lack was a HARNESS
            // hole, not a code one: `ServiceWorkerContainer` is an
            // `EventTarget` in every real browser. The mock carried none of
            // it, so `register()` threw as soon as the eviction bridge was
            // set on it. A mock poorer than the platform fails correct code.
            addEventListener: vi.fn(),
        };
        ({ SWRegister } = await import("../../src/kernel/storage/sw-register.js"));
    });

    beforeEach(() => {
        vi.clearAllMocks();
        SWRegister._registration = null;
        registration = createRegistration();
        mockRegister.mockResolvedValue(registration);
    });

    describe("register", () => {
        it("returns null if serviceWorker not supported", async () => {
            const sw = global.navigator.serviceWorker;
            delete global.navigator.serviceWorker;
            const result = await SWRegister.register();
            expect(result).toBeNull();
            global.navigator.serviceWorker = sw;
        });

        it("enregistre le SW et mémorise la registration", async () => {
            const result = await SWRegister.register();
            expect(mockRegister).toHaveBeenCalledWith("sw-core.js", { scope: "/" });
            expect(result).toBe(registration);
            // ⚠️ Read on `_registration` and not through `getRegistration()`,
            // removed with `update()` and `unregister()` — three members with
            // zero production callers. What this test guards has not changed:
            // the registration is MEMOISED, which the `updatefound` listening
            // below depends on.
            expect(SWRegister._registration).toBe(registration);
        });

        it("utilise options.path et options.scope si fournis", async () => {
            await SWRegister.register({ path: "sw.js", scope: "/app/" });
            expect(mockRegister).toHaveBeenCalledWith("sw.js", { scope: "/app/" });
        });

        it("throw si l'enregistrement fails", async () => {
            mockRegister.mockRejectedValue(new Error("Failed"));
            await expect(SWRegister.register()).rejects.toThrow("Failed");
        });
    });

    // ⚠️ THE `update`, `unregister` AND `getRegistration` BLOCKS ARE REMOVED —
    // the three members had no production caller, and their tests would thus
    // have OUTLIVED them.
    //
    // 🛑 What makes the removal safe and not optimistic: real unregistration
    // did not go through `unregister()`. `capabilities/pwa/lifecycle.ts`
    // (`_unregisterAll`) iterates
    // `navigator.serviceWorker.getRegistrations()` and unregisters
    // everything, never reading `_registration` — two unregistration paths,
    // only one running, and the one that stays depended in nothing on the one
    // that leaves. Its tests live in
    // `__tests__/capabilities/pwa-offline-installers.test.js`.

    describe("updatefound listener", () => {
        it("ne plante pas quand installing est null", async () => {
            registration.installing = null;
            let updatefoundCb;
            registration.addEventListener = vi.fn((event, cb) => {
                if (event === "updatefound") updatefoundCb = cb;
            });
            mockRegister.mockResolvedValue(registration);
            await SWRegister.register();
            expect(updatefoundCb).toBeDefined();
            expect(() => updatefoundCb()).not.toThrow();
        });

        it("ne log pas quand newWorker.state n'est pas activated", async () => {
            const newWorker = { state: "installing", addEventListener: vi.fn() };
            registration.installing = newWorker;
            let updatefoundCb;
            registration.addEventListener = vi.fn((event, cb) => {
                if (event === "updatefound") updatefoundCb = cb;
            });
            mockRegister.mockResolvedValue(registration);
            await SWRegister.register();
            updatefoundCb();
            const stateChangeCb = newWorker.addEventListener.mock.calls[0]?.[1];
            if (stateChangeCb) stateChangeCb();
            expect(Log.info).not.toHaveBeenCalledWith(expect.stringContaining("activated"));
        });

        it("log info quand newWorker.state est activated", async () => {
            const newWorker = { state: "activated", addEventListener: vi.fn() };
            registration.installing = newWorker;
            let updatefoundCb;
            registration.addEventListener = vi.fn((event, cb) => {
                if (event === "updatefound") updatefoundCb = cb;
            });
            mockRegister.mockResolvedValue(registration);
            await SWRegister.register();
            updatefoundCb();
            const stateChangeCb = newWorker.addEventListener.mock.calls[0]?.[1];
            if (stateChangeCb) stateChangeCb();
            expect(Log.info).toHaveBeenCalledWith(expect.stringContaining("activated"));
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// The eviction BRIDGE: what the worker cannot say itself
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// 🛑 WHAT THIS BRIDGE CARRIES. A Service Worker has no `document`: it cannot
// dispatch `geoleaf:cache:evicted`. Nor can it import the bus — it is copied
// as-is into each deployment variant, unbundled. Without this bridge, an
// eviction under origin-quota pressure — the precise moment the user needs
// to know space is short — stays in the console of a worker nobody opens.
//
// ⚠️ `_evictionBridgeWired` is a MODULE flag: each case remounts a fresh module.

describe("1.4 — pont d'éviction du Service Worker", () => {
    /** Mounts a fresh module and returns the message handler actually set. */
    async function mountBridge() {
        vi.resetModules();
        const listeners = [];
        const registration = createRegistration();
        global.navigator.serviceWorker = {
            register: vi.fn().mockResolvedValue(registration),
            addEventListener: (type, cb) => listeners.push({ type, cb }),
        };
        const dispatched = [];
        const target = globalThis.document;
        const spy = vi.spyOn(target, "dispatchEvent").mockImplementation((evt) => {
            dispatched.push({ type: evt.type, detail: evt.detail });
            return true;
        });
        const { SWRegister: SW } = await import("../../src/kernel/storage/sw-register.js");
        await SW.register();
        const onMessage = listeners.find((l) => l.type === "message")?.cb;
        return { onMessage, dispatched, spy, SW };
    }

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("un message d'éviction du worker devient `geoleaf:cache:evicted` sur `document`", async () => {
        const { onMessage, dispatched } = await mountBridge();
        expect(onMessage).toBeTypeOf("function"); // witness: the bridge is indeed set

        onMessage({
            data: {
                type: "GEOLEAF_CACHE_EVICTED",
                detail: {
                    evicted: 200,
                    totalBefore: 600,
                    totalAfter: 400,
                    store: "cache-api",
                    reason: "pressure",
                },
            },
        });

        expect(dispatched).toHaveLength(1);
        expect(dispatched[0].type).toBe("geoleaf:cache:evicted");
        expect(dispatched[0].detail).toMatchObject({ evicted: 200, reason: "pressure" });
    });

    it("un message d'un AUTRE type ne devient rien", async () => {
        // ⚠️ `navigator.serviceWorker` receives messages from every worker in
        // scope: re-dispatching without discriminating would turn any message
        // into an eviction signal.
        const { onMessage, dispatched } = await mountBridge();

        onMessage({ data: { type: "SOMETHING_ELSE", detail: { evicted: 5 } } });
        onMessage({ data: null });
        onMessage({});

        expect(dispatched).toHaveLength(0);
    });

    it("une éviction à ZÉRO entrée n'émet pas", async () => {
        // An empty signal teaches its listeners to distrust the signal.
        const { onMessage, dispatched } = await mountBridge();

        onMessage({ data: { type: "GEOLEAF_CACHE_EVICTED", detail: { evicted: 0 } } });

        expect(dispatched).toHaveLength(0);
    });

    it("le pont n'est posé QU'UNE fois, même si `register()` est rappelé", async () => {
        // Two listeners would make two notices for one eviction.
        vi.resetModules();
        const listeners = [];
        global.navigator.serviceWorker = {
            register: vi.fn().mockResolvedValue(createRegistration()),
            addEventListener: (type, cb) => listeners.push({ type, cb }),
        };
        const { SWRegister: SW } = await import("../../src/kernel/storage/sw-register.js");
        await SW.register();
        await SW.register();
        await SW.register();

        expect(listeners.filter((l) => l.type === "message")).toHaveLength(1);
    });
});
