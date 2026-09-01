// @ts-check
/**
 * 27 — OFFLINE SERVES FROM INDEXEDDB (proof criterion no. 2)
 *
 * The verification that root cause no. 2 is REALLY fixed, and not merely fixed
 * in appearance: until 2026-08-02 the Service Worker opened `geoleaf-db` at a
 * hard-coded version `2` while the engine declared `3`, so `openIndexedDB()`
 * returned `null` at every call and step 1 of the tile strategy was never
 * taken.
 *
 * 🛑 WHAT WOULD PROVE NOTHING, and which is the trap this file exists to avoid:
 *   - "the tile arrives offline" — the Cache API path produces exactly the same
 *     green;
 *   - "the Cache API was emptied" — the browser's HTTP cache can still serve;
 *   - "an event was emitted" — that is how six defects survived for months.
 *
 * ✅ WHAT PROVES: bytes that ONLY the IndexedDB branch can produce. A tile
 * whose exact content is known is seeded, the Cache API emptied, the network
 * cut, and BYTE-FOR-BYTE equality asserted. Offline and cache-less, no other
 * branch can yield those bytes.
 *
 * ✅ AND THE NEGATIVE CONTROL, without which the green above stays dubious: the
 * record is removed, we stay offline, we ask again — and must get the SVG
 * placeholder. Without that step, a green could come from a badly cleaned
 * cache.
 *
 * ⚠️ THIS SPEC DOES NOT ARM `serviceWorkers: "block"`, unlike the 26 others.
 * The Service Worker is the subject. Under `E2E_TARGET=nginx` registration
 * requires `--ignore-certificate-errors` at BROWSER level — `ignoreHTTPSErrors`
 * does not cover the worker script's fetch. The flag is set by
 * `hostResolverArgs` (`e2e/helpers/base-url.js`), which documents the trap.
 */

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import {
    seedDatabase,
    seedLegacyDump,
    openBlankOnOrigin,
    wipeOnOrigin,
} from "./helpers/db-seed.js";
import {
    GEOLEAF_DB,
    describe as describeDb,
    readRecord,
    readBinary,
    countStore,
} from "./helpers/idb.js";
import { goOffline, goOnline, withOffline } from "./helpers/offline.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ⚠️ Read through `fs` and not `import ... with { type: "json" }`: Node 22
// accepts import attributes, the ESLint parser configured here does not — the
// "modern" form fails the Lint gate. Measured on 2026-08-02.
const dump = JSON.parse(
    readFileSync(
        fileURLToPath(new URL("./fixtures/offline/db-v3-dump.json", import.meta.url)),
        "utf8"
    )
);

const ORIGIN = baseURL("core");

/** A tile URL — the SW's `isTileRequest()` routes it to `tileCacheStrategy`. */
const TILE_URL = "https://tile.openstreetmap.org/7/63/42.png";

/** A really decodable 1×1 PNG, and its fingerprint: the byte assertion's oracle. */
const TILE_B64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const TILE_BYTES = 70;

