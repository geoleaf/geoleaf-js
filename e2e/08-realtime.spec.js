// @ts-check
// E2E realtime activation + CDN fallback — `realtime-layer` plugin validation:
// bundled GTFS-RT decoder + SSE source.

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

// ⚠️ MIGRATED on 2026-07-27. These tests targeted the demonstration profiles
// `world-disasters` (USGS + SSE) and `france-rail` (GTFS-RT), removed with the
// 6 demos.
//
//   • The 3 USGS / SSE tests are carried over to `tourism`: the
//     `epicentres_seismes` layer was migrated there (worldwide USGS feed,
//     polling + fallback snapshot). The carry-over is coherent — South America
//     is one of the most seismic zones, and `tourism` is the full test profile.
//   • The GTFS-RT tests are ACTIVE since 2026-08-19, on a fixture forged right
//     here: they re-declare in flight the realtime block of a layer of the
//     served bundle, serve a crafted protobuf in its place, and thus exercise
//     the BUNDLED decoder in a real browser. They were disabled for a month
//     for want of a target — the demonstration profile carrying them was
//     removed, and no SHIPPED profile carries a GTFS-RT feed. ⚠️ The refusal
//     to put one in a shipped profile still stands: any profile not
//     `_`-prefixed ships in the deployed variants, hence in production.
//     🛑 The third of those tests was NOT re-armed: its subject was the
//     removed profile's configuration file. Replacing it with the same
//     assertion on the fixture would attest only to the fixture. Full motive
//     where it used to live.

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

// ── Bundled-decode helpers (GTFS-RT scenarios) ───────────────────────────────

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

// ── What the GTFS-RT tests no longer use, and why it is REMOVED ──────────────────────
//
// A station set and a demonstration-profile router lived here, tailored to a
// removed profile. The tests that used them no longer do: the GTFS-RT fixture
// is forged above, against the bundle actually served. Keeping them "just in
// case" would have left dead harness whose only attestation was its own
// presence.

const EMPTY_FC = { type: "FeatureCollection", features: [] };

/**
 * Feature collection whose `stop_id`s match the crafted GTFS-RT feed.
 *
 * A GTFS-RT feed patches PROPERTIES on features the layer already holds — it never carries
 * geometry. Without a base layer whose ids line up, a perfectly decoded feed applies zero
 * update and the test would pass for the wrong reason.
 */
const GTFS_BASE_FC = {
    type: "FeatureCollection",
    features: [
        {
            type: "Feature",
            properties: { stop_id: "87391003", label: "Arrêt A" },
            geometry: { type: "Point", coordinates: [-64.19, -31.42] },
        },
        {
            type: "Feature",
            properties: { stop_id: "87391102", label: "Arrêt B" },
            geometry: { type: "Point", coordinates: [-64.18, -31.41] },
        },
    ],
};

/**
 * Boots a DELIVERED profile whose realtime layer is re-declared, in flight, as a GTFS-RT feed.
 *
 * ## Why the fixture is forged here and not put in a profile
 *
 * These tests exist to keep the protobuf decode path covered in a real browser. They used to
 * ride on a demonstration profile that was removed, and their designated replacement never
 * carried a real-time feed — so "reactivate them" had no target, whatever the profile.
 *
 * 🛑 **Putting a transport feed in a delivered profile was the wrong fix, and it was refused for
 * a good reason**: every profile under `profiles/` that is not `_`-prefixed ships in the
 * deployed variants, so the fixture would travel to production with no business meaning. Forging
 * it in the test keeps the coverage and ships nothing.
 *
 * ⚠️ **The patch is applied to the SERVED bundle, not to a copy of it.** The test fetches the
 * real `profile-bundle.json`, rewrites one layer's realtime block, and serves the result. A
 * hand-written bundle would be a second source of truth: it would keep passing after the real
 * one changed shape, which is the tautology these very tests are meant to avoid.
 *
 * @param page - Playwright page.
 * @param opts.fallbackBody - Bytes served as the profile-relative `.pb`; `null` serves an empty
 *                            (header-only) feed, which must decode cleanly and apply nothing.
 * @param opts.fallbackStatus - HTTP status for the `.pb`, to exercise the failure path.
 */
