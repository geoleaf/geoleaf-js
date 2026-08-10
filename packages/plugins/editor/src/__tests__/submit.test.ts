/**
 * Tests for the save/update submission flow — Sprint S10 (EDT.10.4 / EDT.10.6).
 * Covers success (create + update commit), the toast/error mapping, and the
 * conflict branch (resolves without rethrow, hands off to resolution).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { submitFeature, type SubmitContext } from "../persistence/submit.js";
import { createPersistenceAdapter } from "../persistence/adapter-factory.js";
import { EDITOR_CONFIG_DEFAULTS } from "../config.js";
import {
    PersistenceError,
    type EditorFeature,
    type SavedFeature,
} from "../persistence/adapter-interface.js";

const FEATURE: EditorFeature = {
    id: "f1",
    geometry: { type: "Point", coordinates: [1, 2] },
    properties: { name: "X" },
};
const SAVED: SavedFeature = {
    id: "f1",
    layerId: "L",
    geometry: { type: "Point", coordinates: [9, 9] },
    properties: { name: "X" },
};

let notify: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

function makeCtx(adapter: Partial<SubmitContext["adapter"]>): SubmitContext & {
    commitHost: ReturnType<typeof vi.fn>;
    dispatchSaved: ReturnType<typeof vi.fn>;
    reloadFeature: ReturnType<typeof vi.fn>;
} {
    return {
        adapter: adapter as SubmitContext["adapter"],
        strategy: "client-wins",
        commitHost: vi.fn<SubmitContext["commitHost"]>(),
        reloadFeature: vi.fn<SubmitContext["reloadFeature"]>(),
        dispatchSaved: vi.fn<SubmitContext["dispatchSaved"]>(),
    };
}

beforeEach(() => {
    notify = { success: vi.fn(), error: vi.fn() };
    (globalThis as any).GeoLeaf.UI = { notify };
});

describe("submitFeature — success", () => {
    it("create: calls save, dispatches feature-saved, toasts, no host commit", async () => {
        const ctx = makeCtx({ save: vi.fn().mockResolvedValue(SAVED) });
        await submitFeature(ctx, { feature: FEATURE, layerId: "L", isUpdate: false });
        expect(ctx.adapter.save as any).toHaveBeenCalledWith(FEATURE, "L");
        expect(ctx.commitHost).not.toHaveBeenCalled();
        expect(ctx.dispatchSaved).toHaveBeenCalledWith({
            featureId: "f1",
            layerId: "L",
            saved: SAVED,
            isUpdate: false,
        });
        expect(notify.success).toHaveBeenCalledWith("editor.toast.saved");
    });

    it("update: calls update and commits the saved geometry to the host", async () => {
        const ctx = makeCtx({ update: vi.fn().mockResolvedValue(SAVED) });
        await submitFeature(ctx, { feature: FEATURE, layerId: "L", isUpdate: true });
        expect(ctx.adapter.update as any).toHaveBeenCalledWith(FEATURE, "L");
        expect(ctx.commitHost).toHaveBeenCalledWith("L", "f1", SAVED.geometry);
        expect(ctx.dispatchSaved).toHaveBeenCalledWith({
            featureId: "f1",
            layerId: "L",
            saved: SAVED,
            isUpdate: true,
        });
    });
});

describe("submitFeature — error mapping", () => {
    it("rethrows and toasts the server error on a network failure", async () => {
        const ctx = makeCtx({
            save: vi.fn().mockRejectedValue(new PersistenceError("network", "x")),
        });
        await expect(
            submitFeature(ctx, { feature: FEATURE, layerId: "L", isUpdate: false })
        ).rejects.toThrow();
        expect(notify.error).toHaveBeenCalledWith("editor.error.server");
    });

    it("maps a timeout to the timeout toast", async () => {
        const ctx = makeCtx({
            save: vi.fn().mockRejectedValue(new PersistenceError("timeout", "x")),
        });
        await expect(
            submitFeature(ctx, { feature: FEATURE, layerId: "L", isUpdate: false })
        ).rejects.toThrow();
        expect(notify.error).toHaveBeenCalledWith("editor.error.networkTimeout");
    });

    it("maps a 403 client error to permissionDenied", async () => {
        const ctx = makeCtx({
            save: vi.fn().mockRejectedValue(new PersistenceError("client", "x", { status: 403 })),
        });
        await expect(
            submitFeature(ctx, { feature: FEATURE, layerId: "L", isUpdate: false })
        ).rejects.toThrow();
        expect(notify.error).toHaveBeenCalledWith("editor.error.permissionDenied");
    });
});

describe("submitFeature — conflict", () => {
    it("resolves without rethrow and hands off to resolution (client-wins → force update)", async () => {
        const update = vi.fn().mockResolvedValue(SAVED);
        const ctx = makeCtx({
            save: vi
                .fn()
                .mockRejectedValue(
                    new PersistenceError("conflict", "c", { status: 409, serverData: { v: 1 } })
                ),
            update,
        });
        // Does NOT reject — the form modal must close while resolution runs.
        await expect(
            submitFeature(ctx, { feature: FEATURE, layerId: "L", isUpdate: false })
        ).resolves.toBeUndefined();
        // client-wins force-updates, commits and dispatches on success.
        await new Promise((r) => setTimeout(r, 0));
        expect(update).toHaveBeenCalledWith(FEATURE, "L", { force: true });
        expect(ctx.commitHost).toHaveBeenCalledWith("L", "f1", SAVED.geometry);
        expect(ctx.dispatchSaved).toHaveBeenCalled();
    });
});

describe("createPersistenceAdapter — factory", () => {
    it("returns an adapter exposing the full interface", () => {
        const a = createPersistenceAdapter(EDITOR_CONFIG_DEFAULTS, {});
        expect(typeof a.save).toBe("function");
        expect(typeof a.update).toBe("function");
        expect(typeof a.delete).toBe("function");
        expect(typeof a.isOnline).toBe("function");
    });

    it("offline mode returns the Storage-queue adapter (isOnline() === false)", () => {
        // S11: offline no longer falls back to REST — it returns the queue adapter.
        const a = createPersistenceAdapter(
            { ...EDITOR_CONFIG_DEFAULTS, persistence: { mode: "offline" } },
            {}
        );
        expect(a.isOnline()).toBe(false);
    });
});
