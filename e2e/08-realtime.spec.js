// @ts-check
// Sprint 2 roadmap catalogue-demos v1.0.0 — E2E realtime activation + fallback CDN
// S5 (validation plugin-realtime-layer) — bundled GTFS-RT decoder + SSE source.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// `gtfs-realtime-bindings` lives under the plugin (not hoisted to repo root); resolve
// it from there so the spec can craft real GTFS-RT protobuf payloads in-process.
// require.resolve's `paths` option has no ESM equivalent — createRequire is the tool, not a
// genuine-CJS-target exception.
const require = createRequire(import.meta.url);
const { transit_realtime } = require(
    require.resolve("gtfs-realtime-bindings", {
        paths: [path.join(__dirname, "../packages/plugins/realtime-layer")],
    })
);

test.use({ baseURL: baseURL("core") });

// ⚠️ MIGRÉ le 27/07/2026 (B-42). Ces tests visaient les profils de démonstration
// `world-disasters` (USGS + SSE) et `france-rail` (GTFS-RT), retirés avec les 6 démos.
//
//   • Les 3 tests USGS / SSE sont reportés sur `tourism` : la couche `epicentres_seismes`
//     y a été migrée (flux USGS mondial, polling + snapshot de repli). Le report est
//     cohérent — l'Amérique du Sud est l'une des zones les plus sismiques, et `tourism` est
//     le profil complet de test.
//   • Les 3 tests GTFS-RT sont DÉSACTIVÉS, pas supprimés — voir leur `test.skip` et B-55.

/**
 * Boot loads the active profile from `sessionStorage['gl-selected-profile']`.
 * Prime it before the first navigation so the target profile is used.
 */
async function selectProfile(page, profileId) {
    await page.addInitScript((id) => {
        try {
            sessionStorage.setItem("gl-selected-profile", id);
        } catch (e) {
            console.warn("[e2e] sessionStorage unavailable:", e);
        }
    }, profileId);
}

// ── S5 helpers (bundled-decode scenarios) ────────────────────────────────────

/** Encode a real GTFS-RT TripUpdate FeedMessage. `stops`: {stopId, delay, kind?}. */
function craftGtfsFeed(stops) {
    const entity = stops.map((s, i) => ({
        id: `e${i + 1}`,
        tripUpdate: {
            trip: { tripId: `T${i + 1}` },
            stopTimeUpdate: [{ stopId: s.stopId, [s.kind || "departure"]: { delay: s.delay } }],
        },
    }));
    const msg = transit_realtime.FeedMessage.fromObject({
        header: { gtfsRealtimeVersion: "2.0", incrementality: 0, timestamp: 0 },
        entity,
    });
    return Buffer.from(transit_realtime.FeedMessage.encode(msg).finish());
}

// Two gares whose `code_uic` match the crafted feed's `stop_id`s (merge by code_uic).
const GARES_FC = {
    type: "FeatureCollection",
    features: [
        {
            type: "Feature",
            properties: { code_uic: "87391003", libelle: "Gare A" },
            geometry: { type: "Point", coordinates: [2.35, 48.85] },
        },
        {
            type: "Feature",
            properties: { code_uic: "87391102", libelle: "Gare B" },
            geometry: { type: "Point", coordinates: [4.83, 45.75] },
        },
    ],
};
const EMPTY_FC = { type: "FeatureCollection", features: [] };

/** Capture console + page errors into a growing array. */
function captureConsole(page) {
    const logs = [];
    page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
    page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
    return logs;
}

/**
 * Errors that are artifacts of the headless harness, not plugin defects:
 *  - SW registration fails because `serviceWorkers: 'block'` is set;
 *  - basemap tiles/styles fail because their remote hosts are routed off.
 */
function blockingErrors(logs) {
    return logs
        .filter((l) => /^error:|^pageerror:/.test(l))
        .filter(
            (l) =>
                !/SWRegister|Service Worker|serviceworker/i.test(l) &&
                !/cartocdn|arcgisonline|data\.geopf\.fr|ERR_FAILED|Failed to load resource|AJAXError/i.test(
                    l
                )
        );
}

/**
 * Boot the france-rail profile deterministically offline:
 *  - GTFS-RT proxy primary aborted → forces the `.pb` fallback path;
 *  - gares geometry served locally so the layer registers (realtime boots from
 *    registered layers) with `code_uic`s that match the crafted feed;
 *  - lignes + basemap routed off to keep the run offline.
 * `serviceWorkers: 'block'` (set on the describe) is REQUIRED — deploy-core ships a
 * PWA Service Worker that otherwise serves these requests and bypasses page.route.
 */
