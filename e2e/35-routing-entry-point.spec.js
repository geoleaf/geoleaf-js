// @ts-check
// E2E — `@geoleaf-plugins/routing`'s entry point from a POI, IN BOTH DIRECTIONS.
//
// 🛑 **The second direction is the only one that proves anything.** A test
// verifying the button is there when the plugin is loaded says nothing of the
// guard: an unconditionally rendered button would pass it too. What
// `requiresPlugin` promises is the ABSENCE — and a promise of absence can only
// be verified by removing what it depends on.
//
// The removal is done by **preventing the bundle from loading**, not by
// disabling the module in the profile: the widget's guard evaluates on
// `GeoLeaf.plugins.isLoaded()`, never on the configuration. A profile with
// `modules.routing.enabled: false` would leave the plugin loaded, hence the
// button rendered — and the test would have measured something other than what
// it announces.
//
// The button itself is set neither by the core nor by the plugin: it is
// declared in the PROFILE, on the `tourism` profile's
// `aires_protegees_nationales_sib` layer, as a feature-info `action` widget.
// The core renders it on both surfaces from a shared dispatch table.
//
// ⚠️ This layer and not `hebergements`, which would be semantically more
// natural: measured, `hebergements` is NOT registered by the served profile, so
// its popup never opens. A declaration placed there would be valid, gated
// green, and unreachable — including for a user.
//
// Target: deploy-coverage (port 8769) — the instrumented variant, like
// `22-feature-info`.
import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { bootMapUntilLoaded } from "./helpers/boot.js";

test.use({ baseURL: baseURL("coverage"), serviceWorkers: "block" });

/** The `tourism` profile's layer declaring the `action` widget. */
const LAYER = "aires_protegees_nationales_sib";

/** The `actionId` the profile declares and the plugin filters on. Both must coincide. */
const ACTION_ID = "routing.destination";

/** The simulated POI — a name, so the destination carries one. */
const POI = {
    layerId: LAYER,
    featureId: "ap-1",
    properties: { Name: "Parc national des Écrins" },
    geometry: null,
    lngLat: { lat: -21.0964, lng: 55.4781 },
    point: { x: 300, y: 300 },
};

/**
 * Loads the page and waits for the core to be ready.
 *
 * @param {import('@playwright/test').Page} page The page.
 */

/**
 * Emits the click seam UNTIL `selector` appears.
 *
 * ⚠️ Taken verbatim from `22-feature-info.spec.js`, and the difference with a
 * Node-side loop is not cosmetic: the dispatch and the check live in the SAME
 * page tick. The feature-info surfaces are created lazily at the first event,
 * and a dispatch sent before the capability is wired is **silently lost** — the
 * failure then reads "element not found", not "hidden", and looks like a wrong
 * layer identifier.
 *
 * @param {import('@playwright/test').Page} page The page.
 * @param {string} selector What is awaited.
 */
async function clickPoiUntil(page, selector) {
    await page.waitForFunction(
        (arg) => {
            document.dispatchEvent(
                new CustomEvent("geoleaf:feature:click", { detail: arg.detail })
            );
            return !!document.querySelector(arg.selector);
        },
        { detail: POI, selector },
        { timeout: 15000, polling: 250 }
    );
}

