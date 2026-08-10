/**
 * Schéma v4 — `features` et `outbox` (tâche 3.4).
 *
 * Trois choses sont éprouvées ici, et une seule est structurelle :
 *  1. la forme du schéma (stores, clés, index) ;
 *  2. **B-03 corrigé DANS LA CLÉ** — c'est la garde qui compte, et elle a été vue rougir ;
 *  3. l'inatteignabilité par l'éviction, qui est un fait de NOM DE STORE et non de champ.
 *
 * ⚠️ `fake-indexeddb`, comme `storage-helper-open-database.test.js` : le mock maison du reste
 * de la suite offline ne sait produire ni `versionchange`, ni index composé, ni `autoIncrement`.
 */

import "fake-indexeddb/auto";
// ⚠️ `?raw` et non `readFileSync(new URL(..., import.meta.url))` : sous vitest,
// `import.meta.url` n'est PAS un URL `file:` et la lecture jette `ERR_INVALID_URL_SCHEME`.
// Mesuré deux fois dans ce dépôt ; la résolution vite est la forme qui marche.
import evictionSource from "../../../src/capabilities/offline/db/eviction.ts?raw";
import { IndexedDB } from "../../../src/capabilities/offline/db/indexeddb.ts";

const DB_NAME = "geoleaf-db";

