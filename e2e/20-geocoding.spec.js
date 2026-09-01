// @ts-check
// E2E geocoding (@geoleaf-plugins/geocoding) on deploy-coverage (port 8769).
//
// End-to-end guard for the core → plugin geocoding extraction: proves that,
// once the plugin's <script> tag is injected into the deploy variants, the
// address-search pill really mounts in a deployed profile and that the
// search → results → selection → recentre + event chain holds in a browser.
//
// Target: deploy-coverage — a copy of deploy-core (active profile `tourism`,
// `modules.geocoding.enabled: true`, nominatim provider). Port 8769 is started
// by playwright.config.js's webServer; `npm run build:deploy-coverage` must
// have populated `deploy/deploy-coverage` beforehand (after
// `build:deploy:all`).
//
// Mock mechanism (cf. cfg-c2): a `window.fetch` monkeypatch set in
// addInitScript — it short-circuits the geocoding providers' hosts and
// returns a canned "Rosario" GeoCodeJSON FeatureCollection WITHOUT touching
// the network (deterministic + independent of the `connect-src` CSP). All
// providers (addok/nominatim/photon) parse this format. The canned locality
// must stay INSIDE the profile's bounds (`positionFixed` → MapLibre
// maxBounds) or the recentre is clamped — see ROSARIO_GEOJSON's comment.
//
// The "disabled ⇒ no pill" gate is handled by the plugin-side registry
// (`_onMapReady` returns early if `!config.enabled`) and covered at the unit
// tier; here the nominal path is validated on a profile that enables
// geocoding.
//
// `serviceWorkers: 'block'`: keeps the PWA SW from mediating (and thus
// escaping) the fetch monkeypatch — same precaution as the plugin specs on
// PWA variants.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { registerCoverageCollection } from "./helpers/coverage.js";
import { bootMapUntilIdle } from "./helpers/boot.js";

test.use({ baseURL: baseURL("coverage"), serviceWorkers: "block" });

// This spec already TARGETED the instrumented variant without ever yielding
// its coverage: the bundle was measured, the data thrown away at page close.
// The wiring below pours it in. ⚠️ It only has value since the istanbul
// `include` covers `src/capabilities/**`: before that, the code exercised
// here was OUTSIDE the denominator, and three more dumps would have moved
// nothing.
registerCoverageCollection(test, "geocoding");

// Built-in providers' hosts (provider.ts) — intercepted whatever the active
// profile's provider, so the spec stays green if the profile switches to
// addok/photon.
const PROVIDER_HOSTS = [
    "nominatim.openstreetmap.org",
    "api-adresse.data.gouv.fr",
    "photon.komoot.io",
];

// Canned response in GeoCodeJSON FeatureCollection format (parsed by
// _parseGeoJSON). bbox present ⇒ selection takes the fitBounds path
// (recentring on the city).
//
// ⚠️ The locality MUST fall inside the active profile's bounds. `tourism`
// declares `map.positionFixed: true` + `map.bounds`
// [[-55,-73.5],[-21.78,-53.5]] (Argentina); `core-map.module.ts` turns it
// into a MapLibre `maxBounds` (padBounds, boundsMargin 0.7 ⇒ lat ≤ 1.47,
// lng ∈ [-87.5,-39.5]). A fitBounds outside that box is CLAMPED by MapLibre:
// the map does not move, whatever the geocoder. Rosario (the profile's city,
// cf. the `sites_rosario` layer) is in bounds — which is what makes the
// recentre assertion verifiable. Consistent with the profile's
// `modules.geocoding.countrycodes: "ar"`, and with 19-permalink which uses
// only in-bounds coordinates.
const ROSARIO_GEOJSON = {
    type: "FeatureCollection",
    features: [
        {
            type: "Feature",
            geometry: { type: "Point", coordinates: [-60.63932, -32.94682] },
            properties: { geocoding: { label: "Rosario, Santa Fe, Argentine" } },
            bbox: [-60.7503, -33.0201, -60.5503, -32.8501],
        },
    ],
};

