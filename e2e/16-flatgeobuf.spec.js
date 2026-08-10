// @ts-check
// E2E: 16-flatgeobuf (@geoleaf-plugins/flatgeobuf) — deploy-core (port 8766), PARESSEUX.
//
// Sprint S10 (plugin-validation). ⚠️ Cet en-tête a dit « EAGER … no `plugins.load` needed »
// jusqu'au 07/08/2026 : socle-init S4.5 a retiré sa balise <script> (13,6 Ko gz). DEUX chemins
// depuis : une couche de profil qui déclare `"plugin": "flatgeobuf"` est servie sans aucun load,
// par la couture `ensurePluginLoaded` du core ; l'API appelée directement se charge à la main.
//
// ⚠️ UN SEUL jeu de données depuis le 27/07/2026 (B-42) : `tourism eco_regions.fgb`.
//
// Cette spec exerçait DEUX fichiers — `eco_regions.fgb` pour le chargement complet, et
// `france-rail zones_desserte.fgb` (~5 Ko) pour bbox + Range + autoRefresh. Le profil
// `france-rail` faisait partie des 6 démos retirées : la spec cherchait un fichier absent du
// déployé. Tout est reporté sur `eco_regions.fgb`, ce qui est possible parce que l'index
// R-tree et les requêtes partielles sont des propriétés du FORMAT, pas de ce fichier-là.
//
// Ce que la conversion coûte, dit franchement : le fichier fait ~1 Mo au lieu de ~5 Ko, donc
// les tests bbox/Range/autoRefresh transfèrent davantage — plus lents, pas moins probants. Et
// le test de dispatch déclaratif perd la variante « config portant un bbox » : la couche
// `eco_regions_fgb` de `tourism` n'en déclare pas. `loadBbox` reste couvert par ses propres
// tests, en passant le bbox en mémoire.
//
// Coverage:
//   - load()/loadBbox()  → FeatureCollection (data-only, was already conforme)
//   - HTTP Range 206     → bbox mode issues Range requests (http-server replies 206)
//   - loadAsLayer/loadBboxAsLayer → render via adapter.addGeoJSONLayer  (S10 correctif A)
//   - autoRefresh        → moveend re-fetches (adapter.updateLayerData)
//   - declarative `plugin: "flatgeobuf"` profile layer → core dispatch  (S10 correctif B)
//
// NOTE: deploy-core ships a PWA service worker → serviceWorkers:'block'. Run after
// `npm run build:deploy:all`.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

// Deployed .fgb files (root-relative; made absolute in-page via location.origin).
const ECO_PATH = "/profiles/tourism/layers/eco_regions_fgb/data/eco_regions.fgb";

// Un bbox qui CONTIENT des entités, et un qui n'en contient aucune. Le premier reprend
// l'emprise déclarée par `profiles/tourism/profile.json` (`map.bounds`, Amérique du Sud) —
// pas une valeur inventée : si l'emprise du profil bougeait sans que ce bbox suive, le test
// dirait « 0 entité » et accuserait le plugin.
const DATA_BBOX = { minX: -73.5, minY: -55, maxX: -53.5, maxY: -21.78 };
// Atlantique nord : hors de l'emprise du profil, donc 0 entité par construction.
const OCEAN_BBOX = { minX: -40, minY: 20, maxX: -39, maxY: 21 };

const SW_NOISE = /SWRegister|ServiceWorker|serviceworker/i;
const pluginErrors = (arr) => arr.filter((t) => !SW_NOISE.test(t));

/** Primes the profile selected at boot (read from sessionStorage by boot.ts). */
async function selectProfile(page, profileId) {
    await page.addInitScript((id) => {
        try {
            sessionStorage.setItem("gl-selected-profile", id);
        } catch (e) {
            console.warn("[e2e] sessionStorage unavailable:", e);
        }
    }, profileId);
}

/**
 * Navigates, waits for the map, LOADS the lazy FlatGeobuf plugin, and returns the
 * page-error, console-error and `.fgb` network-response collectors.
 */
async function boot(page) {
    const errors = [];
    const consoleErrors = [];
    const fgbResponses = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("response", (resp) => {
        if (resp.url().includes(".fgb"))
            fgbResponses.push({ url: resp.url(), status: resp.status() });
    });
    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
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
    // socle-init S4.5 — `flatgeobuf` n'est plus eager. ⚠️ DEUX chemins, à ne pas confondre :
    // une couche de profil qui déclare `"plugin": "flatgeobuf"` est servie SANS ce load, par
    // la couture `ensurePluginLoaded` du core (`globals.geojson.ts`) — c'est le chemin
    // produit, et le test « couche déclarative » plus bas l'exerce tel quel. Ce load-ci ne
    // sert qu'aux tests qui appellent `GeoLeaf.FlatGeobuf.*` DIRECTEMENT, sans passer par
    // une couche : eux sont dans la position d'un intégrateur qui pilote l'API à la main.
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.plugins.load("flatgeobuf"));
    return { errors, consoleErrors, fgbResponses };
}

