#!/usr/bin/env node
/**
 * FILET 4 — boot contract probe against the REAL Rollup bundle, in a REAL browser.
 *
 * The tier that actually caught `192c6865` (S4). It stays because it is the only one that sees
 * what the other three cannot: the RENDER (a painted map) and the REAL ORDER of the perf marks
 * emitted from inside the module init()s — which never fire under a mocked MapLibre.
 *
 * It is NOT the daily gate: it needs a build + an external server, so it VALIDATES, it does not
 * GUARD. The cheap tiers guard:
 *   - `packages/core/__tests__/bundle-boot-contract.test.js` — artefact tier (~1 s, no server)
 *   - `packages/core/__tests__/api/api-controller-getter.test.js` — the real getter (~4 ms)
 *
 * WHY A STANDALONE SCRIPT AND NOT `playwright test`: `playwright.config.js` starts four
 * http-servers on 8766-8770 by default, and starting a server is forbidden here. The dev nginx
 * already serves `deploy/deploy-core` at https://demo.geoleaf.local.test/. So: `npm run
 * build:deploy` (a build, allowed), then drive Chromium straight at that URL.
 *
 * N.B. since backlog R.7a the suite ITSELF can run without starting a server
 * (`E2E_TARGET=nginx`, see e2e/helpers/base-url.js) — this probe keeps its own entry point
 * because it asserts a boot CONTRACT (facade surface + perf-mark order), not a scenario.
 *
 * Usage:  node scripts/probe-boot-contract.mjs
 * Exit:   0 = all assertions passed · 1 = at least one failed
 */

import { chromium } from "@playwright/test";
import { SOFTWARE_GL_ARGS } from "../e2e/helpers/launch-options.js";
import { baseURL } from "../e2e/helpers/base-url.js";

// Same source of truth as the suite: `core` resolves to the nginx vhost or to port 8766,
// per E2E_TARGET. GEOLEAF_PROBE_URL still wins, for probing an arbitrary deployment.
const URL = process.env.GEOLEAF_PROBE_URL || `${baseURL("core")}/`;

import { walkNamespace, IMPORT_SURFACE_MIN } from "./lib/namespace-surface.mjs";

/**
 * Pre-boot facade surface — must stay in sync with the artefact tier's IMPORT_SURFACE
 * (`packages/core/__tests__/bundle-boot-contract.test.js`). Asserted as a SUPERSET here:
 * `deploy-core/init.js` legitimately mounts plugin namespaces on top before boot.
 */
// IMPORT_SURFACE_MIN et la marche vivent dans `scripts/lib/namespace-surface.mjs`
// (API S4.1) — avec les deux autres tiers, et avec la note sur `requireMap` qui
// racontait la dérive que cette centralisation rend désormais impossible.

/** `serviceWorkers: 'block'` makes register() resolve undefined → this log is a TEST ARTEFACT. */
const KNOWN_NOISE = [/\[SWRegister\] Registration failed/i];

