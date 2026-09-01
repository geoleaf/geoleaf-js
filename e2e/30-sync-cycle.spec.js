// @ts-check
/**
 * 30 — THE SYNC CYCLE, AGAINST A REAL BACKEND
 *
 * The cycle's proof criterion:
 *
 *   > Network cut → edit of a **pulled** entity → page reload → **the edit is
 *   > still visible** → network back → push → **the entity carries its server
 *   > identifier**, and a second synchronisation produces **no** request.
 *
 * ✅ **THIS FILE PROVES THAT JOURNEY, END TO END.** It did not always, and what
 * it lacked CHANGED IN NATURE mid-work: first the cycle itself (pull, local
 * read, optimistic write, push), then — those four delivered — a **PRODUCER**,
 * the two editing plugins still writing the v3 queue. The producer switch is
 * what lifted it. Distinguishing "code is missing" from "a caller is missing"
 * took three attempts.
 *
 * ✅ **Pull and local read ARE delivered, and their `fixme` became a living
 * test**: the `features` store now has its writer (`GeoLeaf.Storage.pullLayer`)
 * and its reader. ⚠️ Its expected values are **measured in the run**, never
 * copied: the two push tests below insert rows that only the `afterAll` cleans,
 * so a hard-coded count passes in isolation and reddens in the full file. It
 * happened at the 1st draft.
 *
 * What this file proves **today** is the problem's other half: that the proof's
 * backend exists, that it holds the properties the next steps will depend on,
 * and that the page reaches it **with the connector active**. Without that,
 * writing the next steps would amount to coding against an assumed server — and
 * that is precisely what the preflight found: the backend the criterion
 * requires did not exist, `qgis.geoleaf.dev` answered 404, and the repo's only
 * authenticated E2E (`11-connector.spec.js`) mocked every response.
 *
 * ═══ WHY THIS SPEC DRIVES THE CONNECTOR INSTEAD OF LETTING IT BOOTSTRAP ═══
 *
 * `apps/geoleaf-app/init.js` restricts the dev bootstrap to
 * `localhost|127.0.0.1` and `deploy-local`'s vhost, so a token never activates
 * on a shipped origin. Driving it from the test is the pattern
 * `11-connector.spec.js` established — the difference here is that it targets a
 * REAL backend and not `page.route()` mocks.
 *
 * ⚠️ This paragraph named `demo.addpoi.geoleaf.local.test` until 2026-08-09:
 * that vhost left with the variant, which this very file writes 100 lines
 * lower. A correct motive leaning on a dead example re-reads as a proof.
 *
 * 🛑 SINCE 2026-08-09, THE BOOTSTRAP NO LONGER ACTIVATES ON ANY TARGET OF THIS
 * SPEC, AND THAT IS A GAIN. `build-deploy.cjs` now writes only the inert stub
 * into shippable variants — `deploy-full`, which this file targets, is one. The
 * `ports` target served it from `localhost`, so the bootstrap ACTIVATED there,
 * while it never activated under `nginx`: the two targets did not prove the
 * same starting state, and the "point 5" test below measured not a state but a
 * race window. They now start from the same place.
 *
 * The token is read Node-side in `apps/geoleaf-app/connector.local.js`
 * (git-ignored), never written into this file. A test carrying a hard-coded
 * JWT would be committed with it.
 *
 * ═══ WHAT THE PROBE MEASURED BEFORE THIS FILE WAS WRITTEN ═══
 *
 * 🛑 **`configure()` patches the PAGE's `fetch`, so EVERY request to `baseUrl`
 * carries the token afterwards** — including those believed anonymous. A first
 * draft of the probe asserted "POST without bearer → 401" **after** calling
 * `configure()`, and read **201**. The assertion was wrong, not the server.
 *
 * That is what gives the "point 5 of the contract" test below its shape: the
 * **same** request, before then after `configure()`. It is also the direct
 * demonstration of why the replay must run **on the page** and not in the
 * Service Worker — the patch never reaches the worker, and that is the motive
 * that got the Background Sync path deleted.
 *
 * ⚠️ `serviceWorkers: "block"`, like `11-connector`. Without blocking, the
 * worker could interpose and we would measure the worker believing we measure
 * the network.
 *
 * 🛑 **NO profile of the repo declares `modules.offline.dataOrigins`** —
 * measured, zero occurrences in `profiles/`. The contract has been frozen for a
 * while, the Service Worker knows how to read them, the config gate knows the
 * key, but **nobody feeds it one**: it still runs on its BOOTSTRAP routing, the
 * heuristic path that was meant to become exceptional.
 *
 * ⚠️ **And declaring is NOT a line to add — tried on 08-03, measured, REMOVED.**
 * `routeRequest` (`sw-core.js`) switches to declarative mode as soon as
 * ONE origin is declared, and every undeclared origin then stops being cached:
 * "a declaration's silence is a refusal, not a permission". Declaring the
 * backend's single origin thus cut the cache of the application's own origin,
 * and `27-offline-idb.spec.js` caught it (negative control red, green on
 * removal). **The declaration is all-or-nothing**, and the app's own origin is
 * not declarable in a portable profile — it changes at every deployment.
 * Tracked in the origins register.
 *
 * ⚠️ **Nor was it "wire `matchDataOrigin`"**, as three documents wrote before
 * the 08-03 preflight: the function is private, already has a consumer
 * (`publishDataOrigins`), and its TSDoc reserves its export for the pull work —
 * "exporting for a caller that does not yet exist is exactly the posture this
 * work reproaches elsewhere".
 *
 * ═══ THE BACKEND ONLY EXISTS ON THE DEV MACHINE ═══
 *
 * The containers are those of `docker-compose.dev.yml`
 * (`docker/backend/README.md`). On a GitHub runner there are none. This file
 * **skips itself entirely** when the backend does not answer — but it does so
 * **loudly**: the motive is named, and the single test that survives the skip
 * asserts the skip's reason was recorded. A file coming out green having played
 * nothing would be the very form of the defect this work fights.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { layerConfigPath } from "./helpers/profiles.js";
import { goOffline, goOnline, settleNetwork, assertZeroNetwork } from "./helpers/offline.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** The proof backend's origin — the same as `connector.local.js`'s. */
const API = "https://qgis.geoleaf.dev";
/** OGC API Features surface (pygeoapi), read by `ogc-api-loader.ts` for the pull. */
const OGC = `${API}/ogc/collections/sites_rosario/items`;
/** Write surface (PostgREST), the adapters' `collection` dialect. */
const REST = `${API}/sites_rosario`;