// ── Boot & API surface ──────────────────────────────────────────────────────────

test("charge à la demande : GeoLeaf.FlatGeobuf présent, 5 fonctions, 0 erreur console", async ({
    page,
}) => {
    const { errors, consoleErrors } = await boot(page);
    const api = await page.evaluate(() => {
        const fgb = /** @type {any} */ (window).GeoLeaf.FlatGeobuf;
        return {
            present: typeof fgb === "object" && fgb !== null,
            methods: [
                "load",
                "loadBbox",
                "loadAsLayer",
                "loadBboxAsLayer",
                "loadLayerFromConfig",
            ].filter((m) => typeof fgb[m] === "function"),
        };
    });
    expect(api.present).toBe(true);
    expect(api.methods).toHaveLength(5);
    expect(errors).toEqual([]);
    expect(pluginErrors(consoleErrors)).toEqual([]);
});

// ── load() — full-file streaming through the real bundle ─────────────────────────

test("load() streams the full eco_regions.fgb to a FeatureCollection (HTTP 200)", async ({
    page,
}) => {
    const { errors, fgbResponses } = await boot(page);
    const res = await page.evaluate(async (path) => {
        const url = location.origin + path;
        const r = await /** @type {any} */ (window).GeoLeaf.FlatGeobuf.load(url);
        return { count: r.featureCount, type: r.data && r.data.type };
    }, ECO_PATH);
    console.log("LOAD", JSON.stringify(res));
    expect(res.type).toBe("FeatureCollection");
    expect(res.count).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    // Full-file load is a plain GET → 200 (not a Range request).
    expect(fgbResponses.some((r) => r.status === 200)).toBe(true);
});

// ── loadBbox() — spatial filtering via the R-tree index ──────────────────────────

test("loadBbox() filters spatially: france bbox > 0 features, ocean bbox = 0", async ({ page }) => {
    const { errors } = await boot(page);
    const res = await page.evaluate(
        async (args) => {
            const url = location.origin + args.path;
            const fgb = /** @type {any} */ (window).GeoLeaf.FlatGeobuf;
            const inFrance = await fgb.loadBbox(url, args.france);
            const inOcean = await fgb.loadBbox(url, args.ocean);
            return { france: inFrance.featureCount, ocean: inOcean.featureCount };
        },
        { path: ECO_PATH, france: DATA_BBOX, ocean: OCEAN_BBOX }
    );
    console.log("LOADBBOX", JSON.stringify(res));
    expect(res.france).toBeGreaterThan(0);
    expect(res.ocean).toBe(0);
    expect(errors).toEqual([]);
});

// ── HTTP Range 206 — proof the bbox mode does partial fetches ─────────────────────

test("loadBbox() triggers HTTP Range requests (206 Partial Content)", async ({ page }) => {
    const { fgbResponses } = await boot(page);
    await page.evaluate(
        async (args) => {
            const url = location.origin + args.path;
            await /** @type {any} */ (window).GeoLeaf.FlatGeobuf.loadBbox(url, args.france);
        },
        { path: ECO_PATH, france: DATA_BBOX }
    );
    await page.waitForTimeout(300);
    console.log("RANGE", JSON.stringify(fgbResponses));
    expect(fgbResponses.some((r) => r.status === 206)).toBe(true);
});

// ── loadAsLayer() — renders on the map via the adapter (S10 correctif A) ──────────

test("loadAsLayer() renders a GeoJSON layer on the map (S10 correctif A)", async ({ page }) => {
    const { errors } = await boot(page);
    const warns = [];
    page.on("console", (msg) => {
        if (msg.type() === "warning" || msg.type() === "error") warns.push(msg.text());
    });
    const res = await page.evaluate(async (path) => {
        const map = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
        const beforeSources = Object.keys(map.getStyle().sources).length;
        const beforeLayers = map.getStyle().layers.length;
        let layerId;
        let err;
        try {
            layerId = await /** @type {any} */ (window).GeoLeaf.FlatGeobuf.loadAsLayer(
                location.origin + path,
                { layerId: "e2e-eco", layerName: "e2e eco-regions", geometry: "polygon" }
            );
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
    }, ECO_PATH);
    console.log("LOADASLAYER", JSON.stringify(res), "WARNS", JSON.stringify(warns));
    expect(res.err).toBeUndefined();
    expect(res.layerId).toBe("e2e-eco");
    expect(res.hasSource).toBe(true);
    expect(res.sourceDelta).toBe(1);
    expect(res.layerDelta).toBeGreaterThanOrEqual(1);
    expect(res.featureCount).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    // The dead-path guard must NOT fire.
    expect(warns.some((w) => /GeoJSON\] Module not initialized/.test(w))).toBe(false);
});

