/**
 * Les DEUX sorties de quarantaine — tâche 8.4 (B-123).
 *
 * 🛑 Ce que cette suite garde, et que rien d'autre ne gardait : qu'une entrée mise de côté
 * puisse **en sortir**. Avant 8.4 elle n'avait aucune sortie — ni le drain, ni la purge, ni
 * aucun geste d'interface —, donc elle s'accumulait sur l'appareil de terrain, visible,
 * comptée, irrésolvable.
 *
 * Les deux sorties ne sont PAS interchangeables, et c'est le cœur de la conception :
 *
 *  1. **Remise en file** — réservée aux motifs dont la cause peut être constatée levée.
 *     Rejouer un `deletedOnServer` recréerait ce que le serveur a supprimé ; un
 *     `rejectedByServer` se ferait refuser à l'identique. Un « réessayer » indifférencié
 *     serait faux pour la moitié des cas, et faux dans le sens qui coûte.
 *  2. **Destruction confirmée** — et la confirmation n'est pas un booléen. L'appelant doit
 *     rendre le `localId` de l'entrée, qu'il ne peut connaître qu'en l'ayant LISTÉE. Un
 *     `{confirmed: true}` se pose depuis n'importe quel code sans que rien n'ait été montré.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StorageContract } from "../../../src/kernel/shared/index.js";
import {
    requeueQuarantined,
    discardQuarantined,
} from "../../../src/capabilities/offline/write/quarantine-api.js";

vi.mock("../../../src/capabilities/offline/config-seam.js", () => ({
    coreProfileLayerConfig: (layerId: string) =>
        layerId === "couche-ecrivable"
            ? { write: { enabled: true } }
            : { write: { enabled: false } },
}));

interface Entry {
    id: string;
    layerId?: string;
    localId?: string;
    state?: string;
    quarantine?: string;
    attempts?: number;
}

let entries: Entry[];
let updates: Array<[string, string, unknown]>;
let removals: string[];

/** Monte un faux store de file, ou aucun store du tout. */
function mountOutbox(list: Entry[] | null): void {
    entries = list ?? [];
    updates = [];
    removals = [];
    // ⚠️ `StorageContract.DB` est un ACCESSEUR en lecture seule — `init()` est son unique
    // point d'écriture, et c'est ce que fait `push-engine.test.js`. Écrire la propriété
    // directement jette « Cannot set property DB ».
    const db =
        list === null
            ? null
            : {
                  _ensureModule: (name: string) =>
                      name === "Outbox"
                          ? {
                                list: async () => entries,
                                updateState: async (id: string, state: string, patch: unknown) => {
                                    updates.push([id, state, patch]);
                                },
                                remove: async (id: string) => {
                                    removals.push(id);
                                },
                            }
                          : null,
              };
    (StorageContract as unknown as { init: (m: unknown) => void }).init({
        get DB() {
            return db;
        },
        isAvailable: () => db !== null,
    });
}

const quarantined = (over: Partial<Entry> = {}): Entry => ({
    id: "create:sites:loc:abc:1",
    layerId: "sites",
    localId: "loc:abc",
    state: "quarantined",
    quarantine: "retryBudgetExhausted",
    attempts: 3,
    ...over,
});

beforeEach(() => {
    mountOutbox([quarantined()]);
});

afterEach(() => {
    // 🛑 `StorageContract.init()` écrit un SINGLETON de module : sans cette remise à zéro, le
    // faux store de cette suite survit à son fichier et se fait lire par les suivantes.
    // Trouvé en se trompant — `offline-engine-entry.test.js` passait isolé et cassait en suite
    // complète, ce qui ressemblait exactement à une régression de mon code.
    (StorageContract as unknown as { init: (m: unknown) => void }).init({
        get DB() {
            return null;
        },
        isAvailable: () => false,
    });
});

