/**
 * @vitest-environment happy-dom
 *
 * Bundle boot contract — the ARTEFACT tier.
 *
 * This is the tier that did not exist, and its absence cost two reverts:
 *
 *   - `192c6865` (S4): `APIController` built at import with 0 managers. Caught by a browser
 *     E2E two hours later. The revert (`eae711fa`) names the reason: "build/vitest run on
 *     source, never the rollup bundle in a browser".
 *   - `46cd88dc` (S1.3): `GeoLeaf.I18n` no longer existed before `boot()`, so eager plugins
 *     lost their dictionaries SILENTLY. Caught weeks later by a human looking at the screen.
 *     That commit shipped with "10 446/10 446 green, golden-master byte-identical".
 *
 * Both pannes are import-time CONTRACT breaks of the built artefact. Neither needs a browser
 * to be caught — they need the real `dist/` bundle to be EVALUATED. `bundle.test.js` only
 * greps it as text; source-level unit tests never see the Rollup output at all. This file
 * closes that gap in ~1 second, with no HTTP server and no WebGL.
 *
 * What it guards, and why each assertion exists:
 *   1. IMPORT SURFACE — the keys present on `GeoLeaf` BEFORE any `boot()`. This is a distinct
 *      contract from the post-boot surface frozen by `boot-golden-master.test.js`; only the
 *      latter was ever frozen, which is precisely how `46cd88dc` shipped green.
 *   2. APIController HEALTH at import — the literal oracle of S4 (`managers: 0` is the panne).
 *      Unit tests are structurally blind here: the `_APIController` getter has no setter, so
 *      every existing test either `vi.mock`s the module away or overwrites the property.
 *   3. PLUGIN CONTRACT end-to-end — an eager plugin registering its dictionary at top-level.
 *      Reproduces the exact failure mode of `46cd88dc`: optional chaining means a missing
 *      anchor throws nothing, mounts the plugin anyway, and just loses the labels.
 *
 * Canary = `plugin-table` (flat dict, binary resolution). NOT `plugin-geocoding`: it registers
 * a NESTED dict and reads FLAT keys, so its labels never resolve — masked by a hardcoded
 * French fallback. That is a live bug (debt report §7 C-5), not a usable oracle.
 *
 * Requires a prior build (`turbo run build`) — hence `vitest.bundle.config.ts`, not the
 * standard run.
 */

