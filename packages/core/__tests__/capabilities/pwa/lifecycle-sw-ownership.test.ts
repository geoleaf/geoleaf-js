/**
 * @file lifecycle-sw-ownership.test.ts
 * @description GeoLeaf unregisters ITS OWN service worker, never the host application's.
 *
 * Why this file exists
 * ------------------------------------------------------------------------------------
 * 🛑 **A measured, blocking defect on a third-party host.** `_unregisterOwn` was
 * `_unregisterAll`: it iterated `navigator.serviceWorker.getRegistrations()` and unregistered
 * every entry, without ever looking at which script each one carried. The bundle is mounted
 * inside a third-party host web application **with the PWA capability disabled** — the branch
 * that calls it. So booting the map unregistered `/web/service-worker.js`, a worker GeoLeaf
 * never installed and does not own. The host silently lost its offline mode and its app
 * install, and nothing in either codebase said why.
 *
 * ⚠️ The repo already held half the fact: `kernel/storage/sw-register.ts` states that real
 * unregistration "iterates `getRegistrations()` … without ever reading `_registration`". It
 * was written as a note on a deletion's safety, never as a consequence for an embedder.
 *
 * What it locks
 * ------------------------------------------------------------------------------------
 * The selection predicate, on both call sites — `init()` with the gate closed, and `_reset()`.
 * A foreign registration must survive both. And the best-effort contract is part of the lock:
 * a rejected `getRegistrations()`, a missing API, must not throw into the boot.
 *
 * ⚠️ **This file is also the source guard of `GEOLEAF_SW_FILENAME`.** That literal is written
 * twice — here and in `SWRegister._swPath` — because `kernel/storage/index.ts` deliberately
 * exposes `SWRegister` alone (`CDC_kernel.md` §barils kernel). The fixture below is therefore
 * built FROM `SWRegister._swPath`, never from a hand-typed copy: if the kernel renames the
 * worker and the capability does not follow, these tests go red instead of silently matching
 * nothing. Which is why this file must NOT mock `src/kernel/storage/index.js`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { PwaLifecycle } from "../../../src/capabilities/pwa/lifecycle.ts";
import { SWRegister } from "../../../src/kernel/storage/index.ts";

/** The worker script GeoLeaf actually registers — read, never retyped. See the header. */
const OWN = SWRegister._swPath;

/** Drains the floating `getRegistrations().then().catch()` chain (3 hops, plus slack). */
const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
};

type Slot = "active" | "waiting" | "installing";
type FakeRegistration = { unregister: ReturnType<typeof vi.fn> };

/** A registration whose worker sits in `slot` and serves `scriptURL`. */
function registration(scriptURL: string, slot: Slot = "active"): FakeRegistration {
    return {
        active: null,
        waiting: null,
        installing: null,
        [slot]: { scriptURL },
        unregister: vi.fn(() => Promise.resolve(true)),
    } as unknown as FakeRegistration;
}

/** Installs a fake `navigator.serviceWorker`; `undefined` removes the API entirely. */
function setServiceWorker(sw: unknown): void {
    Object.defineProperty(navigator, "serviceWorker", { value: sw, configurable: true });
}

/** `getRegistrations()` resolving to `regs`. */
function container(regs: FakeRegistration[]): { getRegistrations: () => Promise<unknown[]> } {
    return { getRegistrations: vi.fn(() => Promise.resolve(regs)) };
}

describe("PwaLifecycle — unregisters GeoLeaf's own service worker, and only that one", () => {
    let original: PropertyDescriptor | undefined;

    beforeEach(() => {
        original = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
        vi.clearAllMocks();
    });

    afterEach(() => {
        if (original) Object.defineProperty(navigator, "serviceWorker", original);
        else setServiceWorker(undefined);
    });

    // ── The defect itself, on both call sites ─────────────────────────────────

    it("leaves the host's service worker alone when the gate is closed", async () => {
        const ours = registration(`https://host.example/app/${OWN}`);
        const theirs = registration("https://host.example/web/service-worker.js");
        setServiceWorker(container([ours, theirs]));

        PwaLifecycle.init({ enabled: false });
        await flush();

        expect(ours.unregister).toHaveBeenCalledOnce();
        expect(theirs.unregister).not.toHaveBeenCalled();
    });

    it("leaves the host's service worker alone on _reset()", async () => {
        const ours = registration(`https://host.example/app/${OWN}`);
        const theirs = registration("https://host.example/web/service-worker.js");
        setServiceWorker(container([ours, theirs]));

        PwaLifecycle._reset();
        await flush();

        expect(ours.unregister).toHaveBeenCalledOnce();
        expect(theirs.unregister).not.toHaveBeenCalled();
    });

    it("unregisters nothing when the origin carries only foreign workers", async () => {
        const theirs = registration("https://host.example/web/service-worker.js");
        setServiceWorker(container([theirs]));

        PwaLifecycle.init({ enabled: false });
        await flush();

        expect(theirs.unregister).not.toHaveBeenCalled();
    });

    // ── The predicate reads all three worker slots ────────────────────────────

    it.each(["active", "waiting", "installing"] as const)(
        "recognises its own worker while it sits in `%s`",
        async (slot) => {
            const ours = registration(`https://host.example/${OWN}`, slot);
            setServiceWorker(container([ours]));

            PwaLifecycle.init({ enabled: false });
            await flush();

            expect(ours.unregister).toHaveBeenCalledOnce();
        }
    );

    it("matches on the last path segment, not on a suffix", async () => {
        // A host worker whose filename merely ENDS WITH ours. `endsWith(OWN)` alone would
        // unregister it — the very class of defect this file exists to close.
        const lookalike = registration(`https://host.example/vendor-${OWN}`);
        setServiceWorker(container([lookalike]));

        PwaLifecycle.init({ enabled: false });
        await flush();

        expect(lookalike.unregister).not.toHaveBeenCalled();
    });

    it("still matches when the script URL carries a query string", async () => {
        const ours = registration(`https://host.example/app/${OWN}?v=3`);
        setServiceWorker(container([ours]));

        PwaLifecycle.init({ enabled: false });
        await flush();

        expect(ours.unregister).toHaveBeenCalledOnce();
    });

    // ── Best-effort: nothing here may throw into the boot ─────────────────────

    it("does not throw when getRegistrations() rejects", async () => {
        setServiceWorker({
            getRegistrations: vi.fn(() => Promise.reject(new Error("SecurityError"))),
        });

        expect(() => PwaLifecycle.init({ enabled: false })).not.toThrow();
        expect(() => PwaLifecycle._reset()).not.toThrow();
        await flush();
    });

    it("does not throw when a registration exposes no worker at all", async () => {
        const empty = {
            active: null,
            waiting: null,
            installing: null,
            unregister: vi.fn(() => Promise.resolve(true)),
        } as unknown as FakeRegistration;
        setServiceWorker(container([empty]));

        expect(() => PwaLifecycle.init({ enabled: false })).not.toThrow();
        await flush();

        expect(empty.unregister).not.toHaveBeenCalled();
    });

    it("stays a no-op when the API is absent", async () => {
        setServiceWorker(undefined);

        expect(() => PwaLifecycle.init({ enabled: false })).not.toThrow();
        expect(() => PwaLifecycle._reset()).not.toThrow();
        await flush();
    });

    it("stays a no-op when getRegistrations is not callable", async () => {
        setServiceWorker({ getRegistrations: "nope" });

        expect(() => PwaLifecycle.init({ enabled: false })).not.toThrow();
        await flush();
    });
});
