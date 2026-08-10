// @ts-check
// E2E: 15-file-import (@geoleaf-plugins/file-import) — deploy-core (port 8766), PARESSEUX.
//
// Sprint S9 (plugin-validation). ⚠️ Cet en-tête a dit « EAGER … no `plugins.load` needed »
// jusqu'au 07/08/2026 : socle-init S4.5 a retiré sa balise <script> d'index.html (17,9 Ko gz).
// API pure, sans écouteur ni créneau — le consommateur la charge, comme le fait cette suite.
//
// The plugin is API-only (no UI, no toolbar, no config). The host app wires a file
// input → GeoLeaf.FileImport. This spec reproduces that: it injects a hidden
// <input type=file>, drives it with real on-disk fixtures via setInputFiles, and
// exercises the two public journeys:
//   - convert(file)         → {data: FeatureCollection, warnings}  (CDC Parcours 2)
//   - importAsLayer(file)   → GeoLeaf.GeoJSON.addData → map layer   (CDC Parcours 1)
//
// The 6 fixtures (e2e/fixtures/sample.*) exercise every converter through the REAL
// deployed bundle (DOMParser GPX, @tmcw/togeojson KML, fflate KMZ, papaparse
// CSV/TSV, topojson-client). sample.kmz is a binary ZIP built by fixtures/_gen-kmz.cjs.
//
// NOTE: deploy-core ships a PWA service worker → serviceWorkers:'block'. Run after
// `npm run build:deploy:all`.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

const INPUT_ID = "__e2e_fi";
const FIX = (name) => path.join(__dirname, "fixtures", name);

// deploy-core registers a PWA service worker; under serviceWorkers:'block' that
// registration fails with a benign console error unrelated to the plugin. Filter
// it out so the assertion still catches any *plugin* console error.
const SW_NOISE = /SWRegister|ServiceWorker|serviceworker/i;
const pluginErrors = (arr) => arr.filter((t) => !SW_NOISE.test(t));

/**
 * Navigates, waits for the state the journey ACTUALLY uses, injects the integrator file
 * input, LOADS the lazy FileImport plugin, and returns the page-error + console-error
 * collectors.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ waitForMap?: boolean }} [opts] `waitForMap` n'est vrai que pour le SEUL parcours
 *   qui touche la carte (`importAsLayer`). Partout ailleurs, l'attendre n'est pas neutre —
 *   voir le bloc ci-dessous : c'est elle qui rendait les `convert()` instables.
 */
