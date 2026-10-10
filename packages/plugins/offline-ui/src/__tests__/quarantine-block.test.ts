/**
 * THE QUARANTINE, ACTIONABLE FROM THE CACHE MODAL.
 *
 * 🛑 The sync block of this modal said HOW MANY captures were set aside, and offered nothing
 * to do about them: the two exits the core publishes — requeue a motive, discard an entry —
 * were reachable from the editor plugin's window only. An application without the editor
 * showed a red count and no gesture.
 *
 * ⚠️ What these cases hold is the CHAIN to the core's public facade, and that the block
 * decides nothing itself: which motives can be requeued is the core's answer
 * (`Storage.requeueableReasons()`), what a requeue brought back is the core's count.
 *
 * ⚠️ The module is reached through the built `CacheControl` state object, whose shape the
 * package types loosely on purpose; `any` is the honest form for the doubles here.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

const confirmDialog = vi.fn();
vi.mock("@geoleaf/host-runtime", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@geoleaf/host-runtime")>()),
    confirmDialog: (...args: unknown[]) => confirmDialog(...args),
}));

const { buildQuarantineBlock } = await import("../cache/quarantine-block.js");

interface Row {
    entryId: string;
    localId: string;
    state: string;
    quarantine?: string;
}

let rows: Row[];
let storage: any;
let notif: any;
let self: any;
let body: HTMLElement;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The three captures a dead session and a refusal leave — the scenario of `e2e/46`. */
const ASIDE: Row[] = [
    {
        entryId: "update:sites:srv:a1",
        localId: "srv:a1",
        state: "quarantined",
        quarantine: "authRequired",
    },
    {
        entryId: "update:sites:srv:a2",
        localId: "srv:a2",
        state: "quarantined",
        quarantine: "authRequired",
    },
    {
        entryId: "update:sites:srv:b1",
        localId: "srv:b1",
        state: "quarantined",
        quarantine: "rejectedByServer",
    },
];

function installGeoLeaf(overrides: Record<string, unknown> = {}) {
    storage = {
        requeueableReasons: vi.fn(() => ["retryBudgetExhausted", "authRequired"]),
        requeueAll: vi.fn(async (reason?: string) => {
            const back = rows.filter((r) => r.quarantine === reason);
            rows = rows.filter((r) => r.quarantine !== reason);
            return { ok: true, requeued: back.length, skipped: 0 };
        }),
        discardQuarantined: vi.fn(async (id: string) => {
            rows = rows.filter((r) => r.entryId !== id);
            return { ok: true };
        }),
        DB: { listPendingEdits: vi.fn(async () => rows) },
        ...overrides,
    };
    notif = { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() };
    (globalThis as any).GeoLeaf = { Storage: storage, _UINotifications: notif };
}

async function build(): Promise<HTMLElement> {
    self = { _eventCleanups: [] as Array<() => void> };
    body = document.createElement("div");
    document.body.appendChild(body);
    buildQuarantineBlock(self, body);
    await flush();
    return body.querySelector(".gl-cache-quarantine") as HTMLElement;
}

const groupsOf = (root: HTMLElement) =>
    [...root.querySelectorAll<HTMLElement>(".gl-cache-quarantine__group")].map((group) => ({
        reason: group.getAttribute("data-gl-reason"),
        text: group.querySelector(".gl-cache-quarantine__label")?.textContent ?? "",
        requeue: group.querySelector<HTMLButtonElement>(".gl-cache-quarantine__requeue"),
        discard: group.querySelector<HTMLButtonElement>(".gl-cache-quarantine__discard"),
    }));

beforeEach(() => {
    rows = ASIDE.map((row) => ({ ...row }));
    confirmDialog.mockReset();
    confirmDialog.mockResolvedValue(true);
    installGeoLeaf();
});

afterEach(() => {
    for (const off of self?._eventCleanups ?? []) off();
    body?.remove();
    delete (globalThis as any).GeoLeaf;
    vi.restoreAllMocks();
});

describe("le bloc de quarantaine — ce qu'il montre", () => {
    test("rien de mis de côté → le bloc reste caché", async () => {
        rows = [{ entryId: "create:x:1", localId: "loc:1", state: "pending" }];
        const root = await build();
        expect(root.hidden).toBe(true);
        expect(groupsOf(root)).toEqual([]);
    });

    test("🛑 un groupe par MOTIF, avec son compte", async () => {
        const root = await build();
        expect(root.hidden).toBe(false);
        const groups = groupsOf(root);
        expect(groups.map((g) => g.reason)).toEqual(["authRequired", "rejectedByServer"]);
        expect(groups[0]?.text).toContain("2");
        expect(groups[1]?.text).toContain("1");
    });

    test("🛑 la relance n'est offerte qu'aux motifs que le CORE dit relançables", async () => {
        const root = await build();
        const [auth, rejected] = groupsOf(root);
        expect(storage.requeueableReasons).toHaveBeenCalled();
        expect(auth?.requeue).not.toBeNull();
        // A server refusal replays into the same refusal: its only exit is the discard.
        expect(rejected?.requeue).toBeNull();
        // Every motive can be discarded — that exit is the one no motive lacks.
        expect(auth?.discard).not.toBeNull();
        expect(rejected?.discard).not.toBeNull();
    });

    test("un core qui ne publie pas la règle → aucune relance offerte, l'abandon reste", async () => {
        installGeoLeaf({ requeueableReasons: undefined });
        const root = await build();
        const groups = groupsOf(root);
        expect(groups).toHaveLength(2);
        expect(groups.every((g) => g.requeue === null)).toBe(true);
        expect(groups.every((g) => g.discard !== null)).toBe(true);
    });

    test("un core sans la lecture de la file → le bloc reste caché, sans jeter", async () => {
        installGeoLeaf({ DB: {} });
        const root = await build();
        expect(root.hidden).toBe(true);
    });
});

