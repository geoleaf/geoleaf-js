/**
 * 31 — The DELTA, against a real server.
 *
 * `offline.source.delta` shipped in `@geoleaf/core` 3.5.0, and with it four guarantees
 * that `packages/core/docs/SERVER_CONTRACT.md` §1.3 asks of whoever runs the server.
 * Those four were REASONED, never measured: until this file, the mechanism was proven
 * against a source with state — `pull-converges.test.ts` in the unit suite, `e2e/54` on
 * the shipped bundle — and both fakes were written from the same reasoning as the page
 * they confirm. A fake can show a contract is self-consistent. It cannot falsify it.
 *
 * The repository already paid that lesson ON THIS BENCH: pg_featureserv served `bbox`
 * and `limit` correctly but emitted no `next` link, so the pull stopped after page one
 * AND REPORTED SUCCESS. Each test below therefore names the clause it can falsify, and
 * the shape of the green that would have hidden it.
 *
 * Read side: pygeoapi collection `sites_rosario_delta` (a view carrying tombstones,
 * `time_field: updated_at`). Write side: PostgREST on the same view, whose
 * `INSTEAD OF DELETE` turns a delete into a tombstone — see `docker/backend/01-schema.sql`.
 *
 * ⚠️ Like `30-sync-cycle`, this file **skips itself entirely** when the bench does not
 * answer, and does so LOUDLY: a witness outside the `describe` asserts the motive was
 * named. A file coming out green having played nothing is the very defect this work fights.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { layerConfigPath } from "./helpers/profiles.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/**
 * The proof backend's origin — the same as `connector.local.js`'s.
 *
 * ⚠️ DERIVED, and the default is the dev bench so the local recipe does not move. The bench
 * has two topologies and they do not share a hostname: `https://qgis.geoleaf.dev` behind
 * Traefik on the workstation, `http://localhost:<port>` on a runner that has neither TLS nor
 * a `hosts` entry. Writing either one in is what would make the other unreachable.
 */
const API = (process.env.GEOLEAF_BACKEND_BASE_URL ?? "https://qgis.geoleaf.dev").replace(
    /\/+$/,
    ""
);
/** The collection that carries tombstones and honours `datetime`. */
const OGC_DELTA = `${API}/ogc/collections/sites_rosario_delta/items`;
/** The collection that serves COMPLETE pulls — live rows only. */
const OGC_LIVE = `${API}/ogc/collections/sites_rosario/items`;
/** Write surface of the delta layer: the same view, whose DELETE writes a tombstone. */
const REST_DELTA = `${API}/sites_rosario_delta`;
/** The base table — the only face from which a row LEAVES for good. Cleanup only. */
const REST_TABLE = `${API}/sites_rosario`;

/** Prefix of every client identity this file creates, and the whole of its cleanup. */
const LOCAL_ID_PREFIX = "e2e31-";

/**
 * Reads the dev bootstrap to extract the origin and the token.
 * @returns {{ baseUrl: string, token: string } | null} `null` if absent — the nominal
 *   case on a runner, not an anomaly.
 */