test.describe("① le plugin est chargé — le bouton EXISTE et ouvre l'itinéraire", () => {
    test("le plugin s'est enregistré au boot, en EAGER", async ({ page }) => {
        // Its `<script type="module">` tag is in index.html, not a
        // `registerLazy`: a lazy `routing` would mask its own entry point, this
        // guard evaluating on `isLoaded()` alone.
        await bootMapUntilLoaded(page);
        const loaded = await page.evaluate(() =>
            /** @type {any} */ (window).GeoLeaf?.plugins?.isLoaded?.("routing")
        );
        expect(loaded).toBe(true);
    });

    test("le bouton est rendu dans la popup, avec l'actionId du profil", async ({ page }) => {
        await bootMapUntilLoaded(page);
        await clickPoiUntil(page, ".gl-fi-popup-ml");
        const btn = page.locator(`.gl-poi-popup__action[data-gl-action-id="${ACTION_ID}"]`);
        await expect(btn).toBeVisible({ timeout: 3000 });
    });

    test("le clic ouvre le panneau avec le POI en DESTINATION", async ({ page }) => {
        await bootMapUntilLoaded(page);
        await clickPoiUntil(page, ".gl-fi-popup-ml");
        await page.locator(`.gl-poi-popup__action[data-gl-action-id="${ACTION_ID}"]`).click();

        const panel = page.locator(".gl-routing-panel");
        await expect(panel).toBeVisible({ timeout: 3000 });

        // 🛑 `toBeVisible()` IS NOT ENOUGH, and this file proved it the hard way. Playwright
        // calls an element visible when it has a non-empty bounding box — being INSIDE the
        // viewport is not part of the definition. From the day this spec was written until
        // 26/08/2026 the panel rendered at the end of `<body>` with no layout rules at all,
        // below a `.gl-page` that is `100vh` tall: entirely off screen, entirely unreachable,
        // and green here on every run. The user saw a dead button; the suite saw a pass.
        // ⚠️ `toBeInViewport` and not a hand-rolled `boundingBox()` comparison. The first
        // version of this check did the arithmetic itself and was FLAKY for a reason that says
        // nothing about the feature: below 1440px the host is the mobile sheet, which slides up
        // over ~0.2s, so a single instantaneous box lands at y=730 in a 720-tall viewport once
        // in a few runs. This matcher retries until the animation settles — and still fails on
        // a panel parked off screen, which is the defect it exists to catch.
        await expect(panel).toBeInViewport();

        // And it is DOCKED, not floating: the kernel adopts it into a host. A panel that
        // rendered correctly but outside any host would mean the registry silently did nothing
        // — and, since the panel hides itself by default, it would not render at all.
        //
        // ⚠️ BOTH hosts are accepted on purpose. This suite runs at 1280×720 (see
        // `playwright.config.js`), which is BELOW the 1440px breakpoint of the desktop side
        // panel — so the surface that actually adopts it here is the mobile sheet. Asserting
        // `#gl-rp-pane-routing` alone would have been red for a reason that says nothing about
        // the feature, and pinning the sheet alone would stop measuring anything the day the
        // viewport widens.
        await expect(
            page.locator(
                "#gl-rp-pane-routing .gl-routing-panel, .gl-sheet-panel__body .gl-routing-panel"
            )
        ).toHaveCount(1);

        // The POI is the DESTINATION and not a stop: the operator starts from a
        // POI they are looking at and wants to go there. A single stop, so
        // `roleAt` names it both start and end — what counts here is that its
        // NAME arrived, i.e. that `payloadFields` joined the property. Without
        // it, the row would display coordinates.
        await expect(panel.locator(".gl-routing-steps__name")).toContainText(
            "Parc national des Écrins"
        );
    });

    test("la popup se ferme quand le panneau s'ouvre", async ({ page }) => {
        // The panel takes focus; leaving the popup open under it would hand
        // focus back to a surface the user no longer sees.
        await bootMapUntilLoaded(page);
        await clickPoiUntil(page, ".gl-fi-popup-ml");
        await page.locator(`.gl-poi-popup__action[data-gl-action-id="${ACTION_ID}"]`).click();
        await expect(page.locator(".gl-routing-panel")).toBeVisible({ timeout: 3000 });
        await expect(page.locator(".gl-fi-popup-ml")).toHaveCount(0);
    });
});

