/**
 * `ThemeApplierCore` is completed by MONKEY-PATCH at import — contract.
 *
 * ## The defect this test exists to prevent
 *
 * `kernel/themes/theme-applier/core.ts` declares `applyTheme()`, and
 * `applyTheme()` calls `this._hideAllLayers()`, `this._applyLayerConfig(cfg)`
 * and `self._syncLegendVisibility()` — **which it does not define**. These
 * 13 methods are grafted onto the SAME object, at import, by three sibling
 * modules:
 *
 *   deferred.ts   → _scheduleLayerConfig, _schedulePendingCheck, _checkPendingLayerConfigs,
 *                   _setLayerVisibilityAndStyle, _resolveDataFilePath, _getProfilesBasePath,
 *                   _normalizeBasePath
 *   ui-sync.ts    → _updateStyleSelector, _loadLegendForStyle, _fitBoundsOnAllLayers,
 *                   _syncLegendVisibility
 *   visibility.ts → _hideAllLayers, _applyLayerConfig
 *
 * None of the three exports anything that is consumed: they are
 * SIDE-EFFECT modules. They only entered the graph because `globals.ui.ts`
 * imported them to compose `GeoLeaf._ThemeApplier` — a key nobody ever
 * read, removed by the API review on that ground.
 *
 * The removal almost took the patches with it. Three instruments said "dead
 * code" in concert:
 *
 *   • ESLint — 4 `no-unused-vars` imports, since the symbols effectively serve nothing;
 *   • `check-orphan-exports` — the 3 consumer-less exports;
 *   • human reading — "812 lines imported by nobody".
 *
 * All three were right on the LETTER and wrong on the SUBSTANCE: a
 * side-effect module has no consumer by definition. The "announced dead ≠
 * dead" failure mode, in its most costly form — the suite would have
 * stayed GREEN, because everything touching themes mocks
 * `ThemeApplierCore`. The production symptom would have been
 * `TypeError: this._hideAllLayers is not a function` at the first theme change.
 *
 * ## Why this test and not a lint rule
 *
 * An `eslint-disable` exemption on the imports would say "ignore me", not
 * "these methods must exist". Here the CONSEQUENCE is asserted:
 * `ThemeApplierCore`'s surface after loading the `globals` chain. If a
 * future cleanup removes an import, this test names the lost method.
 */
"use strict";

import { describe, test, expect } from "vitest";

// The real globals chain — it is what anchors the three patchers. Do NOT
// import the patchers directly here: this test must fail if `globals.ui.ts`
// stops pulling them.
import "../../src/globals/globals.js";
import { ThemeApplierCore } from "../../src/kernel/themes/theme-applier/core.js";

/** The 13 grafted methods, by module of origin. */
const PATCHED = {
    "theme-applier/deferred.ts": [
        "_checkPendingLayerConfigs",
        "_getProfilesBasePath",
        "_normalizeBasePath",
        "_resolveDataFilePath",
        "_scheduleLayerConfig",
        "_schedulePendingCheck",
        "_setLayerVisibilityAndStyle",
    ],
    "theme-applier/ui-sync.ts": [
        "_fitBoundsOnAllLayers",
        "_loadLegendForStyle",
        "_syncLegendVisibility",
        "_updateStyleSelector",
    ],
    "theme-applier/visibility.ts": ["_applyLayerConfig", "_hideAllLayers"],
};

/** Those `core.ts` calls without defining — the subset that breaks production. */
const APPELEES_PAR_APPLY_THEME = [
    "_applyLayerConfig",
    "_hideAllLayers",
    "_scheduleLayerConfig",
    "_syncLegendVisibility",
];

describe("ThemeApplierCore — les greffes d'import", () => {
    test("les 13 méthodes greffées sont présentes après chargement de `globals`", () => {
        const manquantes = [];
        for (const [source, methodes] of Object.entries(PATCHED)) {
            for (const m of methodes) {
                if (typeof ThemeApplierCore[m] !== "function") manquantes.push(`${m} (${source})`);
            }
        }
        expect(
            manquantes,
            `Méthodes greffées ABSENTES — un import d'effet de bord a disparu de ` +
                `globals.ui.ts :\n  ${manquantes.join("\n  ")}`
        ).toEqual([]);
    });

    test("celles qu'`applyTheme()` appelle sans les définir existent", () => {
        // Subset redundant with the previous test, deliberately: if someone
        // trims the list of 13 judging it too strict, these 4 stay, with the reason.
        for (const m of APPELEES_PAR_APPLY_THEME) {
            expect(
                typeof ThemeApplierCore[m],
                `applyTheme() appelle this.${m}() — sans la greffe, TypeError en production`
            ).toBe("function");
        }
    });

    test("`applyTheme` existe et est bien celle qui dépend des greffes", () => {
        // Keeps the test's claim honest: if `applyTheme` vanishes or changes
        // name, the two assertions above would become true for nothing.
        expect(typeof ThemeApplierCore.applyTheme).toBe("function");
    });
});