describe("requeueQuarantined — la cause levée, et seulement elle", () => {
    it("`retryBudgetExhausted` repasse en `pending`, budget REMIS À ZÉRO", async () => {
        const out = await requeueQuarantined("create:sites:loc:abc:1");
        expect(out).toEqual({ ok: true });
        // 🛑 Sans la remise à zéro, l'entrée retomberait en quarantaine au premier échec :
        // son budget est déjà épuisé, c'est précisément ce qui l'y a mise.
        expect(updates).toEqual([
            ["create:sites:loc:abc:1", "pending", { attempts: 0, quarantine: null }],
        ]);
    });

    it("`layerNoLongerWritable` est remise en file SI la couche écrit de nouveau", async () => {
        mountOutbox([
            quarantined({ quarantine: "layerNoLongerWritable", layerId: "couche-ecrivable" }),
        ]);
        expect(await requeueQuarantined("create:sites:loc:abc:1")).toEqual({ ok: true });
    });

    it("`layerNoLongerWritable` est REFUSÉE tant que la couche n'écrit pas", async () => {
        // La cause est VÉRIFIABLE : on la constate levée plutôt que de l'espérer. Remettre en
        // file une couche qui n'écrit toujours pas la renverrait en quarantaine au premier
        // drain, en consommant son budget pour rien.
        mountOutbox([quarantined({ quarantine: "layerNoLongerWritable", layerId: "sites" })]);
        expect(await requeueQuarantined("create:sites:loc:abc:1")).toEqual({
            ok: false,
            refused: "causeStillPresent",
        });
        expect(updates).toEqual([]);
    });

    it("`notImplementedByServer` est rejouable — le serveur peut avoir été mis à jour", async () => {
        // B-199. La levée de cause est le déploiement d'une version qui connaît le verbe : rien
        // ici ne peut la constater — le seul moyen serait de refaire l'appel, c'est-à-dire le
        // rejeu lui-même. Donc on croit l'opérateur, exactement comme pour un budget épuisé.
        // ⚠️ Le budget est aussi remis à zéro : l'entrée est arrivée là en QUARANTAINE
        // IMMÉDIATE, à `attempts: 1` — sans la remise à zéro elle repartirait avec un budget
        // entamé pour une cause qui ne lui appartient pas.
        mountOutbox([quarantined({ quarantine: "notImplementedByServer", attempts: 1 })]);
        expect(await requeueQuarantined("create:sites:loc:abc:1")).toEqual({ ok: true });
        expect(updates).toEqual([
            ["create:sites:loc:abc:1", "pending", { attempts: 0, quarantine: null }],
        ]);
    });

    it.each(["deletedOnServer", "rejectedByServer"])(
        "%s N'EST PAS rejouable — sa cause ne se lève pas",
        async (reason) => {
            mountOutbox([quarantined({ quarantine: reason })]);
            expect(await requeueQuarantined("create:sites:loc:abc:1")).toEqual({
                ok: false,
                refused: "causeNotLiftable",
            });
            expect(updates, "rejouer recréerait une entité supprimée côté serveur").toEqual([]);
        }
    );

    it("une entrée qui n'est PAS en quarantaine est refusée", async () => {
        mountOutbox([quarantined({ state: "failed" })]);
        expect(await requeueQuarantined("create:sites:loc:abc:1")).toEqual({
            ok: false,
            refused: "notQuarantined",
        });
    });

    it("une entrée inconnue est refusée, sans jeter", async () => {
        expect(await requeueQuarantined("inexistante")).toEqual({ ok: false, refused: "notFound" });
    });

    it("sans moteur câblé, la sortie est refusée plutôt que silencieuse", async () => {
        mountOutbox(null);
        expect(await requeueQuarantined("create:sites:loc:abc:1")).toEqual({
            ok: false,
            refused: "engineUnavailable",
        });
    });
});

describe("discardQuarantined — la confirmation n'est PAS un booléen", () => {
    it("détruit quand le `localId` rendu correspond", async () => {
        const out = await discardQuarantined("create:sites:loc:abc:1", "loc:abc");
        expect(out).toEqual({ ok: true });
        expect(removals).toEqual(["create:sites:loc:abc:1"]);
    });

    it("🛑 REFUSE quand la confirmation ne correspond pas", async () => {
        // C'est ce qui rend structurellement vrai « l'opérateur a vu ce qu'il jette » : le
        // `localId` ne se connaît qu'en ayant listé l'entrée. Un `{confirmed: true}` se pose
        // depuis n'importe quel code sans que rien n'ait été montré.
        expect(await discardQuarantined("create:sites:loc:abc:1", "loc:autre")).toEqual({
            ok: false,
            refused: "confirmationMismatch",
        });
        expect(removals, "aucune saisie ne doit partir sans confirmation juste").toEqual([]);
    });

    it("REFUSE une confirmation vide", async () => {
        expect(await discardQuarantined("create:sites:loc:abc:1", "")).toEqual({
            ok: false,
            refused: "confirmationMismatch",
        });
        expect(removals).toEqual([]);
    });

    it("ne détruit QUE ce qui est en quarantaine", async () => {
        // Une entrée `pending` ou `failed` a déjà une sortie : le drain. La détruire ici
        // serait une perte que rien ne justifie.
        mountOutbox([quarantined({ state: "pending" })]);
        expect(await discardQuarantined("create:sites:loc:abc:1", "loc:abc")).toEqual({
            ok: false,
            refused: "notQuarantined",
        });
        expect(removals).toEqual([]);
    });
});
