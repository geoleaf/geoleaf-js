/**
 * WHEN the outbox is drained — the half of the write cycle that lived in a plugin.
 *
 * 🛑 **THIS FILE IMPORTS NO PLUGIN, AND THAT IS THE ASSERTION.** Until R7 the repo's only
 * automatic drain trigger was `@geoleaf-plugins/editor`'s own `online` listener: an
 * application without that plugin never emptied its queue, and the plugin being lazily
 * loaded, a session reopened with captures owed drained only once the editor came back.
 * Everything below runs against the core alone.
 *
 * The engine is stubbed rather than mounted on `fake-indexeddb`: what is under test is the
 * DECISION to drain — its gates, its timer, its listeners — not what a drain does once it
 * has been decided. `outbox.list` being called is the proxy for "a pass ran", because it is
 * the first thing `pushOutbox` does after the pre-drain steps.
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach } from "vitest";

// ⚠️ The modules under test are loaded DYNAMICALLY: their types are unknown at write time.
// `any` is the honest form here — pretending to type an import whose evaluation ORDER is the
// test's subject would give false assurance. Same arbitration as `routes-store.test.ts`.

describe("4.5 — les déclencheurs du drain", () => {
    let StorageContract: any;
    let armOutboxDrain: any;
    let disarmOutboxDrain: any;
    let requestDrain: any;

    let listCalls: number;
    let dueCalls: number;
    let dueValue: number;
    /** Entries the drain will walk past — their retry delay has not elapsed. */
    let deferredValue: number;
    let timers: { fn: () => void; ms: number }[];
    let now: number;

    /** Lets every queued microtask settle — `armOutboxDrain` fires its first pass void. */
    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

    function mountEngine() {
        const outbox = {
            list: async () => {
                listCalls += 1;
                // Replayable entries whose delay has NOT elapsed: the drain walks past them
                // and reports them as `deferred`, which is what keeps the tick lit.
                // ⚠️ `Date.now()` AND NOT the injected clock: `_drainOnce` reads the real
                // one, and a first draft dated these entries on `now` (1,000,000 ms) — i.e.
                // in the distant past, so they were DUE, the drain attempted them, and the
                // test "a deferred entry keeps the tick lit" came out GREEN under the
                // mutation that drops `deferred` from the condition. It proved nothing.
                return Array.from({ length: deferredValue }, (_, i) => ({
                    id: `e${i}`,
                    state: "pending",
                    nextAttemptAt: Date.now() + 600_000,
                    layerId: "l",
                    localId: `loc${i}`,
                }));
            },
            countDue: async () => {
                dueCalls += 1;
                return dueValue;
            },
            updateState: async () => {},
            remove: async () => {},
        };
        const features = { put: async () => {}, get: async () => null, remove: async () => {} };
        StorageContract.init({
            get DB() {
                return { _ensureModule: (name: string) => (name === "Outbox" ? outbox : features) };
            },
            isAvailable: () => true,
        });
    }

    /** Injected timers: the tick is fired by hand, never by the clock. */
    function deps(extra = {}) {
        return {
            now: () => now,
            setInterval: (fn: () => void, ms: number) => {
                const handle = { fn, ms };
                timers.push(handle);
                return handle;
            },
            clearInterval: (handle: unknown) => {
                timers = timers.filter((t) => t !== handle);
            },
            ...extra,
        };
    }

    const fireTick = async () => {
        for (const t of [...timers]) t.fn();
        await settle();
    };

    const setVisibility = (state: string) => {
        Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
    };

    beforeAll(async () => {
        ({ StorageContract } = await import("../../../src/kernel/shared/storage-contract.js"));
        ({ armOutboxDrain, disarmOutboxDrain, requestDrain } =
            await import("../../../src/capabilities/offline/write/outbox-drain-triggers.js"));
    });

    beforeEach(() => {
        listCalls = 0;
        dueCalls = 0;
        dueValue = 1;
        deferredValue = 0;
        timers = [];
        now = 1_000_000;
        Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
        setVisibility("visible");
        mountEngine();
    });

    afterEach(() => {
        disarmOutboxDrain();
    });

    // ── T1 — the whole point of the lot ─────────────────────────────────────────────
    test("🛑 un retour de réseau draine — SANS qu'aucun plugin ne soit chargé", async () => {
        armOutboxDrain(deps());
        await settle();
        // The arming IS the "storage ready" trigger — one gesture, not two: it empties a
        // queue left by a previous session without waiting for a network transition that
        // may never come, the device having been online all along.
        expect(listCalls).toBe(1);

        window.dispatchEvent(new Event("online"));
        await settle();

        expect(listCalls).toBe(2);
    });

    // ── T2 — idempotence ────────────────────────────────────────────────────────────
    test("armer deux fois ne pose ni deux écouteurs ni deux minuteurs", async () => {
        armOutboxDrain(deps());
        armOutboxDrain(deps());
        await settle();
        expect(timers).toHaveLength(1);

        const before = listCalls;
        window.dispatchEvent(new Event("online"));
        await settle();

        expect(listCalls).toBe(before + 1);
    });

    // ── T3 — the teardown a lifecycle owes ──────────────────────────────────────────
    test("désarmer relâche l'écouteur ET le minuteur", async () => {
        armOutboxDrain(deps());
        await settle();
        disarmOutboxDrain();
        const before = listCalls;

        window.dispatchEvent(new Event("online"));
        await settle();

        expect(listCalls).toBe(before);
        expect(timers).toHaveLength(0);
    });

    // ── T4 — the gate that keeps a phone asleep ─────────────────────────────────────
    //
    // 🛑 THIS CASE ASSERTED THAT THE TICK CONSULTED `countDue`, AND THE PROPERTY IT SHOULD
    // ASSERT IS STRONGER: on an idle application the tick costs ZERO I/O. Reading the
    // database once a minute, for the life of every tab, to learn each time that there is
    // nothing to do, is what a background timer must NOT do on a field device.
    test("🛑 file vide : le tic ne touche même pas la base — zéro E/S", async () => {
        dueValue = 0;
        armOutboxDrain(deps());
        await settle();
        const beforeDue = dueCalls;
        const beforeList = listCalls;

        await fireTick();
        await fireTick();

        expect(dueCalls).toBe(beforeDue);
        expect(listCalls).toBe(beforeList);
    });

    test("une mise en file RALLUME le tic — sans lecture, sur l'événement du core", async () => {
        dueValue = 0;
        armOutboxDrain(deps());
        await settle();
        const beforeDue = dueCalls;

        document.dispatchEvent(new CustomEvent("geoleaf:offline:outbox-queued"));
        await fireTick();

        // Re-lit, it consults — and does not drain, since nothing is due.
        expect(dueCalls).toBe(beforeDue + 1);
        expect(listCalls).toBe(1);
    });

    test("un tic AVEC une entrée due draine", async () => {
        dueValue = 2;
        armOutboxDrain(deps());
        await settle();
        const before = listCalls;

        document.dispatchEvent(new CustomEvent("geoleaf:offline:outbox-queued"));
        await fireTick();

        expect(listCalls).toBe(before + 1);
    });

    test("🛑 une entrée DIFFÉRÉE garde le tic allumé — c'est lui qui reviendra pour elle", async () => {
        // A drain that WALKED PAST deferred entries has not emptied the queue: turning the
        // tick off here would condemn them to wait for a network transition.
        dueValue = 0;
        deferredValue = 1;
        armOutboxDrain(deps());
        await settle();
        // The arming drain must have SEEN the deferred entry — otherwise this test does
        // not exercise what it claims.
        expect(listCalls).toBe(1);
        const beforeDue = dueCalls;

        await fireTick();

        expect(dueCalls).toBe(beforeDue + 1);
    });

    // ── T5 — cheapest gate first ────────────────────────────────────────────────────
    test("hors réseau, le tic ne touche même pas IndexedDB", async () => {
        armOutboxDrain(deps());
        await settle();
        Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
        const beforeDue = dueCalls;
        const beforeList = listCalls;

        await fireTick();

        // The order of the gates is the whole economy of a background timer on a field
        // device: no network means no reason to open a transaction at all.
        expect(dueCalls).toBe(beforeDue);
        expect(listCalls).toBe(beforeList);
    });

    // ── T6 — hidden STOPS the timer, it does not skip the work ──────────────────────
    test("🛑 onglet caché : le minuteur est ARRÊTÉ, pas seulement sauté", async () => {
        armOutboxDrain(deps());
        await settle();
        expect(timers).toHaveLength(1);

        setVisibility("hidden");
        await settle();
        expect(timers).toHaveLength(0);

        now += 60_000;
        setVisibility("visible");
        await settle();
        expect(timers).toHaveLength(1);
    });

    // ── T7 — two triggers, one drain ────────────────────────────────────────────────
    test("`online` et un réveil d'onglet dans la même seconde ne drainent qu'une fois", async () => {
        armOutboxDrain(deps());
        await settle();
        const before = listCalls;

        window.dispatchEvent(new Event("online"));
        setVisibility("visible");
        await settle();

        expect(listCalls).toBe(before + 1);
    });

    test("passé le plancher, un réveil d'onglet draine bien", async () => {
        armOutboxDrain(deps());
        await settle();
        const before = listCalls;

        now += 30_000;
        setVisibility("visible");
        await settle();

        expect(listCalls).toBe(before + 1);
    });

    // ── T8 — the period is derived, so it is pinned ─────────────────────────────────
    test("la période par défaut vaut 60 s — dérivée de l'échelle de recul du drain", async () => {
        armOutboxDrain({ now: deps().now, setInterval: deps().setInterval });
        await settle();
        expect(timers[0]!.ms).toBe(60_000);
    });

    test("`pollIntervalMs: 0` désactive le tic sans toucher aux autres déclencheurs", async () => {
        armOutboxDrain(deps({ pollIntervalMs: 0 }));
        await settle();
        expect(timers).toHaveLength(0);

        const before = listCalls;
        window.dispatchEvent(new Event("online"));
        await settle();
        expect(listCalls).toBe(before + 1);
    });

    // ── The extra pass a mid-drain write earns ──────────────────────────────────────
    test("une demande arrivée PENDANT un drain en obtient un second", async () => {
        armOutboxDrain(deps({ pollIntervalMs: 0 }));
        await settle();
        const before = listCalls;

        // Both are asked for before either settles: the running pass read the queue before
        // the second request existed, so without the replay the write would wait a tick.
        await Promise.all([requestDrain("write"), requestDrain("write")]);

        expect(listCalls).toBe(before + 2);
    });
});