// ── loadBboxAsLayer() + autoRefresh — render + re-fetch on viewport change ─────────

test("loadBboxAsLayer() renders, and autoRefresh re-fetches on moveend", async ({ page }) => {
    const { errors, fgbResponses } = await boot(page);
    const rendered = await page.evaluate(
        async (args) => {
            const map = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
            const layerId = await /** @type {any} */ (window).GeoLeaf.FlatGeobuf.loadBboxAsLayer(
                location.origin + args.path,
                args.france,
                { layerId: "e2e-zones", autoRefresh: true, debounceMs: 50 }
            );
            await new Promise((r) => setTimeout(r, 300));
            const src = map.getSource("gl-src-" + layerId);
            return { layerId, hasSource: !!src };
        },
        { path: ECO_PATH, france: DATA_BBOX }
    );
    expect(rendered.layerId).toBe("e2e-zones");
    expect(rendered.hasSource).toBe(true);

    const before = fgbResponses.length;
    // Programmatic camera move fires `moveend` (unlike synthetic mouse drag).
    await page.evaluate(() => {
        const map = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
        map.jumpTo({ center: [3.0, 46.5], zoom: 6 });
    });
    await page.waitForTimeout(800);
    console.log("AUTOREFRESH", "before", before, "after", fgbResponses.length);
    expect(fgbResponses.length).toBeGreaterThan(before);
    expect(errors).toEqual([]);
});

// ── Guards — invalid bbox / disallowed URL reject ─────────────────────────────────

test("rejects an invalid bbox and a disallowed URL", async ({ page }) => {
    await boot(page);
    const res = await page.evaluate(
        async (args) => {
            const fgb = /** @type {any} */ (window).GeoLeaf.FlatGeobuf;
            const out = { bboxErr: null, urlErr: null };
            try {
                await fgb.loadBbox(location.origin + args.path, {
                    minX: 5,
                    minY: 5,
                    maxX: 1,
                    maxY: 1,
                });
            } catch (e) {
                out.bboxErr = String((e && e.message) || e);
            }
            try {
                await fgb.load("ftp://example.com/data.fgb");
            } catch (e) {
                out.urlErr = String((e && e.message) || e);
            }
            return out;
        },
        { path: ECO_PATH }
    );
    expect(res.bboxErr).toMatch(/Invalid bbox/);
    expect(res.urlErr).toMatch(/Invalid or disallowed URL/);
});

// ── Declarative dispatch — profile `plugin: "flatgeobuf"` layer (S10 correctif B) ──
//
// Proves correctif B end-to-end on a REAL bundled profile: the core registers the
// plugin's layer loader (GeoLeaf.plugins.registerLayerLoader), and dispatching the
// `tourism` `eco_regions_fgb` declarative config (plugin:"flatgeobuf") through it renders
// the layer from the indexed .fgb — config → core dispatch → URL resolution → rendered source.
//
// ⚠️ Reporté de `france-rail zones_desserte` sur `tourism eco_regions_fgb` le 27/07/2026
// (B-42). La couche cible ne déclare **pas** de `bbox`, donc ce test ne couvre plus la
// variante « config déclarative PORTANT un bbox » — `loadBbox` reste couvert par ses tests
// dédiés, qui passent le bbox en mémoire. C'est la seule perte de couverture du report.
//
// NOTE (finding): the bundled-profile theme orchestration does not yet auto-trigger
// plugin-typed layers at boot (it spans the profile/theme/visibility loaders, each
// assuming a standard GeoJSON data URL). So this test invokes the registered dispatch
// loader directly — the exact function the core calls once a plugin layer reaches
// `_loadSingleLayer`. Auto-load wiring in the theme orchestration is a documented follow-up.