/**
 * Prefix of every client identity this file creates. Serves the cleanup: this
 * spec writes into a shared database, and leaving its rows behind would drift
 * the count the pagination is asserted on (27 rows, 3 pages).
 */
const LOCAL_ID_PREFIX = "e2e30-";

/**
 * Reads the dev bootstrap to extract the origin and the token.
 * @returns {{ baseUrl: string, token: string } | null} `null` if the file is
 *   absent — the nominal case on a runner, not an anomaly.
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

/**
 * The skip's motive, or `null` if everything is in place. Computed once,
 * asserted by the witness test.
 * @type {string | null}
 */
let skipReason = null;

// ⚠️ `deploy-addpoi` vanished with the merged plugin; `deploy-full` is now the
// only variant carrying editing AND `offline-ui`, hence the only one where this
// cycle exists.
test.use({ baseURL: baseURL("full"), serviceWorkers: "block" });

// 🛑 THIS HOOK IS AT FILE SCOPE, NOT THE `describe`'s, AND THE WITNESS DEMANDS
// IT. Placed inside the `describe`, it did execute — but its companion
// `beforeEach` ALSO skipped the witness, and the file came out "9 skipped" with
// not one line saying why. Measured by stopping the containers: that was very
// exactly the silence this file claims to prevent, and it sat inside the
// mechanism meant to prevent it.
test.beforeAll(async ({ request }) => {
    if (!DEV) {
        skipReason =
            "apps/geoleaf-app/connector.local.js absent — pas de bootstrap dev sur cette machine";
        return;
    }
    try {
        const r = await request.get(`${OGC}?f=json&limit=1`, { timeout: 8000 });
        if (!r.ok()) skipReason = `backend joignable mais répond ${r.status()} sur ${OGC}`;
    } catch (e) {
        skipReason = `backend injoignable sur ${API} — conteneurs de docker-compose.dev.yml non démarrés (${String(e).slice(0, 80)})`;
    }
    if (skipReason) return;

    // ── 3rd condition — does the SERVED VARIANT still declare a pull source?
    //
    // 🛑 ADDED ON 2026-08-09, AND IT IS ONE MORE ASSUMED SKIP, NOT A MASKED
    // REGRESSION. Since that date, `build-deploy.cjs` (step 9a) removes the
    // proof-backend bindings from SHIPPABLE variants: `qgis.geoleaf.dev` only
    // resolves on this machine, and it shipped as-is to a client. Yet this file
    // targets `deploy-full`, which IS a deliverable, and `pullLayer()` reads
    // `offline.source.url` in the served profile — with no possible override
    // (`capabilities/offline/pull/layer-pull.ts`). Without this condition, the
    // pull tests would redden on a deploy that is CORRECT.
    //
    // ⚠️ The two conditions above measure the MACHINE (bootstrap, containers);
    // this one measures the ARTIFACT. A backend that answers says nothing of
    // what the served variant declares — precisely the gap that made the
    // diagnosis unreadable without it.
    try {
        const cfg = await request.get(
            `${baseURL("full")}${layerConfigPath("tourism", "sites_rosario")}`,
            { timeout: 8000 }
        );
        const declaresSource = cfg.ok() && Boolean((await cfg.json())?.offline?.source?.url);
        if (!declaresSource) {
            skipReason =
                "la variante servie est un LIVRABLE : ses liaisons vers le backend de preuve ont " +
                "été retirées au build (build-deploy.cjs étape 9a), donc `sites_rosario` ne " +
                "déclare plus d'`offline.source`. Pour éprouver le cycle complet, reconstruire " +
                "avec l'origine explicite : " +
                "GEOLEAF_BACKEND_BASE_URL=https://qgis.geoleaf.dev npm run build:deploy";
        }
    } catch (e) {
        skipReason = `profil de la variante servie illisible (${String(e).slice(0, 80)})`;
    }
});

