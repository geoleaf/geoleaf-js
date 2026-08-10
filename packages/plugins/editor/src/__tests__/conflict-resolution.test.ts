/**
 * Tests for HTTP 409 conflict resolution — Sprint S10 (EDT.10.3 / EDT.10.6).
 * Covers the three strategies and the prompt modal's button callbacks.
 * The mocked I18n.getLabel returns the key, so buttons are found by their key text.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    resolveConflict,
    type ConflictResolveContext,
} from "../persistence/conflict-resolution.js";
import type { ConflictEventDetail } from "../persistence/adapter-interface.js";

const DETAIL: ConflictEventDetail = {
    featureId: "f1",
    layerId: "layerA",
    localFeature: {
        id: "f1",
        geometry: { type: "Point", coordinates: [1, 2] },
        properties: { name: "local-name", phone: "0102" },
    },
    serverData: { id: "f1", properties: { name: "server-name", phone: "0809" } },
};

function makeCtx(): ConflictResolveContext & {
    update: ReturnType<typeof vi.fn>;
    reloadFeature: ReturnType<typeof vi.fn>;
    onResolvedLocal: ReturnType<typeof vi.fn>;
} {
    const update = vi.fn().mockResolvedValue({
        id: "f1",
        layerId: "layerA",
        geometry: DETAIL.localFeature.geometry,
        properties: DETAIL.localFeature.properties,
    });
    const reloadFeature = vi.fn();
    const onResolvedLocal = vi.fn();
    return { adapter: { update }, reloadFeature, onResolvedLocal, update };
}

/** Finds a rendered button by its (mocked) i18n key text. */
function btn(key: string): HTMLButtonElement {
    const all = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"));
    const found = all.find((b) => b.textContent?.startsWith(key));
    if (!found) throw new Error(`button not found for key: ${key}`);
    return found;
}

beforeEach(() => {
    document.body.innerHTML = "";
});

describe("resolveConflict — non-interactive strategies", () => {
    it("client-wins force-updates the local edit and calls onResolvedLocal", async () => {
        const ctx = makeCtx();
        await resolveConflict(DETAIL, "client-wins", ctx);
        expect(ctx.update).toHaveBeenCalledWith(DETAIL.localFeature, "layerA", { force: true });
        expect(ctx.onResolvedLocal).toHaveBeenCalledOnce();
    });

    it("server-wins reloads the host feature and does not update", async () => {
        const ctx = makeCtx();
        await resolveConflict(DETAIL, "server-wins", ctx);
        expect(ctx.reloadFeature).toHaveBeenCalledWith(DETAIL.serverData, "layerA");
        expect(ctx.update).not.toHaveBeenCalled();
    });
});

describe("resolveConflict — prompt modal", () => {
    it("opens a modal with three choices", async () => {
        const ctx = makeCtx();
        void resolveConflict(DETAIL, "prompt", ctx);
        expect(document.body.querySelector(".gl-editor-conflict-modal")).not.toBeNull();
        expect(btn("editor.sync.conflict.btn.keepLocal")).toBeTruthy();
        expect(btn("editor.sync.conflict.btn.keepServer")).toBeTruthy();
        expect(btn("editor.sync.conflict.btn.merge")).toBeTruthy();
    });

    it("keep local → force-update, modal removed", async () => {
        const ctx = makeCtx();
        const p = resolveConflict(DETAIL, "prompt", ctx);
        btn("editor.sync.conflict.btn.keepLocal").click();
        await p;
        expect(ctx.update).toHaveBeenCalledWith(DETAIL.localFeature, "layerA", { force: true });
        expect(document.body.querySelector(".gl-editor-conflict-modal")).toBeNull();
    });

    it("keep server → reloadFeature, modal removed", async () => {
        const ctx = makeCtx();
        const p = resolveConflict(DETAIL, "prompt", ctx);
        btn("editor.sync.conflict.btn.keepServer").click();
        await p;
        expect(ctx.reloadFeature).toHaveBeenCalledWith(DETAIL.serverData, "layerA");
        expect(document.body.querySelector(".gl-editor-conflict-modal")).toBeNull();
    });

    it("merge → opens merge UI, apply force-updates with chosen values", async () => {
        const ctx = makeCtx();
        const p = resolveConflict(DETAIL, "prompt", ctx);
        btn("editor.sync.conflict.btn.merge").click();
        expect(document.body.querySelector(".gl-editor-conflict-merge")).not.toBeNull();

        // Pick the server value for "phone", keep local for "name".
        const rows = Array.from(
            document.body.querySelectorAll<HTMLElement>(".gl-editor-conflict-merge__row")
        );
        const phoneRow = rows.find((r) => r.textContent?.includes("phone"))!;
        const useServer = Array.from(phoneRow.querySelectorAll<HTMLButtonElement>("button")).find(
            (b) => b.textContent?.startsWith("editor.sync.conflict.merge.useServer")
        )!;
        useServer.click();

        btn("editor.sync.conflict.merge.apply").click();
        await p;

        expect(ctx.update).toHaveBeenCalledOnce();
        const [feature] = ctx.update.mock.calls[0] as [
            { properties: Record<string, unknown> },
            string,
            unknown,
        ];
        expect(feature.properties).toEqual({ name: "local-name", phone: "0809" });
        expect(document.body.querySelector(".gl-editor-conflict-merge")).toBeNull();
    });

    it("merge → cancel closes without updating", async () => {
        const ctx = makeCtx();
        const p = resolveConflict(DETAIL, "prompt", ctx);
        btn("editor.sync.conflict.btn.merge").click();
        btn("editor.modal.btn.cancel").click();
        await p;
        expect(ctx.update).not.toHaveBeenCalled();
        expect(document.body.querySelector(".gl-editor-conflict-merge")).toBeNull();
    });
});