async function routeGtfsFixture(page, { fallbackBody = null, fallbackStatus = 200 } = {}) {
    const LAYER = "epicentres_seismes";
    const PB = `layers/${LAYER}/data/fixture_gtfsrt.pb`;

    await page.route(
        (u) => u.href.includes("/profiles/tourism/profile-bundle.json"),
        async (route) => {
            const res = await route.fetch();
            const bundle = await res.json();
            const cfg = bundle.layerConfigs?.[LAYER];
            if (!cfg) {
                // Refuse to serve a bundle we did not manage to patch: a silently unpatched
                // fixture would run the JSON decoder and the test would prove nothing.
                throw new Error(`fixture GTFS-RT : couche « ${LAYER} » absente du bundle servi`);
            }
            cfg.data.realtime = {
                enabled: true,
                source: "polling",
                // Aborted below — the point of the scenario is the FALLBACK path.
                url: "https://gtfs-rt.fixture.invalid/feed.pb",
                intervalMs: 2000,
                decoder: "gtfs-rt",
                updateMode: "upsert",
                idField: "stop_id",
                mapping: { idField: "stop_id" },
                fallbackUrl: PB,
            };
            cfg.data.file = "fixture_gtfsrt.geojson";
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(bundle),
            });
        }
    );

    await page.route(
        (u) => u.href.includes("gtfs-rt.fixture.invalid"),
        (r) => r.abort("failed")
    );

    await page.route(
        (u) => u.href.includes("fixture_gtfsrt.geojson"),
        (r) =>
            r.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(GTFS_BASE_FC),
            })
    );

    await page.route(
        (u) => u.href.includes("fixture_gtfsrt.pb"),
        (r) =>
            r.fulfill({
                status: fallbackStatus,
                contentType: "application/octet-stream",
                body: fallbackBody ?? craftGtfsFeed([]),
            })
    );

    await page.route(
        (u) => /data\.geopf\.fr|basemaps\.cartocdn\.com|server\.arcgisonline\.com/.test(u.href),
        (r) => r.abort("failed")
    );
}

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
        // ⚠️ Rewired on 2026-07-28. The old rig exploited the fact that
        // `epicentres_seismes` used the SAME USGS url for its `dataUrl` and for
        // the polling primary: it served the 1st hit and cut the next ones.
        // That coupling fell — boot now reads the LOCAL snapshot, USGS only
        // serves the live path. The test's invariant does not move: the layer
        // must start from 0 entities, otherwise `featureCount > 0` would be
        // true from boot on and would STOP DISCRIMINATING. The counter thus
        // moves onto the local path — 1st hit (layer load) = EMPTY
        // FeatureCollection, next hits (the PollingSource's fallback, aiming at
        // the same file) = real body — and USGS is now cut without a counter.
        //
        // ⚠️ The previous comment justified the counter by `shakemap_mmi`,
        // "this profile's second USGS-backed layer". That layer DOES NOT EXIST
        // in `tourism` — a `world-disasters` inheritance, never re-verified at
        // migration.
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
        // The layer started from 0 entities (1st response = empty
        // FeatureCollection): whatever it holds can only come from the fallback
        // snapshot served by the PollingSource.
        expect(featureCount).toBeGreaterThan(0);
    });

    // ── The test with no subject left, and why it is not "re-armed" ──────────────────
    //
    // A third test lived here: it read the configuration file of a layer of
    // the removed DEMONSTRATION profile, and checked it did announce a
    // realtime feed and its fallback. Its subject was a file, and that file no
    // longer exists.
    //
    // 🛑 It is NOT replaced by the same assertion on the fixture below, and the
    // refusal is the point: the fixture is written three functions up, in this
    // very file. A test affirming it conform would attest only to itself —
    // exactly the configuration this repo has already paid for, "green tests
    // attest to removed APIs because their oracle is their own fixture". What
    // it verified for real — that a layer schema ACCEPTS a GTFS-RT realtime
    // block — is verified against the schema, not in a browser.
    //
    // The TWO tests that follow do guard something no other level guards: real
    // protobuf decoding, in the real bundle, in a real browser.

    // Scope restricted TO THE TWO GTFS-RT TESTS, not the file: the other three
    // pass without this setting, and extending it to them would change their
    // environment without necessity. A global setting one can no longer
    // attribute is a setting one no longer dares remove.
    test.describe("GTFS-RT (fixture forgée, décodeur embarqué)", () => {
        test.use({ serviceWorkers: "block" });

        test("GTFS-RT: bundled decoder patches the layer from a real protobuf fallback", async ({
            page,
        }) => {
            const logs = captureConsole(page);
            await selectProfile(page, "tourism");
            // Crafted feed: stop 87391003 → +300 s (departure), stop 87391102 → −60 s (arrival).
            await routeGtfsFixture(page, {
                fallbackBody: craftGtfsFeed([
                    { stopId: "87391003", delay: 300, kind: "departure" },
                    { stopId: "87391102", delay: -60, kind: "arrival" },
                ]),
            });

            await page.goto("/");
            await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });

            // Fallback path runs (primary aborted) → the BUNDLED decoder produces updates.
            await expect
                .poll(() => logs.some((l) => l.includes("using fallback snapshot")), {
                    timeout: 15000,
                })
                .toBe(true);
            await expect
                .poll(
                    async () =>
                        page.evaluate(
                            () =>
                                globalThis.GeoLeaf?.RealtimeLayer?.getStatus?.("epicentres_seismes")
                                    ?.lastUpdateAt ?? null
                        ),
                    { timeout: 15000 }
                )
                .not.toBeNull();

            const status = await page.evaluate(() =>
                globalThis.GeoLeaf.RealtimeLayer.getStatus("epicentres_seismes")
            );
            expect(status.active).toBe(true);
            expect(status.source).toBe("polling");

            // The decode really happened: no swallowed interop fault behind the green.
            expect(logs.filter((l) => /\[gtfs-rt\] Failed to decode/i.test(l))).toHaveLength(0);
            expect(blockingErrors(logs)).toHaveLength(0);
        });

        test("GTFS-RT: a profile-relative .pb fallback resolves and decodes cleanly (header-only)", async ({
            page,
        }) => {
            // Regression guard, and it is the reason this test survived its profile: the polling
            // source resolves a profile-relative `fallbackUrl` against the ACTIVE PROFILE base
            // path, not page-relative — the latter 404'd. A header-only feed (0 entity) must be
            // fetched and decoded without error, and must apply NO update: that second half is
            // what distinguishes "decoded an empty feed" from "never decoded anything".
            const logs = captureConsole(page);
            await selectProfile(page, "tourism");
            await routeGtfsFixture(page, { fallbackBody: craftGtfsFeed([]) });

            await page.goto("/");
            await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });

            await expect
                .poll(() => logs.some((l) => l.includes("using fallback snapshot")), {
                    timeout: 15000,
                })
                .toBe(true);
            expect(
                logs.filter((l) => /\[realtime-layer\]\[polling\]\[fallback\].*HTTP 404/i.test(l))
            ).toHaveLength(0);

            const status = await page.evaluate(() =>
                globalThis.GeoLeaf.RealtimeLayer.getStatus("epicentres_seismes")
            );
            expect(status.active).toBe(true);
            expect(status.source).toBe("polling");
            expect(status.lastUpdateAt).toBeNull(); // header-only feed → 0 entity → no update applied
            expect(logs.filter((l) => /\[gtfs-rt\] Failed to decode/i.test(l))).toHaveLength(0);
            expect(blockingErrors(logs)).toHaveLength(0);
        });
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
