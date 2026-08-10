/**
 * Unit tests — built-in/shared/sync-handler-seam.ts + geoleaf.sync.ts (S14 Phase B).
 *
 * The in-core SyncHandlerContract registry lets data plugins (addpoi) push their offline
 * sync handler via GeoLeaf.Sync.registerHandler; the offline engine reads them back. This
 * inverts the former build-time engine→addpoi coupling (no-plugin-in-core, B3).
 */
import { beforeEach, describe, expect, it } from "vitest";

const { SyncHandlerContract } = await import("../../src/kernel/shared/sync-handler-seam.ts");
const { Sync } = await import("../../src/api/geoleaf.sync.ts");

beforeEach(() => SyncHandlerContract._reset());

describe("SyncHandlerContract", () => {
    it("registers and retrieves a handler by id", () => {
        const h = { processSyncQueue: () => Promise.resolve({ synced: 0 }) };
        SyncHandlerContract.registerHandler("poi", h);
        expect(SyncHandlerContract.getHandler("poi")).toBe(h);
    });

    it("getHandlers returns every registered handler in registration order", () => {
        const a = {};
        const b = {};
        SyncHandlerContract.registerHandler("poi", a);
        SyncHandlerContract.registerHandler("other", b);
        expect(SyncHandlerContract.getHandlers()).toEqual([a, b]);
    });

    it("re-registering the same id replaces the handler (no duplicate)", () => {
        const a = {};
        const b = {};
        SyncHandlerContract.registerHandler("poi", a);
        SyncHandlerContract.registerHandler("poi", b);
        expect(SyncHandlerContract.getHandler("poi")).toBe(b);
        expect(SyncHandlerContract.getHandlers()).toEqual([b]);
    });

    it("ignores a falsy id or handler", () => {
        SyncHandlerContract.registerHandler("", {});
        SyncHandlerContract.registerHandler("x", null);
        expect(SyncHandlerContract.getHandlers()).toEqual([]);
    });

    it("getHandler returns undefined for an unknown id", () => {
        expect(SyncHandlerContract.getHandler("nope")).toBeUndefined();
    });

    it("_reset clears all handlers", () => {
        SyncHandlerContract.registerHandler("poi", {});
        SyncHandlerContract._reset();
        expect(SyncHandlerContract.getHandlers()).toEqual([]);
    });
});

describe("GeoLeaf.Sync façade", () => {
    it("self-mounts on globalThis.GeoLeaf.Sync at import", () => {
        expect(globalThis.GeoLeaf?.Sync).toBeDefined();
        expect(typeof globalThis.GeoLeaf.Sync.registerHandler).toBe("function");
    });

    it("registerHandler delegates to the contract", () => {
        const h = {};
        Sync.registerHandler("poi", h);
        expect(SyncHandlerContract.getHandler("poi")).toBe(h);
        expect(Sync.getHandler("poi")).toBe(h);
    });

    it("getHandlers delegates to the contract", () => {
        const h = {};
        SyncHandlerContract.registerHandler("poi", h);
        expect(Sync.getHandlers()).toEqual([h]);
    });
});
