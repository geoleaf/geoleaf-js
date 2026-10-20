/**
 * @file lifecycle-sw-holders.test.ts
 * @description A context without the PWA leaves GeoLeaf's worker alone while another context
 * of the same origin still relies on it.
 *
 * Why this file exists
 * ------------------------------------------------------------------------------------
 * GeoLeaf's worker is registered for the whole origin. Two configurations can live on one
 * origin — two pages of an integrator, a configuration handed over in memory — and only one of
 * them may enable the PWA. The context without it unregistered the worker at boot, and the
 * other one lost its offline mode: its next load without network found no worker.
 *
 * A context cannot tell, from one load to the next, whether it registered the worker itself.
 * So the contexts that enable the PWA write their holder id (the active profile) to
 * `localStorage`. A context without the PWA removes its own id, and unregisters only when no
 * holder remains — which keeps the single-profile case: a profile that turns the PWA off still
 * removes the worker it had.
 *
 * Companion of `lifecycle-sw-ownership.test.ts`, which locks WHICH registrations are ours; this
 * file locks WHEN they may go.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { PwaLifecycle } from "../../../src/capabilities/pwa/lifecycle.ts";

/**
 * Typed here, not imported: the key is documented to integrators (the configuration guide, the
 * `pwa` sheet), so a rename must turn this file red rather than follow silently.
 */
const PWA_HOLDERS_STORAGE_KEY = "gl-pwa-holders";
import { SWRegister } from "../../../src/kernel/storage/index.ts";

/** Drains the floating `getRegistrations().then().catch()` chain (3 hops, plus slack). */
const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
};

/** GeoLeaf's own registration, as `getRegistrations()` hands it back. */
function ownRegistration(): { unregister: ReturnType<typeof vi.fn> } {
    return {
        active: { scriptURL: `https://host.example/app/${SWRegister._swPath}` },
        waiting: null,
        installing: null,
        unregister: vi.fn(() => Promise.resolve(true)),
    } as unknown as { unregister: ReturnType<typeof vi.fn> };
}

function setServiceWorker(sw: unknown): void {
    Object.defineProperty(navigator, "serviceWorker", { value: sw, configurable: true });
}

describe("PwaLifecycle — the worker stays while another context holds it", () => {
    let original: PropertyDescriptor | undefined;
    let ours: { unregister: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        original = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
        localStorage.clear();
        ours = ownRegistration();
        setServiceWorker({
            getRegistrations: vi.fn(() => Promise.resolve([ours])),
            // `init` with the PWA on schedules a registration; it must not reach a real one.
            register: vi.fn(() => Promise.reject(new Error("not in tests"))),
        });
        // The registration itself is not this file's subject.
        vi.spyOn(SWRegister, "register").mockResolvedValue(null as never);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        PwaLifecycle._reset();
        localStorage.clear();
        vi.restoreAllMocks();
        if (original) Object.defineProperty(navigator, "serviceWorker", original);
        else setServiceWorker(undefined);
    });

    it("🔴 a context without the PWA leaves the worker another profile holds", async () => {
        PwaLifecycle.init({ enabled: true }, "field");
        PwaLifecycle.init({ enabled: false }, "office");
        await flush();

        expect(ours.unregister).not.toHaveBeenCalled();
    });

    it("the same profile turning the PWA off still removes its worker", async () => {
        PwaLifecycle.init({ enabled: true }, "field");
        PwaLifecycle.init({ enabled: false }, "field");
        await flush();

        expect(ours.unregister).toHaveBeenCalledOnce();
    });

    it("the last holder leaving removes the worker", async () => {
        PwaLifecycle.init({ enabled: true }, "field");
        PwaLifecycle.init({ enabled: true }, "survey");
        PwaLifecycle.init({ enabled: false }, "field");
        await flush();
        expect(ours.unregister).not.toHaveBeenCalled();

        PwaLifecycle.init({ enabled: false }, "survey");
        await flush();
        expect(ours.unregister).toHaveBeenCalledOnce();
    });

    it("a teardown is not a withdrawal: the holder stays, and so does the worker", async () => {
        PwaLifecycle.init({ enabled: true }, "field");
        PwaLifecycle._reset();
        await flush();

        expect(ours.unregister).not.toHaveBeenCalled();
        expect(JSON.parse(localStorage.getItem(PWA_HOLDERS_STORAGE_KEY) ?? "[]")).toEqual([
            "field",
        ]);
    });

    it("a context with no profile holds under a shared id", async () => {
        PwaLifecycle.init({ enabled: true }, null);
        PwaLifecycle.init({ enabled: false }, "office");
        await flush();
        expect(ours.unregister).not.toHaveBeenCalled();

        PwaLifecycle.init({ enabled: false }, null);
        await flush();
        expect(ours.unregister).toHaveBeenCalledOnce();
    });

    // ── An unreadable registry falls back to the former behaviour ─────────────

    it("a corrupt registry counts as empty: the worker goes", async () => {
        localStorage.setItem(PWA_HOLDERS_STORAGE_KEY, "{not json");
        PwaLifecycle.init({ enabled: false }, "office");
        await flush();

        expect(ours.unregister).toHaveBeenCalledOnce();
    });

    it("ignores entries that are not holder ids", async () => {
        localStorage.setItem(PWA_HOLDERS_STORAGE_KEY, JSON.stringify([42, "<script>", ""]));
        PwaLifecycle.init({ enabled: false }, "office");
        await flush();

        expect(ours.unregister).toHaveBeenCalledOnce();
    });

    it("storage that throws counts as empty, and nothing throws into the boot", async () => {
        // A stand-in, not a spy on `Storage.prototype`: jsdom's `localStorage` does not go
        // through the prototype, and the spy left the real store answering.
        const refuse = (): never => {
            throw new Error("SecurityError");
        };
        vi.stubGlobal("localStorage", { getItem: refuse, setItem: refuse, removeItem: refuse });

        expect(() => PwaLifecycle.init({ enabled: true }, "field")).not.toThrow();
        expect(() => PwaLifecycle.init({ enabled: false }, "office")).not.toThrow();
        await flush();

        expect(ours.unregister).toHaveBeenCalledOnce();
    });
});