import { describe, test, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
// ⚠️ Ce fichier tourne sous `vitest.bundle.config.ts`, dont le `root` est `packages/core` :
// l'import statique traverse cette frontière. Si `server.fs.allow` venait à le refuser, le
// repli est l'import dynamique `pathToFileURL(...)` + `/* @vite-ignore */`, patron déjà
// employé plus bas pour l'artefact lui-même.
import {
    walkNamespace,
    diffSurface,
    IMPORT_SURFACE,
    IMPORT_SURFACE_MIN,
    EXPECTED_FACADE_KEYS,
} from "../../../scripts/lib/namespace-surface.mjs";

const CORE_DIST = path.join(__dirname, "..", "dist");
const BUNDLE = path.join(CORE_DIST, "geoleaf.esm.js");
// ARCHI S10.1 — `../../plugin-table` désignait le voisin direct ; les plugins sont
// désormais sous `packages/plugins/`. Le chemin est reconstruit explicitement plutôt
// que dérivé du registre : ce fichier de test s'exécute sous Vite, qui externalise
// les specifiers nus, et charger un module CJS de `scripts/lib/` ici n'apporterait
// rien. L'assertion `existsSync` ci-dessous rend de toute façon la rupture bruyante
// — c'est elle qui a signalé ce chemin après le déplacement.
//
// ⚠️ R.15 (24/07/2026) — et elle l'a signalé une SECONDE fois, au retrait du préfixe
// `plugin-` des répertoires (`plugins/plugin-table` → `plugins/table`). Le pari du
// commentaire ci-dessus tient donc sur deux déplacements successifs : le chemin en
// dur est acceptable ICI précisément parce qu'un `existsSync` le garde. Sans cette
// assertion, le test aurait chargé `undefined` et serait passé au vert.
const TABLE_PLUGIN = path.join(
    __dirname,
    "..",
    "..",
    "plugins",
    "table",
    "dist",
    "geoleaf-table.plugin.js"
);

/** Absolute file:// import — bypasses Vite's alias/extension resolution so we load the REAL artefact. */
const importArtefact = (p) => import(/* @vite-ignore */ pathToFileURL(p).href);

/**
 * The PRE-BOOT facade surface, measured on the built bundle (not hand-written).
 *
 * Distinct from the 113-key post-boot surface frozen by `boot-golden-master.test.js`. Only the
 * post-boot one was ever frozen — which is exactly how `46cd88dc` shipped "golden-master
 * byte-identical" while having removed `GeoLeaf.I18n` from this very surface.
 *
 * A key LEAVING this list is a breaking change for every eager plugin. `d3477c2f` left the
 * generalised risk explicitly open ("any eager plugin calling GeoLeaf.notify()/
 * GeoLeaf.Utils.* at top-level could suffer the same silence — NOT audited"). Freezing the
 * whole surface closes it.
 *
 * Not a snapshot on purpose: `vitest -u` must not be able to rubber-stamp a regression here.
 * Update by hand, having read the diff.
 *
 * ── Baseline history ────────────────────────────────────────────────────────────────────────
 * S6 Lot 0: 64 keys — the pre-boot surface as S1.3 left it (only `globals.core.ts` ran its
 *           setups at import; the other five were lazy, and the rustine compensated).
 * S6 Lot 2: 88 keys — phase A restored. The five remaining globals now post their facades at
 *           import too. Measured diff on the built bundle: +24, **-0**. Every addition is a
 *           kernel facade that S1.3 had made lazy (`GeoJSON`, `ThemeCache`, `_GeoJSONLoader`,
 *           the `_LayerManager*` / `_UI*` / `_Theme*` families, `_OfflineDetector`, `_SWRegister`,
 *           `_StyleUtils`, `_WorkerManager`…). Nothing was lost — this is the fix, not drift.
 *           This test going red on that lot is the filet working: the contract DID change.
 *
 * KERNEL S6: 87 keys — `_StyleUtils` removed. Its sole member `normalizeStyle` had no
 *           production reader (the global was written by `globals.geojson.ts` and never
 *           read), so `built-in/geojson/style-utils.ts` was deleted outright. Internal
 *           `_`-prefixed surface, absent from the published typings → not a breaking change.
 */
// IMPORT_SURFACE vit désormais dans `scripts/lib/namespace-surface.mjs` (API S4.1),
// aux côtés des deux autres tiers — c'est ce qui rend `MIN ⊆ IMPORT ⊆ POST` assertable.

describe("Bundle boot contract — artefact tier", () => {
    let GeoLeaf;
    let importSurface;
    let healthAtImport;

    beforeAll(async () => {
        expect(fs.existsSync(BUNDLE), `missing ${BUNDLE} — run \`turbo run build\` first`).toBe(
            true
        );

        await importArtefact(BUNDLE);
        GeoLeaf = globalThis.GeoLeaf;

        // Captured BEFORE any plugin import — this is the pre-boot contract, and a plugin
        // would pollute it (plugin-table mounts `GeoLeaf.Table`).
        importSurface = walkNamespace(GeoLeaf).keys;
        healthAtImport = GeoLeaf.getHealth();

        // The canary: an eager plugin registering its dictionary at its own top-level,
        // exactly as a page does before calling GeoLeaf.boot().
        if (fs.existsSync(TABLE_PLUGIN)) await importArtefact(TABLE_PLUGIN);
    });

    // ── 1. Import surface ────────────────────────────────────────────────────────

    test("la surface d'import du bundle est exactement celle du contrat", () => {
        const d = diffSurface([...IMPORT_SURFACE].sort(), importSurface);
        expect(
            d.missing,
            `clés DISPARUES de la surface pré-boot : ${d.missing.join(", ")}`
        ).toEqual([]);
        expect(d.extra, `clés APPARUES sur la surface pré-boot : ${d.extra.join(", ")}`).toEqual(
            []
        );
        expect(importSurface).toEqual([...IMPORT_SURFACE].sort());
    });

    test("MIN ⊆ IMPORT ⊆ POST — les trois tiers ne peuvent plus diverger", () => {
        // L'assertion qui manquait. `requireMap` est resté dans IMPORT_SURFACE_MIN onze jours
        // après avoir quitté IMPORT_SURFACE, parce que le seul instrument qui l'aurait vu était
        // une sonde navigateur que personne ne lançait. Mécanisée ici, dans le tier statique,
        // elle ne dépend plus de la bonne volonté de quiconque.
        const horsImport = IMPORT_SURFACE_MIN.filter((k) => !IMPORT_SURFACE.includes(k));
        expect(horsImport, `dans MIN mais pas dans IMPORT : ${horsImport.join(", ")}`).toEqual([]);

        const horsPost = IMPORT_SURFACE.filter((k) => !EXPECTED_FACADE_KEYS.includes(k));
        expect(horsPost, `dans IMPORT mais pas dans POST : ${horsPost.join(", ")}`).toEqual([]);
    });

    test("les ancres pré-boot que les plugins eager consomment existent dès l'import", () => {
        // Named separately from the surface freeze: when this breaks, the failure message
        // should say WHICH contract broke, not just "array differs at index 11".
        expect(typeof GeoLeaf.I18n?.registerDict).toBe("function");
        expect(typeof GeoLeaf.I18n?.getLabel).toBe("function");
        expect(typeof GeoLeaf.notify).toBe("function");
        expect(typeof GeoLeaf.Utils).toBe("object");
    });

    test("le garde-fou de `deploy-core/init.js:33` est satisfait", () => {
        // `if (!gl?.plugins || !gl?.registry || !gl?.I18n) return;` guards the WHOLE plugin
        // IIFE: one missing anchor silently drops table/print/measure/editor — normal map,
        // zero console error. Far wider blast radius than "untranslated labels".
        expect(GeoLeaf.plugins).toBeTruthy();
        expect(GeoLeaf.registry).toBeTruthy();
        expect(GeoLeaf.I18n).toBeTruthy();
    });

    // ── 2. APIController health at import — the literal oracle of S4 ──────────────

    test("l'APIController est sain à l'import (l'oracle de S4 : 0 manager = la panne)", () => {
        expect(healthAtImport).not.toBeNull();
        expect(healthAtImport.managersCount).toBe(3);
        expect(healthAtImport.managers).toBe(3);
        expect(healthAtImport.isInitialized).toBe(true);
        expect(healthAtImport.hasModuleAccess).toBe(true);
        expect(healthAtImport.errors).toEqual([]);
    });

    test("getHealth et getMetrics restent DÉTACHABLES sur le bundle livré (D8)", () => {
        // socle-init 7.7 — ce tier est le SEUL où le défaut D8 a réellement été observé
        // (« mesuré dans Chromium sur le bundle livré ») : `getMetrics(){ return this.getHealth(); }`
        // marchait attaché et jetait détaché. La source, elle, est gardée par
        // `__tests__/guards/top-level-api-single-writer.guard.test.ts` (TLA-02) — mais elle ne
        // voit pas qui écrit EN DERNIER dans l'artefact. Ici, si.
        const { getHealth, getMetrics } = GeoLeaf;
        expect(() => getHealth()).not.toThrow();
        expect(() => getMetrics()).not.toThrow();
        expect(getMetrics()).toEqual(GeoLeaf.getMetrics());
    });

    // ── 3. Plugin contract end-to-end ────────────────────────────────────────────

    test("un plugin eager voit son dictionnaire pris en compte (canari plugin-table)", () => {
        expect(
            fs.existsSync(TABLE_PLUGIN),
            `missing ${TABLE_PLUGIN} — run \`turbo run build\` first`
        ).toBe(true);

        // The failure mode being guarded is SILENT: entry.ts:32 uses optional chaining
        // (`_g.GeoLeaf?.I18n?.registerDict?.(...)`), so a missing anchor throws nothing and
        // still mounts the plugin. Only the labels vanish — getLabel returns the raw key.
        expect(GeoLeaf.Table).toBeDefined();
        expect(GeoLeaf.I18n.getLabel("table.toolbar.button")).toBe("Tableau");
        expect(GeoLeaf.I18n.getLabel("ui.table.layer_placeholder")).toBe(
            "Sélectionner une couche..."
        );
    });
});