test("TÉMOIN — si ce fichier se saute, le motif est NOMMÉ et non silencieux", async () => {
    // ⚠️ OUTSIDE the `describe`, hence out of its `beforeEach`'s reach: the only
    // test of the file that must execute even without a backend. Its value is
    // not asserting the backend runs — it is preventing this file from passing
    // as "green" while it played nothing. A fully skipped file is
    // indistinguishable, in a quickly-read report, from a fully green one.
    if (skipReason) {
        test.info().annotations.push({ type: "skip-reason", description: skipReason });
        expect(skipReason.length, "un saut doit porter un motif lisible").toBeGreaterThan(20);
        return;
    }
    expect(DEV, "le bootstrap dev doit être lisible quand le backend répond").not.toBeNull();
});

test.describe("30 — Cycle de synchronisation (backend réel, connector actif)", () => {
    test.beforeEach(() => {
        test.skip(skipReason !== null, skipReason ?? "");
    });

    test.afterAll(async ({ request }) => {
        // Cleanup of EVERYTHING this file may have written, including after a
        // mid-route failure. Without it, repeated execution would grow the table
        // and the pagination count (27) would stop being true — a test breaking
        // the test next door.
        if (skipReason || !DEV) return;
        await request
            .delete(`${REST}?local_id=like.${LOCAL_ID_PREFIX}*`, {
                headers: { Authorization: `Bearer ${DEV.token}` },
            })
            .catch(() => {});
    });

    // ─────────────────────────────────────────────────────────────────────────
    // What is PROVEN today — the properties the rest of the cycle depends on.
    // ─────────────────────────────────────────────────────────────────────────

    test("4.1 (transport) — la surface OGC a la forme que `ogc-api-loader` exige", async ({
        page,
    }) => {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

        const shape = await page.evaluate(async (url) => {
            const r = await fetch(`${url}?f=json&limit=10`);
            const d = await r.json();
            return {
                status: r.status,
                type: d.type,
                featuresIsArray: Array.isArray(d.features),
                matched: d.numberMatched,
                hasNext: (d.links || []).some(
                    (l) => l.rel === "next" && typeof l.href === "string"
                ),
                geometryType: d.features?.[0]?.geometry?.type ?? null,
            };
        }, OGC);

        // These three are exactly what `_validateOgcResponse` checks, and what
        // `_extractNextUrl` looks for. Asserting them here is asserting the pull
        // will have NO transport code to write — the contract's point-6 promise.
        expect(shape.status).toBe(200);
        expect(shape.type).toBe("FeatureCollection");
        expect(shape.featuresIsArray).toBe(true);
        expect(shape.hasNext, "sans lien `next`, la pagination de 4.1 serait improuvable").toBe(
            true
        );
        expect(shape.geometryType).toBe("Point");
    });

    test("4.1 (transport) — la pagination tourne RÉELLEMENT les pages, depuis la page", async ({
        page,
    }) => {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

        // Same walk as `fetchOgcApiFeatures`: follow `links[rel=next]` to
        // exhaustion. The 10-turn cap is no tuning, it is a guard-rail: without
        // it, a backend always returning the same `next` would jam the runner.
        const walk = await page.evaluate(async (url) => {
            let next = `${url}?f=json&limit=10`;
            let pages = 0;
            let total = 0;
            let matched = null;
            while (next && pages < 10) {
                const r = await fetch(next);
                const d = await r.json();
                pages++;
                total += (d.features || []).length;
                matched = d.numberMatched ?? matched;
                next = (d.links || []).find((l) => l.rel === "next")?.href ?? null;
            }
            return { pages, total, matched };
        }, OGC);

        // 🛑 `pages > 1` is the assertion that counts, and it is there for a
        // measured reason: pg_featureserv 1.3.1 — the first server mounted —
        // serves `bbox` and `limit` correctly but emits NO `next` link. The walk
        // stopped at the first page returning a plausible total. A test
        // asserting only the total would have passed green against a server
        // unable to paginate.
        expect(walk.pages, "une seule page ⇒ le lien `next` n'est pas suivi").toBeGreaterThan(1);
        expect(walk.total).toBe(walk.matched);
    });

    test("4.1 (transport) — l'emprise BORNE le rapatriement", async ({ page }) => {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

        // 🛑 `numberMatched` AND NOT `features.length`. The first draft counted
        // rendered features with `limit=1000`, and read **10 versus 10**:
        // pygeoapi CLIPS the page size to its `server.limit` (10 here, chosen
        // small on purpose so pagination stays testable). The two measurements
        // thus compared two identical truncated pages, and the test reddened
        // blaming the extent.
        //
        // ⚠️ The instrument carried the bias it measured: counting a PAGE to
        // prove a filter on a SET. `numberMatched` is the result's cardinal, not
        // the page's — 27 without extent, 12 with.
        const counts = await page.evaluate(async (url) => {
            const at = async (q) =>
                (await (await fetch(`${url}?f=json&limit=1${q}`)).json()).numberMatched;
            return {
                all: await at(""),
                inBbox: await at("&bbox=-60.67,-32.95,-60.64,-32.93"),
            };
        }, OGC);

        // An extent that removes nothing does not prove it filters — it only
        // proves it caused no error.
        expect(counts.inBbox).toBeGreaterThan(0);
        expect(counts.inBbox).toBeLessThan(counts.all);
    });

    test("POINT 5 DU CONTRAT — le connector patche le `fetch` DE LA PAGE, et c'est ce qui autorise l'écriture", async ({
        page,
    }) => {
        // 🛑 CAPTURE `fetch` BEFORE ANY PAGE SCRIPT — without which this test
        // would be a RACE.
        //
        // ⚠️ THE HISTORY IS WORTH KEEPING, BECAUSE THE TEST'S SHAPE FOLLOWS FROM
        // IT. Until 2026-08-09, `deploy-full` embarked the REAL
        // `connector.local.js`: on the `ports` target — `ci:local`'s — the
        // origin is `localhost`, so the dev bootstrap activated and configured
        // the connector at boot, while under `E2E_TARGET=nginx` it never
        // activated. The "before `configure()`" measurement thus measured not a
        // state but a WINDOW: it only held if it won the race against that
        // bootstrap. Seen flipping on 2026-08-08 at the MapLibre 6 move, whose
        // boot adds two serialised requests (`global.mjs` → `maplibre-gl.mjs` →
        // `-shared.mjs`) and shifts the window — v6 broke nothing, it revealed
        // the assertion rested on timing.
        //
        // The race vanished at its root: shippable variants now receive only the
        // inert stub, so `window.GEOLEAF_DEV_CONNECTOR` is `undefined` at boot
        // on BOTH targets.
        //
        // `addInitScript` nonetheless stays, and it is not belt-and-braces: it
        // executes before any script of the document, so the reference captured
        // here is NEVER patched. The "before" becomes true by CONSTRUCTION
        // rather than by a build property — which gives the test back what it
        // claims to prove: it really is the `fetch` patch that authorises the
        // write, and not the order in which two scripts loaded.
        await page.addInitScript(() => {
            /** @type {any} */ (window).__origFetch = window.fetch.bind(window);
        });
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

        const body = {
            local_id: `${LOCAL_ID_PREFIX}point5`,
            title: "Saisie de terrain",
            geom: "SRID=4326;POINT(-60.655 -32.945)",
        };

        // BEFORE `configure()` — no token is injected, PostgREST falls back on
        // `geoleaf_anon`, which has only SELECT. The invariant held SQL-side:
        // pulling never confers writing.
        const before = await page.evaluate(
            async ({ url, payload }) => {
                // `__origFetch` — the reference from before any patch (see `addInitScript`).
                const r = await /** @type {any} */ (window).__origFetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                });
                return r.status;
            },
            { url: REST, payload: body }
        );
        expect(before, "sur un `fetch` NON patché, l'écriture doit être REFUSÉE").toBe(401);

        // AFTER `configure()` — the SAME request, on the same page, with no
        // header set by the caller. The connector is what adds it, by patching
        // `fetch`.
        const after = await page.evaluate(
            async ({ url, payload, api, tok }) => {
                const w = /** @type {any} */ (window);
                await w.GeoLeaf.Connector.configure({ baseUrl: api, getToken: async () => tok });
                const r = await fetch(url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Prefer: "return=representation",
                    },
                    body: JSON.stringify(payload),
                });
                return { status: r.status, rows: r.status === 201 ? await r.json() : null };
            },
            { url: REST, payload: body, api: API, tok: /** @type {string} */ (DEV?.token) }
        );

        expect(after.status, "avec connector, la MÊME requête doit passer").toBe(201);

        // 🛑 This is where point 5's reason to exist plays out: this patch lives
        // in the PAGE. The Service Worker does not see it, and that is why the
        // replay from the worker could not solve authentication — the Background
        // Sync path was deleted for this motive, not for hygiene.
        expect(after.rows?.[0]?.local_id).toBe(body.local_id);
    });

    test("4.5 (préalable) — le push rend l'IDENTIFIANT SERVEUR, matière de la réconciliation", async ({
        page,
    }) => {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

        // ⚠️ WAIT for the plugin, not a proxy. `connector` is LAZY (`init.js` →
        // `registerLazy`), so `#geoleaf-map` visible says NOTHING of its
        // availability: `GeoLeaf.Connector` was still `undefined` here,
        // intermittently. Waiting on the state about to be used is the only form
        // that does not depend on boot time — which changed at the MapLibre 6
        // move (two more serialised requests).
        await page.waitForFunction(
            () => typeof window.GeoLeaf?.Connector?.configure === "function",
            null,
            { timeout: 20000 }
        );

        const pushed = await page.evaluate(
            async ({ url, api, tok, localId }) => {
                const w = /** @type {any} */ (window);
                await w.GeoLeaf.Connector.configure({ baseUrl: api, getToken: async () => tok });
                const r = await fetch(url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Prefer: "return=representation",
                    },
                    body: JSON.stringify({
                        local_id: localId,
                        title: "Entité créée hors réseau",
                        geom: "SRID=4326;POINT(-60.66 -32.946)",
                    }),
                });
                const rows = await r.json();
                return { status: r.status, row: rows?.[0] ?? null };
            },
            {
                url: REST,
                api: API,
                tok: /** @type {string} */ (DEV?.token),
                localId: `${LOCAL_ID_PREFIX}push`,
            }
        );

        expect(pushed.status).toBe(201);
        // `localId` → `serverId`: THE datum the push must carry into the record.
        expect(typeof pushed.row?.id, "le serveur doit rendre son identifiant").toBe("number");
        expect(pushed.row?.local_id).toBe(`${LOCAL_ID_PREFIX}push`);
        // The version marker read at push — the conflict detection's matter.
        expect(pushed.row?.updated_at, "sans marqueur, un conflit est indétectable").toBeTruthy();
    });

    test("4.5 (préalable) — le REJEU du même `localId` est refusé par la BASE, pas par une convention d'appelant", async ({
        page,
    }) => {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

        // ⚠️ WAIT for the plugin, not a proxy. `connector` is LAZY (`init.js` →
        // `registerLazy`), so `#geoleaf-map` visible says NOTHING of its
        // availability: `GeoLeaf.Connector` was still `undefined` here,
        // intermittently. Waiting on the state about to be used is the only form
        // that does not depend on boot time — which changed at the MapLibre 6
        // move (two more serialised requests).
        await page.waitForFunction(
            () => typeof window.GeoLeaf?.Connector?.configure === "function",
            null,
            { timeout: 20000 }
        );

        const replay = await page.evaluate(
            async ({ url, api, tok, localId }) => {
                const w = /** @type {any} */ (window);
                await w.GeoLeaf.Connector.configure({ baseUrl: api, getToken: async () => tok });
                const send = () =>
                    fetch(url, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            local_id: localId,
                            title: "Rejeu",
                            geom: "SRID=4326;POINT(-60.661 -32.947)",
                        }),
                    });
                const first = await send();
                const second = await send();
                const count = await (await fetch(`${url}?local_id=eq.${localId}&select=id`)).json();
                return { first: first.status, second: second.status, rows: count.length };
            },
            {
                url: REST,
                api: API,
                tok: /** @type {string} */ (DEV?.token),
                localId: `${LOCAL_ID_PREFIX}replay`,
            }
        );

        expect(replay.first).toBe(201);
        // 409 on the UNIQUE constraint. The idempotence the push must hold is
        // thus not caller discipline — an accidental replay CANNOT duplicate.
        expect(replay.second, "un rejeu doit collisionner, pas dupliquer").toBe(409);
        expect(replay.rows, "une seule ligne, quoi qu'il arrive").toBe(1);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // ✅ NO `fixme` LEFT IN THIS FILE. It carried two, one per undelivered
    // piece; both became living tests — the pull first, then the full journey
    // once the producers switched. That was their only role: redden at
    // delivery.
    // ─────────────────────────────────────────────────────────────────────────

    // ⚠️ THIS TEST WAS A `fixme` UNTIL THE PULL LANDED — it has been alive
    // since.
    //
    // Three things changed in waking it, none cosmetic:
    //
    //  1. `GeoLeaf.Offline.pullLayer` NEVER EXISTED and will not: the pull is
    //     mounted on `GeoLeaf.Storage`, the offline engine's facade, rather
    //     than a new namespace. The `fixme` said so — "the name is a
    //     hypothesis, not a contract".
    //  2. The call LOSES ITS OPTIONAL CHAINING. `w.GeoLeaf?.Offline?.pullLayer?.(…)`
    //     did not throw when nothing answered: it did NOTHING, and the test
    //     would only have blamed the count. A call that must happen is written
    //     without `?.`.
    //  3. The criterion rises. "`features` is no longer empty" is satisfied by
    //     one meaningless record; here we assert the entities carry their
    //     server identity and their version marker — what conflict detection
    //     will compare — and above all that an EXTENT really bounds the batch
    //     (11 of the 27, measured).
    test("4.1 — le rapatriement borné ÉCRIT dans `features`, et l'emprise le BORNE", async ({
        page,
        request,
    }) => {
        // 🛑 THE EXPECTED VALUES ARE MEASURED IN THE SAME RUN, NEVER COPIED.
        // The seed is 27 rows — but the two push tests above INSERT some, and
        // their cleanup only happens in `afterAll`. A `toBe(27)` written here
        // passes alone and reddens in the full file: what happened at the 1st
        // draft. So the server is asked for its own count, and the proof
        // becomes the GAP.
        const numberMatched = async (bbox) => {
            const response = await request.get(
                `${OGC}?f=json&limit=1${bbox ? `&bbox=${bbox}` : ""}`
            );
            return (await response.json()).numberMatched;
        };
        const BBOX = "-60.66,-32.95,-60.62,-32.93";
        const onServer = await numberMatched();
        const onServerBounded = await numberMatched(BBOX);

        await page.goto("/", { waitUntil: "domcontentloaded" });
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

        // The storage engine is a DEFERRED chunk: without this wait, we would
        // measure the facade's bounded wait instead of the pull (same trap as
        // the local-read work).
        await page.waitForFunction(() => !!window.GeoLeaf?.Storage?.DB, null, { timeout: 20000 });

        /**
         * Reads the store. Guards `objectStoreNames.contains` (a v3 database
         * would throw `NotFoundError`) and `onerror` on the request — without
         * it the promise never resolves, and the symptom is a Playwright
         * timeout instead of a readable red.
         */
        const readStore = async () =>
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
                                resolve({
                                    total: rows.length,
                                    withServerId: rows.filter((r) => r.serverId).length,
                                    withVersion: rows.filter((r) => r.version?.kind === "timestamp")
                                        .length,
                                    states: [...new Set(rows.map((r) => r.syncState))],
                                });
                            };
                        };
                    })
            );

        const full = await page.evaluate(() => window.GeoLeaf.Storage.pullLayer("sites_rosario"));
        expect(full.refused, "le rapatriement ne doit pas refuser").toBeNull();

        const stored = await readStore();
        expect(stored.total, "après un pull, `features` porte ce que la source a rendu").toBe(
            onServer
        );
        expect(stored.withServerId, "chaque entité porte son identité serveur").toBe(onServer);
        // The marker read FROM the first pull: it, and nothing else, is what
        // will make conflicts detectable. Reading it later would have imposed a
        // migration.
        expect(stored.withVersion, "chaque entité porte son VersionMarker").toBe(onServer);
        // Standing invariant — pulling NEVER confers editability.
        expect(stored.states).toEqual(["synced"]);

        // ── The extent BOUNDS, and the check is discriminating ──────────────────────────
        // The extent is passed to the page, never rewritten: the string queried
        // at the server and the array given to the pull must be the SAME
        // literal, else the comparison bears on two different extents with
        // nothing saying so.
        const bounded = await page.evaluate(async (bboxText) => {
            await new Promise((resolve) => {
                const q = indexedDB.open("geoleaf-db");
                q.onerror = () => resolve(null);
                q.onsuccess = () => {
                    const db = q.result;
                    const tx = db.transaction("features", "readwrite");
                    tx.objectStore("features").clear();
                    tx.oncomplete = tx.onerror = () => {
                        db.close();
                        resolve(null);
                    };
                };
            });
            return window.GeoLeaf.Storage.pullLayer("sites_rosario", {
                bbox: bboxText.split(",").map(Number),
            });
        }, BBOX);

        // ⚠️ The check that makes the proof: an extent returning EVERYTHING
        // would prove nothing. First assert it really discriminates, THEN that
        // the pull sticks to it. Without the first line, the second would stay
        // green the day the data moves out of the extent.
        expect(
            onServerBounded,
            "l'emprise doit DISCRIMINER, sinon la mesure ne prouve rien"
        ).toBeLessThan(onServer);
        expect(bounded.written, "l'emprise borne le rapatriement").toBe(onServerBounded);
        expect((await readStore()).total).toBe(onServerBounded);
    });

    /**
     * THE CYCLE'S PROOF CRITERION, played end to end.
     *
     * 🛑 THIS TEST WAS A `fixme` FOR THE WHOLE EFFORT, AND WHAT IT LACKED
     * CHANGED IN NATURE ALONG THE WAY. At first the cycle was missing: pull,
     * local read, optimistic write, push. Once those four were delivered
     * something was still missing — not cycle code, but a PRODUCER: the two
     * editing plugins still wrote the v3 queue, each in its own vocabulary. The
     * producer switch lifted it. Telling the two apart took three attempts.
     *
     * ⚠️ It edits a PULLED entity, not a created one: that is the criterion's
     * word, and the case that makes sense — a server identity already exists,
     * so reconciliation bears on something. It restores the original title on
     * the way out: this spec writes into a shared database, and letting the
     * seed drift would make the other tests' counts lie.
     */
    test("PREUVE DU SPRINT 4 — édition hors réseau, rechargement, push, identité réconciliée", async ({
        page,
        context,
    }) => {
        const LAYER = "sites_rosario";
        const EDITED = `hors-réseau-${Date.now()}`;
        /** Everything that is NOT the backend is tolerated: step 9 speaks only of IT. */
        const ONLY_BACKEND = [/^(?!.*qgis\.geoleaf\.dev).*/];

        const bootAndConfigure = async () => {
            await page.goto("/", { waitUntil: "domcontentloaded" });
            await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

            // ⚠️ WAIT for the plugin, not a proxy. `connector` is LAZY (`init.js`
            // → `registerLazy`), so `#geoleaf-map` visible says NOTHING of its
            // availability: `GeoLeaf.Connector` was still `undefined` here,
            // intermittently. Waiting on the state about to be used is the only
            // form that does not depend on boot time — which changed at the
            // MapLibre 6 move (two more serialised requests).
            await page.waitForFunction(
                () => typeof window.GeoLeaf?.Connector?.configure === "function",
                null,
                { timeout: 20000 }
            );
            // The storage engine is a DEFERRED chunk — without this wait we
            // would measure the facade's bounded wait instead of the cycle.
            await page.waitForFunction(() => !!window.GeoLeaf?.Storage?.DB, null, {
                timeout: 20000,
            });
            await page.evaluate(
                async ({ api, tok }) => {
                    await window.GeoLeaf.Connector.configure({
                        baseUrl: api,
                        getToken: async () => tok,
                    });
                },
                { api: API, tok: DEV.token }
            );
        };

        const readRecord = (localId) =>
            page.evaluate(
                ({ layer, id }) =>
                    new Promise((resolve) => {
                        const q = indexedDB.open("geoleaf-db");
                        q.onerror = () => resolve({ err: String(q.error?.name) });
                        q.onsuccess = () => {
                            const db = q.result;
                            if (!db.objectStoreNames.contains("features")) {
                                db.close();
                                resolve({ err: "store absent" });
                                return;
                            }
                            const get = db
                                .transaction("features")
                                .objectStore("features")
                                .get([layer, id]);
                            get.onerror = () => {
                                db.close();
                                resolve({ err: String(get.error?.name) });
                            };
                            get.onsuccess = () => {
                                db.close();
                                resolve(get.result ?? null);
                            };
                        };
                    }),
                { layer: LAYER, id: localId }
            );

        // ── 1. PULL ─────────────────────────────────────────────────────────────────────
        await bootAndConfigure();
        const pull = await page.evaluate((l) => window.GeoLeaf.Storage.pullLayer(l), LAYER);
        expect(pull.refused, "le rapatriement doit avoir lieu").toBeNull();
        expect(pull.written).toBeGreaterThan(0);

        // The edited entity is a PULLED one: its local identity is derived from
        // its server identity by the pull, and that is what will make
        // reconciliation verifiable.
        const localId = "srv:1";
        const before = await readRecord(localId);
        expect(before?.serverId, "l'entité rapatriée porte son identité serveur").toBe("1");
        const originalTitle = before.feature.properties.title;

        // ── 2. CUT · 3. EDIT ────────────────────────────────────────────────────────────
        await goOffline(context, page);
        const edit = await page.evaluate(
            async ({ layer, id, title }) => {
                const rec = await new Promise((resolve) => {
                    const q = indexedDB.open("geoleaf-db");
                    q.onsuccess = () => {
                        const db = q.result;
                        const g = db
                            .transaction("features")
                            .objectStore("features")
                            .get([layer, id]);
                        g.onsuccess = () => {
                            db.close();
                            resolve(g.result);
                        };
                    };
                });
                const feature = { ...rec.feature };
                feature.properties = { ...feature.properties, title };
                return window.GeoLeaf.Storage.applyEdit({
                    layerId: layer,
                    kind: "update",
                    localId: id,
                    feature,
                });
            },
            { layer: LAYER, id: localId, title: EDITED }
        );
        expect(edit.refused, "éditer hors réseau ne doit rien refuser").toBeNull();

        // ── 4. RELOAD · 5. THE EDIT IS STILL THERE ──────────────────────────────────────
        // 🛑 THE CRITERION'S HEART. This is where the chain breaks if the
        // optimistic write did not land in `features`, or if the local read
        // does not re-read it: a field entry that vanishes at reload is the
        // defect this work exists to close.
        await goOnline(context, page);
        await bootAndConfigure();
        const afterReload = await readRecord(localId);
        expect(afterReload?.feature?.properties?.title, "l'édition survit au rechargement").toBe(
            EDITED
        );
        expect(afterReload.syncState, "elle est toujours due au serveur").toBe("pending");

        const served = await page.evaluate(
            (l) => window.GeoLeaf.Storage.DB.getLayerFeatureCollection(l),
            LAYER
        );
        expect(
            served.features.some((f) => f?.properties?.title === EDITED),
            "et le magasin la SERT — c'est ce que « toujours visible » veut dire"
        ).toBe(true);

        // ── 6. RESTORE (already done) · 7. PUSH · 8. IDENTITY RECONCILED ────────────────
        const push = await page.evaluate(() => window.GeoLeaf.Storage.pushOutbox());
        expect(push.refused).toBeNull();
        expect(push.pushed, "l'édition part au serveur").toBeGreaterThan(0);

        const afterPush = await readRecord(localId);
        expect(afterPush.serverId, "l'entité porte son identifiant serveur").toBe("1");
        expect(afterPush.syncState, "et elle n'est plus due").toBe("synced");

        // ── 9. A SECOND SYNCHRONISATION PRODUCES NO REQUEST ─────────────────────────────
        // ⚠️ Scoped to the backend's origin, and preceded by `settleNetwork`: on
        // a map page the network is NEVER quiet (tiles arrive well after boot),
        // and concluding "zero requests at all" on one variant then applying it
        // to another is the mistake the helper documents. The instrument counts
        // INITIATIONS.
        await settleNetwork(page);
        await assertZeroNetwork(
            page,
            async () => {
                const second = await page.evaluate(() => window.GeoLeaf.Storage.pushOutbox());
                expect(second.attempted, "la file est vide, il n'y a rien à repousser").toBe(0);
            },
            { allow: ONLY_BACKEND }
        );

        // Seed restoration — this spec writes into a shared database.
        await page.evaluate(
            async ({ url, title }) => {
                await fetch(`${url}?id=eq.1`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ title }),
                });
            },
            { url: REST, title: originalTitle }
        );
    });
});
