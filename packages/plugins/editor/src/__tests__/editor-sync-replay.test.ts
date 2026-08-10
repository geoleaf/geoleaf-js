/**
 * `editor-sync-replay` — APRÈS la migration vers l'`outbox` du core (tâche 4.9).
 *
 * 🛑 CE FICHIER A CHANGÉ DE SUJET, ET C'EST LÉGITIME PARCE QUE SON SUJET A DÉMÉNAGÉ.
 * Il éprouvait le rejeu PAR ENTRÉE : lecture de la charge dans `payload`, dispatch sur le
 * vocabulaire `editor.*`, marquage `failed` sans perte, erreurs de parsing. Ces comportements
 * vivent maintenant dans le drain du core, où ils sont couverts par
 * `packages/core/__tests__/capabilities/offline/push-engine.test.js` — 14 tests, 8 mutations
 * vues rouges, dont « un 500 laisse l'entrée en file, en `failed` — qui n'est pas terminal ».
 *
 * ⚠️ La distinction avec `addpoi` mérite d'être écrite, parce qu'elle a décidé du traitement.
 * Là-bas, les tests pilotaient des adaptateurs ENCORE VIVANTS via `syncDirect` : ils ont été
 * re-pointés, pas supprimés. Ici la fonction `_replayEntry` a disparu, et l'adaptateur REST
 * qu'elle utilisait garde ses propres tests (`rest-adapter.test.ts`,
 * `collection-rest-adapter.test.ts`) plus son chemin vivant en ligne (`auto-adapter`). Rien
 * n'est découvert.
 *
 * Ce qui est éprouvé ici, c'est ce que ce module fait ENCORE : lire l'outbox, déléguer le
 * drain, et prévenir l'interface.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
    listPendingEditorEntries,
    getPendingCount,
    flushNow,
    drainOutbox,
    initSyncReplay,
    destroySyncReplay,
} from "../persistence/editor-sync-replay.js";

/** Façade de stockage sous contrôle du test : l'outbox en lecture, le drain en écriture. */
function mountStorage(entries: unknown[], report = { attempted: 0, pushed: 0, failed: 0 }) {
    const pushOutbox = vi.fn().mockResolvedValue({ ...report, conflicts: 0, refused: null });
    (globalThis as Record<string, unknown>).GeoLeaf = {
        Storage: {
            DB: { _ensureModule: () => ({ list: () => Promise.resolve(entries) }) },
            pushOutbox,
        },
    };
    return pushOutbox;
}

describe("editor-sync-replay — lecture de l'outbox", () => {
    beforeEach(() => {
        Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    });
    afterEach(() => {
        destroySyncReplay();
        delete (globalThis as Record<string, unknown>).GeoLeaf;
    });

    it("liste TOUT ce qui est dû au serveur, sans filtrer par producteur", async () => {
        // 🛑 L'INVERSE DE CE QUE CE MODULE FAISAIT. Il gardait les entrées `editor.*` et
        // écartait les autres — un plugin qui ne reconnaissait que « les siennes » dans une
        // file que deux plugins écrivaient. L'`outbox` ne parle qu'un vocabulaire, et un
        // utilisateur qui demande « qu'est-ce qui n'est pas parti ? » veut la réponse complète.
        mountStorage([
            { id: "a", kind: "create", layerId: "l1", localId: "x", state: "pending" },
            { id: "b", kind: "update", layerId: "l2", localId: "y", state: "failed" },
        ]);
        const entries = await listPendingEditorEntries();
        expect(entries.map((e) => e.id)).toEqual(["a", "b"]);
        expect(await getPendingCount()).toBe(2);
    });

    it("écarte ce qui est déjà `synced` — le serveur l'a, ce n'est plus dû", async () => {
        mountStorage([
            { id: "a", kind: "create", layerId: "l1", localId: "x", state: "pending" },
            { id: "b", kind: "create", layerId: "l1", localId: "z", state: "synced" },
        ]);
        expect((await listPendingEditorEntries()).map((e) => e.id)).toEqual(["a"]);
    });

    it("rend [] quand le moteur de stockage est absent — sans jeter", async () => {
        (globalThis as Record<string, unknown>).GeoLeaf = { Storage: {} };
        expect(await listPendingEditorEntries()).toEqual([]);
    });
});