async function boot(page, { waitForMap = false } = {}) {
    const errors = [];
    const consoleErrors = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    await page.goto("/");
    // Garde de page (la div est dans le markup) — pas une attente d'état : elle échoue vite
    // si le document servi n'est pas l'application, et ne dit rien de ce qui a booté.
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });

    // ⚠️ ATTENDRE L'ÉTAT UTILISÉ — LE RÉSOLVEUR PARESSEUX — ET SURTOUT PAS LA CARTE.
    //
    // Ce qui était attendu ici jusqu'au 08/08/2026 : `native.loaded()`, puis `#gl-loader`
    // masqué. Les deux sont des PROXYS, et le premier ment sur son nom. Mesuré sur ce
    // déployé (21 chargements) : `loaded()` rend `true` dès ~130-230 ms sur un style qui
    // porte 0 à 3 couches SUR 18 et ZÉRO écouteur `error` — c'est-à-dire sur une carte
    // VIDE, avant même `geoleaf:app:ready` (~250-440 ms). `SourceCache.loaded()` est vrai
    // quand aucune tuile n'est encore demandée : « chargée » y veut dire « rien à charger ».
    // Le second, lui, se termine par `.catch(() => {})` : il ne garantit rien du tout, il
    // ATTEND — ~1,1 s des ~1,3 s que ce boot coûtait, par accident.
    //
    // Or `convert()` ne touche PAS la carte : c'est une API pure (cf. l'en-tête de ce
    // fichier). L'état dont elle dépend est le résolveur `file-import`, enregistré par
    // l'IIFE d'`init.js` AVANT `GeoLeaf.boot()` — donc avant que la carte existe. Attendre
    // la carte, c'était attendre plus tard et moins bien.
    //
    // 🛑 ET CE N'EST PAS QU'UNE PERTE DE TEMPS — c'est ce qui faisait rougir ce test.
    // `boot({ config })` applique le fond de plan EN DERNIER (`setBaseLayer:
    // terrain-terrarium`, puis `Terrain 3D activated`, dernières lignes du boot). Le profil
    // `tourism` tire ses tuiles de TIERS : `*.tile.opentopomap.org`, `s3.amazonaws.com`
    // (DEM terrarium), `earthquake.usgs.gov`. Premier tir tiers mesuré à ~390-660 ms, rafale
    // de ~30 requêtes ensuite. Les trois `toEqual([])` de ce fichier concluaient donc sur une
    // fenêtre qui CONTIENT du réseau tiers — et Chromium journalise ses échecs réseau en
    // `console.error` (« Failed to load resource: net::ERR_… »), qu'aucun écouteur applicatif
    // ne peut intercepter. Mesuré : 2 chargements sur 25 en ont produit, sans le moindre
    // défaut du plugin. En suite complète ces hôtes encaissent ~213 chargements — c'est
    // l'état partagé que l'isolation par contexte de Playwright ne voit pas, parce qu'il est
    // HORS du navigateur, et c'est pourquoi ce test ne tombe jamais isolément.
    //
    // Mesure du geste (6 runs par bras, même poste, même cible) : la fenêtre passe de
    // ~1 300 ms à ~230 ms, et de 1-10 requêtes tierces émises avant la conclusion à 0-1.
    // Ce n'est pas « un délai plus court » — c'est un ORDRE : le résolveur est posé par
    // l'IIFE d'`init.js`, qui court avant `GeoLeaf.boot()`, donc avant qu'un fond de plan
    // puisse exister. Ne PAS remettre l'attente carte ici « par sécurité » : c'est elle
    // qu'on retire.
    await page.waitForFunction(
        () => {
            const p = /** @type {any} */ (window).GeoLeaf?.plugins;
            return (
                typeof p?.load === "function" &&
                typeof p?.getAvailableModules === "function" &&
                p.getAvailableModules().includes("file-import")
            );
        },
        null,
        { timeout: 20000 }
    );

    if (waitForMap) {
        // Réservé au parcours `importAsLayer`, qui LIT la carte (`getStyle()`, delta de
        // sources). Attentes et ordre inchangés pour lui — seul son domicile change.
        await page.waitForFunction(
            () => {
                const m = /** @type {any} */ (window).GeoLeaf?.Core?.getMap?.()?.getNativeMap?.();
                return !!m && typeof m.loaded === "function" && m.loaded();
            },
            null,
            { timeout: 15000 }
        );
        await page
            .locator("#gl-loader")
            .waitFor({ state: "hidden", timeout: 10000 })
            .catch(() => {});
    }
    // The plugin is API-only — the host app provides the file input. Inject one.
    await page.evaluate((id) => {
        if (document.getElementById(id)) return;
        const inp = document.createElement("input");
        inp.type = "file";
        inp.id = id;
        inp.style.cssText = "position:fixed;left:-9999px;top:0";
        document.body.appendChild(inp);
    }, INPUT_ID);
    // socle-init S4.5 — `file-import` n'est plus eager (17,9 Ko gz retirés du premier
    // chargement). API pure, sans écouteur ni créneau : le consommateur la charge.
    //
    // Ce `await` suffit, et il n'appelle pas d'attente supplémentaire sur `GeoLeaf.FileImport` :
    // `entry.ts` monte le namespace À L'ÉVALUATION du module, donc le `import()` que
    // `PluginRegistry.load()` attend ne résout QU'APRÈS le montage. Une attente de plus ici
    // serait décorative — et ce fichier n'en veut pas.
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.plugins.load("file-import"));
    return { errors, consoleErrors };
}

/** Sets the fixture on the injected input and runs convert() with the real File. */
async function convertFixture(page, fileName) {
    await page.setInputFiles("#" + INPUT_ID, FIX(fileName));
    return page.evaluate(async (id) => {
        const f = /** @type {any} */ (document.getElementById(id)).files[0];
        const r = await /** @type {any} */ (window).GeoLeaf.FileImport.convert(f);
        const feats = (r && r.data && r.data.features) || [];
        return {
            name: f.name,
            count: feats.length,
            warnings: r.warnings || [],
            types: [...new Set(feats.map((x) => x.geometry && x.geometry.type))],
        };
    }, INPUT_ID);
}

// ── Boot & API surface ──────────────────────────────────────────────────────────

test("charge à la demande : GeoLeaf.FileImport présent, 6 formats, 0 erreur console", async ({
    page,
}) => {
    const { errors, consoleErrors } = await boot(page);
    const api = await page.evaluate(() => {
        const fi = /** @type {any} */ (window).GeoLeaf.FileImport;
        return {
            present: typeof fi === "object" && fi !== null,
            methods: [
                "convert",
                "importAsLayer",
                "getSupportedFormats",
                "registerConverter",
            ].filter((m) => typeof fi[m] === "function"),
            formats: fi.getSupportedFormats(),
        };
    });
    expect(api.present).toBe(true);
    expect(api.methods).toHaveLength(4);
    expect(api.formats).toEqual(
        expect.arrayContaining([".gpx", ".kml", ".kmz", ".csv", ".tsv", ".topojson"])
    );
    expect(errors).toEqual([]);
    expect(pluginErrors(consoleErrors)).toEqual([]);
});

