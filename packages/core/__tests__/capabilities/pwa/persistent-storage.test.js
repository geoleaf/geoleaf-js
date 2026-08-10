/**
 * Origin-level persistent storage — `PwaLifecycle` → `_requestPersistentStorage`.
 *
 * Why this file exists: browsers evict **per origin, not per store**. A best-effort
 * origin can lose IndexedDB — which holds `sync_queue`, i.e. field captures with no
 * other copy — at the same time as the Cache API. `persist()` is the only lever that
 * moves the whole origin out of that regime, and its verdict is otherwise unobservable.
 *
 * ⚠️ Proven by mutation, per the repo's "a guard never seen red guards nothing" rule.
 * Deleting the `_requestPersistentStorage()` call from `lifecycle.ts` `init()` must turn
 * "requests persistence when the gate is open" RED. Re-check this when touching the file.
 */
vi.mock("../../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../../src/kernel/storage/index.js", () => ({
    SWRegister: { register: vi.fn(() => Promise.resolve()) },
}));

import { PwaLifecycle } from "../../../src/capabilities/pwa/lifecycle.ts";
import { Log } from "../../../src/utils/log/index.js";

/** Drains the floating `persist().then().catch()` chain (3 hops, plus slack). */
const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
};

/** Installs a fake `navigator.storage`; `undefined` removes the API entirely. */
function setStorage(storage) {
    Object.defineProperty(navigator, "storage", { value: storage, configurable: true });
}

describe("PwaLifecycle — origin-level persistent storage", () => {
    let originalStorage;

    beforeEach(() => {
        originalStorage = Object.getOwnPropertyDescriptor(navigator, "storage");
        vi.clearAllMocks();
    });

    afterEach(() => {
        if (originalStorage) Object.defineProperty(navigator, "storage", originalStorage);
        else setStorage(undefined);
    });

    // ── The wiring itself — this is the assertion the mutation must break ──────

    it("requests persistence when the gate is open", async () => {
        const persist = vi.fn(() => Promise.resolve(true));
        setStorage({ persist });

        PwaLifecycle.init({ enabled: true });
        await flush();

        expect(persist).toHaveBeenCalledOnce();
    });

    it("does NOT request persistence when the gate is closed", async () => {
        const persist = vi.fn(() => Promise.resolve(true));
        setStorage({ persist });

        PwaLifecycle.init({ enabled: false });
        await flush();

        expect(persist).not.toHaveBeenCalled();
    });

    it("requests persistence even when the service worker fails to register", async () => {
        // The queue lives in IndexedDB, not in the SW's caches: a failed registration
        // must not skip the protection.
        const { SWRegister } = await import("../../../src/kernel/storage/index.js");
        SWRegister.register.mockImplementationOnce(() => Promise.reject(new Error("boom")));
        const persist = vi.fn(() => Promise.resolve(true));
        setStorage({ persist });

        PwaLifecycle.init({ enabled: true });
        await flush();

        expect(persist).toHaveBeenCalledOnce();
    });

    // ── The verdict — the whole point of the task is that it is logged ─────────

    it("logs the granted verdict", async () => {
        setStorage({ persist: () => Promise.resolve(true) });

        PwaLifecycle.init({ enabled: true });
        await flush();

        expect(Log.info).toHaveBeenCalledWith(expect.stringContaining("granted"));
        expect(Log.warn).not.toHaveBeenCalled();
    });

    it("logs the refused verdict as a warning, naming the sync queue", async () => {
        setStorage({ persist: () => Promise.resolve(false) });

        PwaLifecycle.init({ enabled: true });
        await flush();

        const warned = Log.warn.mock.calls.flat().join(" ");
        expect(warned).toContain("refused");
        expect(warned).toContain("sync queue");
    });

    it("reports an unsupported API instead of staying silent", async () => {
        setStorage(undefined);

        PwaLifecycle.init({ enabled: true });
        await flush();

        expect(Log.info).toHaveBeenCalledWith(expect.stringContaining("unsupported"));
    });

    it("reports an unsupported API when `persist` is not callable", async () => {
        setStorage({ persist: "nope" });

        PwaLifecycle.init({ enabled: true });
        await flush();

        expect(Log.info).toHaveBeenCalledWith(expect.stringContaining("unsupported"));
    });

    // ── Failure modes must never break the boot ───────────────────────────────

    it("swallows a rejected request, logs it, and does not throw", async () => {
        setStorage({ persist: () => Promise.reject(new Error("SecurityError")) });

        expect(() => PwaLifecycle.init({ enabled: true })).not.toThrow();
        await flush();

        const warned = Log.warn.mock.calls.flat().join(" ");
        expect(warned).toContain("SecurityError");
    });

    it("does not throw when the request rejects with a non-Error", async () => {
        setStorage({ persist: () => Promise.reject("bare string") });

        expect(() => PwaLifecycle.init({ enabled: true })).not.toThrow();
        await flush();

        expect(Log.warn).toHaveBeenCalled();
    });
});
