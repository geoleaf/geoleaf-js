/**
 * Module-discovery characterisation — public API review.
 *
 * Written BEFORE the removal of the namespace's 13 `_` keys, and green when
 * written: the definition of a characterisation test. It does not say what
 * the code SHOULD do, it engraves what it does, so the next pass produces a
 * readable diff instead of a silent regression.
 *
 * ## What it guards, and why it matters
 *
 * `APIModuleManager._scanExistingModules()`
 * (`kernel/api/module-manager.ts`) does not discover modules: it
 * **copies every namespace key whose name starts with `_`**. It thus
 * promotes to "module" a string (`_version`), a state bag (`_app`), and an
 * ACCESSOR it invokes in passing (`_APIController`). Removing 13 of these
 * keys mechanically changes `stats.totalModules`, the cached list and
 * `getModuleList()`.
 *
 * ⚠️ One plan intention is corrected here by measurement: the explicit
 * catalogue replacing the scan **cannot** "preserve `getModuleList()`'s
 * output". That output unions with `Object.keys(gl)` at every call
 * (`:213-226`) — as soon as keys leave the namespace, it shrinks, catalogue
 * or not. What the catalogue brings is something else, and suffices:
 * discovery stops being a prefix sweep, and the getter's re-entrance
 * disappears.
 *
 * ## Real scope of the risk, measured
 *
 * `getModule` / `hasModule` / `getNamespace` are public (they are in the
 * post-boot oracle). `getModuleList` is not — only reachable through the
 * manager instance. Confirming measure: these four methods have **zero
 * callers** outside the core (nothing in `apps/`, `e2e/`, `deploy/`, the 13
 * plugins, `packages/libs/`, `examples/`, `profiles/`).
 *
 * ## ⚠️ What these numbers do NOT describe
 *
 * This boot is not production's: `GeoLeaf.loadConfig` is stubbed, so the
 * scan runs at a moment that is not its own in real conditions, and sees a
 * more populated namespace. Do not transpose `38` as-is to a page load.
 * What the test guarantees is the invariant, not the absolute number: **the
 * cache is a subset of the namespace**, and it moves exactly when the
 * namespace moves.
 *
 * ## Journal
 *
 * First pass: 51 → 38 (14 public + 24 `_`), `moduleList` 102 → 89. The 13
 * removed `_` keys had no reader and were declared in no type.
 *
 * Second pass: 38 → 34. The declarative catalogue replaces the prefix
 * sweep, and **four `_` keys leave the cache without leaving the
 * namespace**: `_version` (a string), `_app` (a state bag), `_registry`
 * (the ModuleRegistry instance) and `_APIController` (an accessor). The
 * sweep took them because they start with `_`, not because they are modules.
 *
 * ⚠️ **The PUBLIC surface is unchanged**, and that is the only criterion
 * that counts here — measured: `getModule("POI")` still returns `null` (not
 * `undefined`), `getModule("_APIController")` still returns the object
 * (through the fallback), `hasModule` answers the same on all four,
 * `getModuleList()` still equals the oracle, and the 3 aliases are identical.
 */
"use strict";

import { describe, test, expect, beforeAll } from "vitest";
import "../../src/globals/globals.js";
import "../../src/app/app-namespace.js";
import * as bootModule from "../../src/app/boot.js";
import { EXPECTED_FACADE_KEYS } from "../../../../scripts/lib/namespace-surface.mjs";
import { MODULE_CATALOG, CATALOG_EXPECTED_ABSENT } from "../../src/kernel/api/module-catalog.js";

const _app = bootModule._app;
const GeoLeaf = globalThis.GeoLeaf;

/**
 * The 14 PUBLIC modules cached by `moduleList` (the hardcoded list at `:75-93`).
 *
 * It enumerates 17, but three are mounted by nobody since their respective
 * dissolutions — `POI`, `Route` (facade dissolved), `Constants` (the
 * namespace carries `CONSTANTS`, capitals). The `if (gl[name])` skips them
 * silently: the hardcoded list and the runtime diverge by three entries,
 * and nothing says so.
 */