/**
 * Sets the geocoding harness BEFORE any page script:
 *  - records `geoleaf:geocoding:result` events in `window.__geocodingEvents`,
 *  - monkeypatches `window.fetch` to return `geojson` on the provider hosts.
 * Arguments passed explicitly (not via closure: addInitScript serialises the
 * function).
 */
async function installGeocodingHarness(page, geojson, hosts) {
    await page.addInitScript(
        ({ geojson, hosts }) => {
            /** @type {any[]} */
            (window).__geocodingEvents = [];
            document.addEventListener("geoleaf:geocoding:result", (e) => {
                /** @type {any[]} */ (window).__geocodingEvents.push(/** @type {any} */ (e).detail);
            });
            const origFetch = window.fetch.bind(window);
            window.fetch = async (input, init) => {
                const url = typeof input === "string" ? input : (input && input.url) || "";
                if (url && hosts.some((h) => url.includes(h))) {
                    return new Response(JSON.stringify(geojson), {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                    });
                }
                return origFetch(input, init);
            };
        },
        { geojson, hosts }
    );
}

test.describe("20-geocoding — pill + recherche + événement (deploy-coverage, tourism)", () => {
    test("le plugin se charge et le pill se monte (modules.geocoding.enabled)", async ({
        page,
    }) => {
        await installGeocodingHarness(page, ROSARIO_GEOJSON, PROVIDER_HOSTS);
        await bootMapUntilIdle(page);

        // The plugin bundle is injected and the facade mounted on the namespace.
        const enabled = await page.evaluate(
            () => /** @type {any} */ (window).GeoLeaf?.Geocoding?.isEnabled?.() === true
        );
        expect(enabled).toBe(true);

        // Desktop (viewport 1280px > breakpoint 768px): the pill is visible by default.
        const input = page.locator('.gl-geocoding-ctrl input[role="combobox"]');
        await expect(input).toBeVisible({ timeout: 10000 });
    });

    test("recherche → résultats → sélection émet geoleaf:geocoding:result + recentre", async ({
        page,
    }) => {
        await installGeocodingHarness(page, ROSARIO_GEOJSON, PROVIDER_HOSTS);
        await bootMapUntilIdle(page);

        const input = page.locator('.gl-geocoding-ctrl input[role="combobox"]');
        await expect(input).toBeVisible({ timeout: 10000 });

        // Input ≥ minChars (3) ⇒ debounced search ⇒ mocked provider ⇒ dropdown.
        await input.fill("Rosario");
        const items = page.locator(".gl-geocoding-result-item");
        await expect(items.first()).toBeVisible({ timeout: 10000 });
        await expect(items.first()).toContainText("Rosario");

        // Select the 1st result.
        await items.first().click();

        // 1) The public event is emitted with the selected locality.
        await page.waitForFunction(
            () => /** @type {any} */ (window.__geocodingEvents || []).length > 0,
            null,
            { timeout: 10000 }
        );
        const ev = await page.evaluate(() => /** @type {any} */ (window).__geocodingEvents[0]);
        expect(String(ev.label)).toContain("Rosario");
        expect(ev.lat).toBeGreaterThan(-33.5);
        expect(ev.lat).toBeLessThan(-32.5);
        expect(ev.lng).toBeGreaterThan(-61);
        expect(ev.lng).toBeLessThan(-60);

        // 2) The map recentres near Rosario (fitBounds on the result's bbox).
        //    3rd argument = options: `waitForFunction(fn, arg, options)` —
        //    passing the timeout 2nd makes it a silently ignored `arg`.
        await page.waitForFunction(
            () => {
                const c = /** @type {any} */ (window).GeoLeaf?.Core?.getMap?.()
                    ?.getNativeMap?.()
                    ?.getCenter?.();
                return !!c && Math.abs(c.lat - -32.935) < 0.6 && Math.abs(c.lng - -60.65) < 0.6;
            },
            null,
            // ⚠️ Measured: this test lasts **14,109 ms** in total on a 24-core
            // machine. A 10 s budget for a single one of its waits had no
            // margin on a runner ~5× slower. The wait bears on the right
            // predicate (the map's native centre after `fitBounds`): nothing
            // to synchronise better, only a budget to recalibrate. Generous
            // costs the passing case nothing.
            { timeout: 30000 }
        );
    });
});
