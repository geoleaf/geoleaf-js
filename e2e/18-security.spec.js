// @ts-check
// E2E: 18-security — deploy-core (port 8766). Security suite.
//
// Dynamic proof of H1 (stored POI XSS) and the CSP guardian for B.5.
//
// The model: a profile is untrusted. A POI whose `name`/`description`/`url`/
// `image` fields carry XSS payloads must NEVER execute JavaScript when its
// sidepanel is rendered. The hostile POI is STORED in a real layer through the
// real public API — `GeoLeaf.Utils.poiToFeature()` → `GeoLeaf.Layers.mergeFeatures()`
// — then read BACK from the layer store and rendered through the real detail
// surface (`GeoLeaf.FeatureInfo.openSidePanel` → .gl-poi-sidepanel, real DOM),
// then assert:
//   - window.__xss stays false (no onerror/script fired)         → H1 closed
//   - no live element is injected from the payload (escaped)     → sink works
//   - href/src never carry javascript:/data:text/html            → URL sink
//   - 0 script-src CSP violations collected                      → no inline JS
//
// The B.5 guardian boots under a STRICT style-src (unsafe-inline stripped from
// the document CSP) and asserts 0 style-src violations — core only.
//
// The B.7 guardian does the same on a PLUGIN variant — `deploy-full`
// (editor + offline-ui + connector) since the variant merge, `deploy-addpoi`
// before it disappeared with the merged plugin. B.5 hardened the core but the e2e ran on
// deploy-core alone, so it missed that plugin CSS was injected at runtime via
// the bundler's styleInject (a <style> element) and the connector's hand-rolled
// <style> — both blocked under strict style-src. Plugin CSS now loads via
// constructable stylesheets (adoptedStyleSheets), not subject to style-src.
//
// deploy-* ship a PWA service worker → serviceWorkers:'block'. Run after
// `npm run build:deploy:all`.

import { test, expect } from "@playwright/test";
import { baseURL, isNginxTarget } from "./helpers/base-url.js";
import { bootMapUntilIdle } from "./helpers/boot.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

// Sentinel + CSP-violation collector, installed before any page script runs.
const SENTINEL_INIT = () => {
    /** @type {any} */ (window).__xss = false;
    /** @type {any} */ (window).__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
        /** @type {any} */ (window).__cspViolations.push({
            directive: e.effectiveDirective || e.violatedDirective,
            blockedURI: e.blockedURI,
            source: e.sourceFile,
        });
    });
};

/**
 * The payload that must never become live markup. Shared by the fixture and by
 * the non-vacuity guard in {@link renderHostilePoi}.
 */
const XSS_HTML_PAYLOAD = '<img src=x onerror="window.__xss=true">';

// Safe CONTROLS, rendered side by side with the hostile URLs by the very same
// renderers. They make the URL-sink assertions a discrimination proof instead of
// a plain absence: the sink is provably reached (the controls came through) AND
// it provably rejected the hostile pair. Neither hits the network — an <a href>
// is never fetched, and the GIF is a 1x1 data: URL (allowed by the img-src CSP
// and by ALLOWED_DATA_URL_TYPES, security/validators.ts).
const SAFE_CONTROL_HREF = "https://example.org/safe";
const SAFE_CONTROL_IMG =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/**
 * Side-panel layout pinning every hostile value to the sink it must be
 * neutralised by: `text` → `textContent`, `link` → `anchor.href`, `image` →
 * `img.src`.
 *
 * Passed as the `layout` override (2nd argument of `openSidePanel`), which fully
 * replaces the auto-resolved layer binding. Without it the assertions below
 * would be VACUOUS: `buildSidePanelBody` skips untyped fields outright
 * (`if (!field?.type) continue;`, feature-info/render/sidepanel-content.ts),
 * and the injection layer carries no `capabilities.feature-info` binding of its
 * own — so nothing at all would be rendered and "no live element in the panel"
 * would hold on an empty panel.
 */
const HOSTILE_SIDEPANEL_LAYOUT = [
    { field: "name", type: "text", variant: "title" },
    { field: "description", type: "text" },
    // Nested path — exercises the `attributes.*` branch of resolve.ts.
    { field: "attributes.shortDescription", type: "text" },
    { field: "website", type: "link", label: "Site" },
    { field: "mainImage", type: "image" },
    { field: "safeWebsite", type: "link", label: "Contrôle" },
    { field: "safeImage", type: "image", label: "Contrôle" },
];