describe("le bloc de quarantaine — relancer un motif", () => {
    test("🛑 « Relancer » appelle `requeueAll` avec CE motif, et le bloc se repeint", async () => {
        const root = await build();
        groupsOf(root)[0]?.requeue?.click();
        await flush();
        await flush();

        expect(storage.requeueAll).toHaveBeenCalledTimes(1);
        expect(storage.requeueAll).toHaveBeenCalledWith("authRequired");
        expect(groupsOf(root).map((g) => g.reason)).toEqual(["rejectedByServer"]);
        // What came back is the core's count, said as such.
        expect(notif.success).toHaveBeenCalledTimes(1);
        expect(String(notif.success.mock.calls[0][0])).toContain("2");
    });

    test("🛑 ce que le core a LAISSÉ est dit — la cause n'est pas levée", async () => {
        storage.requeueAll.mockResolvedValue({ ok: true, requeued: 0, skipped: 2 });
        const root = await build();
        groupsOf(root)[0]?.requeue?.click();
        await flush();
        await flush();

        expect(notif.success).not.toHaveBeenCalled();
        expect(notif.warning).toHaveBeenCalledTimes(1);
        expect(String(notif.warning.mock.calls[0][0])).toContain("2");
    });

    test("un refus du core est une erreur dite, pas un silence", async () => {
        storage.requeueAll.mockResolvedValue({
            ok: false,
            requeued: 0,
            skipped: 0,
            refused: "engineUnavailable",
        });
        const root = await build();
        groupsOf(root)[0]?.requeue?.click();
        await flush();
        await flush();
        expect(notif.error).toHaveBeenCalledTimes(1);
    });
});

describe("le bloc de quarantaine — abandonner", () => {
    test("🛑 sans confirmation, RIEN n'est détruit", async () => {
        confirmDialog.mockResolvedValue(false);
        const root = await build();
        groupsOf(root)[1]?.discard?.click();
        await flush();
        await flush();

        expect(confirmDialog).toHaveBeenCalledTimes(1);
        expect(confirmDialog.mock.calls[0]?.[0]).toMatchObject({ destructive: true });
        expect(storage.discardQuarantined).not.toHaveBeenCalled();
    });

    test("🛑 confirmé : chaque saisie du groupe, sous l'identité LISTÉE", async () => {
        const root = await build();
        groupsOf(root)[0]?.discard?.click();
        await flush();
        await flush();
        await flush();

        // The core demands the entry's `localId` as read from the listing: that is what makes
        // it true that the capture was enumerated before being destroyed.
        expect(storage.discardQuarantined.mock.calls).toEqual([
            ["update:sites:srv:a1", "srv:a1"],
            ["update:sites:srv:a2", "srv:a2"],
        ]);
        expect(groupsOf(root).map((g) => g.reason)).toEqual(["rejectedByServer"]);
        expect(String(notif.success.mock.calls[0][0])).toContain("2");
    });

    test("la confirmation dit COMBIEN de saisies partent", async () => {
        const root = await build();
        groupsOf(root)[0]?.discard?.click();
        await flush();
        const asked = confirmDialog.mock.calls[0]?.[0] as { message?: unknown } | undefined;
        expect(String(asked?.message)).toContain("2");
    });

    test("un abandon que le core refuse est compté à part", async () => {
        storage.discardQuarantined.mockResolvedValue({ ok: false, refused: "notQuarantined" });
        const root = await build();
        groupsOf(root)[1]?.discard?.click();
        await flush();
        await flush();
        await flush();
        expect(notif.success).not.toHaveBeenCalled();
        expect(notif.error).toHaveBeenCalledTimes(1);
    });
});

describe("le bloc de quarantaine — il suit la file", () => {
    test("🛑 une sortie de quarantaine annoncée par le core le repeint", async () => {
        const root = await build();
        expect(groupsOf(root)).toHaveLength(2);
        rows = rows.filter((r) => r.quarantine !== "authRequired");
        document.dispatchEvent(new CustomEvent("geoleaf:offline:quarantine-exited"));
        await flush();
        expect(groupsOf(root).map((g) => g.reason)).toEqual(["rejectedByServer"]);
    });

    test("une passe de drain le repeint — c'est elle qui met de côté", async () => {
        rows = [];
        const root = await build();
        expect(root.hidden).toBe(true);
        rows = ASIDE.map((row) => ({ ...row }));
        document.dispatchEvent(new CustomEvent("geoleaf:offline:outbox-drained"));
        await flush();
        expect(root.hidden).toBe(false);
    });

    test("🛑 les écouteurs sont rendus à la fenêtre : après nettoyage, plus de relecture", async () => {
        const root = await build();
        const reads = storage.DB.listPendingEdits.mock.calls.length;
        for (const off of self._eventCleanups) off();
        self._eventCleanups = [];
        document.dispatchEvent(new CustomEvent("geoleaf:offline:quarantine-exited"));
        await flush();
        expect(storage.DB.listPendingEdits.mock.calls.length).toBe(reads);
        expect(root.isConnected).toBe(true);
    });
});
