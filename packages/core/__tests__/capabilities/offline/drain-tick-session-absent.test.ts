/**
 * The periodic tick after a pass that stopped for want of a session.
 *
 * A layer declaring `write.auth: "bearer"` holds its captures while no session is open: the
 * pass stops BEFORE its first request, so it reports `attempted: 0` and `deferred: 0` — the
 * very figures the tick reads as "the queue holds nothing replayable". The contract says the
 * triggers keep running under that halt, and a session reader registered by a host announces
 * no event when the session opens: the tick is what comes back for the capture.
 *
 * `pushOutbox` is replaced, on purpose: what is under test is what the TRIGGERS do with a
 * report, and building a real halt would need a profile, a layer and a session reader to say
 * what one object says here. The halt itself is pinned by `write-auth-drain.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const pass = vi.hoisted(() => ({ report: {} as Record<string, unknown>, calls: 0 }));

vi.mock("../../../src/capabilities/offline/write/push-engine.js", () => ({
    pushOutbox: vi.fn(async () => {
        pass.calls += 1;
        return pass.report;
    }),
}));

const { StorageContract } = await import("../../../src/kernel/shared/storage-contract.js");
const { armOutboxDrain, disarmOutboxDrain } =
    await import("../../../src/capabilities/offline/write/outbox-drain-triggers.js");

describe("le tic après une passe arrêtée faute de session", () => {
    let timers: (() => void)[];
    let dueCalls: number;

    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    const fireTick = async () => {
        for (const fn of [...timers]) fn();
        await settle();
    };
    const report = (heldForSession: number) => ({
        attempted: 0,
        pushed: 0,
        failed: 0,
        deferred: 0,
        conflicts: 0,
        haltedBy: null,
        heldForSession,
    });

    beforeEach(() => {
        timers = [];
        dueCalls = 0;
        pass.calls = 0;
        Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
        const outbox = {
            countDue: async () => {
                dueCalls += 1;
                return 1;
            },
        };
        StorageContract.init({
            get DB() {
                return { _ensureModule: () => outbox };
            },
            isAvailable: () => true,
        });
    });

    afterEach(() => {
        disarmOutboxDrain();
    });

    const arm = () =>
        armOutboxDrain({
            now: () => 1_000_000,
            setInterval: (fn: () => void) => timers.push(fn),
            clearInterval: () => {
                timers = [];
            },
        });

    test("🛑 la saisie retenue est encore due : le tic relit la file et relance une passe", async () => {
        pass.report = report(1);
        arm();
        await settle();
        expect(pass.calls).toBe(1);

        await fireTick();

        expect(dueCalls).toBe(1);
        expect(pass.calls).toBe(2);
    });

    // The witness of the gate the case above must not have removed: a pass that touched
    // nothing and stopped on nothing still puts the tick to sleep.
    test("une passe qui n'a rien trouvé endort toujours le tic", async () => {
        pass.report = report(0);
        arm();
        await settle();

        await fireTick();

        expect(dueCalls).toBe(0);
        expect(pass.calls).toBe(1);
    });
});
