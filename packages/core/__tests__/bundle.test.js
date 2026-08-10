/**
 * Tests de validation du bundle Rollup
 * Verifies que les bundles generated contiennent les modules attendus
 * et que les files deprecated ne are no longer used.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { measureEagerBootAt } = require("../../../scripts/check-bundle-size.cjs");

const DIST = path.join(__dirname, "..", "dist");

describe("Bundle Rollup — core (geoleaf.esm.js)", () => {
    let bundleContent;
    let boot;
    const bundlePath = path.join(DIST, "geoleaf.esm.js");

    // The assertions below must read the BOOT PAYLOAD — the entry plus the chunks it imports
    // statically — not the entry file alone.
    //
    // They used to read the entry, and they silently stopped meaning anything when
    // `kernel-exports.ts` (S4) moved its content into chunks: the entry is now a ~1 KB re-export
    // shim, so `size > 100 KB` and every `GeoLeaf.<ns>` check had been failing on perfectly
    // healthy builds ever since. Same disease as the old BUNDLE_WARN_GZ_KB and as
    // `smoke-test.cjs` (both fixed in S5; this file was missed): a threshold pointed at an
    // artifact that had ceased to be the payload. Measure the closure — that is what the
    // browser downloads.
    //
    // NB: this file greps the bundle as TEXT — it never evaluates it. Executing the artefact is
    // `bundle-boot-contract.test.js`, the tier that catches what source-level tests cannot.
    beforeAll(() => {
        if (!fs.existsSync(bundlePath)) return;
        boot = measureEagerBootAt(bundlePath, DIST);
        bundleContent = [bundlePath, ...(boot?.chunkFiles ?? [])]
            .map((f) => fs.readFileSync(f, "utf8"))
            .join("\n");
    });

    test("le file dist/geoleaf.esm.js existe", () => {
        expect(fs.existsSync(bundlePath)).toBe(true);
    });

    test("l'entrée importe bien des chunks statiques (elle est un shim depuis S4)", () => {
        expect(boot).not.toBeNull();
        expect(boot.chunks).toBeGreaterThan(0);
    });

    test("la charge au boot n'est pas vide (> 100 KB raw)", () => {
        expect(boot.raw).toBeGreaterThan(100);
    });

    // ─── Namespaces core ────────────────────────────────────────
    // `GeoLeaf.POI` is NOT in this list, and must not come back: the POI namespace was dissolved
    // in S9 (its behaviour is now spread across the taxonomy / feature-info / cluster capabilities).
    // `EXPECTED_FACADE_KEYS` in __tests__/app/boot-golden-master.test.js is the exhaustive,
    // runtime-checked source of truth for the facade surface; this list is a coarse text check on
    // the artifact, and it had been asserting a namespace deliberately removed a sprint earlier.
    test.each([
        "GeoLeaf.Config",
        "GeoLeaf.GeoJSON",
        "GeoLeaf.Legend",
        "GeoLeaf.UI",
        "GeoLeaf.Log",
        "GeoLeaf.Security",
        "GeoLeaf.Utils",
        "GeoLeaf.Labels",
        "GeoLeaf.ThemeSelector",
        "GeoLeaf.PWA",
        "GeoLeaf.Permalink",
        "GeoLeaf.events",
    ])("contient le namespace %s", (ns) => {
        // The CDN bundle is minified: the `GeoLeaf` namespace object is aliased to a
        // local variable, so boot-time registrations appear as `gl.Log=…` and the
        // un-minified literal (e.g. `GeoLeaf.Log`) is absent for namespaces that are
        // only *written* during boot — not also read back elsewhere via the literal
        // path (Config/POI/UI… still appear literally because consumer code reads
        // `GeoLeaf.X`). Accept either form — same minification rationale as the
        // `GeoLeaf.boot` test below. Presence is verified at runtime by globals/*.test.
        const member = ns.slice("GeoLeaf.".length);
        const hasLiteral = bundleContent.includes(ns);
        const hasMemberAssign = new RegExp(`\\.${member}\\s*=`).test(bundleContent);
        expect(hasLiteral || hasMemberAssign).toBe(true);
    });

    // ─── GeoLeaf.boot() ────────────────────────────────────────
    test("expose GeoLeaf.boot()", () => {
        expect(bundleContent).toContain("GeoLeaf.boot");
        // The CDN bundle is minified, so the GeoLeaf namespace object is aliased
        // (e.g. `Q.boot=function`) and the un-minified literal "GeoLeaf.boot = function"
        // is absent. Assert the boot function assignment survived (property `.boot`
        // assigned a function), whitespace-tolerant. The un-minified source shape is
        // verified separately against app/boot.ts below.
        expect(bundleContent).toMatch(/\.boot\s*=\s*function/);
    });

    // ─── Pas de spinners/loaders deprecated ─────────────────────
    test("ne contient PAS le code de EarlyLoader (early-loader.js)", () => {
        expect(bundleContent).not.toContain("gl-early-loader");
        expect(bundleContent).not.toContain("EarlyLoader");
    });

    test("ne contient PAS le code de LoadingScreen (loading-screen.js)", () => {
        expect(bundleContent).not.toContain("_glLoadingScreen.show");
        expect(bundleContent).not.toContain("LoadingScreen.show");
    });

    // ─── Pas de modules Storage/AddPOI in the core ────────────
    test("does not contain Storage imports (separate plugin)", () => {
        // Le core peut reference GeoLeaf.Storage par des guards,
        // mais ne doit PAS contenir l'implementation IndexedDB
        expect(bundleContent).not.toContain("openDatabase");
        expect(bundleContent).not.toContain("indexedDB.open");
    });

    test("does not contain AddPOI form imports (separate plugin)", () => {
        expect(bundleContent).not.toContain("add-form-orchestrator");
        expect(bundleContent).not.toContain("AddFormOrchestrator");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The core's dist is the CORE's product — nothing else.
//
// This describe replaces two that used to assert on `dist/geoleaf-offline-ui.plugin.js` and
// `dist/geoleaf-addpoi.plugin.js`, built HERE by two extra configs in rollup.config.mjs. Those
// were a second, divergent build of two plugins that already build themselves in their own
// packages, and nobody consumed them: build-deploy.cjs copies the REAL artefacts from
// `packages/plugin-*/dist/`. They only ever did damage — `files: ["dist/", …]` shipped ~660 KB
// of plugin code inside the public @geoleaf/core npm package, and they
// were built with the CSP-violating `styleInject` the rest of the repo had already migrated off.
//
// The configs are deleted. This is the anti-regression gate: the day someone re-adds a plugin
// build to the core's rollup, the npm package silently re-inflates and re-leaks. Fail loudly
// instead. The plugin CONTENT assertions moved to where the artefact actually lives, and where
// they therefore gate something: packages/plugin-{storage,addpoi}/__tests__/bundle.test.js.
describe("dist/ du core — aucun artefact plugin", () => {
    test("dist/ ne contient AUCUN geoleaf-*.plugin.js", () => {
        const leaked = fs
            .readdirSync(DIST)
            .filter((f) => /^geoleaf-.+\.plugin\.js(\.map)?$/.test(f));

        expect(leaked).toEqual([]);
    });
});

// (T2) The "Demo bootstrap moderne" describe lived here and read
// `__dirname/../index.html` and `../init.js` — a test of the LIBRARY reaching into the
// APPLICATION, which is the coupling T2 exists to remove. Both assertions moved to
// `scripts/verify-app-template.cjs` (APP-01/APP-02), which also added three invariants
// nothing guarded before: the icon path the deploy rewrite depends on, and the
// single-line shape of the `Optional plugins` comment and of the gated plugin <script>
// tags, all three patched by `/gm` regexes with no `/s` flag.

describe("boot pipeline (app/boot.ts) — structure", () => {
    // The legacy single-file src/geoleaf.app.js was split into the modern boot pipeline:
    // app/boot.ts, app/init-reveal.ts (reveal / map:ready / loader, S6.2) and app/app-namespace.ts
    // (checkPlugins warnings). `app/init.ts` — the legacy `initApp()` test-only facade that
    // just delegated to CoreMapModule/SharedModule/UIModule — was removed (roadmap nettoyage
    // Sprint 3 / A-1); those module classes are exercised directly by the config-contract
    // test suite (s10/s11/s15) instead.
    //
    // Since the presets chantier, `boot.ts` is "a binding, not a boot" (its own words): the
    // `GeoLeaf.boot()` facade is created by `boot-install.ts#installBoot(preset)` (S4) and the
    // boot sequence lives in `boot-core.ts#bootWithPreset()` (S3). All boot.ts still does is bind
    // the shipped manifest. So that is where the facade must be asserted.
    let bootContent;
    let bootInstallContent;
    let revealContent;
    let helpersContent;

    beforeAll(() => {
        const appDir = path.join(__dirname, "..", "src", "app");
        bootContent = fs.readFileSync(path.join(appDir, "boot.ts"), "utf8");
        bootInstallContent = fs.readFileSync(path.join(appDir, "boot-install.ts"), "utf8");
        revealContent = fs.readFileSync(path.join(appDir, "init-reveal.ts"), "utf8");
        helpersContent = fs.readFileSync(path.join(appDir, "app-namespace.ts"), "utf8");
    });

    test("boot.ts se contente de lier le manifeste livré (FULL) à installBoot", () => {
        expect(bootContent).toContain("installBoot");
        expect(bootContent).toContain("FULL");
    });

    test("installBoot() pose la façade GeoLeaf.boot", () => {
        expect(bootInstallContent).toMatch(/\bboot\s*[:=]/);
        expect(bootInstallContent).toContain("installBoot");
    });

    test("startApp() n'est pas auto-exécuté hors de boot()", () => {
        // startApp is invoked only via _app.startApp() inside the boot flow,
        // never as a bare top-level startApp(); call (legacy auto-exec pattern).
        expect(bootContent).not.toMatch(/^\s*startApp\(\)\s*;?\s*$/m);
    });

    test("ne contient PAS de _glLoadingScreen (pattern legacy)", () => {
        expect(bootContent).not.toContain("_glLoadingScreen");
    });

    test("ne contient PAS de setInterval (pas de polling loader)", () => {
        expect(bootContent).not.toContain("setInterval");
    });

    test("dispatche geoleaf:map:ready", () => {
        expect(revealContent).toContain("geoleaf:map:ready");
    });

    test("masque le #gl-loader", () => {
        expect(revealContent).toContain('getElementById("gl-loader")');
    });

    // ⚠️ 5.1-f — l'assertion sur « AddPOI plugin is not loaded » est RETIRÉE, pas relâchée :
    // la garde qu'elle observait n'existe plus. Elle conseillait d'inclure un fichier
    // (`geoleaf-addpoi.plugin.js`) qui n'est plus produit, et son motif est tombé avec le
    // modèle qu'elle supposait : le bouton d'ajout de POI passe désormais par un créneau
    // PARESSEUX, dont l'absence de plugin au boot est un état NORMAL et non un défaut.
    // ⚠️ La garde `storage` reste, et c'est elle qui porte le sens du test : un bloc de
    // config qui référence un plugin absent doit se voir. Le cas `editor` n'a pas
    // d'équivalent — il n'y a pas de bloc `modules.editor` obligatoire.
    test("verifies les plugins manquants", () => {
        expect(helpersContent).toContain("checkPlugins");
        expect(helpersContent).toContain("Storage plugin is not loaded");
    });
});
