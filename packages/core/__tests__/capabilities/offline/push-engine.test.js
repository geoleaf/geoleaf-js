/**
 * THE PUSH, and identity reconciliation.
 *
 * The `outbox` got its first writer earlier; these tests exercise its first
 * real reader. Four properties that cannot be read off the code:
 *
 *  1. the CLIENT identity goes on the wire — without it, no replay can be idempotent;
 *  2. a **409 is a SUCCESS**: the server says "I already have it";
 *  3. the server id comes back INTO THE RECORD, not into the queue;
 *  4. a failure leaves the capture queued — `failed` is not terminal.
 *
 * Runs against `fake-indexeddb` with a controlled `fetch`: what is asserted
 * is the body really sent and the state really persisted, never a mock's echo.
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

    /** A controlled server: status and payload decided by the test. */
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
            // Editable, but with no declared write target.
            { id: "orphan", edition: { create: true, update: true, delete: true } },
        ];
        globalThis.GeoLeaf = {
            Config: { getActiveProfile: () => ({ layers: layerConfigs }) },
        };
        // ⚠️ `close()` and not `_db = null`: the facade CACHES the sub-module
        // instances in `_modules`, bound to the connection that created them.
        // Resetting `_db` by hand leaves that cache in place, and another test
        // file opening its own base then writes into the PREVIOUS connection.
        // `close()` clears both — the invariant the facade already holds, and
        // bypassing it made it lie.
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

    // ── ① the client identity leaves, and the whitelist holds ────────────────────────────
    test("le corps porte `local_id` et RIEN hors de la liste blanche", async () => {
        const created = await applyEdit({
            layerId: "sites",
            kind: "create",
            feature: feature("Nouveau site"),
        });
        serve(() => ({ status: 201, body: [{ id: 77 }] }));

        await pushOutbox();

        const body = bodyOf(fetchSpy.mock.calls[0]);
        // 🛑 Without this key, no replay can be idempotent: it is the one the
        // server's UNIQUE constraint refuses a second time.
        expect(body.local_id).toBe(created.localId);
        expect(body.title).toBe("Nouveau site");
        expect(body.geom).toEqual({ type: "Point", coordinates: [-60.64, -32.94] });
        // The whitelist is a whitelist.
        expect(body.secret).toBeUndefined();
    });

    // ── ①bis THE REPLAY ORDER ───────────────────────────────────────────────
    test("🛑 une entrée `failed` PLUS ANCIENNE part AVANT une `pending` plus récente", async () => {
        // The drain read `[...listByState("pending"), ...listByState("failed")]`
        // — two index reads laid end to end, hence ALL `pending` before ALL
        // `failed`, whatever their capture rank. The exact shape already fixed
        // once on the v3 queue, returned on the outbox.
        //
        // ⚠️ The case arises through the `inFlight` window, which is NOT
        // mergeable: an edit made while a push is in flight stacks a second
        // entry, and if that push fails the entity carries a `failed` of rank
        // N and a `pending` of rank N+1.
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

        // We set the FIRST to `failed`: it keeps its `seq`, hence its capture rank.
        const outbox = IndexedDB._ensureModule("Outbox");
        const queued = await outbox.list();
        const older = queued.find((e) => e.localId === first.localId);
        await outbox.updateState(older.id, "failed");

        serve(() => ({ status: 201, body: [{ id: 1 }] }));
        await pushOutbox();

        // The request order IS the capture order — not the state order.
        const sent = fetchSpy.mock.calls.map((c) => JSON.parse(c[1].body).local_id);
        expect(sent).toEqual([first.localId, second.localId]);
    });

    // ── ①ter THE REPLAY BUDGET ──────────────────────────────────────────────
    test("🛑 trois échecs mettent l'entrée en QUARANTAINE — et ne la détruisent PAS", async () => {
        // Without a cap, a failing entry replays indefinitely and
        // `quarantined` is reached by no path: three declared
        // `QuarantineReason`s, zero producers.
        await applyEdit({ layerId: "sites", kind: "create", feature: feature("Obstinée") });
        serve(() => ({ status: 500, body: {} }));

        const reports = [await pushOutbox(), await pushOutbox(), await pushOutbox()];

        expect(reports.map((r) => r.failed)).toEqual([1, 1, 1]);

        const rows = await readAll("outbox");
        expect(rows, "le contrat interdit de détruire une entrée").toHaveLength(1);
        expect(rows[0].state).toBe("quarantined");
        expect(rows[0].attempts).toBe(3);
        // 🛑 THE REASON FOLLOWS THE LAST FAILURE, it does not just say "budget exhausted".
        //
        // ⚠️ **THIS ASSERTION EXPECTED `rejectedByServer`, AND IT LOCKED A
        // DEFECT IN.** Its comment said "here the server REFUSED three times
        // (500)" — but a 500 is not a refusal, it is an outage. `pushOne`
        // then had a single branch for the whole non-409/non-404 spectrum, so
        // the word "refused" was true there by construction and false in
        // fact. Since `rejectedByServer` is excluded from `REQUEUEABLE`, this
        // test engraved the loss: a server maintenance made the capture
        // unrecoverable other than by destroying it. The expected reason now
        // follows the status CLASS.
        expect(rows[0].quarantine).toBe("retryBudgetExhausted");
    });

    test("🛑 un 404 sur un `update` = l'entité a disparu côté serveur, quarantaine IMMÉDIATE", async () => {
        // Replaying three times an entity the server deleted can neither
        // recreate nor modify it. A product decision, not a transport
        // incident: it must surface now. `deletedOnServer` was the last
        // `QuarantineReason` declared without a producer — the contract
        // itself calls such a member "indistinguishable from a typo".
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
        // The counter-proof: without it, every 404 would become
        // `deletedOnServer` and a misconfigured layer would be quarantined
        // under a reason accusing the server.
        await applyEdit({ layerId: "sites", kind: "create", feature: feature("Endpoint faux") });
        serve(() => ({ status: 404, body: {} }));

        await pushOutbox();

        const rows = await readAll("outbox");
        expect(rows[0].state, "un create en 404 reste rejouable").toBe("failed");
        expect(rows[0].quarantine).toBeUndefined();
    });

    test("🛑 un réseau MUET épuisé ne se nomme pas comme un refus serveur", async () => {
        // The reason's counter-proof: without it, `rejectedByServer` could be
        // written in both cases and the test above would still pass. Two causes, two names.
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
        // The counter-proof: without it, a cap that marks without setting
        // aside would pass the test above while letting the entry loop.
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
        // Replaying three times a layer that lost its `write` block only
        // waits three times. `layerNoLongerWritable` exists exactly for this
        // — and this is its FIRST producer: the contract had declared it with
        // nothing writing it. `orphan` is editable and declares NO write
        // target — the harness already carries it for this precise case.
        await applyEdit({ layerId: "orphan", kind: "create", feature: feature("Orpheline") });

        const report = await pushOutbox();

        expect(report.failed).toBe(1);
        const rows = await readAll("outbox");
        expect(rows[0].state).toBe("quarantined");
        expect(rows[0].attempts, "le budget est COURT-CIRCUITÉ, pas consommé").toBe(1);
        expect(rows[0].quarantine).toBe("layerNoLongerWritable");
    });

    // ── ①quater THE HTTP STATUS CLASS DECIDES ────────────────────────────────────
    //
    // 🛑 Until 09/08/2026, `pushOne` had ONE branch for everything neither 409
    // nor 404: `rejectedByServer`. A maintenance 503 and a definitive 403
    // were the same fact there. Since that reason is excluded from
    // `REQUEUEABLE`, a transient server outage exhausted the budget then made
    // the capture NON-REPLAYABLE — its only exit became `discardQuarantined`,
    // i.e. destruction. The three tests below hold the three classes, and the
    // third is the counter-proof without which a fix making EVERYTHING
    // replayable would pass the first two.

    test("🛑 un 503 épuisé est un budget épuisé, PAS un refus — l'entrée reste rejouable", async () => {
        // The case carrying the cost: server maintenance, or an operator
        // pressing "Retry" three times. `attempts` is persistent and
        // cumulative, so the three failures can spread over days.
        await applyEdit({ layerId: "sites", kind: "create", feature: feature("Maintenance") });
        serve(() => ({ status: 503, body: {} }));

        await pushOutbox();
        await pushOutbox();
        await pushOutbox();

        const rows = await readAll("outbox");
        expect(rows[0].state).toBe("quarantined");
        expect(rows[0].attempts).toBe(3);
        // The reason decides the EXIT: `retryBudgetExhausted` is in
        // `REQUEUEABLE`, `rejectedByServer` is not. Writing the second here
        // condemned the capture.
        expect(rows[0].quarantine).toBe("retryBudgetExhausted");
    });

    test("🛑 un 501 ne consomme PAS le budget — le serveur ne connaît pas le verbe", async () => {
        // Replaying three times a verb the server declares unimplemented only
        // waits three times — same argument as the 404 on `update`. The
        // reason is nevertheless REPLAYABLE: the cause lifts when the server
        // updates, unverifiable locally, hence left to the operator. The
        // exact mirror of the `rest` dialect's carve-out, which treats a
        // CLIENT-side "not implemented" as replayable.
        await applyEdit({ layerId: "sites", kind: "create", feature: feature("Verbe inconnu") });
        serve(() => ({ status: 501, body: {} }));

        await pushOutbox();

        const rows = await readAll("outbox");
        expect(rows[0].state).toBe("quarantined");
        expect(rows[0].attempts, "le budget est COURT-CIRCUITÉ, pas consommé").toBe(1);
        expect(rows[0].quarantine).toBe("notImplementedByServer");
        // The assertion carrying the original grievance: ONE round trip, not three.
        expect(fetchSpy.mock.calls.length, "un seul envoi, pas trois").toBe(1);
    });

    test("🛑 un 403 épuisé RESTE un refus — la contre-épreuve du correctif", async () => {
        // Without it, making everything replayable would pass the two tests
        // above while coming out green. A definitive refusal keeps its
        // reason, hence keeps its absence of requeue.
        await applyEdit({ layerId: "sites", kind: "create", feature: feature("Interdite") });
        serve(() => ({ status: 403, body: {} }));

        await pushOutbox();
        await pushOutbox();
        await pushOutbox();

        const rows = await readAll("outbox");
        expect(rows[0].state).toBe("quarantined");
        expect(rows[0].attempts).toBe(3);
        expect(rows[0].quarantine).toBe("rejectedByServer");
        // 🛑 THE DIAGNOSIS TRAVELS WITH THE ENTRY. `rejectedByServer` alone
        // cannot tell a missing right (403, which the operator fixes) from a
        // malformed request (400, which is our bug). The status was known at
        // the decision point and lived only in a `Log.warn` — volatile, and
        // nobody opens a console in the field.
        expect(rows[0].quarantineStatus).toBe(403);
    });

    test("une quarantaine SANS réponse serveur ne porte AUCUN statut", async () => {
        // ⚠️ The counter-proof, and it is necessary: without it, the case
        // above could not tell "the status travels" from "a status is
        // fabricated at every quarantine". A mute network has no status — a
        // `0` would say "the server answered 0", which is false and
        // indistinguishable from a measurement.
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

    // ── ② identity reconciliation ────────────────────────────────────────────────────────
    test("l'identifiant serveur revient DANS L'ENREGISTREMENT, et la file se vide", async () => {
        await applyEdit({ layerId: "sites", kind: "create", feature: feature("A") });
        serve(() => ({ status: 201, body: [{ id: 77 }] }));

        const report = await pushOutbox();
        expect(report.pushed).toBe(1);

        const records = await readAll("features");
        expect(records[0].serverId).toBe("77");
        expect(records[0].syncState).toBe("synced");
        // The queue only references `localId` and vanishes once pushed: if
        // the server identity were not written here, it would be lost.
        expect(await readAll("outbox")).toHaveLength(0);
    });

    // ── ③ a 409 is a SUCCESS ─────────────────────────────────────────────────────────────
    test("un 409 sur l'identité cliente vaut « déjà présent », pas un échec", async () => {
        await applyEdit({ layerId: "sites", kind: "create", feature: feature("B") });
        serve(() => ({ status: 409, body: { code: "23505" } }));

        const report = await pushOutbox();

        // Treating it as a failure would loop the queue on an entry the server accepted.
        expect(report.pushed).toBe(1);
        expect(report.alreadyPresent).toBe(1);
        expect(report.failed).toBe(0);
        expect(await readAll("outbox")).toHaveLength(0);
    });

    // ── ④ a failure keeps the capture ────────────────────────────────────────────────────
    test("un 500 laisse l'entrée en file, en `failed` — qui n'est pas terminal", async () => {
        await applyEdit({ layerId: "sites", kind: "create", feature: feature("C") });
        serve(() => ({ status: 500 }));

        const report = await pushOutbox();
        expect(report.failed).toBe(1);
        expect(report.pushed).toBe(0);

        const queue = await readAll("outbox");
        expect(queue).toHaveLength(1);
        expect(queue[0].state).toBe("failed");
        // And the capture is still there — the contract's whole point.
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

    // ── ⑤ deletion closes the cycle ──────────────────────────────────────────────────────
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

    // ── ⑥ named refusals ─────────────────────────────────────────────────────────────────
    test("une couche sans cible d'écriture ne part pas, et ne disparaît pas", async () => {
        await applyEdit({ layerId: "orphan", kind: "create", feature: feature("F") });
        serve(() => ({ status: 201 }));

        const report = await pushOutbox();
        expect(report.failed).toBe(1);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(await readAll("features")).toHaveLength(1);
    });

    test("le dialecte `rest` est refusé par son NOM, pas envoyé en corps plat", async () => {
        // Sending a `collection` body to a REST endpoint would send the wrong
        // shape silently — the exact defect class being closed.
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

    // ── ⑥bis — the conflict becomes DETECTABLE, and the outcome is DECLARED ─────────────
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
        // ⚠️ The timezone `+` MUST be encoded: measured against PostgREST, a
        // bare `+` reads as a space and yields `400 invalid input syntax for type timestamp`.
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

        // 1st call: filtered on a stale marker → 200 [] (measured on real PostgREST).
        // 2nd call: unfiltered → the local version overwrites.
        let call = 0;
        serve(() =>
            ++call === 1 ? { status: 200, body: [] } : { status: 200, body: [{ id: 6 }] }
        );

        const report = await pushOutbox();

        expect(report.conflicts).toBe(1);
        // 🛑 THE OUTCOME DOES NOT CHANGE — the whole subject. `lastWriteWins`
        // was already the behaviour, but by accident and without a trace. The
        // gain is that it is now DETECTED and LOGGED before being applied.
        expect(report.pushed).toBe(1);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
        // The second send no longer carries the filter: it is the one that overwrites.
        expect(String(fetchSpy.mock.calls[1][0])).not.toContain("updated_at=eq.");
        expect((await readAll("features"))[0].syncState).toBe("synced");
    });

    test("une MISE À JOUR sans marqueur n'invente pas de conflit sur une réponse vide", async () => {
        // ⚠️ THIS TEST WAS REWRITTEN BECAUSE IT DID NOT COVER WHAT IT
        // ANNOUNCED. The first draft did a `create` — yet the detection is
        // already gated by `kind === "update"`, so removing the `baseVersion`
        // guard did not turn it red.
        //
        // The real case: an entity created offline has NO marker
        // (`version: null`), so a later update leaves without a filter. If
        // the server answers with an empty body — 204, or an absent
        // representation — counting "zero rows" as a conflict would invent
        // one every time, and trigger a second send for nothing.
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

    // ── ⑦ the full cycle, end to end ─────────────────────────────────────────────────────
    test("créer hors réseau puis pousser : l'entité porte son identifiant serveur", async () => {
        const created = await applyEdit({
            layerId: "sites",
            kind: "create",
            feature: feature("terrain"),
        });
        // An extra edit before the push: it coalesces, hence ONE request.
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
        // And it is the CORRECTED state that left — the payload is the record.
        expect(bodyOf(fetchSpy.mock.calls[0]).title).toBe("terrain corrigé");
        expect((await readAll("features"))[0].serverId).toBe("99");
    });
});