test.describe("27 — le hors-ligne sert depuis IndexedDB (3.2)", () => {
    test.beforeEach(async ({ page }) => {
        // Real isolation: a green must never be able to come from a previous run.
        await wipeOnOrigin(page, ORIGIN);
    });

    test.afterEach(async ({ context, page }) => {
        await goOnline(context, page).catch(() => {
            /* the context may already be online */
        });
    });

    test("une tuile semée en base est servie PAR LE CHEMIN DU SW, hors ligne et sans Cache API", async ({
        context,
        page,
    }) => {
        // ── 1. Seed a REAL v3 before any boot ───────────────────────────────────────────
        // The criterion says "open geoleaf-db AFTER migration": a database must
        // thus already exist when the application starts. Seeding after the boot
        // tests nothing.
        await seedDatabase(page, {
            ...dump,
            clear: true,
            data: {
                layers: [
                    {
                        id: TILE_URL,
                        profileId: "tourism",
                        resourceType: "tile",
                        contentType: "image/png",
                        timestamp: 1785600000000,
                        // ArrayBuffer and NOT Blob: the SW's `extractBinary()`
                        // reads an ArrayBuffer, a `data:` string or a
                        // {kind:"binary"} envelope — a Blob falls through all
                        // three and the record becomes unreadable by the very
                        // path it serves to prove.
                        data: { __arraybuffer__: { base64: TILE_B64 } },
                    },
                ],
            },
        });

        const seeded = await describeDb(page, GEOLEAF_DB);
        expect(seeded.version).toBe(3);
        expect(seeded.stores).toContain("layers");

        // ── 2. Boot the application ON that database ────────────────────────────────────
        await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });

        // `controller`, not `.ready`: a registered but NON-CONTROLLING SW serves
        // nothing, and waiting on it is what keeps this test honest.
        await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {
            timeout: 25000,
        });

        // The seeded database survived the boot — else a fresh one would be proven.
        const afterBoot = await readRecord(page, {
            db: GEOLEAF_DB,
            store: "layers",
            key: TILE_URL,
        });
        expect(afterBoot, "la tuile semée doit survivre au boot de l'app").toBeTruthy();

        // ── 3. Empty the Cache API — the competing branch ───────────────────────────────
        //
        // ⚠️ Do NOT assert "0 caches". The application is running: the worker
        // reopens a bucket at the very next request (`caches.open(CACHE_TILES)`,
        // the network-first strategies doing `cache.put`), so counting caches
        // amounts to racing it and yields a red that says nothing of the tested
        // code. Measured: 1 cache recreated between the `delete` and the
        // re-read.
        //
        // What counts is not "no cache" but "nothing IN CACHE FOR THIS URL" —
        // i.e. the competing branch cannot answer in IndexedDB's place.
        const tileInCache = await page.evaluate(async (url) => {
            const names = await caches.keys();
            await Promise.all(names.map((n) => caches.delete(n)));
            const hit = await caches.match(url);
            return hit ? { status: hit.status } : null;
        }, TILE_URL);
        expect(tileInCache, "aucune réponse en Cache API pour cette tuile").toBeNull();

        // ── 3bis. The bytes ARE really in the database, in the right shape ──────────────
        // `readBinary` tells an ArrayBuffer from a string: seeding a Blob would
        // silently pass the `toBeTruthy()` above and stay unreadable by the SW.
        const stored = await readBinary(page, {
            db: GEOLEAF_DB,
            store: "layers",
            key: TILE_URL,
            field: "data",
        });
        expect(stored.kind, "la tuile doit être un ArrayBuffer, pas un Blob ni une chaîne").toBe(
            "arraybuffer"
        );
        expect(stored.byteLength).toBe(TILE_BYTES);

        // ── 4. Cut the network ──────────────────────────────────────────────────────────
        // ── 5. Request the tile — the answer can only come from IndexedDB ───────────────
        // `withOffline` restores the network even if an assertion fails: without
        // it, a red here would leave the context offline for every following
        // test of the file.
        // ⚠️ NO `assertZeroNetwork` here, and the motive is measured: a `fetch()`
        // served ENTIRELY by the Service Worker still emits a `request` event.
        // The helper counts request INITIATIONS, not network egress — the
        // assertion would thus have reddened on the tile just served from the
        // database.
        //
        // ✅ The limit has been INVESTIGATED since 08-03 (see `offline.js`'s
        // header): it concerns ONLY the reads the worker intercepts — i.e.
        // exactly this test. Criterion 3 bears on a WRITE, which emits none; it
        // is proven by `29-offline-proof.spec.js`. This comment thus stays
        // right, and it now is for a measured reason rather than by prudence.
        const served = await withOffline(context, page, () =>
            page.evaluate(async (url) => {
                const res = await fetch(url, { cache: "no-store" });
                const buf = await res.arrayBuffer();
                const bytes = Array.from(new Uint8Array(buf));
                return {
                    status: res.status,
                    contentType: res.headers.get("content-type"),
                    byteLength: buf.byteLength,
                    head: bytes.slice(0, 8),
                };
            }, TILE_URL)
        );

        expect(served.status).toBe(200);
        expect(served.contentType).toContain("image/png");
        // The assertion carrying everything: the bytes are THE ONES SEEDED.
        // Offline, without the Cache API, no other worker branch can produce
        // them.
        expect(served.byteLength).toBe(TILE_BYTES);
        // PNG header — the proof it is neither the SVG placeholder nor an empty response.
        expect(served.head).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    });

    test("CONTRÔLE NÉGATIF — sans l'enregistrement, la même requête rend le placeholder", async ({
        context,
        page,
    }) => {
        // Without this test, the previous one's green could come from a badly
        // cleaned cache: the SAME request, under the SAME conditions, must be
        // shown to fail when the only thing that changes is the IndexedDB
        // record's absence.
        // `seedLegacyDump` — the documented entry point: it lays the COMPLETE v3
        // fixture before any boot. Its tile is a DIFFERENT URL from the measured
        // one, which is exactly the negative control's condition.
        const seeded = await seedLegacyDump(page, ORIGIN, dump);
        expect(seeded.version).toBe(3);

        // The fixture carries what it announces — 5 queue entries, including
        // criterion 4's `failed` entry and the three carrying the input order.
        // What those five prove is proven by `28-offline-queue.spec.js`; here
        // only their PRESENCE is verified, so the negative control below starts
        // from a real database.
        expect(await countStore(page, { db: GEOLEAF_DB, store: "sync_queue" })).toBe(5);

        await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {
            timeout: 25000,
        });

        const absent = await readRecord(page, { db: GEOLEAF_DB, store: "layers", key: TILE_URL });
        expect(absent, "le contrôle négatif exige que la tuile soit ABSENTE").toBeNull();

        await page.evaluate(async () => {
            const names = await caches.keys();
            await Promise.all(names.map((n) => caches.delete(n)));
        });
        await goOffline(context, page);

        const served = await page.evaluate(async (url) => {
            const res = await fetch(url, { cache: "no-store" });
            return {
                status: res.status,
                contentType: res.headers.get("content-type"),
                body: (await res.text()).slice(0, 40),
            };
        }, TILE_URL);

        // The worker serves its placeholder. ✅ Since the fix it serves it as
        // **504**: the body has use value — it tells the user the tile is
        // missing — but the status tells the truth, and any consumer testing
        // `response.ok` sees it. At 200, MapLibre received SVG for a vector tile
        // and tried parsing it as protobuf.
        expect(served.contentType).toContain("image/svg+xml");
        expect(served.body).toContain("<svg");
        expect(served.status, "bug n° 6 : l'échec réseau ne se déguise plus en succès").toBe(504);
    });

    // ⚠️ THIS TEST IS NOT A GUARD, and saying so is the only way it will not be
    // taken for one. It replays the two opens from the PAGE: it thus observes a
    // fact about IndexedDB and the seeded database, not about `sw-core.js`.
    // Verified by mutation — putting `open("geoleaf-db", 2)` back in the worker
    // and rebuilding the deploy, it stays GREEN while this file's first test
    // reddens.
    //
    // It is worth what it documents: WHY a pinned version cannot work. What
    // GUARDS the worker's behaviour are the first test above (bytes served
    // offline) and `__tests__/storage/sw-core.test.js`'s source guard (no
    // two-argument `indexedDB.open(`).
    test("le MÉCANISME de 3.1, documenté depuis le navigateur (pas une garde — voir ci-dessus)", async ({
        page,
    }) => {
        await seedDatabase(page, { ...dump, clear: true, data: {} });
        await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {
            timeout: 25000,
        });

        // Reproduces the two opens from the PAGE (same origin, same database as
        // the SW). The versionless one must succeed; the one pinned at 2 must
        // still fail — without that witness, the green would not be
        // distinguishable from a browser with no database.
        const opens = await page.evaluate(async () => {
            const tryOpen = (version) =>
                new Promise((resolve) => {
                    const req =
                        version === undefined
                            ? indexedDB.open("geoleaf-db")
                            : indexedDB.open("geoleaf-db", version);
                    req.onsuccess = () => {
                        const db = req.result;
                        resolve({
                            ok: true,
                            version: db.version,
                            hasLayers: db.objectStoreNames.contains("layers"),
                        });
                        db.close();
                    };
                    req.onerror = () => resolve({ ok: false, err: String(req.error?.name) });
                    req.onblocked = () => resolve({ ok: false, err: "BLOCKED" });
                });
            return { versionless: await tryOpen(undefined), pinnedAt2: await tryOpen(2) };
        });

        // ⚠️ NO version literal here, and that is the test's very subject. What
        // is verified is that the versionless open FOLLOWS the engine, whatever
        // its number — precisely what the fix buys. Writing `version: 3` made
        // this test redden at the v4 move while NOTHING had broken: the literal
        // was the only desynchronised thing, in the test documenting the
        // desynchronisation.
        expect(opens.versionless).toMatchObject({ ok: true, hasLayers: true });
        expect(opens.versionless.version).toBeGreaterThanOrEqual(3);
        // The historical witness: a version PINNED below still fails.
        expect(opens.pinnedAt2).toMatchObject({ ok: false, err: "VersionError" });
    });

    test("openBlankOnOrigin ne boote PAS l'application", async ({ page }) => {
        // Guard of the harness itself: if this document booted the app, seeding
        // would stop being "before the boot" and criterion 2 would lose its
        // subject, in silence.
        await openBlankOnOrigin(page, ORIGIN);
        const state = await page.evaluate(() => ({
            hasGeoLeaf: typeof (/** @type {any} */ (window).GeoLeaf) !== "undefined",
            hasMapEl: !!document.getElementById("geoleaf-map"),
            origin: location.origin,
        }));
        expect(state.hasGeoLeaf).toBe(false);
        expect(state.hasMapEl).toBe(false);
        expect(state.origin).toBe(ORIGIN);
    });
});