test.describe("② le plugin est ABSENT — aucun bouton, nulle part", () => {
    test.beforeEach(async ({ page }) => {
        // 🛑 The bundle is intercepted and aborted. The module never evaluates,
        // so `plugins.register("routing")` is never called, so
        // `isLoaded("routing")` returns `false` — exactly the state of an
        // integrator who did not install the plugin.
        // ⚠️ The glob MUST tolerate the query string. The bundle is requested
        // with a cache parameter — `dist/geoleaf-routing.plugin.js?v=ba83a913` —
        // and a pattern stopping at `.js` does not match. The interception then
        // never fired, the plugin loaded, and the second direction's three
        // tests failed giving the impression the GUARD was broken: the witness
        // below is what allowed telling "the guard does not work" from "the
        // manipulation did not happen".
        await page.route("**/geoleaf-routing.plugin.js*", (route) => route.abort());
    });

    test("le plugin n'est PAS chargé — le témoin de la manipulation", async ({ page }) => {
        // Without this assertion, the next two would also pass on a bundle that
        // loaded but whose button fails to appear for another reason. The
        // witness is what makes the second direction conclusive rather than
        // reassuring.
        await bootMapUntilLoaded(page);
        const loaded = await page.evaluate(() =>
            /** @type {any} */ (window).GeoLeaf?.plugins?.isLoaded?.("routing")
        );
        expect(loaded).toBeFalsy();
    });

    test("la popup s'ouvre, et NE porte aucun bouton d'action", async ({ page }) => {
        await bootMapUntilLoaded(page);
        await clickPoiUntil(page, ".gl-fi-popup-ml");
        // The popup itself is there: what distinguishes "the button is hidden"
        // from "nothing was rendered at all", and without that distinction the
        // absence proves nothing.
        await expect(page.locator(".gl-fi-popup-ml")).toBeVisible();
        await expect(page.locator(".gl-poi-popup__action")).toHaveCount(0);
    });

    test("le panneau d'itinéraire n'existe nulle part", async ({ page }) => {
        await bootMapUntilLoaded(page);
        await clickPoiUntil(page, ".gl-fi-popup-ml");
        await expect(page.locator(".gl-routing-panel")).toHaveCount(0);
    });
});

