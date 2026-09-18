/*!
 * Tests — the pending-queue modal makes the QUARANTINE actionable.
 *
 * 🛑 **THE DEFECT, MEASURED ON 17/09/2026.** The modal lists every non-`synced` entry, set
 * aside ones included, and shows two fields: the operation and the layer. Nothing says an
 * entry is quarantined, nothing says WHY, and the single "Retry now" button calls the drain
 * — which replays `pending` and `failed` only (`REPLAYABLE`, `push-engine.ts`). So the one
 * button the window offers has, by construction, no effect on the entries the user opened it
 * for.
 *
 * 🛑 **AND TWO MOTIVES HAVE NO EXIT AT ALL.** `rejectedByServer` and `deletedOnServer` are
 * what `REQUEUEABLE` excludes: their only contractual exit is `discardQuarantined`, which has
 * ZERO callers anywhere. A device that went through the identity defect closed on 17/09/2026
 * — an edit naming an existing entity landed on a second record with no server identity —
 * carries one such entry per entity, and nothing can clear them: they inflate the banner's
 * quarantine count for good.
 *
 * Each `🛑` case was seen red on the assertion of the defect before the fix; the failing
 * message is quoted beside it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { openPendingQueueModal } from "../sub-menu/pending-queue-modal.js";
import { installMockGeoLeaf, uninstallMockGeoLeaf, makeMockMaplibreMap } from "./setup.js";
import type { EditorQueueEntry } from "../persistence/editor-sync-replay.js";
import L_fr from "../lang/lang-fr.js";

/** The motives the core's rule lets come back — read from the facade by `entry.ts`. */
const REQUEUEABLE = [
    "retryBudgetExhausted",
    "layerNoLongerWritable",
    "notImplementedByServer",
    "authRequired",
    "dialectNotSupported",
];

/** A queue as a dead session and a refusal leave it. */
const MIXED: EditorQueueEntry[] = [
    { id: "1", kind: "update", layerId: "sites", localId: "srv:1", state: "pending" },
    {
        id: "2",
        kind: "update",
        layerId: "sites",
        localId: "srv:2",
        state: "quarantined",
        quarantine: "authRequired",
    },
    {
        id: "3",
        kind: "delete",
        layerId: "sites",
        localId: "srv:3",
        state: "quarantined",
        quarantine: "authRequired",
    },
    {
        id: "4",
        kind: "create",
        layerId: "sites",
        localId: "loc:4",
        state: "quarantined",
        quarantine: "rejectedByServer",
    },
];

const texts = (selector: string): string[] =>
    Array.from(document.querySelectorAll(selector), (n) => n.textContent ?? "");

const buttons = (selector: string): HTMLButtonElement[] =>
    Array.from(document.querySelectorAll<HTMLButtonElement>(selector));

/**
 * The single element of a one-element list.
 *
 * ⚠️ It THROWS rather than returning `undefined`: under `noUncheckedIndexedAccess` a bare
 * `list[0]` is `T | undefined`, and silencing that with `!` would trade a compiler question
 * for a runtime `TypeError` whose message names nothing.
 */
function only<T>(list: T[], what: string): T {
    expect(list, what).toHaveLength(1);
    const [first] = list;
    if (!first) throw new Error(`${what} — liste vide`);
    return first;
}

beforeEach(() => {
    installMockGeoLeaf({ nativeMap: makeMockMaplibreMap() });
    // 🛑 THE REAL DICTIONARY, and the assertions below are why. The harness's `getLabel`
    // returns the KEY — so `editor.sync.detail.reason.authRequired` would satisfy "the row
    // says something" while containing the contract vocabulary the test forbids. A guard that
    // cannot tell a resolved label from an unresolved key guards nothing here.
    const g = globalThis as { GeoLeaf?: { I18n?: { getLabel?: (k: string) => string } } };
    if (g.GeoLeaf?.I18n) {
        g.GeoLeaf.I18n.getLabel = (key: string) => (L_fr as Record<string, string>)[key] ?? key;
    }
});

afterEach(() => {
    document.querySelector(".gl-form-modal-overlay")?.remove();
    uninstallMockGeoLeaf();
    vi.restoreAllMocks();
});

