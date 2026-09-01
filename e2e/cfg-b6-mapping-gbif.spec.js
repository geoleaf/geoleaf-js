// @ts-check
// cfg-b6 — E2E: runtime mapping pipeline on the DEPLOYED bundle.
//
// ⚠️ Migrated on 2026-07-27: it targeted guyane-biodiversite, a removed
// demonstration profile. The `observations_gbif` layer and the `gbif` mapping
// block were migrated into `tourism`. Loads the tourism profile on
// deploy-core (`activeProfile` override via fetch monkeypatch — deploy-core
// has a PWA SW, hence serviceWorkers:'block' + no page.route).
//
// ⚠️ Rewired on 2026-07-28. This test used to MOCK `**/api.gbif.org/**` —
// which made it deterministic, but let the layer query the API for real at
// the boot of ALL the other scenarios, hence in the startup path of the 3
// shipped variants. The boot source is now a LOCAL profile file, shaped like
// a GBIF response; the mock and its `page.route` are removed. Direct
// consequence: the test now verifies the SHIPPED artifact and not a mock —
// the values asserted below are those of
// `profiles/tourism/layers/observations_gbif/data/observations_gbif.json`,
// and that coupling is intended (same posture as `16-flatgeobuf`).
//
// DISCRIMINATING test of the wiring: the data is `{ results: [...] }` (an
// object, not an array). WITHOUT the mapping pipeline,
// `DataConverter.autoConvert` cannot convert it → 0 features. WITH the
// pipeline (data.mapping="gbif" + data.itemsPath="results" →
// normalizePoiWithMapping → autoConvert), it becomes a FeatureCollection of
// Points. So we assert that a source carries the mapped feature
// (title="Jaguar", coords from decimalLat/Lng).
//
// The `cfg-` prefix marks the config-contract spec family.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

test.describe("cfg-b6 — pipeline mapping runtime (GBIF, bundle déployé)", () => {
    test('data.mapping="gbif" + itemsPath="results" → Points mappés sur la carte', async ({
        page,
    }) => {
        // page.route (not window.fetch) so the layer's Web Worker fetch is intercepted too.
        // VERIFIED empirically (2026-07-21, `page.on('request')` + a counter on
        // the handler): Playwright does intercept the fetch emitted FROM the
        // dedicated Web Worker `geojson-worker.js` — only *Service* Workers
        // escape page.route, hence the serviceWorkers:'block' (deploy-core
        // ships a PWA service worker).
        await page.route("**/geoleaf.config.json**", async (route) => {
            const res = await route.fetch();
            const cfg = await res.json();
            cfg.data = cfg.data || {};
            cfg.data.activeProfile = "tourism";
            await route.fulfill({ json: cfg });
        });
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

        // Wait until a native source carries the MAPPED feature — proof that the raw
        // GBIF `{results}` went through normalizePoiWithMapping → autoConvert in the
        // deployed bundle (id "111" coerced to string, coords from decimalLat/Lng).
        //
        // ⚠️ The signature is `waitForFunction(fn, arg, options)`. The 25 s
        // below used to be passed as 2nd argument: Playwright serialised them
        // as `arg` (ignored by the predicate) and the wait fell back to the
        // DEFAULT timeout — i.e. `actionTimeout`, worth 10 s at that date
        // (30 s since 2026-08-01; the current value lives in
        // `playwright.config.js`, not here).
        //
        // This test then timed out at 25 s for an ENTIRELY OTHER reason, and
        // it was a real production defect: the layer went through the GeoJSON
        // Web Worker, whose `_normalizeFeatures` keeps only `.features` / a
        // root array. GBIF's `{ results: [...] }` envelope was thus DESTROYED
        // before reaching the main thread, `applyDataMapping` found nothing at
        // `itemsPath="results"` any more, and the layer rendered 0 features —
        // the mapping pipeline was dead in the browser. Fixed in
        // `loader/single-layer.ts` (`data.mapping` ⇒ main-thread fetch). Since
        // then, the predicate passes in ~1.2 s: the 25 s are a CEILING (cold
        // SwiftShader software-WebGL boot), not an expected delay.
        const mapped = await page.waitForFunction(
            () => {
                const m = /** @type {any} */ (window).GeoLeaf;
                const native = m?.Core?.getMap?.()?.getNativeMap?.();
                if (!native || typeof native.getStyle !== "function") return null;
                const sources = native.getStyle()?.sources || {};
                for (const id of Object.keys(sources)) {
                    let data = sources[id] && sources[id].data;
                    if (!data || !Array.isArray(data.features)) {
                        try {
                            const ser = native.getSource(id)?.serialize?.();
                            data = ser && ser.data;
                        } catch {
                            data = null;
                        }
                    }
                    const feats = data && data.features;
                    if (Array.isArray(feats)) {
                        const jaguar = feats.find((f) => f?.properties?.title === "Jaguar");
                        if (jaguar) {
                            return {
                                sourceId: id,
                                count: feats.length,
                                id: jaguar.properties.id,
                                coords: jaguar.geometry?.coordinates,
                                species: jaguar.properties.species,
                            };
                        }
                    }
                }
                return null;
            },
            undefined,
            { timeout: 25000 }
        );

        const result = await mapped.jsonValue();
        expect(result.sourceId).toContain("observations_gbif");
        expect(result.count).toBe(2);
        expect(result.id).toBe("111"); // numeric GBIF key coerced to string
        expect(result.coords).toEqual([-57.45, -28.55]); // [lng, lat] from decimalLng/Lat
        expect(result.species).toBe("Panthera onca");
    });
});