test.describe("③ l'attribution ODbL — une obligation de licence, vue dans un vrai navigateur", () => {
    // 🛑 This block proves a COMPLIANCE, not a feature. Both shipped engines
    // compute on OpenStreetMap, whose ODbL requires attribution wherever the
    // derived work is shown — and the one who ends up out of compliance is the
    // INTEGRATOR, since they publish the map. A unit guard suffices to prove
    // the mechanism; only this one proves the SHIPPED bundle carries it.
    //
    // ⚠️ The route is published directly through the public API rather than
    // computed: a computation would require a network call to an engine, which
    // the no-network rule forbids to the whole suite. What is proven here is
    // the `publishRoute` → credit wiring, exactly the half no unit test saw
    // before it was written.

    test("🛑 avant toute publication, aucun crédit n'est affiché", async ({ page }) => {
        // The witness. Without it, "the credit is there after publication" would
        // also pass on a credit the bundle displayed permanently — which would
        // not prove the wiring.
        await bootMapUntilLoaded(page);
        await expect(page.locator(".gl-routing-attribution")).toHaveCount(0);
    });

    test("`getProvider()` rend l'identifiant ET la mention", async ({ page }) => {
        await bootMapUntilLoaded(page);
        const p = await page.evaluate(() =>
            /** @type {any} */ (window).GeoLeaf.Routing.getProvider()
        );
        expect(p).not.toBeNull();
        expect(p.id).toBe("valhalla");
        expect(p.attribution).toContain("OpenStreetMap");
    });

    // ✅ Since 2026-08-25 the demo profile DECLARES the `routing-route` layer
    // (empty, filled by `publishRoute` at runtime) — until then this block could
    // not prove the `publishRoute` → credit coupling: `listLayerIds()` returned
    // a list with no route layer, `setData` on an unknown id writes nowhere, and
    // the showcase itself ended every computation on
    // `panel.showFailure("no-layer")`. The two tests below are exactly the ones
    // the comment of the time awaited; the absence witness at the block's head
    // remains their counterpart.
    //
    // ⚠️ The route is PUBLISHED through the public API, never computed (no
    // network for the whole suite). The geometry is tiny and local; what is
    // proven is the SHIPPED bundle's wiring, the only half the unit tests
    // (attribution.test.ts, seen red both ways) do not cover.

    /**
     * A two-stop route, real enough to publish — never to navigate. The shape
     * is `RouteResult`'s: `geometry` is an ENCODED POLYLINE (precision 5,
     * decoded by `routeFeatures`), not GeoJSON — a first draft's
     * `coordinates is not iterable` error established it. The encoded trace
     * covers [-21.0964,55.4781] → [-21.1064,55.4881].
     */
    const TINY_ROUTE = {
        geometry: "nkw_CcqrqIn}@o}@",
        distance: 1500,
        duration: 1200,
        provider: "valhalla",
        attribution: "© OpenStreetMap contributors (test)",
        waypoints: [{ coordinates: [55.4781, -21.0964] }, { coordinates: [55.4881, -21.1064] }],
    };

    /**
     * Waits for the route layer to be registered — the GeoJSON population is
     * DEFERRED (layers arrive after the map's boot, through asynchronous
     * loading): the loaded native map says nothing of the layer registry's
     * state.
     *
     * @param {import('@playwright/test').Page} page The page.
     */
    async function waitForRouteLayer(page) {
        await page.waitForFunction(
            () => /** @type {any} */ (window).GeoLeaf?.Layers?.hasLayer?.("routing-route") === true,
            null,
            { timeout: 15000 }
        );
    }

    test("publishRoute écrit dans la couche déclarée ET affiche le crédit ODbL", async ({
        page,
    }) => {
        await bootMapUntilLoaded(page);
        await waitForRouteLayer(page);
        const outcome = await page.evaluate((route) => {
            return /** @type {any} */ (window).GeoLeaf.Routing.publishRoute(route);
        }, TINY_ROUTE);
        // Yesterday's refusal was `{ ok: false, reason: "no-such-layer" }` — the
        // assertion names the field so a profile regression yields a message
        // saying where to look.
        expect(outcome.ok, `publishRoute a refusé : ${JSON.stringify(outcome)}`).toBe(true);
        expect(outcome.layerId).toBe("routing-route");
        await expect(page.locator(".gl-routing-attribution")).toBeVisible();
        await expect(page.locator(".gl-routing-attribution")).toContainText("OpenStreetMap");
    });

    test("clearRoute retire la géométrie ET redescend le crédit avec elle", async ({ page }) => {
        await bootMapUntilLoaded(page);
        await waitForRouteLayer(page);
        await page.evaluate((route) => {
            /** @type {any} */ (window).GeoLeaf.Routing.publishRoute(route);
        }, TINY_ROUTE);
        await expect(page.locator(".gl-routing-attribution")).toBeVisible();
        const cleared = await page.evaluate(() =>
            /** @type {any} */ (window).GeoLeaf.Routing.clearRoute()
        );
        expect(cleared.ok).toBe(true);
        // The credit rises with the geometry and falls with it — ODbL has no
        // grace period for "the panel was closed".
        await expect(page.locator(".gl-routing-attribution")).toHaveCount(0);
    });

    // 🛑 The only place that exercises the geometry guard IN THE DELIVERED BUNDLE.
    //
    // The layer ships EMPTY and is written at runtime, so its sub-layer set is the
    // "unknown" fallback: fill + casing + line + circle, all over ONE source. MapLibre
    // checks no geometry type when it fills a bucket — `FillBucket` closes a LineString
    // into a filled polygon, `CircleBucket` walks every vertex — so without the
    // per-sub-layer `geometry-type` filter this shape rendered an opaque black polygon
    // plus SEVEN dots (5 line vertices + 2 stops) where two were wanted.
    //
    // ⚠️ It writes through `GeoLeaf.Layers.setData` rather than `publishRoute`, and for a
    // measured reason: the demo profile CLAMPS the view (`maxBounds`), so a fixture with
    // hardcoded coordinates cannot be brought on screen — and `queryRenderedFeatures`
    // only sees the viewport. The geometry is therefore built around the map's OWN centre.
    // That is the same seam `publishRoute` writes through (`publish.ts`), carrying the same
    // `properties.role`; what this test owns is the RENDERING contract, and the publication
    // contract is the two tests above.
    //
    // A five-vertex zigzag on purpose: a two-point line closes into a degenerate polygon
    // that paints nothing, and the fill assertion would pass for the wrong reason.
    test("un nœud est une ÉTAPE — ni polygone noir, ni cercle par sommet", async ({ page }) => {
        await bootMapUntilLoaded(page);
        await waitForRouteLayer(page);

        const seen = await page.evaluate(async () => {
            const gl = /** @type {any} */ (window).GeoLeaf;
            const map = gl.Core.getMap().getNativeMap();
            const { lng, lat } = map.getCenter();
            const d = 0.02;
            const line = [
                [lng - 2 * d, lat],
                [lng - d, lat + d],
                [lng, lat - d],
                [lng + d, lat + d],
                [lng + 2 * d, lat],
            ];
            gl.Layers.setData("routing-route", [
                {
                    type: "Feature",
                    id: "route",
                    geometry: { type: "LineString", coordinates: line },
                    properties: { role: "route" },
                },
                {
                    type: "Feature",
                    id: "waypoint-0",
                    geometry: { type: "Point", coordinates: line[0] },
                    properties: { role: "origin", index: 0, step: 1 },
                },
                {
                    type: "Feature",
                    id: "waypoint-1",
                    geometry: { type: "Point", coordinates: line[4] },
                    properties: { role: "destination", index: 1, step: 2 },
                },
            ]);
            map.jumpTo({ center: [lng, lat], zoom: 11 });
            await new Promise((resolve) => {
                const done = () => resolve(null);
                map.once("idle", done);
                setTimeout(done, 8000);
            });
            const count = (id) => map.queryRenderedFeatures({ layers: [id] }).length;
            return {
                fillFilter: map.getFilter("gl-routing-route-fill") ?? null,
                circleFilter: map.getFilter("gl-routing-route-circle") ?? null,
                filled: count("gl-routing-route-fill"),
                drawn: count("gl-routing-route-line"),
                dots: count("gl-routing-route-circle"),
            };
        });

        // The guard travels all the way into the minified bundle, not just the sources.
        expect(seen.fillFilter, "la sous-couche fill ne porte aucune garde").not.toBeNull();
        expect(seen.circleFilter, "la sous-couche circle ne porte aucune garde").not.toBeNull();

        expect(seen.drawn, "le tracé n'est pas dessiné").toBeGreaterThan(0);
        expect(seen.filled, "un polygone est peint depuis une LineString").toBe(0);
        expect(seen.dots, "un nœud par sommet au lieu d'un nœud par étape").toBe(2);
    });
});