test("core's registered dispatch renders a declarative `plugin: flatgeobuf` config (tourism)", async ({
    page,
}) => {
    await selectProfile(page, "tourism");
    const { errors, consoleErrors, fgbResponses } = await boot(page);
    const res = await page.evaluate(async () => {
        const gl = /** @type {any} */ (window).GeoLeaf;
        const map = gl.Core.getMap().getNativeMap();
        // Pull the declarative config straight from the loaded profile.
        const prof = gl.Config.getActiveProfile();
        const lists = [
            prof && prof.layers,
            prof && prof.geojsonLayers,
            prof && prof.geojson && prof.geojson.layers,
            gl.Config.Profile && gl.Config.Profile.getActiveProfileLayersConfig
                ? gl.Config.Profile.getActiveProfileLayersConfig()
                : null,
        ];
        let cfg = null;
        for (const arr of lists) {
            if (Array.isArray(arr)) {
                const z = arr.find((l) => l && l.id === "eco_regions_fgb" && l.plugin);
                if (z) {
                    cfg = z;
                    break;
                }
            }
        }
        if (!cfg) return { error: "eco_regions_fgb config with plugin not found in profile" };
        const loader = gl.plugins.getLayerLoader("flatgeobuf");
        if (typeof loader !== "function") return { error: "no registered flatgeobuf layer loader" };
        const beforeSources = Object.keys(map.getStyle().sources).length;
        const id = await loader({ ...cfg, _profileId: "tourism" });
        // The loader resolves as soon as it has SCHEDULED the source; the .fgb is streamed
        // over HTTP Range requests, so `addSource` lands a variable number of ticks later.
        // A fixed sleep here made this test flake at ~50% (measured: 2 green / 2 red over 4
        // isolated runs, zero code change in between). Poll for the condition instead — the
        // assertion below is unchanged, only the deadline stops being arbitrary.
        const _deadline = Date.now() + 10000;
        while (!map.getSource("gl-src-" + id) && Date.now() < _deadline) {
            await new Promise((r) => setTimeout(r, 50));
        }
        const src = map.getSource("gl-src-" + id);
        const ser = src && src.serialize ? src.serialize() : null;
        const feats = ser && ser.data && ser.data.features ? ser.data.features.length : null;
        return {
            id,
            registered: true,
            hasPlugin: !!cfg.plugin,
            hasBbox: !!(cfg.data && cfg.data.bbox),
            hasSource: !!src,
            featureCount: feats,
            sourceDelta: Object.keys(map.getStyle().sources).length - beforeSources,
        };
    });
    console.log("DECLARATIVE", JSON.stringify(res));
    expect(res.error).toBeUndefined();
    expect(res.hasPlugin).toBe(true);
    // ⚠️ `false`, et c'est ASSERTÉ, pas contourné (B-42, 27/07/2026). Cette ligne exigeait
    // `true` : la config déclarative de `france-rail zones_desserte` portait un `bbox`. Celle
    // de `tourism eco_regions_fgb` n'en déclare pas. Affirmer `false` dit la forme RÉELLE de la
    // couche visée — retirer l'assertion aurait laissé le test muet sur ce point, et la mettre
    // à `true` demanderait de modifier un profil LIVRÉ pour satisfaire un test.
    expect(res.hasBbox).toBe(false);
    expect(res.id).toBe("eco_regions_fgb");
    expect(res.hasSource).toBe(true);
    expect(res.sourceDelta).toBe(1);
    expect(res.featureCount).toBeGreaterThan(0);
    // ⚠️ 200, pas 206 — et c'est la CONSÉQUENCE DIRECTE du report (B-42, 27/07/2026).
    // Cette ligne exigeait un 206 : la config déclarative de `france-rail` portait un `bbox`,
    // donc le chargement passait par des requêtes partielles. Celle de `tourism` n'en déclare
    // pas → chargement complet, statut 200. Assouplir en « 200 ou 206 » aurait rendu
    // l'assertion vraie dans les deux cas, donc incapable de distinguer un mode de l'autre :
    // on affirme le mode RÉEL de la couche visée. Le 206 reste couvert par le test
    // « loadBbox() triggers HTTP Range requests » plus haut, qui passe son bbox en mémoire.
    expect(fgbResponses.some((r) => r.status === 200)).toBe(true);
    expect(errors).toEqual([]);
    // Aucune erreur console propre à flatgeobuf. (La note sur le 404 de boot de `france-rail`
    // est tombée avec ce profil : `tourism` est celui que les autres tests de cette suite
    // exigent déjà sans aucune erreur console.)
    const fgbErrors = pluginErrors(consoleErrors).filter((t) => /flatgeobuf|fgb/i.test(t));
    expect(fgbErrors).toEqual([]);
});