// ── convert() per format — real conversion through the deployed bundle ───────────

const CASES = [
    { file: "sample.gpx", minCount: 2, types: ["Point", "LineString"] },
    { file: "sample.kml", minCount: 2, types: ["Point", "LineString"] },
    { file: "sample.csv", minCount: 2, types: ["Point"] },
    { file: "sample.tsv", minCount: 2, types: ["Point"] },
    { file: "sample.topojson", minCount: 2, types: ["Point"] },
    { file: "sample.kmz", minCount: 2, types: ["Point", "LineString"] },
];

for (const c of CASES) {
    test(`convert(${c.file}) → GeoJSON features through the real bundle`, async ({ page }) => {
        const { errors, consoleErrors } = await boot(page);
        const res = await convertFixture(page, c.file);
        console.log("CONVERT", JSON.stringify(res));
        expect(res.count).toBeGreaterThanOrEqual(c.minCount);
        for (const t of c.types) expect(res.types).toContain(t);
        expect(res.warnings).toEqual([]);
        expect(errors).toEqual([]);
        expect(pluginErrors(consoleErrors)).toEqual([]);
    });
}

// ── importAsLayer() — CDC Parcours 1 (map rendering), S9 correctif ───────────────
//
// S9 correctif: importAsLayer() renders through the core map adapter
// (GeoLeaf.Core.getMap().addGeoJSONLayer) — the working MapLibre path the core layer
// loader uses — instead of the dead GeoLeaf.GeoJSON.addData (a no-op:
// `state.geoJsonLayer` is never instantiated). It now returns a layer id, creates a
// `gl-src-<id>` source + sub-layers on the native map, and no longer logs "Module
// not initialized". (The layer renders but is NOT registered in the layer-manager
// panel — that path is core-internal.) See CDC §Correctif S9.

test("importAsLayer(sample.kml): renders a GeoJSON layer on the map (S9 correctif)", async ({
    page,
}) => {
    // `waitForMap: true` — LE SEUL parcours du fichier qui lit la carte (delta de sources,
    // `getStyle()`), donc le seul qui doit l'attendre. Les attentes sont celles que `boot()`
    // imposait à tout le monde avant le 08/08/2026 ; elles n'ont pas changé, elles ont
    // seulement rejoint le test qui en a besoin.
    const { errors } = await boot(page, { waitForMap: true });
    const warns = [];
    page.on("console", (msg) => {
        if (msg.type() === "warning" || msg.type() === "error") warns.push(msg.text());
    });
    await page.setInputFiles("#" + INPUT_ID, FIX("sample.kml"));
    const res = await page.evaluate(async (id) => {
        const map = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
        const beforeSources = Object.keys(map.getStyle().sources).length;
        const beforeLayers = map.getStyle().layers.length;
        const f = /** @type {any} */ (document.getElementById(id)).files[0];
        let layerId;
        let err;
        try {
            layerId = await /** @type {any} */ (window).GeoLeaf.FileImport.importAsLayer(f, {
                layerName: "e2e-kml",
            });
        } catch (e) {
            err = String((e && e.message) || e);
        }
        await new Promise((r) => setTimeout(r, 300));
        const src = layerId ? map.getSource("gl-src-" + layerId) : null;
        const serialized = src && src.serialize ? src.serialize() : null;
        const data = serialized && serialized.data;
        return {
            layerId,
            err,
            sourceDelta: Object.keys(map.getStyle().sources).length - beforeSources,
            layerDelta: map.getStyle().layers.length - beforeLayers,
            hasSource: !!src,
            featureCount: data && data.features ? data.features.length : null,
        };
    }, INPUT_ID);
    console.log("IMPORTASLAYER", JSON.stringify(res), "WARNS", JSON.stringify(warns));
    expect(res.err).toBeUndefined();
    expect(errors).toEqual([]);
    // The fix: a real GeoJSON layer is rendered on the map.
    expect(typeof res.layerId).toBe("string");
    expect(res.layerId.length).toBeGreaterThan(0);
    expect(res.hasSource).toBe(true);
    expect(res.sourceDelta).toBe(1);
    expect(res.layerDelta).toBeGreaterThanOrEqual(1);
    expect(res.featureCount).toBe(2);
    // The dead-path guard must NOT fire anymore.
    expect(warns.some((w) => /GeoJSON\] Module not initialized/.test(w))).toBe(false);
});