async function routeFranceRail(page, fallbackBody) {
    await page.route(
        (u) => u.href.includes("proxy.transport.data.gouv.fr"),
        (r) => r.abort("failed")
    );
    await page.route(
        (u) => u.href.includes("liste-des-gares"),
        (r) =>
            r.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(GARES_FC),
            })
    );
    await page.route(
        (u) => u.href.includes("formes-des-lignes"),
        (r) =>
            r.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(EMPTY_FC),
            })
    );
    await page.route(
        (u) => /data\.geopf\.fr|basemaps\.cartocdn\.com|server\.arcgisonline\.com/.test(u.href),
        (r) => r.abort("failed")
    );
    if (fallbackBody) {
        await page.route(
            (u) => u.href.includes("gares_voyageurs_gtfsrt_snapshot.pb"),
            (r) =>
                r.fulfill({
                    status: 200,
                    contentType: "application/octet-stream",
                    body: fallbackBody,
                })
        );
    }
}

test.describe("08-realtime", () => {
    test("USGS epicentres_seismes is active after boot", async ({ page }) => {
        await selectProfile(page, "tourism");
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });

        // Allow polling boot + first fetch to complete
        await page.waitForTimeout(3500);

        const status = await page.evaluate(() => {
            const api = /** @type {any} */ (globalThis).GeoLeaf?.RealtimeLayer;
            return api?.getStatus?.("epicentres_seismes") ?? null;
        });
        expect(status).not.toBeNull();
        expect(status.active).toBe(true);
        expect(status.source).toBe("polling");
    });

    test("fallback snapshot is served when primary URL is blocked", async ({ page }) => {
        await selectProfile(page, "tourism");
        // Realtime boots from REGISTERED layers (`bootFromProfile` → `GeoJSON.getAllLayers()`),
        // so the layer's initial load MUST succeed or no realtime source is ever started
        // (`loader/profile.ts` catches and returns null → the layer never reaches
        // `state.layers`) and the scenario under test is not reproduced at all.
        //
        // ⚠️ Recâblé le 28/07/2026 (B-56). L'ancien montage exploitait le fait que
        // `epicentres_seismes` utilisait la MÊME url USGS pour son `dataUrl` et pour la
        // primaire du polling : il servait le 1er hit et coupait les suivants. Ce couplage est
        // tombé — le boot lit désormais le snapshot LOCAL, USGS ne sert plus que le direct.
        // L'invariant du test, lui, ne bouge pas : la couche doit partir de 0 entité, sinon
        // `featureCount > 0` serait vrai dès le boot et CESSERAIT DE DISCRIMINER. Le compteur
        // se déplace donc sur le chemin local — 1er hit (chargement de la couche) =
        // FeatureCollection VIDE, hits suivants (le repli du PollingSource, qui vise le même
        // fichier) = vrai corps — et USGS se coupe désormais sans compteur.
        //
        // ⚠️ Le commentaire précédent justifiait le compteur par `shakemap_mmi`, « seconde
        // couche adossée à USGS de ce profil ». Cette couche N'EXISTE PAS dans `tourism` —
        // c'était un héritage de `world-disasters`, jamais re-vérifié à la migration.
        await page.route("**earthquake.usgs.gov/**", (route) => route.abort("failed"));

        let snapshotHits = 0;
        await page.route(
            "**/epicentres_seismes/data/epicentres_seismes_snapshot.geojson",
            (route) => {
                snapshotHits += 1;
                return snapshotHits === 1
                    ? route.fulfill({
                          status: 200,
                          contentType: "application/json",
                          body: JSON.stringify(EMPTY_FC),
                      })
                    : route.continue();
            }
        );

        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });

        // Give the polling source time to hit the primary, fail, and fall back
        await page.waitForTimeout(4000);

        const featureCount = await page.evaluate(() => {
            const gj = /** @type {any} */ (globalThis).GeoLeaf?.GeoJSON;
            const data = gj?.getLayerData?.("epicentres_seismes");
            return data?.features?.length ?? 0;
        });
        // La couche est partie de 0 entité (1re réponse = FeatureCollection vide) : tout ce
        // qu'elle contient ne peut venir que du snapshot de repli servi par le PollingSource.
        expect(featureCount).toBeGreaterThan(0);
    });

    test("france-rail gares_voyageurs config advertises GTFS-RT realtime + fallback", async ({
        request,
    }) => {
        // ⚠️ DÉSACTIVÉ le 27/07/2026 — B-55, même motif que les deux tests GTFS-RT suivants :
        // il lit la config d'une couche du profil de démonstration `france-rail`, retiré. Voir
        // leur `test.skip` pour l'argument complet (couverture protobuf, refus de placer de la
        // donnée SNCF dans un profil sud-américain livré en production).
        test.skip(
            true,
            "B-55 — visait le profil de démonstration `france-rail`, retiré le 27/07/2026. Sa cible de recâblage `reunion-eclairage` est partie au Sprint 7 du passage public puis REVENUE le 10/08/2026 : le blocage a changé de nature sans changer d'effet, car elle ne porte aucun flux temps réel. Réactivé le jour où un profil LIVRÉ porte un flux GTFS-RT — `tourism/epicentres_seismes` est bien du temps réel, mais en GeoJSON natif, donc il n'exerce pas le décodage protobuf que ces 3 tests gardent"
        );

        // The france-rail profile loads several SNCF endpoints which may fail in
        // headless CI, so we validate the migrated JSON is correctly served
        // instead of relying on full profile boot.
        const resp = await request.get(
            "/profiles/france-rail/layers/gares_voyageurs/gares_voyageurs_config.json"
        );
        expect(resp.ok()).toBe(true);
        const cfg = await resp.json();
        const rt = cfg?.data?.realtime;
        expect(rt).toBeDefined();
        expect(rt.enabled).toBe(true);
        expect(rt.source).toBe("polling");
        expect(rt.decoder).toBe("gtfs-rt");
        expect(rt.intervalMs).toBe(120000);
        expect(typeof rt.fallbackUrl).toBe("string");
        expect(rt.fallbackUrl).toContain("gares_voyageurs_gtfsrt_snapshot.pb");
    });
});