describe("la fenêtre des saisies en attente — la quarantaine devient actionnable", () => {
    it("prémisse : elle liste TOUT ce qui est dû, mises à l'écart comprises", () => {
        openPendingQueueModal(MIXED, { onRetry: vi.fn() });
        expect(document.querySelectorAll(".gl-editor-queue-detail__row").length).toBe(4);
    });

    // Red on 17/09/2026: expected [] to have a length of 3 but got +0
    it("🛑 chaque ligne mise à l'écart DIT son état et son motif", () => {
        openPendingQueueModal(MIXED, { onRetry: vi.fn(), requeueable: REQUEUEABLE });
        const states = texts(".gl-editor-queue-detail__state");
        expect(states.filter((s) => s.length > 0)).toHaveLength(3);
        // The raw contract vocabulary must never reach the user, in any language.
        expect(states.join(" ")).not.toContain("authRequired");
        expect(states.join(" ")).not.toContain("quarantined");
    });

    // Red on 17/09/2026: expected +0 to be 1
    it("🛑 « réessayer tout » existe PAR MOTIF, et ne rejoue que le sien", () => {
        const onRequeue = vi.fn();
        openPendingQueueModal(MIXED, { onRetry: vi.fn(), onRequeue, requeueable: REQUEUEABLE });
        // One group only: `authRequired`. `rejectedByServer` is not requeueable.
        const group = only(buttons(".gl-editor-queue-detail__requeue"), "un seul groupe");
        expect(group.dataset.glReason).toBe("authRequired");
        group.click();
        expect(onRequeue).toHaveBeenCalledWith("authRequired");
    });

    /**
     * 🛑 THE RULE HAS ONE AUTHOR, AND IT IS THE CORE. `REQUEUEABLE` lives in
     * `write/quarantine-api.ts`; the modal is HANDED the list rather than knowing it. A
     * second copy here would be free to diverge on the exact point the arbitration of
     * 07/08/2026 settled — and the plugin cannot import the core (`INV-NS`), so the copy
     * would be unfalsifiable.
     *
     * ⚠️ **GREEN ON 17/09/2026, AND VACUOUSLY SO** — no requeue button existed at all, so an
     * assertion about which ones exist passed while proving nothing. Said here rather than
     * counted as a proof. It becomes meaningful with the buttons, and it was seen RED by
     * mutation (the modal offering a group for every motive it finds).
     */
    it("un motif que le rejeu ne répare pas n'offre PAS de réessai", () => {
        openPendingQueueModal(MIXED, {
            onRetry: vi.fn(),
            onRequeue: vi.fn(),
            requeueable: REQUEUEABLE,
        });
        const reasons = buttons(".gl-editor-queue-detail__requeue").map((b) => b.dataset.glReason);
        expect(reasons).not.toContain("rejectedByServer");
    });

    // Red on 17/09/2026: expected undefined to be truthy
    it("🛑 une entrée non rejouable offre l'ABANDON, et sous confirmation", async () => {
        const onDiscard = vi.fn();
        openPendingQueueModal(MIXED, { onRetry: vi.fn(), onDiscard, requeueable: REQUEUEABLE });
        // Only the entry no replay can repair — the others have a retry that works.
        const discard = only(
            buttons(".gl-editor-queue-detail__discard"),
            "un seul abandon proposé"
        );
        expect(discard.dataset.glEntry).toBe("4");

        discard.click();
        // 🛑 NOT DESTROYED ON THE CLICK. `discardQuarantined` demands `confirmedLocalId`
        // precisely so the capture is enumerated before being lost; a one-click destroy in
        // the UI would hand that guarantee back.
        expect(onDiscard).not.toHaveBeenCalled();
        const confirm = only(
            buttons(".gl-editor-queue-detail__discard-confirm"),
            "aucune confirmation n'est proposée"
        );
        confirm.click();
        expect(onDiscard).toHaveBeenCalledWith(
            expect.objectContaining({ id: "4", localId: "loc:4" })
        );
    });

    it("prémisse : une file sans mise à l'écart n'affiche ni groupe ni abandon", () => {
        openPendingQueueModal(MIXED.slice(0, 1), { onRetry: vi.fn(), requeueable: REQUEUEABLE });
        expect(buttons(".gl-editor-queue-detail__requeue")).toHaveLength(0);
        expect(buttons(".gl-editor-queue-detail__discard")).toHaveLength(0);
    });
});