describe("editor-sync-replay — le drain est délégué au core", () => {
    beforeEach(() => {
        Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    });
    afterEach(() => {
        destroySyncReplay();
        delete (globalThis as Record<string, unknown>).GeoLeaf;
    });

    it("flushNow appelle pushOutbox et prévient l'interface", async () => {
        const pushOutbox = mountStorage([], { attempted: 2, pushed: 2, failed: 0 });
        const onChange = vi.fn();
        const flushed = vi.fn();
        document.addEventListener("geoleaf:editor:feature-sync-flushed", flushed);

        initSyncReplay({ rest: {} as never, onChange });
        await flushNow();

        expect(pushOutbox).toHaveBeenCalled();
        expect(onChange).toHaveBeenCalled();
        // ⚠️ Cet événement a un ÉCOUTEUR (`entry.ts` → `_onQueueChanged`, le badge d'attente).
        // Une première rédaction de 4.9 le supprimait en affirmant qu'il n'en avait aucun —
        // affirmation faite AVANT le grep qui l'a démentie. Le badge serait resté figé.
        expect(flushed).toHaveBeenCalled();
        document.removeEventListener("geoleaf:editor:feature-sync-flushed", flushed);
    });

    it("ne draine PAS hors réseau — chaque entrée échouerait pour rien", async () => {
        const pushOutbox = mountStorage([]);
        Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
        initSyncReplay({ rest: {} as never });
        await flushNow();
        expect(pushOutbox).not.toHaveBeenCalled();
    });

    it("ne draine pas sans dépendances injectées", async () => {
        const pushOutbox = mountStorage([]);
        await flushNow();
        expect(pushOutbox).not.toHaveBeenCalled();
    });
});

/**
 * 🛑 `drainOutbox` a été EXTRAIT de `flushNow` à la tâche 5.1-b, et le motif est le VERROU.
 * Le handler `"poi"` du seam `Sync` draine lui aussi, pour le bouton d'`offline-ui`. S'il
 * appelait `pushOutbox` de son côté, `_flushing` — qui ne garde que ce qui passe par ici —
 * ne verrait pas ses appels, et deux drains pourraient se recouvrir sur la même outbox.
 */
describe("drainOutbox — le point d'entrée unique du drain (5.1-b)", () => {
    beforeEach(() => {
        Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    });
    afterEach(() => {
        destroySyncReplay();
        delete (globalThis as Record<string, unknown>).GeoLeaf;
    });

    it("REND le décompte du drain, là où flushNow ne rendait rien", async () => {
        mountStorage([], { attempted: 3, pushed: 2, failed: 1 });
        await expect(drainOutbox()).resolves.toMatchObject({
            attempted: 3,
            pushed: 2,
            failed: 1,
        });
    });

    it("🛑 rend null hors réseau — ce n'est PAS un drain à zéro", async () => {
        const pushOutbox = mountStorage([]);
        Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
        await expect(drainOutbox()).resolves.toBeNull();
        expect(pushOutbox).not.toHaveBeenCalled();
    });

    it("rend null quand la façade de stockage est absente", async () => {
        delete (globalThis as Record<string, unknown>).GeoLeaf;
        await expect(drainOutbox()).resolves.toBeNull();
    });

    it("🛑 DEUX drains concurrents ne poussent QU'UNE FOIS — le verrou tient", async () => {
        let release!: (v: unknown) => void;
        const gate = new Promise((r) => {
            release = r;
        });
        const pushOutbox = vi.fn(async () => {
            await gate;
            return { attempted: 1, pushed: 1, failed: 0, conflicts: 0, refused: null };
        });
        (globalThis as Record<string, unknown>).GeoLeaf = {
            Storage: {
                DB: { _ensureModule: () => ({ list: () => Promise.resolve([]) }) },
                pushOutbox,
            },
        };

        const first = drainOutbox();
        const second = drainOutbox(); // pendant que le premier est en vol
        release(null);
        const [a, b] = await Promise.all([first, second]);

        expect(pushOutbox).toHaveBeenCalledTimes(1);
        // Le second est refusé, et il le dit — il ne rend pas un faux succès.
        expect([a, b].filter((r) => r === null)).toHaveLength(1);
    });

    it("🛑 le drain relâche son verrou même si pushOutbox JETTE", async () => {
        // Sans le `finally`, un échec réseau bloquerait tout rejeu ultérieur jusqu'au
        // rechargement de la page — une saisie de terrain resterait en file sans recours.
        const pushOutbox = vi
            .fn()
            .mockRejectedValueOnce(new Error("boom"))
            .mockResolvedValue({ attempted: 1, pushed: 1, failed: 0, conflicts: 0, refused: null });
        (globalThis as Record<string, unknown>).GeoLeaf = {
            Storage: {
                DB: { _ensureModule: () => ({ list: () => Promise.resolve([]) }) },
                pushOutbox,
            },
        };

        await expect(drainOutbox()).rejects.toThrow("boom");
        await expect(drainOutbox()).resolves.toMatchObject({ pushed: 1 });
        expect(pushOutbox).toHaveBeenCalledTimes(2);
    });
});