/**
 * S5 — exercise the BUNDLED realtime-layer decoders/sources in a real browser.
 * Unit round-trip tests cover the `.ts` source; these prove the Rollup bundle
 * (CommonJS interop of `gtfs-realtime-bindings`, EventSource wiring) works too.
 * `serviceWorkers: 'block'` lets page.route intercept the plugin's own fetch.
 */
test.describe("08-realtime — bundled decode (S5)", () => {
    test.use({ serviceWorkers: "block" });

    test("GTFS-RT: bundled decoder patches the layer from a real protobuf fallback", async ({
        page,
    }) => {
        // ⚠️ DÉSACTIVÉ le 27/07/2026 — B-55. Ce test visait le profil de démonstration
        // `france-rail`, retiré avec les 5 autres. Il n'est PAS supprimé : les 3 tests GTFS-RT
        // portent la seule vérification navigateur du chemin **protobuf** de
        // `realtime-layer`. Les supprimer perdrait cette couverture sans trace.
        //
        // Pourquoi pas migré sur `tourism` comme ses voisins USGS : la donnée est un snapshot
        // GTFS-RT de gares SNCF. Elle est récupérable depuis `HEAD`, mais la placer dans un
        // profil sud-américain n'aurait aucun sens métier — et `tourism` est le profil livré,
        // donc cette donnée partirait en production.
        //
        // 🛑 Le geste prévu (B-55) visait un recâblage sur de la donnée propre d'un second
        // profil métier — `reunion-eclairage`. Il est parti au Sprint 7 du passage public, puis
        // REVENU le 10/08/2026 : la cible existe donc de nouveau, mais elle ne porte aucun flux
        // temps réel, et B-55 reste sans objet pour une autre raison qu'à son ouverture. Ne pas
        // relire ce saut comme périmé au seul motif que le profil est de retour.
        // 📌 Le seul flux temps réel LIVRÉ est `tourism/epicentres_seismes` — polling USGS en
        // GeoJSON natif, donc il n'exerce pas le décodage protobuf que ces tests gardent.
        //
        // ⚠️ Un test ignoré ne garde rien : tant que B-55 n'est pas soldée, le décodage
        // protobuf n'a AUCUNE couverture navigateur. C'est une dette visible, pas une réparation.
        test.skip(
            true,
            "B-55 — visait le profil de démonstration `france-rail`, retiré le 27/07/2026. Sa cible de recâblage `reunion-eclairage` est partie au Sprint 7 du passage public puis REVENUE le 10/08/2026 : le blocage a changé de nature sans changer d'effet, car elle ne porte aucun flux temps réel. Réactivé le jour où un profil LIVRÉ porte un flux GTFS-RT — `tourism/epicentres_seismes` est bien du temps réel, mais en GeoJSON natif, donc il n'exerce pas le décodage protobuf que ces 3 tests gardent"
        );

        const logs = captureConsole(page);
        await selectProfile(page, "france-rail");
        // Crafted feed: stop 87391003 → +300 s (departure), stop 87391102 → −60 s (arrival).
        await routeFranceRail(
            page,
            craftGtfsFeed([
                { stopId: "87391003", delay: 300, kind: "departure" },
                { stopId: "87391102", delay: -60, kind: "arrival" },
            ])
        );

        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });

        // Fallback path runs (primary aborted) → bundled decoder produces updates.
        await expect
            .poll(() => logs.some((l) => l.includes("using fallback snapshot")), { timeout: 12000 })
            .toBe(true);
        await expect
            .poll(
                async () =>
                    page.evaluate(
                        () =>
                            globalThis.GeoLeaf?.RealtimeLayer?.getStatus?.("gares_voyageurs")
                                ?.lastUpdateAt ?? null
                    ),
                { timeout: 12000 }
            )
            .not.toBeNull();

        const status = await page.evaluate(() =>
            globalThis.GeoLeaf.RealtimeLayer.getStatus("gares_voyageurs")
        );
        expect(status.active).toBe(true);
        expect(status.source).toBe("polling");

        // The decoded delays are merged onto the matching gares (full decode chain).
        const byUic = await page.evaluate(() => {
            const d = globalThis.GeoLeaf.GeoJSON.getLayerData("gares_voyageurs");
            const out = {};
            for (const f of d?.features ?? [])
                out[String(f.properties?.code_uic)] = {
                    delay: f.properties?.delay,
                    rt: !!f.properties?._realtimeUpdatedAt,
                };
            return out;
        });
        expect(byUic["87391003"]).toMatchObject({ delay: 300, rt: true });
        expect(byUic["87391102"]).toMatchObject({ delay: -60, rt: true });

        // The bundled decoder parsed real protobuf — no swallowed interop error.
        expect(logs.filter((l) => /\[gtfs-rt\] Failed to decode/i.test(l))).toHaveLength(0);
        expect(blockingErrors(logs)).toHaveLength(0);
    });

    test("GTFS-RT: the deployed .pb snapshot is reachable and decodes cleanly (header-only)", async ({
        page,
    }) => {
        // ⚠️ DÉSACTIVÉ le 27/07/2026 — B-55. Ce test visait le profil de démonstration
        // `france-rail`, retiré avec les 5 autres. Il n'est PAS supprimé : les 3 tests GTFS-RT
        // portent la seule vérification navigateur du chemin **protobuf** de
        // `realtime-layer`. Les supprimer perdrait cette couverture sans trace.
        //
        // Pourquoi pas migré sur `tourism` comme ses voisins USGS : la donnée est un snapshot
        // GTFS-RT de gares SNCF. Elle est récupérable depuis `HEAD`, mais la placer dans un
        // profil sud-américain n'aurait aucun sens métier — et `tourism` est le profil livré,
        // donc cette donnée partirait en production.
        //
        // 🛑 Le geste prévu (B-55) visait un recâblage sur de la donnée propre d'un second
        // profil métier — `reunion-eclairage`. Il est parti au Sprint 7 du passage public, puis
        // REVENU le 10/08/2026 : la cible existe donc de nouveau, mais elle ne porte aucun flux
        // temps réel, et B-55 reste sans objet pour une autre raison qu'à son ouverture. Ne pas
        // relire ce saut comme périmé au seul motif que le profil est de retour.
        // 📌 Le seul flux temps réel LIVRÉ est `tourism/epicentres_seismes` — polling USGS en
        // GeoJSON natif, donc il n'exerce pas le décodage protobuf que ces tests gardent.
        //
        // ⚠️ Un test ignoré ne garde rien : tant que B-55 n'est pas soldée, le décodage
        // protobuf n'a AUCUNE couverture navigateur. C'est une dette visible, pas une réparation.
        test.skip(
            true,
            "B-55 — visait le profil de démonstration `france-rail`, retiré le 27/07/2026. Sa cible de recâblage `reunion-eclairage` est partie au Sprint 7 du passage public puis REVENUE le 10/08/2026 : le blocage a changé de nature sans changer d'effet, car elle ne porte aucun flux temps réel. Réactivé le jour où un profil LIVRÉ porte un flux GTFS-RT — `tourism/epicentres_seismes` est bien du temps réel, mais en GeoJSON natif, donc il n'exerce pas le décodage protobuf que ces 3 tests gardent"
        );

        // Regression guard for the S5 fix: PollingSource now resolves the profile-relative
        // `fallbackUrl` ("data/...pb") against the active profile base path
        // (/profiles/france-rail/data/...) instead of fetching it page-relative (which
        // 404'd). The REAL deployed snapshot is a valid header-only FeedMessage (0 entity),
        // so it must be fetched and decoded without error — and apply no update.
        const logs = captureConsole(page);
        await selectProfile(page, "france-rail");
        await routeFranceRail(page, null); // real deployed snapshot (not intercepted)

        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });

        // The fallback now resolves to the shipped file and is served (not 404).
        await expect
            .poll(() => logs.some((l) => l.includes("using fallback snapshot")), { timeout: 12000 })
            .toBe(true);
        expect(
            logs.filter((l) => /\[realtime-layer\]\[polling\]\[fallback\].*HTTP 404/i.test(l))
        ).toHaveLength(0);

        const status = await page.evaluate(() =>
            globalThis.GeoLeaf.RealtimeLayer.getStatus("gares_voyageurs")
        );
        expect(status.active).toBe(true);
        expect(status.source).toBe("polling");
        expect(status.lastUpdateAt).toBeNull(); // header-only feed → 0 entity → no update applied
        // The shipped artifact decoded in the bundle without a swallowed interop fault.
        expect(logs.filter((l) => /\[gtfs-rt\] Failed to decode/i.test(l))).toHaveLength(0);
        expect(blockingErrors(logs)).toHaveLength(0);
    });

    test("SSE: bundled EventSource source applies a decoded FeatureCollection", async ({
        page,
    }) => {
        const logs = captureConsole(page);

        // Deterministic SSE: a fake EventSource emits one message; no real stream.
        await page.addInitScript(() => {
            /** @type {any} */ (window).__SSE_PAYLOAD__ = {
                type: "FeatureCollection",
                features: [
                    {
                        type: "Feature",
                        properties: { id: "sse-1", name: "SSE Point" },
                        geometry: { type: "Point", coordinates: [1, 1] },
                    },
                ],
            };
            class FakeEventSource {
                constructor(url) {
                    this.url = url;
                    this.onmessage = null;
                    this.onerror = null;
                    this.readyState = 1;
                    setTimeout(() => {
                        if (this.onmessage)
                            this.onmessage({
                                data: JSON.stringify(/** @type {any} */ (window).__SSE_PAYLOAD__),
                            });
                    }, 80);
                }
                close() {}
                addEventListener() {}
                removeEventListener() {}
            }
            /** @type {any} */ (window).EventSource = FakeEventSource;
        });
        await selectProfile(page, "tourism");

        // Inject an SSE realtime block onto epicentres_seismes via the profile bundle.
        await page.route("**/tourism/profile-bundle.json", async (route) => {
            const resp = await route.fetch();
            const bundle = await resp.json();
            bundle.layerConfigs.epicentres_seismes.data.realtime = {
                enabled: true,
                source: "sse",
                decoder: "json",
                url: "http://sse.test/stream",
                updateMode: "replace",
                idField: "id",
            };
            await route.fulfill({ response: resp, json: bundle });
        });
        await page.route(
            (u) => u.href.includes("earthquake.usgs.gov"),
            (r) =>
                r.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify(EMPTY_FC),
                })
        );
        await page.route(
            (u) => /data\.geopf\.fr|basemaps\.cartocdn\.com|server\.arcgisonline\.com/.test(u.href),
            (r) => r.abort("failed")
        );

        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });

        await expect
            .poll(
                async () =>
                    page.evaluate(
                        () =>
                            globalThis.GeoLeaf?.RealtimeLayer?.getStatus?.("epicentres_seismes")
                                ?.source ?? null
                    ),
                { timeout: 12000 }
            )
            .toBe("sse");
        await expect
            .poll(
                async () =>
                    page.evaluate(
                        () =>
                            globalThis.GeoLeaf?.GeoJSON?.getLayerData?.("epicentres_seismes")
                                ?.features?.length ?? 0
                    ),
                { timeout: 12000 }
            )
            .toBeGreaterThan(0);

        const row = await page.evaluate(() => {
            const f = globalThis.GeoLeaf.GeoJSON.getLayerData("epicentres_seismes").features[0];
            return { id: f.properties?._realtimeId ?? f.properties?.id, name: f.properties?.name };
        });
        expect(row).toMatchObject({ id: "sse-1", name: "SSE Point" });
        expect(blockingErrors(logs)).toHaveLength(0);
    });
});
