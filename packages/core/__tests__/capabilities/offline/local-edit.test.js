/**
 * Tâche 4.4 — L'ÉCRITURE OPTIMISTE, et le premier écrivain de l'`outbox`.
 *
 * L'`outbox` existe depuis 3.4 et comptait **zéro producteur**, core et plugins confondus.
 * Ces tests éprouvent les trois propriétés qui ne se lisent pas dans le code :
 *
 *  1. l'entité ET l'entrée de file atterrissent ensemble, ou pas du tout ;
 *  2. la coalescence ne perd aucune édition et n'en empile aucune en double ;
 *  3. l'invariant S6 tient — le rapatriement ne confère jamais l'éditabilité.
 *
 * Tourne contre `fake-indexeddb` : la transaction inter-stores, l'index composé
 * `[layerId, localId]` et l'index UNIQUE sur `id` sont exactement ce que le mock maison ne
 * sait pas rendre — et c'est sur eux que tout repose. Import différé pour la même raison que
 * `sync-entry-id.test.js`.
 */

const DB_NAME = "geoleaf-edit-test";

function feature(title) {
    return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-60.64, -32.94] },
        properties: { title },
    };
}

describe("4.4 — écriture optimiste", () => {
    let IndexedDB;
    let StorageContract;
    let applyEdit;
    let layerConfigs;
    let open;

    const request = (req) =>
        new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

    const readAll = (store) =>
        request(IndexedDB._db.transaction([store], "readonly").objectStore(store).getAll());

    beforeAll(async () => {
        await import("fake-indexeddb/auto");
        ({ IndexedDB } = await import("../../../src/capabilities/offline/db/indexeddb.js"));
        ({ StorageContract } = await import("../../../src/kernel/shared/storage-contract.js"));
        ({ applyEdit } = await import("../../../src/capabilities/offline/write/local-edit-api.js"));
    });

    beforeEach(async () => {
        open = [];
        layerConfigs = [
            { id: "sites", edition: { create: true, update: true, delete: true } },
            // Couche rapatriable en LECTURE seule — le sujet de l'invariant S6.
            { id: "villes", offline: { enabled: true }, edition: { create: false } },
            // Éditable, mais sans droit de suppression — ce que `enableEditionFull` gouvernait
            // réellement, quoi que son nom ait laissé croire.
            { id: "readonly_delete", edition: { create: true, update: true } },
            // 🛑 Les trois fixtures de la sûreté-par-défaut (5.9 / V1). Elles sont distinctes
            // parce qu'elles tombent sur des branches distinctes, et qu'une seule d'entre
            // elles laisserait passer la mutation des deux autres.
            /** Aucun bloc `edition` : rien n'est accordé. */
            { id: "muette" },
            /** Bloc présent mais VIDE : déclarer ne vaut pas accorder. */
            { id: "vide", edition: {} },
            /** N'accorde QUE `update` : ne doit conférer ni `create` ni `delete`. */
            { id: "update_seul", edition: { update: true } },
        ];
        globalThis.GeoLeaf = {
            Config: { getActiveProfile: () => ({ layers: layerConfigs }) },
        };
        // ⚠️ `close()` et non `_db = null` : la façade CACHE les instances de sous-modules
        // dans `_modules`, liées à la connexion qui les a créées. Remettre `_db` à la main
        // laisse ce cache en place, et un autre fichier de test qui ouvre sa propre base
        // écrit alors dans la connexion PRÉCÉDENTE. `close()` vide les deux — c'est
        // l'invariant que la façade tient déjà, et le contourner l'a fait mentir.
        IndexedDB.close();
        IndexedDB._dbName = DB_NAME;
        await IndexedDB.init();
        open.push(IndexedDB._db);
        StorageContract.init({
            get DB() {
                return IndexedDB;
            },
            isAvailable: () => true,
        });
    });

    afterEach(async () => {
        for (const db of open) db.close();
        IndexedDB.close();
        delete globalThis.GeoLeaf;
        await new Promise((resolve) => {
            const req = globalThis.indexedDB.deleteDatabase(DB_NAME);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
        });
    });

    // ── ① les deux moitiés atterrissent ensemble ──────────────────────────────────────────
    test("une création écrit l'entité ET l'entrée de file, avec une identité cliente frappée", async () => {
        const report = await applyEdit({
            layerId: "sites",
            kind: "create",
            feature: feature("Saisie terrain"),
        });

        expect(report.refused).toBeNull();
        expect(report.queued).toBe(true);
        expect(report.localId).toMatch(/^loc:/);

        const features = await readAll("features");
        expect(features).toHaveLength(1);
        expect(features[0].syncState).toBe("pending");
        expect(features[0].serverId).toBeNull();
        expect(features[0].feature.properties.title).toBe("Saisie terrain");

        const outbox = await readAll("outbox");
        expect(outbox).toHaveLength(1);
        expect(outbox[0].kind).toBe("create");
        expect(outbox[0].localId).toBe(report.localId);
        expect(outbox[0].state).toBe("pending");

        // Et la lecture locale de 4.3 la rend : « l'utilisateur voit sa propre saisie ».
        const collection = await IndexedDB.getLayerFeatureCollection("sites");
        expect(collection.features).toHaveLength(1);
    });

    // ── ② la coalescence, ligne par ligne ─────────────────────────────────────────────────
    test("create puis update → l'entrée reste un `create`, et il porte l'état le plus récent", async () => {
        const created = await applyEdit({
            layerId: "sites",
            kind: "create",
            feature: feature("v1"),
        });
        const updated = await applyEdit({
            layerId: "sites",
            kind: "update",
            localId: created.localId,
            feature: feature("v2"),
        });

        expect(updated.queued).toBe(false);
        expect(updated.coalescedInto).toBe(created.entryId);

        const outbox = await readAll("outbox");
        expect(outbox).toHaveLength(1);
        expect(outbox[0].kind).toBe("create");

        // 🛑 Ce qui rend la fusion correcte : l'entrée ne porte PAS la charge utile, elle
        // référence `localId`. La charge est l'enregistrement, et il est à jour.
        const features = await readAll("features");
        expect(features[0].feature.properties.title).toBe("v2");
    });

    test("update puis update → une seule entrée, pas deux", async () => {
        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId: "srv:7",
            feature: feature("a"),
        });
        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId: "srv:7",
            feature: feature("b"),
        });

        expect(await readAll("outbox")).toHaveLength(1);
        expect((await readAll("features"))[0].feature.properties.title).toBe("b");
    });

    test("create puis delete → ANNULATION : ni entrée, ni entité", async () => {
        const created = await applyEdit({
            layerId: "sites",
            kind: "create",
            feature: feature("regret"),
        });
        const deleted = await applyEdit({
            layerId: "sites",
            kind: "delete",
            localId: created.localId,
        });

        expect(deleted.annulled).toBe(true);
        // Le serveur ne l'a jamais vue : pousser un DELETE sur une identité inconnue de lui
        // serait au mieux du bruit, au pire une erreur qui bloque la file.
        expect(await readAll("outbox")).toHaveLength(0);
        expect(await readAll("features")).toHaveLength(0);
    });

    test("update puis delete → le delete REMPLACE l'update", async () => {
        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId: "srv:9",
            feature: feature("x"),
        });
        await applyEdit({ layerId: "sites", kind: "delete", localId: "srv:9" });

        const outbox = await readAll("outbox");
        expect(outbox).toHaveLength(1);
        expect(outbox[0].kind).toBe("delete");
    });

    test("une entrée `inFlight` ne coalesce PAS — elle est déjà sur le fil", async () => {
        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId: "srv:3",
            feature: feature("p"),
        });
        const outbox = IndexedDB._ensureModule("Outbox");
        const [entry] = await outbox.list();
        await outbox.updateState(entry.id, "inFlight");

        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId: "srv:3",
            feature: feature("q"),
        });

        // Fusionner ferait diverger ce qui part sur le fil de ce que la file croit envoyer.
        const all = await readAll("outbox");
        expect(all).toHaveLength(2);
        expect(all.map((e) => e.state).sort()).toEqual(["inFlight", "pending"]);
    });

    test("deux entrées frappées dans la MÊME milliseconde ne collisionnent pas", async () => {
        // 🛑 L'index `id` de l'`outbox` est UNIQUE : une collision JETTE au lieu d'écraser
        // (correctif B-03). C'est le bon comportement, et c'est lui qui a démasqué un
        // identifiant composé du seul `Date.now()` — deux éditions de la même entité dans la
        // même milliseconde frappaient le même id, et la transaction échouait sur un cas
        // parfaitement légitime. Le défaut ne se voyait que sous la suite complète, assez
        // rapide pour que les deux appels tombent dans la même milliseconde.
        vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
        try {
            await applyEdit({
                layerId: "sites",
                kind: "update",
                localId: "srv:11",
                feature: feature("un"),
            });
            const outbox = IndexedDB._ensureModule("Outbox");
            const [first] = await outbox.list();
            await outbox.updateState(first.id, "inFlight");

            await applyEdit({
                layerId: "sites",
                kind: "update",
                localId: "srv:11",
                feature: feature("deux"),
            });

            const all = await readAll("outbox");
            expect(all).toHaveLength(2);
            expect(new Set(all.map((e) => e.id)).size).toBe(2);
        } finally {
            vi.mocked(Date.now).mockRestore();
        }
    });

    // ── ②bis — une édition PARTIELLE ne détruit pas ce qu'elle n'apporte pas ─────────────
    test("une modification sans géométrie CONSERVE celle du magasin", async () => {
        // 🛑 Le cas réel, mesuré dans le produit : `updateExistingPoi` journalise « missing
        // geometry » et met en file quand même. Renommer un point ne renvoie pas sa position ;
        // écraser avec `undefined` la ferait disparaître.
        const features = IndexedDB._ensureModule("Features");
        await features.put({
            layerId: "sites",
            localId: "srv:20",
            serverId: "20",
            syncState: "synced",
            updatedAt: 1,
            version: null,
            feature: feature("nom d'origine"),
        });

        const report = await applyEdit({ layerId: "sites", kind: "update", localId: "srv:20" });

        expect(report.refused).toBeNull();
        const stored = (await readAll("features"))[0];
        expect(stored.feature.geometry).toEqual({
            type: "Point",
            coordinates: [-60.64, -32.94],
        });
    });

    test("une CRÉATION sans position est refusée — garde sur un état inatteignable", async () => {
        // Le formulaire porte un champ `latlng`, alimenté par le clic de placement : une
        // création sans position n'existe pas dans le produit. Refuser ici ne perd donc aucune
        // saisie — c'est ce qui distingue cette garde d'un refus de mise en file.
        const report = await applyEdit({
            layerId: "sites",
            kind: "create",
            feature: { type: "Feature", geometry: null, properties: { title: "sans lieu" } },
        });

        expect(report.refused).toBe("geometryRequired");
        expect(await readAll("features")).toHaveLength(0);
    });

    // ── ③ la suppression locale disparaît de la carte, sans perdre son `serverId` ─────────
    test("une suppression en attente sort de la lecture locale, mais garde son `serverId`", async () => {
        const features = IndexedDB._ensureModule("Features");
        await features.put({
            layerId: "sites",
            localId: "srv:42",
            serverId: "42",
            syncState: "synced",
            updatedAt: 1,
            version: null,
            feature: feature("rapatriée"),
        });

        await applyEdit({ layerId: "sites", kind: "delete", localId: "srv:42" });

        // Hors de la carte…
        const collection = await IndexedDB.getLayerFeatureCollection("sites");
        expect(collection.features).toHaveLength(0);

        // …mais toujours en base : l'entrée d'outbox ne porte que le `localId`, donc
        // l'enregistrement est le SEUL endroit où le push trouvera quoi supprimer.
        const stored = await readAll("features");
        expect(stored).toHaveLength(1);
        expect(stored[0].serverId).toBe("42");
        // ⚠️ ET L'ENTITÉ ELLE-MÊME SURVIT. Cette ligne manquait à la première rédaction : la
        // mutation qui remplaçait la géométrie conservée par `input.feature` — `undefined`
        // pour une suppression — sortait VERTE. Le test n'éprouvait que le `serverId`, donc
        // une suppression pouvait effacer la donnée en silence sans qu'il bronche.
        expect(stored[0].feature).toBeTruthy();
        expect(stored[0].feature.properties.title).toBe("rapatriée");
    });

    // ── ④ invariant S6 ────────────────────────────────────────────────────────────────────
    test("une couche rapatriable mais NON éditable refuse l'édition (invariant S6)", async () => {
        const report = await applyEdit({
            layerId: "villes",
            kind: "update",
            localId: "srv:1",
            feature: feature("interdit"),
        });

        expect(report.refused).toBe("layerNotEditable");
        expect(await readAll("outbox")).toHaveLength(0);
        expect(await readAll("features")).toHaveLength(0);
    });

    test("`edition.delete` absent interdit la SUPPRESSION, pas la modification", async () => {
        const ok = await applyEdit({
            layerId: "readonly_delete",
            kind: "update",
            localId: "srv:1",
            feature: feature("ok"),
        });
        expect(ok.refused).toBeNull();

        const ko = await applyEdit({
            layerId: "readonly_delete",
            kind: "delete",
            localId: "srv:1",
        });
        expect(ko.refused).toBe("deleteNotPermitted");
    });

    // ── 5.9 / décision V1 — la sûreté par défaut, en trois gardes indissociables ─────────
    //
    // 🛑 Elles ne se remplacent pas l'une l'autre, et c'est vérifié par mutation :
    //   · la garde « muette » sort VERTE si le défaut devient `edition ? (x ?? true) : false`
    //     — il faut « vide » pour l'attraper ;
    //   · la garde « vide » sort VERTE si le défaut devient `!== false` — il faut « muette » ;
    //   · ni l'une ni l'autre ne voit une clé qui en implique une autre — il faut
    //     « update_seul ».
    // Écrire une seule des trois donnerait une garde qui prétend tenir ce qu'elle ne tient pas.

    test("une couche SANS bloc `edition` n'accorde rien — ni create, ni update, ni delete", async () => {
        const created = await applyEdit({
            layerId: "muette",
            kind: "create",
            localId: "loc:1",
            feature: feature("x"),
        });
        expect(created.refused).toBe("layerNotEditable");

        const updated = await applyEdit({
            layerId: "muette",
            kind: "update",
            localId: "srv:1",
            feature: feature("x"),
        });
        expect(updated.refused).toBe("layerNotEditable");

        const deleted = await applyEdit({ layerId: "muette", kind: "delete", localId: "srv:1" });
        expect(deleted.refused).toBe("deleteNotPermitted");

        expect(await readAll("outbox")).toHaveLength(0);
    });

    test("un bloc `edition` VIDE n'accorde rien non plus — déclarer n'est pas accorder", async () => {
        const created = await applyEdit({
            layerId: "vide",
            kind: "create",
            localId: "loc:2",
            feature: feature("x"),
        });
        expect(created.refused).toBe("layerNotEditable");

        const deleted = await applyEdit({ layerId: "vide", kind: "delete", localId: "srv:2" });
        expect(deleted.refused).toBe("deleteNotPermitted");

        expect(await readAll("outbox")).toHaveLength(0);
    });

    test("aucune clé n'en implique une autre : `update` seul refuse `create` ET `delete`", async () => {
        const updated = await applyEdit({
            layerId: "update_seul",
            kind: "update",
            localId: "srv:3",
            feature: feature("ok"),
        });
        expect(updated.refused).toBeNull();

        const created = await applyEdit({
            layerId: "update_seul",
            kind: "create",
            localId: "loc:3",
            feature: feature("x"),
        });
        expect(created.refused).toBe("layerNotEditable");

        const deleted = await applyEdit({
            layerId: "update_seul",
            kind: "delete",
            localId: "srv:3",
        });
        expect(deleted.refused).toBe("deleteNotPermitted");
    });

    test("une couche absente du profil refuse en `layerUnknown`", async () => {
        const report = await applyEdit({
            layerId: "inexistante",
            kind: "update",
            localId: "x",
            feature: feature("z"),
        });
        expect(report.refused).toBe("layerUnknown");
    });

    test("sans moteur de stockage, l'édition refuse au lieu de disparaître", async () => {
        StorageContract.init({
            get DB() {
                return null;
            },
            isAvailable: () => false,
        });
        const report = await applyEdit({
            layerId: "sites",
            kind: "update",
            localId: "srv:1",
            feature: feature("z"),
        });
        expect(report.refused).toBe("engineUnavailable");
    });
});