const CACHED_PUBLIC = [
    "BaseLayers",
    "Baselayers",
    "Config",
    "Core",
    "Errors",
    "GeoJSON",
    "LayerManager",
    "Legend",
    "Log",
    "Security",
    "Storage",
    "UI",
    "Utils",
    "Validators",
];

/** The 20 internal modules ENUMERATED by the catalogue (37 swept before the review). */
const CACHED_PRIVATE = [
    "_Cluster",
    "_ConfigLoader",
    "_DataConverter",
    "_GeoJSONLayerConfig",
    "_GeoJSONLayerManager",
    "_GeoJSONLoader",
    "_LabelButtonManager",
    "_LabelRenderer",
    "_LayerManagerControl",
    "_LayerManagerStyleSelector",
    "_LayerVisibilityManager",
    "_LegendControl",
    "_LegendGenerator",
    "_OfflineDetector",
    "_UIComponents",
    "_UIEventDelegation",
    "_UINotifications",
    "_UITheme",
    "_Validators",
    "_VectorTiles",
];

describe("découverte de modules — caractérisation", () => {
    let mm;
    let captured;

    beforeAll(async () => {
        GeoLeaf.loadConfig = (opts) => setTimeout(() => opts.onLoaded({}), 0);
        GeoLeaf.Config.loadActiveProfileResources = () => Promise.resolve({});
        _app._appStarted = false;
        if (GeoLeaf._registry) GeoLeaf._registry.destroy();
        await _app.startApp();
        await new Promise((r) => setTimeout(r, 30));

        mm = GeoLeaf._APIController?.managers?.module;
        captured = {
            cached: [...mm.modules.keys()].sort(),
            aliases: [...mm.aliases.entries()].sort(),
            stats: mm.getStats(),
            moduleList: mm.getModuleList(),
        };
    }, 30000);

    test("le manager est atteignable et initialisé", () => {
        expect(mm, "APIController.managers.module introuvable").toBeTruthy();
        expect(captured.stats.isInitialized).toBe(true);
        expect(captured.stats.errors).toBe(0);
    });

    test("met en cache exactement 14 modules publics + 20 modules internes = 34", () => {
        expect(captured.cached).toEqual([...CACHED_PUBLIC, ...CACHED_PRIVATE].sort());
        expect(captured.stats.totalModules).toBe(34);
        expect(captured.stats.cachedModules).toBe(34);
    });

    test("trois entrées de `moduleList` ne sont montées par personne", () => {
        // The `if (gl[name])` skips them without a word. Frozen so the next
        // pass's explicit catalogue does not copy them out of fidelity to a
        // list that already lies.
        for (const fantome of ["POI", "Route", "Constants"]) {
            expect(captured.cached, `${fantome} ne devrait pas être en cache`).not.toContain(
                fantome
            );
            expect(GeoLeaf[fantome], `${fantome} ne devrait pas être sur le namespace`).toBeFalsy();
        }
    });

    test("pose 3 alias sur 4 — `Log → Logger` est MORTE", () => {
        // `_setupAliases()` only sets an alias if the TARGET is already
        // cached. `Logger` is neither in `moduleList` nor on the namespace,
        // so `Log → Logger` never gets set. It has been inert forever;
        // freezing it documents the fact instead of letting it reappear as
        // an intention.
        expect(captured.aliases).toEqual([
            ["BaseLayers", "Baselayers"],
            ["Baselayers", "BaseLayers"],
            ["Logger", "Log"],
        ]);
        expect(captured.stats.aliases).toBe(3);
    });

    describe("le catalogue déclaratif (API S4.3f)", () => {
        test("toute entrée du catalogue est montée, sauf celles motivées comme absentes", () => {
            // The anti-drift: a name nobody mounts any more must be REMOVED
            // from the catalogue or DECLARED absent with its reason. A
            // motiveless exemption is indistinguishable from a name someone
            // stopped pursuing.
            const absentes = MODULE_CATALOG.filter((n) => !GeoLeaf[n]);
            const nonMotivees = absentes.filter((n) => !CATALOG_EXPECTED_ABSENT.has(n));
            expect(
                nonMotivees,
                `Entrées du catalogue absentes du namespace SANS motif : ${nonMotivees.join(", ")}`
            ).toEqual([]);
        });

        test("les 3 fantômes restent hors du cache — la garde de présence tient", () => {
            // Without `if (!descriptor.value) continue`, these three would
            // enter the cache and `getModuleList()` would become STRICTLY
            // LARGER than `Object.keys(gl)`.
            for (const [nom, motif] of CATALOG_EXPECTED_ABSENT) {
                expect(captured.cached, `${nom} en cache — ${motif}`).not.toContain(nom);
                // And the public output stays `null`, not `undefined`: the
                // namespace fallback produces it, and it only exists if the
                // name crosses the loop.
                expect(GeoLeaf.getModule(nom), `getModule("${nom}") doit rendre null`).toBeNull();
            }
        });

        test("l'accesseur `_APIController` n'est PAS mis en cache, et reste atteignable", () => {
            // The accessor policy: never read `.value` of a getter-bearing
            // descriptor. Reading this one during `_scanExistingModules()`
            // re-entered the construction of the APIController calling it —
            // recursion measured in a browser.
            const d = Object.getOwnPropertyDescriptor(GeoLeaf, "_APIController");
            expect(typeof d?.get, "_APIController doit rester un accesseur").toBe("function");
            expect(captured.cached).not.toContain("_APIController");
            // …and `getModule`'s fallback still serves it, outside construction.
            expect(typeof GeoLeaf.getModule("_APIController")).toBe("object");
            expect(GeoLeaf.hasModule("_APIController")).toBe(true);
        });

        test("les 3 non-modules quittent le cache sans quitter le namespace", () => {
            for (const nom of ["_app", "_registry", "_version"]) {
                expect(captured.cached, `${nom} n'est pas un module`).not.toContain(nom);
                expect(GeoLeaf[nom], `${nom} doit rester sur le namespace`).toBeDefined();
            }
        });
    });

    test("`getModuleList()` est l'union du cache et du namespace — donc le namespace", () => {
        // The cache is a subset of the namespace (everything was read from
        // it), so the union equals exactly the post-boot oracle. That is
        // what makes it impossible to "preserve" this output while removing
        // keys: it FOLLOWS the namespace, by construction.
        expect(captured.moduleList).toEqual([...EXPECTED_FACADE_KEYS].sort());
    });

    describe("surface publique — c'est elle que le retrait ne doit pas changer", () => {
        test("`getModule` : cache, puis alias, puis repli sur le namespace", () => {
            expect(typeof GeoLeaf.getModule("Core")).toBe("object");
            expect(GeoLeaf.getModule("Logger")).toBe(GeoLeaf.getModule("Log")); // via alias
            expect(GeoLeaf.getModule("Baselayers")).toBe(GeoLeaf.getModule("BaseLayers"));
            expect(GeoLeaf.getModule("NExistePas")).toBeNull();
            expect(GeoLeaf.getModule("")).toBeNull();
            expect(GeoLeaf.getModule(null)).toBeNull();
        });

        test("`hasModule` : cache ∨ alias ∨ présence sur le namespace", () => {
            expect(GeoLeaf.hasModule("Core")).toBe(true);
            expect(GeoLeaf.hasModule("Logger")).toBe(true); // par l'alias seul
            expect(GeoLeaf.hasModule("Log")).toBe(true);
            expect(GeoLeaf.hasModule("NExistePas")).toBe(false);
        });

        test("`getNamespace` rend la façade demandée", () => {
            expect(typeof GeoLeaf.getNamespace("Core")).toBe("object");
        });

        test("`getHealth` compte 3 managers", () => {
            const h = GeoLeaf.getHealth();
            expect(h.managersCount).toBe(3);
            expect(h.isInitialized).toBe(true);
            expect(h.hasModuleAccess).toBe(true);
        });
    });
});
