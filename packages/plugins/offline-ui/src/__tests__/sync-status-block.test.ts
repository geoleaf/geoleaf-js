/**
 * THE PERMANENT COPY — what the core's strip stopped saying, the modal keeps saying.
 *
 * 🛑 The core's `.gl-sync-banner` now shows itself only when it carries information, because
 * on a consultation profile it otherwise repeated "everything sent" for a whole session over
 * ~43 px of chrome, on top of the theme pills. Something still has to answer "did everything
 * of mine leave?" — and this modal is where that question is asked. So the same four facts
 * live here permanently, with no dismiss button.
 *
 * ⚠️ What is NOT tested here is as load-bearing as what is: this block must not COUNT
 * anything. It calls `Storage.getSyncStatus()`, the core's single read. Three tallies of
 * "what is owed" already existed in this repository and disagreed, each having picked its own
 * set of states.
 *
 * ⚠️ The modules under test are reached through the built `CacheControl` state object, whose
 * shape the package types loosely on purpose; `any` is the honest form for the doubles here.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

import { buildStructure } from "../cache/cache-control-dom.js";
import { cleanup } from "../cache/cache-control-events.js";

/** The core's fr labels, with the core's `{0}` interpolation — not `tLabel`'s fallback. */
const FR: Record<string, string> = {
    "ui.sync.online": "En ligne",
    "ui.sync.offline": "Hors ligne",
    "ui.sync.pending_one": "1 en attente",
    "ui.sync.pending_many": "{0} en attente",
    "ui.sync.all_sent": "Tout est envoyé",
    "ui.sync.quarantined": "{0} bloquée(s)",
    "ui.sync.last_never": "jamais synchronisé",
    "ui.sync.last_at": "synchro {0}",
    "ui.sync.action": "Synchroniser",
};

let status: any;
let drains: string[];

function installGeoLeaf() {
    drains = [];
    (globalThis as any).GeoLeaf = {
        I18n: {
            getLabel: (key: string, ...args: string[]) => {
                let label: string = FR[key] ?? key;
                args.forEach((a, i) => (label = label.replace(`{${i}}`, a)));
                return label;
            },
        },
        Storage: {
            isPluginLoaded: () => true,
            isAvailable: () => true,
            getSyncStatus: () => Promise.resolve(status),
            _requestOutboxDrain: (cause: string) => drains.push(cause),
        },
    };
}

function makeSelf(): any {
    const self: any = {
        options: { position: "topright", collapsed: false, collapsible: false },
        _eventCleanups: [],
        _map: null,
        _container: document.createElement("div"),
        _bodyEl: null,
    };
    self._container.className = "gl-cache-control";
    self._updateStatus = vi.fn().mockResolvedValue(undefined);
    self._populateLayerSelection = vi.fn().mockResolvedValue(undefined);
    self._attachEventListeners = vi.fn();
    self._handleDownload = vi.fn(() => Promise.resolve());
    self._handleClear = vi.fn(() => Promise.resolve());
    self._handleStop = vi.fn();
    self._toggleCollapsed = vi.fn();
    return self;
}

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * The last mounted control, released in `afterEach`.
 *
 * 🛑 **AND THE FIRST DRAFT DID NOT RELEASE IT, WHICH IS HOW THIS FILE FOUND ITS OWN BUG.**
 * `document.body.innerHTML = ""` drops the NODES; the block's listeners are on `document` and
 * `window`, so they survive it. Nine tests later the stacking test counted **18** reads for
 * one event instead of 0 — the exact defect it was written to catch, produced by the harness
 * rather than by the code. A suite that leaks what it measures cannot measure it.
 */
let lastSelf: any = null;

async function mount() {
    const self = makeSelf();
    lastSelf = self;
    document.body.appendChild(self._container);
    buildStructure(self);
    await settle();
    await settle();
    return self;
}

/**
 * The block, or a thrown error naming what is missing.
 *
 * ⚠️ Throws rather than returning `null`: every case below dereferences it, so a nullable
 * accessor would spread `!` across the file and turn one missing block into nine confusing
 * failures instead of a single clear one.
 */
function block(): HTMLElement {
    const el = document.querySelector<HTMLElement>(".gl-cache-sync-status");
    if (!el) throw new Error("sync-status block not built");
    return el;
}
/** One span of the block, by its BEM suffix. Same contract as `block()`. */
function part(cls: string): HTMLElement {
    const el = block().querySelector<HTMLElement>(`.gl-cache-sync-status__${cls}`);
    if (!el) throw new Error(`sync-status block: missing part "${cls}"`);
    return el;
}
const text = (cls: string) => part(cls).textContent;
const action = () => part("action") as HTMLButtonElement;