function readDevConnector() {
    const p = path.join(ROOT, "apps", "geoleaf-app", "connector.local.js");
    if (!fs.existsSync(p)) return null;
    const src = fs.readFileSync(p, "utf-8");
    const token = src.match(/["'](ey[A-Za-z0-9._-]{20,})["']/)?.[1];
    const url = src.match(/baseUrl:\s*["']([^"']+)["']/)?.[1];
    return token && url ? { baseUrl: url, token } : null;
}

const DEV = readDevConnector();

/** The skip's motive, or `null` if everything is in place. @type {string | null} */
let skipReason = null;

test.use({ baseURL: baseURL("full"), serviceWorkers: "block" });

// 🛑 FILE SCOPE, NOT THE `describe`'s — the witness demands it. Inside the `describe`,
// the companion `beforeEach` skips the witness too, and the file comes out "N skipped"
// with not one line saying why: the very silence this mechanism exists to prevent.
test.beforeAll(async ({ request }) => {
    if (!DEV) {
        skipReason =
            "apps/geoleaf-app/connector.local.js absent — pas de bootstrap dev sur cette machine";
        return;
    }
    try {
        const r = await request.get(`${OGC_DELTA}?f=json&limit=1`, { timeout: 8000 });
        if (!r.ok()) {
            skipReason =
                `backend joignable mais répond ${r.status()} sur ${OGC_DELTA} — la collection ` +
                "`sites_rosario_delta` manque, ou son `time_field` n'est pas posé " +
                "(docker/backend/pygeoapi.config.yml, puis rejouer 01-schema.sql)";
        }
    } catch (e) {
        skipReason =
            `backend injoignable sur ${API} — conteneurs de docker-compose.dev.yml non ` +
            `démarrés (${String(e).slice(0, 80)})`;
    }
    if (skipReason) return;

    // 3rd condition — the ARTIFACT, not the machine. `build-deploy.cjs` (step 9a) strips
    // the proof-backend bindings from shippable variants, so a CORRECT `deploy-full`
    // declares no `offline.source` at all. Without this, the pull tests would redden on a
    // deploy that is right.
    try {
        const cfg = await request.get(
            `${baseURL("full")}${layerConfigPath("tourism", "sites_rosario")}`,
            { timeout: 8000 }
        );
        const declaresSource = cfg.ok() && Boolean((await cfg.json())?.offline?.source?.url);
        if (!declaresSource) {
            skipReason =
                "la variante servie est un LIVRABLE : ses liaisons vers le backend de preuve " +
                "ont été retirées au build (build-deploy.cjs étape 9a). Pour éprouver le delta, " +
                "reconstruire avec l'origine explicite : " +
                "GEOLEAF_BACKEND_BASE_URL=https://qgis.geoleaf.dev npm run build:deploy";
        }
    } catch (e) {
        skipReason = `profil de la variante servie illisible (${String(e).slice(0, 80)})`;
    }
});

test("TÉMOIN — si ce fichier se saute, le motif est NOMMÉ et non silencieux", async () => {
    // ⚠️ OUTSIDE the `describe`, hence out of its `beforeEach`'s reach. Its value is not
    // asserting the bench runs — it is preventing this file from reading as "green" while
    // it played nothing. A fully skipped file and a fully green one look alike in a
    // report read quickly.
    if (skipReason) {
        test.info().annotations.push({ type: "skip-reason", description: skipReason });
        expect(skipReason.length, "un saut doit porter un motif lisible").toBeGreaterThan(20);
        return;
    }
    expect(DEV, "le bootstrap dev doit être lisible quand le backend répond").not.toBeNull();
});

/**
 * Makes `sites_rosario` declare the delta IN THE SERVED BUNDLE, and point both its faces
 * at the collection that carries tombstones.
 *
 * ⚠️ The declaration is injected rather than committed to `profiles/`: that directory is
 * the product showcase, and adding a layer to it is a product decision, not a test
 * fixture. What is real here is everything that matters — the server, the `datetime`
 * filter, the tombstones and the client path.
 *
 * ⚠️ Only a `200` to a `GET` is rewritten: the download window asks for the bundle again
 * with `HEAD`, and a conditional request may answer `304` — neither carries a body.
 *
 * @param {import("@playwright/test").Page} page
 */
async function armDelta(page) {
    await page.route("**/profiles/tourism/profile-bundle.json**", async (route) => {
        const response = await route.fetch();
        if (route.request().method() !== "GET" || response.status() !== 200) {
            await route.fulfill({ response });
            return;
        }
        const bundle = await response.json();
        const cfg = bundle.layerConfigs?.sites_rosario;
        if (!cfg) throw new Error("le bundle ne porte plus la couche `sites_rosario`");
        cfg.offline = {
            ...(cfg.offline ?? {}),
            enabled: true,
            maxFeatures: 5000,
            source: {
                url: `${API}/ogc`,
                collectionId: "sites_rosario_delta",
                versionProperty: "updated_at",
                delta: { freshness: "datetime", deletedProperty: "deleted_at" },
            },
        };
        cfg.write = { ...(cfg.write ?? {}), endpoint: REST_DELTA };
        await route.fulfill({ response, json: bundle });
    });
}

test.describe("31 — Le contrat du delta, contre un VRAI serveur", () => {
    test.beforeEach(() => {
        test.skip(skipReason !== null, skipReason ?? "");
    });

    test.afterAll(async ({ request }) => {
        // Everything this file may have written, including after a mid-route failure.
        // The delete goes to the TABLE and not to the view: the view's DELETE writes a
        // tombstone, which would leave the row — and the next run's counts — behind.
        if (skipReason || !DEV) return;
        await request
            .delete(`${REST_TABLE}?local_id=like.${LOCAL_ID_PREFIX}*`, {
                headers: { Authorization: `Bearer ${DEV.token}` },
            })
            .catch(() => {});
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Transport — the two clauses no fake can falsify.
    // ─────────────────────────────────────────────────────────────────────────

    test("§1.3 garantie 1 — `datetime` filtre SUR le marqueur de fraîcheur", async ({
        request,
    }) => {
        // 🛑 The counts are measured in the same run, never copied: this file and its
        // neighbour both write into a shared database, and a literal would pass alone
        // and redden in the full suite.
        const all = await request.get(`${OGC_DELTA}?f=json&limit=1`);
        const total = (await all.json()).numberMatched;
        expect(total, "le banc doit porter des lignes").toBeGreaterThan(2);

        // Advance the marker on ONE row, through the write path, and ask for what
        // changed since. A server that ignores `datetime` answers `total`; one that
        // honours it answers 1.
        const created = await request.post(REST_DELTA, {
            headers: {
                Authorization: `Bearer ${DEV.token}`,
                "Content-Type": "application/json",
                Prefer: "return=representation",
            },
            data: {
                local_id: `${LOCAL_ID_PREFIX}g1`,
                title: "Sonde garantie 1",
                geom: { type: "Point", coordinates: [-60.65, -32.94] },
            },
        });
        expect(created.status(), "la création doit rendre la ligne").toBe(201);
        const mark = (await created.json())[0].updated_at;

        const since = await request.get(
            `${OGC_DELTA}?f=json&limit=100&datetime=${encodeURIComponent(`${mark}/..`)}`
        );
        const body = await since.json();
        expect(since.status(), "un `datetime` refusé rendrait 500 — `time_field` non posé").toBe(
            200
        );
        // ⚠️ The interval is CLOSED at its start, so the row that carries the mark is in.
        expect(
            body.numberMatched,
            "un serveur qui IGNORE `datetime` rendrait la collection entière"
        ).toBeLessThan(total + 1);
        expect(body.features.map((f) => f.properties.local_id)).toContain(`${LOCAL_ID_PREFIX}g1`);
    });

    test("§1.1 — le lien `next` REPORTE `datetime`, que GeoLeaf ne reconstruit pas", async ({
        request,
    }) => {
        // 🛑 THE CLAUSE THAT KILLED pg_featureserv, on the delta this time. The contract
        // says the `next` link must carry the query of the first request — GeoLeaf
        // follows it verbatim. A server dropping `datetime` from it answers page 2 with
        // the WHOLE collection: the delta silently degrades into a complete pull that
        // does not sweep, and the run reports success.
        const mark = "2000-01-01T00:00:00+00:00";
        const first = await request.get(
            `${OGC_DELTA}?f=json&limit=2&datetime=${encodeURIComponent(`${mark}/..`)}`
        );
        const body = await first.json();
        const next = (body.links ?? []).find((l) => l.rel === "next")?.href;

        expect(next, "sans lien `next`, la pagination du delta est improuvable").toBeTruthy();
        expect(
            new URL(next).searchParams.get("datetime"),
            "le `next` perd `datetime` ⇒ la page 2 rend TOUT, en sortant vert"
        ).toBe(`${mark}/..`);
    });

    test("§2.3 — le marqueur LU côté OGC SÉLECTIONNE la ligne côté écriture", async ({
        request,
    }) => {
        // 🛑 THIS TEST FIRST ASSERTED A STRING EQUALITY, and that was a PROXY rather
        // than the property. Measured on 20/09/2026 against the CI bench: for an instant
        // whose microseconds end in a zero, pygeoapi pads to six digits
        // (`…711140+00:00`) where PostgREST serves PostgreSQL's canonical form
        // (`…71114+00:00`). The two strings DIFFER — roughly one row in ten — and the
        // first draft reddened, blaming the servers.
        //
        // What matters is not that the two texts are equal: it is that the marker SERVED
        // by the read side, sent back verbatim to the write side's `eq.` filter, SELECTS
        // the row. It does, because PostgREST casts the value instead of comparing text.
        // A server that compared text would lose the filter silently: §2.2 would read the
        // empty answer as a conflict, and the device would win every time.
        //
        // ⚠️ The workstation bench could not show this: the gap only appears on an instant
        // whose last digit is a zero, and the sampled row was not one. It took a SECOND
        // pair of servers to surface it.
        const fromOgc = await request.get(`${OGC_DELTA}?f=json&limit=1`);
        const feature = (await fromOgc.json()).features[0];
        const id = feature.id ?? feature.properties.id;
        const servedByOgc = feature.properties.updated_at;

        const filtered = await request.patch(
            `${REST_DELTA}?id=eq.${id}&updated_at=eq.${encodeURIComponent(servedByOgc)}`,
            {
                headers: {
                    Authorization: `Bearer ${DEV.token}`,
                    "Content-Type": "application/json",
                    Prefer: "return=representation",
                },
                data: { statut: `e2e31-${Date.now()}` },
            }
        );
        expect(filtered.status()).toBe(200);
        const rows = await filtered.json();
        expect(
            rows.length,
            "une réponse vide ⇒ le marqueur de la LECTURE ne sélectionne pas la ligne à " +
                "l'ÉCRITURE : toute édition filtrée partirait dans la branche conflit"
        ).toBe(1);
        expect(rows[0].id).toBe(id);
    });

    test("§2.2 — un DELETE filtré rend LA LIGNE, et non une réponse vide", async ({ request }) => {
        // 🛑 THE FINDING OF THIS FILE, and it is on the WRITE side rather than on the
        // delta's. A server that deletes softly has to answer the delete with the row:
        // measured on 20/09/2026, a `BEFORE DELETE` trigger suppressing the delete makes
        // PostgREST's `RETURNING` empty, the filtered delete answers `200 []`, and §2.2
        // reads that as a CONFLICT. The queue then re-reads the row, keeps the tombstone
        // locally AS A LIVE ENTITY, and resends unfiltered. The delete lands, after a
        // detour that looks like a data race and is a contract miss.
        const created = await request.post(REST_DELTA, {
            headers: {
                Authorization: `Bearer ${DEV.token}`,
                "Content-Type": "application/json",
                Prefer: "return=representation",
            },
            data: {
                local_id: `${LOCAL_ID_PREFIX}del`,
                title: "Sonde suppression",
                geom: { type: "Point", coordinates: [-60.66, -32.94] },
            },
        });
        const row = (await created.json())[0];

        const deleted = await request.delete(
            `${REST_DELTA}?id=eq.${row.id}&updated_at=eq.${encodeURIComponent(row.updated_at)}`,
            {
                headers: {
                    Authorization: `Bearer ${DEV.token}`,
                    Prefer: "return=representation",
                },
            }
        );
        expect(deleted.status()).toBe(200);
        const returned = await deleted.json();
        expect(
            returned.length,
            "une réponse vide serait lue comme un conflit — §2.2, et la suppression a bien eu lieu"
        ).toBe(1);
        expect(returned[0].id).toBe(row.id);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // The client path — what the device does with what the server serves.
    // ─────────────────────────────────────────────────────────────────────────

    test("§1.2 — la collection des rapatriements COMPLETS ne sert aucune pierre tombale", async ({
        request,
    }) => {
        // The two faces exist for this: a client declaring no `deletedProperty` never
        // consults one, so a tombstone reaching it would be stored as a live entity.
        const created = await request.post(REST_DELTA, {
            headers: {
                Authorization: `Bearer ${DEV.token}`,
                "Content-Type": "application/json",
                Prefer: "return=representation",
            },
            data: {
                local_id: `${LOCAL_ID_PREFIX}live`,
                title: "Sonde deux faces",
                geom: { type: "Point", coordinates: [-60.64, -32.93] },
            },
        });
        const row = (await created.json())[0];
        await request.delete(`${REST_DELTA}?id=eq.${row.id}`, {
            headers: { Authorization: `Bearer ${DEV.token}` },
        });

        // 🛑 ASK FOR THE ITEM, DO NOT ENUMERATE THE COLLECTION. The first draft listed
        // `?limit=200` and compared the two arrays — and read ten ids against ten,
        // because pygeoapi CLIPS a page to its `server.limit` (10 here, kept small on
        // purpose so pagination stays testable). It reddened blaming the views, and the
        // fault was the instrument: counting a PAGE to decide a SET. The neighbouring
        // spec carries the same warning at its extent test; this file earned it twice.
        const onDelta = await request.get(`${OGC_DELTA}/${row.id}?f=json`);
        const onLive = await request.get(`${OGC_LIVE}/${row.id}?f=json`);

        expect(onDelta.status(), "la face du delta PORTE la pierre tombale").toBe(200);
        expect(
            (await onDelta.json()).properties.deleted_at,
            "et elle la sert AVEC son instant de suppression"
        ).toBeTruthy();
        expect(onLive.status(), "la face du complet NE LA PORTE PAS").toBe(404);
    });

    test("§1.3 — une pierre tombale RETIRE la copie de l'appareil", async ({ page, request }) => {
        await armDelta(page);
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
        // The storage engine is a DEFERRED chunk: without this wait we would measure the
        // facade's bounded wait instead of the pull.
        await page.waitForFunction(
            () => !!(/** @type {any} */ (window).GeoLeaf?.Storage?.DB),
            null,
            { timeout: 20000 }
        );

        const created = await request.post(REST_DELTA, {
            headers: {
                Authorization: `Bearer ${DEV.token}`,
                "Content-Type": "application/json",
                Prefer: "return=representation",
            },
            data: {
                local_id: `${LOCAL_ID_PREFIX}tomb`,
                title: "Sonde pierre tombale",
                geom: { type: "Point", coordinates: [-60.655, -32.945] },
            },
        });
        const row = (await created.json())[0];

        /** Server ids currently in the device's `features` store. */
        const storedIds = () =>
            page.evaluate(
                () =>
                    new Promise((resolve) => {
                        const q = indexedDB.open("geoleaf-db");
                        q.onerror = () => resolve({ err: String(q.error?.name) });
                        q.onsuccess = () => {
                            const db = q.result;
                            if (!db.objectStoreNames.contains("features")) {
                                db.close();
                                resolve({ err: "store `features` absent" });
                                return;
                            }
                            const all = db.transaction("features").objectStore("features").getAll();
                            all.onerror = () => {
                                db.close();
                                resolve({ err: String(all.error?.name) });
                            };
                            all.onsuccess = () => {
                                const rows = all.result ?? [];
                                db.close();
                                resolve({ ids: rows.map((r) => String(r.serverId)) });
                            };
                        };
                    })
            );

        const first = await page.evaluate(() =>
            /** @type {any} */ (window).GeoLeaf.Storage.pullLayer("sites_rosario")
        );
        expect(first.refused, "le premier rapatriement ne doit pas refuser").toBeNull();
        expect(first.mode, "le premier rapatriement d'une couche à delta est COMPLET").toBe("full");
        expect((await storedIds()).ids, "l'entité créée est sur l'appareil").toContain(
            String(row.id)
        );

        // Tombstone it, then pull again: this one is a delta, and it must remove the copy.
        await request.delete(`${REST_DELTA}?id=eq.${row.id}`, {
            headers: { Authorization: `Bearer ${DEV.token}` },
        });

        const second = await page.evaluate(() =>
            /** @type {any} */ (window).GeoLeaf.Storage.pullLayer("sites_rosario")
        );
        expect(second.refused, "le second rapatriement ne doit pas refuser").toBeNull();
        expect(second.mode, "le second rapatriement doit être un DELTA").toBe("delta");
        expect(
            (await storedIds()).ids,
            "la pierre tombale doit retirer la copie — sinon la suppression n'est jamais apprise"
        ).not.toContain(String(row.id));
    });
});
