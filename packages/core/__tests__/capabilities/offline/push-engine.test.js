/**
 * Tâche 4.5 — LE PUSH, et la réconciliation d'identité.
 *
 * 4.4 a donné à l'`outbox` son premier écrivain ; ces tests éprouvent son premier lecteur
 * réel. Quatre propriétés qui ne se lisent pas dans le code :
 *
 *  1. l'identité CLIENTE part sur le fil — sans elle, aucun rejeu ne peut être idempotent ;
 *  2. un **409 est un SUCCÈS** : le serveur dit « je l'ai déjà » ;
 *  3. l'identifiant serveur revient DANS L'ENREGISTREMENT, pas dans la file ;
 *  4. un échec laisse la saisie en file — `failed` n'est pas terminal.
 *
 * Tourne contre `fake-indexeddb` avec un `fetch` sous contrôle : ce qui est asserté est le
 * corps réellement envoyé et l'état réellement persisté, jamais l'écho d'un mock.
 */

const DB_NAME = "geoleaf-push-test";

function feature(title) {
    return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-60.64, -32.94] },
        properties: { title, secret: "ne doit jamais partir" },
    };
}

describe("4.5 — push et réconciliation d'identité", () => {
    let IndexedDB;
    let StorageContract;
    let applyEdit;
    let pushOutbox;
    let layerConfigs;
    let fetchSpy;
    let open;

    const request = (req) =>
        new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

    const readAll = (store) =>
        request(IndexedDB._db.transaction([store], "readonly").objectStore(store).getAll());

    /** Un serveur sous contrôle : statut et charge décidés par le test. */
    function serve(handler) {
        fetchSpy = vi.fn(async (url, init) => {
            const outcome = handler(String(url), init) ?? {};
            return {
                ok: outcome.status === undefined || outcome.status < 400,
                status: outcome.status ?? 200,
                json: async () => outcome.body ?? null,
            };
        });
        globalThis.fetch = fetchSpy;
    }

    const bodyOf = (call) => JSON.parse(call[1].body);

    beforeAll(async () => {
        await import("fake-indexeddb/auto");
        ({ IndexedDB } = await import("../../../src/capabilities/offline/db/indexeddb.js"));
        ({ StorageContract } = await import("../../../src/kernel/shared/storage-contract.js"));
        ({ applyEdit } = await import("../../../src/capabilities/offline/write/local-edit-api.js"));
        ({ pushOutbox } = await import("../../../src/capabilities/offline/write/push-engine.js"));
    });

    beforeEach(async () => {
        open = [];
        layerConfigs = [
            {
                id: "sites",
                edition: { create: true, update: true, delete: true },
                write: {
                    enabled: true,
                    endpoint: "https://backend.test/sites",
                    dialect: "collection",
                    geometryProperty: "geom",
                    properties: ["title"],
                },
            },
            // Éditable, mais sans cible d'écriture déclarée.
            { id: "orphan", edition: { create: true, update: true, delete: true } },
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
        delete globalThis.fetch;
        await new Promise((resolve) => {
            const req = globalThis.indexedDB.deleteDatabase(DB_NAME);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
        });
    });

    // ── ① l'identité cliente part, et la liste blanche tient ─────────────────────────────
    test("le corps porte `local_id` et RIEN hors de la liste blanche", async () => {
        const created = await applyEdit({
            layerId: "sites",
            kind: "create",
            feature: feature("Nouveau site"),
        });
        serve(() => ({ status: 201, body: [{ id: 77 }] }));

        await pushOutbox();

        const body = bodyOf(fetchSpy.mock.calls[0]);
        // 🛑 Sans cette clé, aucun rejeu ne peut être idempotent : c'est elle que la
        // contrainte UNIQUE du serveur refuse une seconde fois.
        expect(body.local_id).toBe(created.localId);
        expect(body.title).toBe("Nouveau site");
        expect(body.geom).toEqual({ type: "Point", coordinates: [-60.64, -32.94] });
        // La liste blanche est une liste blanche.
        expect(body.secret).toBeUndefined();
    });

    // ── ①bis L'ORDRE DE REJEU (B-126) ────────────────────────────────────────────────
    test("🛑 une entrée `failed` PLUS ANCIENNE part AVANT une `pending` plus récente", async () => {
        // Le drain lisait `[...listByState("pending"), ...listByState("failed")]` — deux
        // lectures d'index mises bout à bout, donc TOUTES les `pending` avant TOUTES les
        // `failed`, quel que soit leur rang de saisie. C'est la forme exacte que B-03 avait
        // fait corriger sur la file v3, revenue sur l'outbox.
        //
        // ⚠️ Le cas se produit par la fenêtre `inFlight`, qui n'est PAS fusionnable : une
        // édition faite pendant qu'un push est en vol empile une seconde entrée, et si ce
        // push échoue l'entité porte une `failed` de rang N et une `pending` de rang N+1.
        const first = await applyEdit({
            layerId: "sites",
            kind: "create",
            feature: feature("Saisie 1"),
        });
        const second = await applyEdit({
            layerId: "sites",
            kind: "create",
            localId: "autre-entite",
            feature: feature("Saisie 2"),
        });

        // On met la PREMIÈRE en `failed` : elle garde son `seq`, donc son rang de saisie.
        const outbox = IndexedDB._ensureModule("Outbox");
        const queued = await outbox.list();
        const older = queued.find((e) => e.localId === first.localId);
        await outbox.updateState(older.id, "failed");

        serve(() => ({ status: 201, body: [{ id: 1 }] }));
        await pushOutbox();

        // L'ordre des requêtes EST l'ordre de saisie — pas l'ordre des états.
        const sent = fetchSpy.mock.calls.map((c) => JSON.parse(c[1].body).local_id);
        expect(sent).toEqual([first.localId, second.localId]);
    });

    // ── ①ter LE BUDGET DE REJEU (B-125) ─────────────────────────────────────────────
    test("🛑 trois échecs mettent l'entrée en QUARANTAINE — et ne la détruisent PAS", async () => {
        // Sans plafond, une entrée qui échoue est rejouée indéfiniment et `quarantined` n'est
        // atteint par aucun chemin : trois `QuarantineReason` déclarés, zéro producteur.
        await applyEdit({ layerId: "sites", kind: "create", feature: feature("Obstinée") });
        serve(() => ({ status: 500, body: {} }));

        const reports = [await pushOutbox(), await pushOutbox(), await pushOutbox()];

        expect(reports.map((r) => r.failed)).toEqual([1, 1, 1]);

        const rows = await readAll("outbox");
        expect(rows, "le contrat interdit de détruire une entrée").toHaveLength(1);
        expect(rows[0].state).toBe("quarantined");
        expect(rows[0].attempts).toBe(3);
        // 🛑 LE MOTIF SUIT LE DERNIER ÉCHEC, il ne dit pas seulement « budget épuisé ».
        //
        // ⚠️ **CETTE ASSERTION ATTENDAIT `rejectedByServer`, ET ELLE VERROUILLAIT UN DÉFAUT
        // (B-199).** Son commentaire disait « ici le serveur a REFUSÉ trois fois (500) » — or un
        // 500 n'est pas un refus, c'est une panne. `pushOne` n'avait alors qu'une seule branche
        // pour tout le spectre non-409/non-404, donc le mot « refusé » y était vrai par
        // construction et faux en fait. Comme `rejectedByServer` est exclu de `REQUEUEABLE`, ce
        // test gravait la perte : une maintenance serveur rendait la saisie indéracinable
        // autrement qu'en la détruisant. Le motif attendu suit maintenant la CLASSE du statut.
        expect(rows[0].quarantine).toBe("retryBudgetExhausted");
    });

    test("🛑 un 404 sur un `update` = l'entité a disparu côté serveur, quarantaine IMMÉDIATE", async () => {
        // Rejouer trois fois une entité que le serveur a supprimée ne peut ni la recréer ni la
        // modifier. C'est une décision de produit, pas un incident de transport : elle doit
        // remonter maintenant. `deletedOnServer` était le dernier `QuarantineReason` déclaré
        // sans producteur — le contrat qualifie lui-même un tel membre d'« indiscernable d'une
        // faute de frappe ».
        const created = await applyEdit({
            layerId: "sites",
            kind: "create",
            feature: feature("Effacée ailleurs"),
        });
        serve(() => ({ status: 201, body: [{ id: 91 }] }));
        await pushOutbox();
        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId: created.localId,
            feature: feature("Renommée"),
        });
        serve(() => ({ status: 404, body: {} }));

        await pushOutbox();

        const rows = await readAll("outbox");
        expect(rows[0].state).toBe("quarantined");
        expect(rows[0].quarantine).toBe("deletedOnServer");
        expect(rows[0].attempts, "le budget est COURT-CIRCUITÉ, pas consommé").toBe(1);
    });

    test("🛑 un 404 sur un `create` n'est PAS une suppression serveur — c'est l'endpoint", async () => {
        // La contre-épreuve : sans elle, tout 404 deviendrait `deletedOnServer` et une couche
        // mal configurée serait mise en quarantaine sous un motif qui accuse le serveur.
        await applyEdit({ layerId: "sites", kind: "create", feature: feature("Endpoint faux") });
        serve(() => ({ status: 404, body: {} }));

        await pushOutbox();

        const rows = await readAll("outbox");
        expect(rows[0].state, "un create en 404 reste rejouable").toBe("failed");
        expect(rows[0].quarantine).toBeUndefined();
    });

    test("🛑 un réseau MUET épuisé ne se nomme pas comme un refus serveur", async () => {
        // La contre-épreuve du motif : sans elle, `rejectedByServer` pourrait être écrit dans
        // les deux cas et le test ci-dessus passerait quand même. Deux causes, deux noms.
        await applyEdit({ layerId: "sites", kind: "create", feature: feature("Muette") });
        fetchSpy.mockRejectedValue(new Error("network down"));

        await pushOutbox();
        await pushOutbox();
        await pushOutbox();

        const rows = await readAll("outbox");
        expect(rows[0].state).toBe("quarantined");
        expect(rows[0].quarantine).toBe("retryBudgetExhausted");
    });

    test("🛑 une entrée en quarantaine N'EST PLUS rejouée", async () => {
        // La contre-épreuve : sans elle, un plafond qui marque sans écarter passerait le test
        // ci-dessus tout en laissant l'entrée boucler.
        await applyEdit({ layerId: "sites", kind: "create", feature: feature("Écartée") });
        serve(() => ({ status: 500, body: {} }));
        await pushOutbox();
        await pushOutbox();
        await pushOutbox();
        const callsBefore = fetchSpy.mock.calls.length;

        const after = await pushOutbox();

        expect(after.attempted, "une entrée écartée ne compte plus parmi les tentées").toBe(0);
        expect(fetchSpy.mock.calls.length, "aucun envoi de plus").toBe(callsBefore);
    });

    test("🛑 une couche sans cible d'écriture part en quarantaine IMMÉDIATEMENT", async () => {
        // Rejouer trois fois une couche qui a perdu son bloc `write` ne fait qu'attendre trois
        // fois. `layerNoLongerWritable` existe exactement pour ça — et c'est son PREMIER
        // producteur : le contrat le déclarait depuis l'Étape 1bis sans que rien ne l'écrive.
        // `orphan` est éditable et ne déclare AUCUNE cible d'écriture — le harnais la porte
        // déjà pour ce cas précis.
        await applyEdit({ layerId: "orphan", kind: "create", feature: feature("Orpheline") });

        const report = await pushOutbox();

        expect(report.failed).toBe(1);
        const rows = await readAll("outbox");
        expect(rows[0].state).toBe("quarantined");
        expect(rows[0].attempts, "le budget est COURT-CIRCUITÉ, pas consommé").toBe(1);
        expect(rows[0].quarantine).toBe("layerNoLongerWritable");
    });

    // ── ①quater LA CLASSE DU STATUT HTTP DÉCIDE (B-199) ──────────────────────────────────
    //
    // 🛑 Jusqu'au 09/08/2026, `pushOne` avait UNE SEULE branche pour tout ce qui n'est ni 409
    // ni 404 : `rejectedByServer`. Un 503 de maintenance et un 403 définitif y étaient le même
    // fait. Comme ce motif est exclu de `REQUEUEABLE`, une panne serveur transitoire épuisait
    // le budget puis rendait la saisie NON REJOUABLE — sa seule sortie devenait
    // `discardQuarantined`, c'est-à-dire la destruction. Les trois tests ci-dessous tiennent
    // les trois classes, et le troisième est la contre-épreuve sans laquelle un correctif qui
    // rendrait TOUT rejouable passerait les deux premiers.

    test("🛑 un 503 épuisé est un budget épuisé, PAS un refus — l'entrée reste rejouable", async () => {
        // Le cas qui porte le coût : maintenance serveur, ou un opérateur qui appuie trois fois
        // sur « Réessayer ». `attempts` est persistant et cumulatif, donc les trois échecs
        // peuvent s'étaler sur des jours.
        await applyEdit({ layerId: "sites", kind: "create", feature: feature("Maintenance") });
        serve(() => ({ status: 503, body: {} }));

        await pushOutbox();
        await pushOutbox();
        await pushOutbox();

        const rows = await readAll("outbox");
        expect(rows[0].state).toBe("quarantined");
        expect(rows[0].attempts).toBe(3);
        // Le motif décide de la SORTIE : `retryBudgetExhausted` est dans `REQUEUEABLE`,
        // `rejectedByServer` ne l'est pas. Écrire le second ici condamnait la saisie.
        expect(rows[0].quarantine).toBe("retryBudgetExhausted");
    });

    test("🛑 un 501 ne consomme PAS le budget — le serveur ne connaît pas le verbe", async () => {
        // Rejouer trois fois un verbe que le serveur déclare ne pas implémenter ne fait
        // qu'attendre trois fois — même argument que le 404 sur `update`. Le motif est
        // néanmoins REJOUABLE : la levée de cause est la mise à jour du serveur, invérifiable
        // localement, donc confiée à l'opérateur. C'est le miroir exact du carve-out du
        // dialecte `rest`, qui traite un « non implémenté » CÔTÉ CLIENT comme rejouable.
        await applyEdit({ layerId: "sites", kind: "create", feature: feature("Verbe inconnu") });
        serve(() => ({ status: 501, body: {} }));

        await pushOutbox();

        const rows = await readAll("outbox");
        expect(rows[0].state).toBe("quarantined");
        expect(rows[0].attempts, "le budget est COURT-CIRCUITÉ, pas consommé").toBe(1);
        expect(rows[0].quarantine).toBe("notImplementedByServer");
        // L'assertion qui porte le grief d'origine : UN aller-retour, pas trois.
        expect(fetchSpy.mock.calls.length, "un seul envoi, pas trois").toBe(1);
    });

    test("🛑 un 403 épuisé RESTE un refus — la contre-épreuve du correctif", async () => {
        // Sans elle, rendre tout rejouable passerait les deux tests ci-dessus en sortant vert.
        // Un refus définitif garde son motif, et garde donc son absence de requeue.
        await applyEdit({ layerId: "sites", kind: "create", feature: feature("Interdite") });
        serve(() => ({ status: 403, body: {} }));

        await pushOutbox();
        await pushOutbox();
        await pushOutbox();

        const rows = await readAll("outbox");
        expect(rows[0].state).toBe("quarantined");
        expect(rows[0].attempts).toBe(3);
        expect(rows[0].quarantine).toBe("rejectedByServer");
        // 🛑 B-200 — LE DIAGNOSTIC VOYAGE AVEC L'ENTRÉE. `rejectedByServer` seul ne distingue
        // pas un droit manquant (403, que l'exploitant corrige) d'une requête malformée (400,
        // qui est notre bug). Le statut était connu au point de décision et ne vivait que dans
        // un `Log.warn` — volatil, et personne n'ouvre une console sur le terrain.
        expect(rows[0].quarantineStatus).toBe(403);
    });

    test("B-200 — une quarantaine SANS réponse serveur ne porte AUCUN statut", async () => {
        // ⚠️ La contre-épreuve, et elle est nécessaire : sans elle, le cas ci-dessus ne
        // distinguerait pas « le statut voyage » de « un statut est fabriqué à chaque
        // quarantaine ». Un réseau muet n'a pas de statut — un `0` dirait « le serveur a
        // répondu 0 », ce qui est faux et indiscernable d'une mesure.
        await applyEdit({ layerId: "sites", kind: "create", feature: feature("Muette") });
        serve(() => {
            throw new Error("réseau muet");
        });

        await pushOutbox();
        await pushOutbox();
        await pushOutbox();

        const rows = await readAll("outbox");
        expect(rows[0].state).toBe("quarantined");
        expect(rows[0].quarantine).toBe("retryBudgetExhausted");
        expect(rows[0].quarantineStatus).toBeUndefined();
    });

    // ── ② la réconciliation d'identité ────────────────────────────────────────────────────
    test("l'identifiant serveur revient DANS L'ENREGISTREMENT, et la file se vide", async () => {
        await applyEdit({ layerId: "sites", kind: "create", feature: feature("A") });
        serve(() => ({ status: 201, body: [{ id: 77 }] }));

        const report = await pushOutbox();
        expect(report.pushed).toBe(1);

        const records = await readAll("features");
        expect(records[0].serverId).toBe("77");
        expect(records[0].syncState).toBe("synced");
        // La file ne référence que `localId` et disparaît une fois poussée : si l'identité
        // serveur n'était pas écrite ici, elle serait perdue.
        expect(await readAll("outbox")).toHaveLength(0);
    });

    // ── ③ un 409 est un SUCCÈS ────────────────────────────────────────────────────────────
    test("un 409 sur l'identité cliente vaut « déjà présent », pas un échec", async () => {
        await applyEdit({ layerId: "sites", kind: "create", feature: feature("B") });
        serve(() => ({ status: 409, body: { code: "23505" } }));

        const report = await pushOutbox();

        // Le traiter en échec ferait boucler la file sur une entrée que le serveur a acceptée.
        expect(report.pushed).toBe(1);
        expect(report.alreadyPresent).toBe(1);
        expect(report.failed).toBe(0);
        expect(await readAll("outbox")).toHaveLength(0);
    });

    // ── ④ un échec garde la saisie ────────────────────────────────────────────────────────
    test("un 500 laisse l'entrée en file, en `failed` — qui n'est pas terminal", async () => {
        await applyEdit({ layerId: "sites", kind: "create", feature: feature("C") });
        serve(() => ({ status: 500 }));

        const report = await pushOutbox();
        expect(report.failed).toBe(1);
        expect(report.pushed).toBe(0);

        const queue = await readAll("outbox");
        expect(queue).toHaveLength(1);
        expect(queue[0].state).toBe("failed");
        // Et la saisie est toujours là — c'est tout l'objet du contrat.
        expect(await readAll("features")).toHaveLength(1);
    });

    test("un `failed` repart au drain suivant", async () => {
        await applyEdit({ layerId: "sites", kind: "create", feature: feature("D") });
        serve(() => ({ status: 500 }));
        await pushOutbox();

        serve(() => ({ status: 201, body: [{ id: 88 }] }));
        const report = await pushOutbox();

        expect(report.pushed).toBe(1);
        expect((await readAll("features"))[0].serverId).toBe("88");
    });

    test("un réseau muet ne perd rien non plus", async () => {
        await applyEdit({ layerId: "sites", kind: "create", feature: feature("E") });
        globalThis.fetch = vi.fn(async () => {
            throw new TypeError("Failed to fetch");
        });

        const report = await pushOutbox();
        expect(report.failed).toBe(1);
        expect(await readAll("features")).toHaveLength(1);
    });

    // ── ⑤ la suppression ferme le cycle ───────────────────────────────────────────────────
    test("une suppression poussée retire l'entité du magasin", async () => {
        const features = IndexedDB._ensureModule("Features");
        await features.put({
            layerId: "sites",
            localId: "srv:5",
            serverId: "5",
            syncState: "synced",
            updatedAt: 1,
            version: null,
            feature: feature("à supprimer"),
        });
        await applyEdit({ layerId: "sites", kind: "delete", localId: "srv:5" });

        serve((url, init) => {
            expect(init.method).toBe("DELETE");
            expect(url).toContain("id=eq.5");
            return { status: 204 };
        });

        const report = await pushOutbox();
        expect(report.pushed).toBe(1);
        expect(await readAll("features")).toHaveLength(0);
        expect(await readAll("outbox")).toHaveLength(0);
    });

    // ── ⑥ les refus nommés ────────────────────────────────────────────────────────────────
    test("une couche sans cible d'écriture ne part pas, et ne disparaît pas", async () => {
        await applyEdit({ layerId: "orphan", kind: "create", feature: feature("F") });
        serve(() => ({ status: 201 }));

        const report = await pushOutbox();
        expect(report.failed).toBe(1);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(await readAll("features")).toHaveLength(1);
    });

    test("le dialecte `rest` est refusé par son NOM, pas envoyé en corps plat", async () => {
        // Envoyer un corps `collection` à un endpoint REST enverrait la mauvaise forme en
        // silence — la classe de défaut exacte que ce sprint ferme.
        layerConfigs[0].write.dialect = "rest";
        await applyEdit({ layerId: "sites", kind: "create", feature: feature("G") });
        serve(() => ({ status: 201 }));

        const report = await pushOutbox();
        expect(report.failed).toBe(1);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    test("sans moteur de stockage, le drain refuse au lieu de rendre un zéro muet", async () => {
        StorageContract.init({
            get DB() {
                return null;
            },
            isAvailable: () => false,
        });
        const report = await pushOutbox();
        expect(report.refused).toBe("engineUnavailable");
    });

    // ── ⑥bis — 4.6 : le conflit devient DÉTECTABLE, et l'issue est DÉCLARÉE ──────────────
    test("le marqueur de base part comme FILTRE — sans lui, aucun conflit n'est observable", async () => {
        const features = IndexedDB._ensureModule("Features");
        await features.put({
            layerId: "sites",
            localId: "srv:4",
            serverId: "4",
            syncState: "synced",
            updatedAt: 1,
            version: { kind: "timestamp", value: "2026-08-03T20:41:05.130076+00:00" },
            feature: feature("base"),
        });
        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId: "srv:4",
            feature: feature("édité"),
        });
        serve(() => ({ status: 200, body: [{ id: 4 }] }));

        await pushOutbox();

        const url = String(fetchSpy.mock.calls[0][0]);
        expect(url).toContain("id=eq.4");
        // ⚠️ Le `+` du fuseau DOIT être encodé : mesuré contre PostgREST, un `+` nu est lu
        // comme une espace et rend `400 invalid input syntax for type timestamp`.
        expect(url).toContain("updated_at=eq.2026-08-03T20%3A41%3A05.130076%2B00%3A00");
    });

    test("zéro ligne touchée = CONFLIT : détecté, journalisé, puis tranché par lastWriteWins", async () => {
        const features = IndexedDB._ensureModule("Features");
        await features.put({
            layerId: "sites",
            localId: "srv:6",
            serverId: "6",
            syncState: "synced",
            updatedAt: 1,
            version: { kind: "timestamp", value: "2026-01-01T00:00:00+00:00" },
            feature: feature("base"),
        });
        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId: "srv:6",
            feature: feature("terrain"),
        });

        // 1er appel : filtré sur un marqueur périmé → 200 [] (mesuré sur le vrai PostgREST).
        // 2e appel : sans filtre → la version locale écrase.
        let call = 0;
        serve(() =>
            ++call === 1 ? { status: 200, body: [] } : { status: 200, body: [{ id: 6 }] }
        );

        const report = await pushOutbox();

        expect(report.conflicts).toBe(1);
        // 🛑 L'ISSUE NE CHANGE PAS — c'est tout le sujet. `lastWriteWins` était déjà le
        // comportement, mais par accident et sans trace. Le gain est qu'il est maintenant
        // DÉTECTÉ et JOURNALISÉ avant d'être appliqué.
        expect(report.pushed).toBe(1);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
        // Le second envoi ne porte plus le filtre : c'est lui qui écrase.
        expect(String(fetchSpy.mock.calls[1][0])).not.toContain("updated_at=eq.");
        expect((await readAll("features"))[0].syncState).toBe("synced");
    });

    test("une MISE À JOUR sans marqueur n'invente pas de conflit sur une réponse vide", async () => {
        // ⚠️ CE TEST A ÉTÉ RÉÉCRIT PARCE QU'IL NE COUVRAIT PAS CE QU'IL ANNONÇAIT. La première
        // rédaction faisait un `create` — or la détection est déjà gardée par
        // `kind === "update"`, donc retirer la garde `baseVersion` ne la faisait pas rougir.
        //
        // Le vrai cas : une entité créée hors ligne n'a AUCUN marqueur (`version: null`), et
        // une mise à jour ultérieure part donc sans filtre. Si le serveur répond avec un corps
        // vide — 204, ou une représentation absente — compter « zéro ligne » comme un conflit
        // en inventerait un à chaque fois, et déclencherait un second envoi pour rien.
        const features = IndexedDB._ensureModule("Features");
        await features.put({
            layerId: "sites",
            localId: "loc:hors-ligne",
            serverId: "31",
            syncState: "synced",
            updatedAt: 1,
            version: null,
            feature: feature("créée hors ligne"),
        });
        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId: "loc:hors-ligne",
            feature: feature("corrigée"),
            baseVersion: null,
        });
        serve(() => ({ status: 200, body: null }));

        const report = await pushOutbox();
        expect(report.conflicts).toBe(0);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(String(fetchSpy.mock.calls[0][0])).not.toContain("updated_at=eq.");
    });

    // ── ⑦ le cycle complet, bout en bout ──────────────────────────────────────────────────
    test("créer hors réseau puis pousser : l'entité porte son identifiant serveur", async () => {
        const created = await applyEdit({
            layerId: "sites",
            kind: "create",
            feature: feature("terrain"),
        });
        // Édition supplémentaire avant le push : elle coalesce, donc UNE seule requête.
        await applyEdit({
            layerId: "sites",
            kind: "update",
            localId: created.localId,
            feature: feature("terrain corrigé"),
        });

        serve(() => ({ status: 201, body: [{ id: 99 }] }));
        const report = await pushOutbox();

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(report.pushed).toBe(1);
        // Et c'est bien l'état CORRIGÉ qui est parti — la charge est l'enregistrement.
        expect(bodyOf(fetchSpy.mock.calls[0]).title).toBe("terrain corrigé");
        expect((await readAll("features"))[0].serverId).toBe("99");
    });
});