/** A hostile POI: every field that reaches a render sink carries a payload. */
function hostilePoi() {
    return {
        id: "xss-probe",
        // Would fire onerror (set __xss) if injected as HTML rather than text.
        title: XSS_HTML_PAYLOAD,
        name: XSS_HTML_PAYLOAD,
        latlng: { lat: 45.76, lng: 4.83 },
        attributes: {
            // A marker element with a unique attribute — present in the DOM only
            // if the description was injected as HTML instead of escaped.
            shortDescription: '<span data-xss-marker="1">boom</span>',
            description: '<span data-xss-marker="1">boom</span>',
            // URL sinks: must be rejected, never reach href/src live.
            website: "javascript:window.__xss=true",
            mainImage: "data:text/html;base64,PHNjcmlwdD53aW5kb3cuX194c3M9dHJ1ZTwvc2NyaXB0Pg==",
            // Controls — same renderers, safe values: they MUST come through.
            safeWebsite: SAFE_CONTROL_HREF,
            safeImage: SAFE_CONTROL_IMG,
        },
    };
}

/**
 * Stores the hostile POI in a real layer, reads it BACK from the layer store,
 * and opens its side-panel — all through the real public API.
 *
 * `GeoLeaf.POI.*` was dissolved (commit 02c6a8d0) and `addPoi` has NO runtime
 * replacement (0 hits outside a remote `/api/pois` path). The honest equivalent
 * today is the very path plugin-storage's offline replay takes to re-inject a
 * stored POI into its host layer — `poiToFeature()` then `mergeFeatures()`, see
 * `core/src/capabilities/offline/poi-restore/poi-restore.ts`. The panel
 * is fed the feature READ BACK from the store (`getFeatureById`), never the
 * in-test literal, so the payload really transits the storage path: this stays a
 * *stored* XSS proof, not a "renderer called with a hostile string" proof.
 *
 * `showPoiDetails` → `GeoLeaf.FeatureInfo.openSidePanel(detail, layout)`
 * (`capabilities/feature-info/public-api.ts`), same `.gl-poi-sidepanel` DOM.
 */
async function renderHostilePoi(page) {
    // The injection target must exist: layers land in the store during boot.
    await page.waitForFunction(
        () => {
            const GL = /** @type {any} */ (window).GeoLeaf;
            return (GL?.Layers?.listLayerIds?.() ?? []).length > 0;
        },
        null,
        { timeout: 20000 }
    );

    const stored = await page.evaluate(
        ({ poi, fields }) => {
            const GL = /** @type {any} */ (window).GeoLeaf;
            const layerId = GL.Layers.listLayerIds()[0];
            // Real ingestion path: POI → GeoJSON Feature → layer store (dedup by id).
            const feature = GL.Utils.poiToFeature(poi);
            if (!feature) return null;
            GL.Layers.mergeFeatures(layerId, [feature]);
            // Read back from the store — the render input is the STORED feature.
            const back = GL.Layers.getFeatureById(layerId, poi.id);
            if (!back) return null;
            GL.FeatureInfo.openSidePanel(
                {
                    layerId,
                    featureId: poi.id,
                    properties: back.properties,
                    geometry: back.geometry ?? null,
                    lngLat: { lat: poi.latlng.lat, lng: poi.latlng.lng },
                    point: { x: 200, y: 200 },
                },
                { layerId, fields }
            );
            return { layerId, title: back.properties.name };
        },
        { poi: hostilePoi(), fields: HOSTILE_SIDEPANEL_LAYOUT }
    );

    // Non-vacuity guards. Without them, "nothing hostile is in the panel" would
    // hold just as well on a panel that never rendered anything at all — the
    // exact failure mode the previous helper had (it threw, so nothing rendered).
    expect(stored, "the hostile POI must round-trip through the layer store").not.toBeNull();
    expect(stored?.title).toBe(XSS_HTML_PAYLOAD);
    await page.locator(".gl-poi-sidepanel").waitFor({ state: "attached", timeout: 10000 });
    // The payload DID reach the title sink — as text, not as markup.
    await expect(page.locator(".gl-poi-sidepanel__title-text")).toHaveText(XSS_HTML_PAYLOAD);
}

/** Serve the document with `'unsafe-inline'` removed from style-src. */
async function forceStrictStyleSrc(page) {
    await page.route("**/*", async (route) => {
        if (route.request().resourceType() !== "document") return route.continue();
        const resp = await route.fetch();
        let body = await resp.text();
        body = body.replace(/(style-src[^;]*?)\s*'unsafe-inline'/g, "$1");
        return route.fulfill({ response: resp, body });
    });
}