test.describe("④ composer un trajet à TROIS points, depuis la barre d'outils", () => {
    // 🛑 THIS BLOCK IS THE WORK'S SATISFACTION CRITERION, AND ITS ORACLE IS THE
    // DOM.
    //
    // The model had known how to compose N stops for a while: `addWaypoint`,
    // `moveWaypoint`, `roleAt`, `maxWaypoints`, all delivered, exposed and
    // tested. **No source fed them.** An API-built oracle would have shown a
    // perfect model on a product where more than two points could not be
    // composed — exactly the confusion that let two defects through in a row.
    //
    // So: open the panel like a user, type, and COUNT THE ROWS. No network call
    // — composing is not computing.

    /**
     * Opens the route panel through the toolbar button.
     *
     * @param {import('@playwright/test').Page} page The page.
     */
    async function openPanel(page) {
        await bootMapUntilLoaded(page);
        // ⚠️ Through the bar's EVENT and not a click on its button: the slot is
        // rendered by the core and its shape depends on the mobile or desktop
        // layout. What is proven here is the panel, not the bar — which block
        // `②` already covers in both directions.
        await page.evaluate(() => {
            document.dispatchEvent(
                new CustomEvent("geoleaf:toolbar:action", { detail: { action: "routing" } })
            );
        });
        await page.waitForSelector(".gl-routing-panel", { timeout: 5000 });
    }

    /**
     * Types a value into the stop field and submits.
     *
     * @param {import('@playwright/test').Page} page The page.
     * @param {string} text What is typed.
     */
    async function addStop(page, text) {
        await page.fill(".gl-routing-add__field", text);
        await page.click(".gl-routing-add__submit");
    }

    test("🛑 le panneau porte un CHAMP de saisie — ce qui manquait", async ({ page }) => {
        await openPanel(page);
        await expect(page.locator(".gl-routing-add__field")).toHaveCount(1);
        await expect(page.locator(".gl-routing-add__pick")).toHaveCount(1);
    });

    test("🛑 trois points saisis font TROIS lignes dans la liste", async ({ page }) => {
        // The assertion that would have caught the first one. It counts DOM
        // elements, not entries of an array nobody renders.
        await openPanel(page);
        await addStop(page, "-21.0964, 55.4781");
        await addStop(page, "-21.1, 55.49");
        await addStop(page, "-21.12, 55.51");
        await expect(page.locator(".gl-routing-steps__item")).toHaveCount(3);
    });

    test("les trois portent leurs rôles — départ, étape, arrivée", async ({ page }) => {
        // The role is DERIVED from the position, never stored: what makes a
        // reorder not have to renumber. Verifying it here proves the derivation
        // survives the input path.
        await openPanel(page);
        await addStop(page, "-21.0964, 55.4781");
        await addStop(page, "-21.1, 55.49");
        await addStop(page, "-21.12, 55.51");
        await expect(page.locator(".gl-routing-steps__item--origin")).toHaveCount(1);
        await expect(page.locator(".gl-routing-steps__item--via")).toHaveCount(1);
        await expect(page.locator(".gl-routing-steps__item--destination")).toHaveCount(1);
    });

    test("une saisie qui n'est ni adresse ni coordonnées est REFUSÉE, avec une phrase", async ({
        page,
    }) => {
        // 🛑 THE PROVIDER IS INTERCEPTED, AND WITHOUT THAT THIS TEST IS HOSTAGE
        // TO A THIRD PARTY. Its comment claimed "without a geocoding plugin in
        // this profile" — FALSE for its own target: `deploy-coverage` ships
        // `geoleaf-geocoding.plugin.js` and `tourism` declares the `nominatim`
        // provider, so `geocodingAvailable()` is true and `submit()` reaches
        // `await searchAddress(text)` — a real call to
        // `nominatim.openstreetmap.org`. The sentence under test only appears
        // once that call has answered.
        //
        // ⚠️ Measured on 2026-08-26: green in isolation, RED in the full suite
        // at the 5 s budget — the same shared-state class `15-file-import`
        // documents, where third-party hosts take ~213 loads over a full run
        // and Playwright's per-context isolation cannot see it, because it is
        // OUTSIDE the browser. Raising the budget would only have made the
        // test slower to fail on someone else's rate limit.
        //
        // An EMPTY result set is served: it is the faithful simulation of "not
        // an address" and drives the `no-match` branch. The refusal path is
        // reached deterministically, offline, and the assertion below is
        // unchanged.
        await page.route(
            (u) =>
                /nominatim\.openstreetmap\.org|api-adresse\.data\.gouv\.fr|photon\.komoot\.io/.test(
                    u.href
                ),
            (route) =>
                route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({ type: "FeatureCollection", features: [] }),
                })
        );
        await openPanel(page);
        await addStop(page, "azerty");
        await expect(page.locator(".gl-routing-steps__item")).toHaveCount(0);
        await expect(page.locator(".gl-routing-add__message")).not.toBeEmpty();
    });

    test("🛑 le bouton « calculer » s'ACTIVE à deux points et pas avant", async ({ page }) => {
        // Composing only makes sense upstream of a computation. This test links
        // the two without triggering one: no network call, the no-network rule
        // holds.
        await openPanel(page);
        const compute = page.locator(".gl-routing-panel__compute");
        await addStop(page, "-21.0964, 55.4781");
        await expect(compute).toBeDisabled();
        await addStop(page, "-21.1, 55.49");
        await expect(compute).toBeEnabled();
    });
});