describe("bloc de statut de synchronisation dans la modale du cache", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        vi.clearAllMocks();
        status = { online: true, owed: 0, quarantined: 0, lastSyncAt: null };
        Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
        installGeoLeaf();
    });

    afterEach(() => {
        if (lastSelf) cleanup(lastSelf);
        lastSelf = null;
        delete (globalThis as any).GeoLeaf;
        document.body.innerHTML = "";
    });

    test("🛑 il est le PREMIER enfant du corps — au-dessus de l'accordéon STATUT", async () => {
        const self = await mount();

        // Built inside `buildContent`, never inserted into `#gl-cache-modal-body` from the
        // outside: both tab initialisers clear that node, and a round trip through Export
        // rebuilds this whole body.
        expect(self._bodyEl.firstElementChild).toBe(block());
        expect(self._bodyEl.querySelector(".gl-cache-status")).not.toBeNull();
    });

    test("🛑 au repos il parle QUAND MÊME — c'est toute sa raison d'être", async () => {
        await mount();

        // The core's strip goes silent in this state. This is exactly where one comes to ask
        // the question once it has, so it answers even when the answer is reassuring.
        expect(text("pending")).toBe("Tout est envoyé");
        expect(text("last")).toBe("jamais synchronisé");
        expect(action().disabled).toBe(true);
    });

    test("il dit ce qui est dû, interpolé", async () => {
        status = { online: true, owed: 3, quarantined: 0, lastSyncAt: null };
        await mount();

        // ⚠️ `{0}` SUBSTITUTED. With `tLabel`, whose 2nd argument is a fallback and not a
        // value, this line would have rendered "{0} en attente" verbatim.
        expect(text("pending")).toBe("3 en attente");
        expect(action().disabled).toBe(false);
    });

    test("la quarantaine est comptée à part, et masquée quand elle est vide", async () => {
        status = { online: true, owed: 1, quarantined: 2, lastSyncAt: null };
        await mount();

        expect(text("pending")).toBe("1 en attente");
        expect(text("quarantine")).toBe("2 bloquée(s)");
        expect(part("quarantine").hidden).toBe(false);
    });

    test("hors réseau : l'état bascule et l'action s'éteint malgré des entrées dues", async () => {
        status = { online: false, owed: 2, quarantined: 0, lastSyncAt: null };
        await mount();

        expect(block().dataset.network).toBe("offline");
        expect(text("net")).toBe("Hors ligne");
        expect(action().disabled).toBe(true);
    });

    test("la dernière synchro se dit en DURÉE, pas en heure", async () => {
        status = { online: true, owed: 0, quarantined: 0, lastSyncAt: Date.now() - 3 * 60_000 };
        await mount();

        expect(text("last")).toContain("3 min");
    });

    test("🛑 il se rafraîchit sur les deux événements de file du cœur", async () => {
        await mount();
        expect(text("pending")).toBe("Tout est envoyé");

        status = { online: true, owed: 1, quarantined: 0, lastSyncAt: null };
        document.dispatchEvent(new CustomEvent("geoleaf:offline:outbox-queued"));
        await settle();
        expect(text("pending")).toBe("1 en attente");

        status = { online: true, owed: 0, quarantined: 0, lastSyncAt: null };
        document.dispatchEvent(new CustomEvent("geoleaf:offline:outbox-drained"));
        await settle();
        expect(text("pending")).toBe("Tout est envoyé");
    });

    test("il se rafraîchit sur les événements réseau natifs", async () => {
        await mount();

        status = { online: false, owed: 0, quarantined: 0, lastSyncAt: null };
        window.dispatchEvent(new Event("offline"));
        await settle();

        expect(block().dataset.network).toBe("offline");
    });

    test("🛑 l'action demande un drain au CŒUR, jamais au chemin de l'éditeur", async () => {
        status = { online: true, owed: 1, quarantined: 0, lastSyncAt: null };
        await mount();

        action().click();

        // `SyncManager.handleSync()` would go through the handler registered by the `editor`
        // plugin, and shows `storage.sync.unavailable` without it — whereas this block exists
        // to tell the truth on an application that does not ship it.
        expect(drains).toEqual(["cache-modal"]);
    });

    test("🛑 `cleanup` relâche les écouteurs — sinon ils S'EMPILENT à chaque aller-retour", async () => {
        // ⚠️ The real risk, and it is specific to this modal: it never calls `onRemove`, and a
        // trip through the Export tab rebuilds this body. Without the release, every round trip
        // would leave one more listener set behind — N database reads for a single capture.
        let reads = 0;
        (globalThis as any).GeoLeaf.Storage.getSyncStatus = () => {
            reads += 1;
            return Promise.resolve(status);
        };

        const self = await mount();
        cleanup(self);
        lastSelf = null; // released here — `afterEach` must not do it twice
        reads = 0;

        document.dispatchEvent(new CustomEvent("geoleaf:offline:outbox-queued"));
        window.dispatchEvent(new Event("offline"));
        await settle();

        expect(reads).toBe(0);
    });
});