afterEach(async () => {
    const handle = IndexedDB._db;
    if (handle && typeof handle.close === "function") handle.close();
    IndexedDB._db = null;
    IndexedDB._modules = {};
    await new Promise((resolve) => {
        const req = globalThis.indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
});

describe("v4 — la forme du schéma", () => {
    test("la base s'ouvre en v4 avec les six stores", async () => {
        const db = await IndexedDB.init();
        expect(db.version).toBe(4);
        expect(Array.from(db.objectStoreNames).sort()).toEqual([
            "features",
            "layers",
            "local_images",
            "metadata",
            "outbox",
            "preferences",
        ]);
    });

    test("🛑 `sync_queue` et `sync_backups` ne sont PLUS créés (4.11)", async () => {
        // Ce fichier portait le test inverse — « `sync_queue` SURVIT à la v4, ce n'est pas du
        // legacy, c'est le chemin vivant » — et il était VRAI quand il a été écrit : `addpoi`
        // et `editor` y écrivaient, `poi-restore` et l'export de secours le lisaient.
        //
        // Le Sprint 4 a déplacé les quatre : 4.4b, 4.9, 4.7 et 4.10. Il n'est resté que la
        // restauration de sauvegarde, retirée ici avec sa chaîne — dont le magasin
        // `sync_backups`, qui prétendait protéger d'une purge d'origine tout en vivant DANS la
        // base que cette purge détruit.
        //
        // ⚠️ Le test est retourné plutôt que supprimé : c'est la seule forme qui rougit si
        // quelqu'un recrée l'un des deux magasins. Un simple retrait aurait laissé la
        // recréation passer en silence.
        const db = await IndexedDB.init();
        const created = new Set(Array.from(db.objectStoreNames));
        expect(created.has("sync_queue")).toBe(false);
        expect(created.has("sync_backups")).toBe(false);
    });

    test("`features` porte une clé COMPOSÉE et trois index", async () => {
        const db = await IndexedDB.init();
        const store = db.transaction("features", "readonly").objectStore("features");
        expect(store.keyPath).toEqual(["layerId", "localId"]);
        expect(Array.from(store.indexNames).sort()).toEqual(["serverId", "syncState", "updatedAt"]);
        // Pas d'index `layerId` : la clé composée donne le parcours par couche gratuitement.
        // Un index de plus serait une seconde vérité pour la même question.
        expect(store.indexNames.contains("layerId")).toBe(false);
    });

    test("`outbox` est en autoIncrement, et son index `id` est UNIQUE", async () => {
        const db = await IndexedDB.init();
        const store = db.transaction("outbox", "readonly").objectStore("outbox");
        expect(store.keyPath).toBe("seq");
        expect(store.autoIncrement).toBe(true);
        expect(store.index("id").unique).toBe(true);
        expect(store.index("localId").keyPath).toEqual(["layerId", "localId"]);
    });
});

describe("v4 — B-03 est corrigé DANS LA CLÉ", () => {
    const entry = (id, n) => ({
        id,
        kind: "create",
        layerId: "poi",
        localId: `l${n}`,
        baseVersion: null,
        state: "pending",
        attempts: 0,
        // MÊME horodatage pour les trois : c'est la condition exacte de B-03. Sur
        // `sync_queue` le hasard du suffixe de clé décide alors de l'ordre, et le tri par
        // horodatage — stable — ne fait que le transporter.
        createdAt: 1785600000000,
    });

    test("trois écritures dans la MÊME milliseconde se relisent dans l'ordre d'écriture", async () => {
        await IndexedDB.init();
        const outbox = IndexedDB._ensureModule("Outbox");

        await outbox.append(entry("op-zzz", 1));
        await outbox.append(entry("op-mmm", 2));
        await outbox.append(entry("op-aaa", 3));

        // ⚠️ Les identifiants sont choisis pour que l'ordre LEXICOGRAPHIQUE soit l'inverse de
        // l'ordre d'écriture. Sur l'ancienne clé (`keyPath: "id"`), `getAll()` aurait rendu
        // aaa, mmm, zzz — soit 3, 2, 1. Ici la clé est `seq`, mintée par la base.
        const all = await outbox.list();
        expect(all.map((e) => e.localId)).toEqual(["l1", "l2", "l3"]);
        expect(all.map((e) => e.seq)).toEqual([1, 2, 3]);
    });

    test("l'ordre survit à un filtrage par état — et sans AUCUN tri", async () => {
        await IndexedDB.init();
        const outbox = IndexedDB._ensureModule("Outbox");
        await outbox.append(entry("op-z", 1));
        await outbox.append(entry("op-m", 2));
        await outbox.append(entry("op-a", 3));

        const pending = await outbox.listByState("pending");
        expect(pending.map((e) => e.localId)).toEqual(["l1", "l2", "l3"]);
    });

    test("changer d'état ne DÉPLACE PAS l'entrée dans la file", async () => {
        // Une `failed` qui redevient traitable (critère 4) doit garder sa place : elle a été
        // saisie avant les suivantes, elle se rejoue avant elles.
        await IndexedDB.init();
        const outbox = IndexedDB._ensureModule("Outbox");
        await outbox.append(entry("op-1", 1));
        await outbox.append(entry("op-2", 2));

        await outbox.updateState("op-1", "failed");
        await outbox.updateState("op-1", "pending");

        const all = await outbox.list();
        expect(all.map((e) => e.localId)).toEqual(["l1", "l2"]);
        expect(all[0].seq).toBe(1);
    });

    test("getById, listByEntity et remove — l'adressage par le contrat", async () => {
        await IndexedDB.init();
        const outbox = IndexedDB._ensureModule("Outbox");
        await outbox.append(entry("op-1", 1));
        await outbox.append({ ...entry("op-2", 1), kind: "update" });
        await outbox.append(entry("op-3", 9));

        // `id` est l'ADRESSE du contrat, même s'il ne porte plus l'ordre.
        const found = await outbox.getById("op-2");
        expect(found).toMatchObject({ id: "op-2", kind: "update", seq: 2 });
        expect(await outbox.getById("op-inexistant")).toBeNull();

        // L'index composé sert la coalescence (3.10) : toutes les opérations d'UNE entité.
        const surL1 = await outbox.listByEntity("poi", "l1");
        expect(surL1.map((e) => e.id)).toEqual(["op-1", "op-2"]);
        expect(await outbox.listByEntity("poi", "inconnue")).toEqual([]);

        // `remove` passe par l'index `id` puis supprime par `seq` — l'ordre des autres
        // entrées n'en est pas affecté.
        await outbox.remove("op-1");
        expect(await outbox.count()).toBe(2);
        expect((await outbox.list()).map((e) => e.id)).toEqual(["op-2", "op-3"]);
        // Retirer un id absent ne jette pas : c'est un no-op, pas une erreur.
        await expect(outbox.remove("op-inexistant")).resolves.toBeUndefined();
    });

    test("updateState sur un id absent REJETTE — un état perdu ne se tait pas", async () => {
        await IndexedDB.init();
        const outbox = IndexedDB._ensureModule("Outbox");
        await expect(outbox.updateState("op-fantome", "failed")).rejects.toThrow(
            /no entry with id/
        );
    });

    test("un `seq` fourni par l'appelant est IGNORÉ — le store est le seul minteur", async () => {
        await IndexedDB.init();
        const outbox = IndexedDB._ensureModule("Outbox");
        await outbox.append({ ...entry("op-x", 1), seq: 9999 });
        const [only] = await outbox.list();
        expect(only.seq).toBe(1);
    });

    test("deux entrées de même `id` LÈVENT au lieu de s'écraser en silence", async () => {
        // Sur `keyPath: "id"` la seconde écrasait la première — une saisie disparaissait sans
        // bruit. L'index unique transforme la disparition en échec.
        await IndexedDB.init();
        const outbox = IndexedDB._ensureModule("Outbox");
        await outbox.append(entry("op-doublon", 1));
        await expect(outbox.append(entry("op-doublon", 2))).rejects.toThrow();
        expect(await outbox.count()).toBe(1);
    });
});

describe("v4 — `features` est INATTEIGNABLE par l'éviction", () => {
    test("`eviction.ts` ne nomme qu'un seul store, et ce n'est ni `features` ni `outbox`", () => {
        // 🛑 C'est la garde qui rend la règle du contrat vraie sans dépendre d'un champ.
        // Le jour où l'éviction apprend un second nom de store, elle rougit — et c'est
        // exactement le jour où il faut relire `EvictionClass`.
        const src = evictionSource;
        const stores = [...src.matchAll(/transaction\(\s*\[?\s*["']([a-z_]+)["']/g)].map(
            (m) => m[1]
        );
        const named = [
            ...new Set([...stores, ...(src.match(/STORE = "([a-z_]+)"/) || []).slice(1)]),
        ];

        expect(named.length).toBeGreaterThan(0); // témoin : la garde ne mesure pas le vide
        expect(named).not.toContain("features");
        expect(named).not.toContain("outbox");
        expect(named).toContain("layers");
    });

    test("le CRUD de `features` fonctionne sur la clé composée", async () => {
        await IndexedDB.init();
        const features = IndexedDB._ensureModule("Features");

        const rec = (layerId, localId, syncState = "pending") => ({
            layerId,
            localId,
            serverId: null,
            syncState,
            updatedAt: 1785600000000,
            version: null,
            feature: { type: "Feature", properties: { nom: localId }, geometry: null },
        });

        await features.put(rec("poi", "a"));
        await features.put(rec("poi", "b", "synced"));
        await features.put(rec("autre", "c"));

        expect((await features.get("poi", "a")).feature.properties.nom).toBe("a");
        expect(await features.get("poi", "inexistant")).toBeNull();

        // Le parcours par couche vient de la clé composée, sans index dédié.
        expect((await features.listByLayer("poi")).map((r) => r.localId).sort()).toEqual([
            "a",
            "b",
        ]);
        expect(await features.countByLayer("poi")).toBe(2);
        expect(await features.countByLayer("autre")).toBe(1);

        expect((await features.listByState("pending")).map((r) => r.localId).sort()).toEqual([
            "a",
            "c",
        ]);

        await features.remove("poi", "a");
        expect(await features.countByLayer("poi")).toBe(1);
    });

    test("⚠️ `serverId: null` n'entre PAS dans l'index — une entité créée hors ligne y est invisible", async () => {
        // `null` n'est pas une clé IndexedDB valide. Ce n'est pas un défaut tant que l'index
        // ne sert qu'à retrouver une entité PAR son identifiant serveur (4.5) — mais compter
        // les entités par lui SOUS-COMPTERAIT. Même mécanisme que B.6 (booléens hors index).
        // Le comportement est ASSERTÉ ici pour que personne ne le redécouvre en le prenant
        // pour une perte de données.
        await IndexedDB.init();
        const features = IndexedDB._ensureModule("Features");
        await features.put({
            layerId: "poi",
            localId: "hors-ligne",
            serverId: null,
            syncState: "pending",
            updatedAt: 1,
            version: null,
            feature: {},
        });

        const db = IndexedDB._db;
        const idx = db
            .transaction("features", "readonly")
            .objectStore("features")
            .index("serverId");
        const viaIndex = await new Promise((resolve) => {
            const req = idx.count();
            req.onsuccess = () => resolve(req.result);
        });

        expect(viaIndex).toBe(0); // invisible à l'index…
        expect(await features.countByLayer("poi")).toBe(1); // …mais bien stockée.
    });
});