test.describe("18-security — stored POI XSS (H1, dynamic proof)", () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(SENTINEL_INIT);
    });

    test("hostile POI sidepanel executes no JavaScript (window.__xss stays false)", async ({
        page,
    }) => {
        const pageErrors = [];
        page.on("pageerror", (e) => pageErrors.push(e.message));

        await bootMapUntilIdle(page);
        await renderHostilePoi(page);

        // Give any deferred onerror/script the chance to run.
        await page.waitForTimeout(500);

        const xss = await page.evaluate(() => /** @type {any} */ (window).__xss);
        expect(xss).toBe(false);
        expect(pageErrors).toEqual([]);
    });

    test("payload is escaped: no live element is injected into the sidepanel", async ({ page }) => {
        await bootMapUntilIdle(page);
        await renderHostilePoi(page);

        // The <span data-xss-marker> exists only if the field was injected as HTML.
        const injected = await page.locator(".gl-poi-sidepanel [data-xss-marker]").count();
        expect(injected).toBe(0);
        // No <script> smuggled into the panel either.
        const scripts = await page.locator(".gl-poi-sidepanel script").count();
        expect(scripts).toBe(0);
    });

    test("URL sinks reject javascript:/data:text/html (no live href or src)", async ({ page }) => {
        await bootMapUntilIdle(page);
        await renderHostilePoi(page);

        const unsafe = await page.evaluate(() => {
            const panel = document.querySelector(".gl-poi-sidepanel");
            if (!panel) return { hrefs: 0, srcs: 0, allHrefs: [], allSrcs: [] };
            const allHrefs = Array.from(panel.querySelectorAll("a[href]")).map(
                (a) => a.getAttribute("href") || ""
            );
            const allSrcs = Array.from(panel.querySelectorAll("img[src]")).map(
                (img) => img.getAttribute("src") || ""
            );
            const bad = /^\s*(javascript|vbscript|data:text\/html)/i;
            return {
                hrefs: allHrefs.filter((h) => bad.test(h)).length,
                srcs: allSrcs.filter((s) => bad.test(s)).length,
                allHrefs,
                allSrcs,
            };
        });
        expect(unsafe.hrefs).toBe(0);
        expect(unsafe.srcs).toBe(0);
        // Discrimination: the two sinks WERE reached — the safe controls came
        // through, and they are the ONLY thing that came through. Without this the
        // two counts above would also read 0 on a renderer that skipped every URL.
        expect(unsafe.allHrefs).toEqual([SAFE_CONTROL_HREF]);
        expect(unsafe.allSrcs).toEqual([SAFE_CONTROL_IMG]);
    });

    test("hostile POI triggers no inline/eval script-src violation", async ({ page }) => {
        await bootMapUntilIdle(page);
        await renderHostilePoi(page);
        await page.waitForTimeout(300);

        // An injected inline handler/script that the browser tried to run would
        // surface as a script-src violation with blockedURI "inline"/"eval".
        // (wasm-eval is asserted separately below — realtime-layer no longer
        // probes WebAssembly at boot.)
        const inlineScript = await page.evaluate(() =>
            /** @type {any} */ (window).__cspViolations.filter(
                (v) =>
                    /script-src/.test(v.directive || "") &&
                    (v.blockedURI === "inline" || v.blockedURI === "eval")
            )
        );
        expect(inlineScript).toEqual([]);
    });

    test("boots with no wasm-eval script-src violation (realtime-layer lazy-loads protobuf)", async ({
        page,
    }) => {
        await bootMapUntilIdle(page);
        // Let any deferred module-init (and its CSP probe) settle.
        await page.waitForTimeout(300);

        // realtime-layer used to pull gtfs-realtime-bindings/protobufjs/long —
        // whose module-init probes WebAssembly — into the boot graph, firing a
        // `wasm-eval` violation under the strict script-src (no 'wasm-unsafe-eval').
        // The GTFS-RT decoder is now lazy-loaded, so a boot without a GTFS-RT
        // layer (deploy-core) must never hit the probe.
        const wasmViolations = await page.evaluate(() =>
            /** @type {any} */ (window).__cspViolations.filter(
                (v) => /script-src/.test(v.directive || "") && v.blockedURI === "wasm-eval"
            )
        );
        expect(wasmViolations).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// B.5 guardian — strict style-src ('unsafe-inline' removed). ACTIVE: all inline-style
// sites were migrated to CSSOM / CSS classes (data-gl-style + applyCssText). This test
// strips 'unsafe-inline' at the network layer and asserts zero style-src violations.
//
// N.B. the deployed document ships `style-src 'self'` — no 'unsafe-inline', and
// no third-party origin either (MapLibre is self-hosted, Google Fonts is gone). So
// `forceStrictStyleSrc()` matches nothing. It is kept as a normalizer: it keeps this
// guardian strict if 'unsafe-inline' is ever re-introduced into the shipped CSP.
//
// ⚠️ This spec asserts NOTHING about which origins the CSP allows — its four assertions
// are `expect(violations).toEqual([])` over `securitypolicyviolation` events, which are
// indifferent to the allowlist. The plan claimed otherwise and sent a task to update a
// file that needed no change, while the real gap went unnamed: no gate reads the shipped
// CSP at all. `scripts/probe-csp-origins.mjs` is what covers it, and it is manual.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("18-security — CSP strict style-src (B.5 guardian)", () => {
    test("boots and opens UI with zero style-src violations under strict CSP", async ({ page }) => {
        await page.addInitScript(SENTINEL_INIT);
        await forceStrictStyleSrc(page);
        await bootMapUntilIdle(page);
        await renderHostilePoi(page);
        await page.waitForTimeout(500);

        const styleViolations = await page.evaluate(() =>
            /** @type {any} */ (window).__cspViolations.filter((v) =>
                /style-src/.test(v.directive || "")
            )
        );
        expect(styleViolations).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// B.7 guardian — strict style-src on a PLUGIN variant. ⚠️ It used to run on
// `deploy-addpoi`; that variant died with the merged plugin, so the guardian now
// runs on `deploy-full` (editor + offline-ui + connector), which is the variant
// carrying gated plugins. Plugin CSS injects at module-eval and the connector
// injects on credential-button/login UI; all
// now go through constructable stylesheets (adoptedStyleSheets), not <style>.
// Before B.7 this booted with several "Applying inline style violates style-src"
// violations — the very defect deploy-core could not surface.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("18-security — CSP strict style-src on plugins (B.7 guardian)", () => {
    test.use({ baseURL: baseURL("full") }); // deploy-full — the gated-plugins variant

    test("editor + offline-ui + connector load with zero style-src violations under strict CSP", async ({
        page,
    }) => {
        await page.addInitScript(SENTINEL_INIT);
        await forceStrictStyleSrc(page);
        await bootMapUntilIdle(page);
        // Plugin CSS injects at module-eval; give deferred injection a beat.
        await page.waitForTimeout(800);

        const styleViolations = await page.evaluate(() =>
            /** @type {any} */ (window).__cspViolations.filter((v) =>
                /style-src/.test(v.directive || "")
            )
        );
        expect(styleViolations).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The `X-Content-Type-Options` header is SERVED, not merely configured.
//
// It lived as a `<meta http-equiv>` in `index.html` until 2026-08-08, where
// it protected NOTHING: this header is only honoured as an HTTP response.
// Nginx did not set it either — the protection was thus absent everywhere
// while appearing present.
//
// 🛑 THIS TEST CANNOT BE THE ONLY GUARD, and that is the point to grasp
// before relying on it. The default target is `ports`, where Playwright
// starts its own http-servers: nginx is not in the loop, so the header will
// NEVER be present there. Written without the `skip` below, this test would
// be permanently red on the reference target; written with a soft `expect`,
// it would be EMPTY — green by construction, on a property it never proved.
//
// The split is thus explicit: **NGINX-01** (`scripts/verify-app-template.cjs`)
// verifies the conf declares the header on EACH vhost and runs in
// `ci:local`'s default path; this test verifies a real server really SERVES
// it, and only runs under `E2E_TARGET=nginx`. Neither replaces the other:
// the first does not prove the server applies its conf, the second does not
// run by default.
test.describe("18-security — en-têtes de sécurité servis", () => {
    test.skip(
        !isNginxTarget,
        "Les en-têtes viennent de nginx. Sur la cible `ports` (http-server) il n'y en a pas — " +
            "l'assertion serait vide, donc verte sans rien prouver. Couvert par NGINX-01 dans ci:local."
    );

    test("deploy-core sert X-Content-Type-Options: nosniff", async ({ page }) => {
        const response = await page.goto("/");
        expect(response, "aucune réponse — le vhost ne répond pas").toBeTruthy();
        expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    });

    test("deploy-full sert X-Content-Type-Options: nosniff", async ({ page }) => {
        const response = await page.goto(`${baseURL("full")}/`);
        expect(response, "aucune réponse — le vhost ne répond pas").toBeTruthy();
        expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    });

    // The counter-proof counts as much as the guard: a test reading a header
    // set by something else (an upstream proxy) would say nothing about the
    // conf just written. `X-Frame-Options` comes out of the same `server`
    // blocks — if it disappears too, the whole block jumped, and the nosniff
    // verdict changes meaning.
    test("les en-têtes voisins du même bloc server répondent aussi", async ({ page }) => {
        const response = await page.goto("/");
        expect(response.headers()["x-frame-options"]).toBe("DENY");
    });
});