const results = [];
const check = (name, ok, detail = "") => {
    results.push({ name, ok, detail });
    console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok || !detail ? "" : `\n      → ${detail}`}`);
};

const run = async () => {
    const browser = await chromium.launch({ args: SOFTWARE_GL_ARGS });
    const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        serviceWorkers: "block",
    });
    const page = await context.newPage();

    const pageErrors = [];
    const consoleErrors = [];
    const badResponses = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    page.on("console", (m) => {
        if (m.type() !== "error") return;
        const text = m.text();
        if (!KNOWN_NOISE.some((re) => re.test(text))) consoleErrors.push(text);
    });
    page.on("response", (r) => {
        if (r.status() >= 400 && !/favicon/i.test(r.url())) {
            badResponses.push(`${r.status()} ${r.url()}`);
        }
    });

    // Capture the PRE-BOOT surface: runs on every new document, before page scripts.
    // `GeoLeaf.boot()` is called by init.js at the end, so a microtask hop after the bundle
    // evaluates still lands before boot completes.
    // La marche est transportée par sa SOURCE, pas par une référence : `addInitScript` sérialise
    // la fonction, elle ne peut donc rien capturer de ce module. C'est ce qui impose à
    // `walkNamespace` d'être auto-suffisante (assertion dédiée côté tests).
    await page.addInitScript((walkSrc) => {
        // 🖐 B-88 — DÉROGATION MOTIVÉE À `no-new-func`, et le motif est mesurable.
        // `walkSrc` est la SOURCE de `walkNamespace`, sérialisée depuis ce dépôt à l'appel
        // ci-dessus — jamais une entrée. `addInitScript` sérialise la fonction et ne
        // transporte aucune fermeture : la reconstruire dans la page est le seul moyen de
        // l'y exécuter. C'est le mécanisme que le commentaire au-dessus décrit, pas un
        // contournement. La règle reste `error` partout ailleurs, `scripts/` compris.
        //
        // ⚠️ La directive doit rester la DERNIÈRE ligne avant le code : `-next-line` porte
        // sur la ligne suivante, et un commentaire intercalé la rend inopérante — elle sort
        // alors « directive inutilisée », ce qui est indiscernable d'une dérogation périmée.
        // eslint-disable-next-line no-new-func
        const walk = new Function("return (" + walkSrc + ")")();
        window.__preBootSurface = null;
        const grab = () => {
            if (window.__preBootSurface || !window.GeoLeaf) return;
            window.__preBootSurface = walk(window.GeoLeaf).keys;
        };
        document.addEventListener("readystatechange", grab, true);
        window.addEventListener("DOMContentLoaded", grab, true);
        setTimeout(grab, 0);
    }, walkNamespace.toString());

    console.log(`\n▸ ${URL}?perf=1\n`);
    await page.goto(`${URL}?perf=1`, { waitUntil: "domcontentloaded", timeout: 30000 });

    // ── The only correct wait condition ──────────────────────────────────────────────────
    // `map.loaded()` is NOT enough: it flips true once the base style is ready, BEFORE GeoLeaf
    // has loaded the profile → "0 layers". A `gl-*` layer is NOT enough either, twice over:
    //   - the basemap is laid down AFTER the profile layers → false "basemap gone";
    //   - `gl-sentinel-poi` (maplibre-layer-registry.ts:40) is ITSELF a `gl-*` layer, so a naive
    //     `some(id.startsWith('gl-'))` goes GREEN ON AN EMPTY MAP.
    // Correct: profile layers (sentinel excluded) AND the basemap source.
    let painted = true;
    try {
        await page.waitForFunction(
            () => {
                const native = window.GeoLeaf?.Core?.getMap?.()?.getNativeMap?.();
                if (!native?.getStyle) return false;
                const style = native.getStyle();
                if (!style) return false;
                const profileLayers = (style.layers || []).filter(
                    (l) => l.id.startsWith("gl-") && l.id !== "gl-sentinel-poi"
                );
                return profileLayers.length > 0 && !!(style.sources || {})["__geoleaf_basemap__"];
            },
            { timeout: 30000 }
        );
    } catch {
        painted = false;
    }

    // ── Second wait, and it is NOT redundant ─────────────────────────────────────────────
    // "Layers painted" is NOT "app revealed". The reveal runs on `geoleaf:app:ready`, which
    // fires AFTER the layers land, and the fade is a CSS transition on top of that. Measured:
    // t=0.5s → loader display:flex, app:ready not fired; t=3.5s → display:none. Sampling the
    // loader right after the paint wait reports a perfectly revealed app as "loader stuck".
    let revealed = true;
    try {
        await page.waitForFunction(
            () => {
                const el = document.getElementById("gl-loader");
                return !el || getComputedStyle(el).display === "none";
            },
            { timeout: 15000 }
        );
    } catch {
        revealed = false;
    }

    const state = await page.evaluate(() => {
        const gl = window.GeoLeaf;
        const native = gl?.Core?.getMap?.()?.getNativeMap?.();
        const style = native?.getStyle?.() || { layers: [], sources: {} };
        return {
            health: gl?.getHealth?.() ?? null,
            preBootSurface: window.__preBootSurface || [],
            tableLabel: gl?.I18n?.getLabel?.("table.toolbar.button") ?? null,
            guard: !!(gl?.plugins && gl?.registry && gl?.I18n),
            profileLayers: (style.layers || []).filter(
                (l) => l.id.startsWith("gl-") && l.id !== "gl-sentinel-poi"
            ).length,
            hasBasemapSource: !!(style.sources || {})["__geoleaf_basemap__"],
            canvases: document.querySelectorAll("canvas").length,
            marks: performance.getEntriesByType("mark").map((m) => m.name),
            // PROBE PITFALL (cost one false "regression"): the loader is NOT left faded at
            // opacity 0. `init-reveal.ts:69-84` adds `.gl-loader--fade`, then sets
            // `display = "none"` on `transitionend` (with a timeout fallback). On a
            // display:none element `getComputedStyle().opacity` does NOT report "0", so an
            // opacity check fails on a perfectly revealed app. Assert the END STATE.
            loaderGone: (() => {
                const el = document.getElementById("gl-loader");
                if (!el) return true;
                return getComputedStyle(el).display === "none";
            })(),
        };
    });

    console.log("── Assertions ──");

    // 1 — the literal oracle of S4
    const h = state.health;
    check(
        "APIController sain (l'oracle de S4)",
        !!h && h.managersCount === 3 && h.isInitialized === true && h.hasModuleAccess === true,
        JSON.stringify(h)
    );

    // 2 — pre-boot surface, in the real browser
    const missing = IMPORT_SURFACE_MIN.filter((k) => !state.preBootSurface.includes(k));
    check(
        `surface pré-boot ⊇ contrat (${state.preBootSurface.length} clés)`,
        state.preBootSurface.length > 0 && missing.length === 0,
        missing.length ? `manquantes: ${missing.join(", ")}` : "aucune capture"
    );

    // 3 — the canary: an eager plugin's dictionary survived
    check(
        "dictionnaire du plugin table résolu (canari 46cd88dc)",
        state.tableLabel === "Tableau",
        `getLabel('table.toolbar.button') = ${JSON.stringify(state.tableLabel)}`
    );

    // 4 — init.js:33 guards the WHOLE plugin IIFE
    check("garde-fou init.js:33 (plugins/registry/I18n)", state.guard === true);

    // 5 — the map is actually PAINTED (what no other tier sees)
    check(
        `carte peinte : ${state.profileLayers} couches profil + basemap`,
        painted && state.profileLayers > 0 && state.hasBasemapSource,
        `layers=${state.profileLayers} basemap=${state.hasBasemapSource}`
    );

    // 6 — no duplicate canvas (recreate leak)
    check(`un seul canvas (${state.canvases})`, state.canvases === 1);

    // 7 — real mark order (impossible outside a browser)
    const bootMarks = state.marks.filter((m) => m.startsWith("geoleaf:"));
    const idx = (n) => bootMarks.indexOf(n);
    const ordered =
        idx("geoleaf:boot:loadConfig:start") >= 0 &&
        idx("geoleaf:boot:loadConfig:start") < idx("geoleaf:boot:loadConfig:end") &&
        idx("geoleaf:boot:loadConfig:end") < idx("geoleaf:boot:registry:start") &&
        idx("geoleaf:boot:registry:start") < idx("geoleaf:boot:registry:end");
    check(`ordre des marqueurs perf (${bootMarks.length} marks)`, ordered, bootMarks.join(" < "));

    // 7bis — the mapCreate marks EXIST and bracket map creation.
    //
    // ⚠️ Added at R.42 (backlog résiduel S5) after a mutation showed assertion 7 could not
    // see them. `archives/rapport_extraction-core-map-module.md` §2.4 states that these two
    // marks are "invisibles au golden-master vitest — seul le probe navigateur les asserte", and
    // makes that the reason the extraction requires a browser run. That was FALSE: check 7
    // only ever named the `boot:loadConfig` / `boot:registry` marks, so deleting
    // `geoleaf:init:mapCreate:end` outright left the probe at 10/10 (it merely printed
    // "17 marks" instead of 18). Nothing anywhere asserted them — the plan's whole
    // validation premise rested on an oracle that could not fail.
    //
    // Presence is asserted separately from order on purpose: an ordering test over a set
    // that does not contain the marks is vacuously true, which is exactly how the hole
    // stayed open. Proven by mutation in both directions before being trusted.
    const mapCreateOrdered =
        idx("geoleaf:init:mapCreate:start") >= 0 &&
        idx("geoleaf:init:mapCreate:end") >= 0 &&
        idx("geoleaf:init:mapCreate:start") < idx("geoleaf:init:mapCreate:end") &&
        idx("geoleaf:boot:registry:start") < idx("geoleaf:init:mapCreate:start");
    check(
        "marks mapCreate présents et encadrant la création de carte",
        mapCreateOrdered,
        `start=${idx("geoleaf:init:mapCreate:start")} end=${idx("geoleaf:init:mapCreate:end")}`
    );

    // 8 — loud regressions
    check(
        "0 erreur JS",
        pageErrors.length === 0 && consoleErrors.length === 0,
        [...pageErrors, ...consoleErrors].slice(0, 3).join(" | ")
    );

    // 9 — the app revealed
    check("loader retiré (app révélée)", revealed && state.loaderGone === true);

    // 10 — artefacts loaded
    check("0 réponse HTTP >= 400", badResponses.length === 0, badResponses.slice(0, 3).join(" | "));

    await browser.close();

    const failed = results.filter((r) => !r.ok);
    console.log(
        `\n${failed.length === 0 ? "✅" : "❌"} ${results.length - failed.length}/${results.length} assertions\n`
    );
    return failed.length === 0 ? 0 : 1;
};

run().then(
    (code) => process.exit(code),
    (err) => {
        console.error("\n❌ Sonde en erreur :", err?.message || err);
        process.exit(1);
    }
);
