/**
 * `ThemeApplierCore` est complété par MONKEY-PATCH à l'import — contrat (API publique S4.3).
 *
 * ## Le défaut que ce test existe pour empêcher
 *
 * `kernel/themes/theme-applier/core.ts` déclare `applyTheme()`, et `applyTheme()` appelle
 * `this._hideAllLayers()`, `this._applyLayerConfig(cfg)` et `self._syncLegendVisibility()` —
 * **qu'il ne définit pas**. Ces 13 méthodes sont greffées sur le MÊME objet, à l'import, par
 * trois modules frères :
 *
 *   deferred.ts   → _scheduleLayerConfig, _schedulePendingCheck, _checkPendingLayerConfigs,
 *                   _setLayerVisibilityAndStyle, _resolveDataFilePath, _getProfilesBasePath,
 *                   _normalizeBasePath
 *   ui-sync.ts    → _updateStyleSelector, _loadLegendForStyle, _fitBoundsOnAllLayers,
 *                   _syncLegendVisibility
 *   visibility.ts → _hideAllLayers, _applyLayerConfig
 *
 * Aucun de ces trois n'exporte quoi que ce soit qui soit consommé : ce sont des modules
 * d'EFFET DE BORD. Ils n'entraient dans le graphe que parce que `globals.ui.ts` les importait
 * pour composer `GeoLeaf._ThemeApplier` — une clé que personne n'a jamais lue, et que l'API
 * S4.3 a retirée à ce titre.
 *
 * Le retrait a failli emporter les patches. Trois instruments ont dit « code mort » de concert :
 *
 *   • ESLint — 4 imports `no-unused-vars`, puisque les symboles ne servent effectivement pas ;
 *   • `check-orphan-exports` — les 3 exports sans consommateur ;
 *   • la lecture humaine — « 812 lignes importées par personne ».
 *
 * Les trois avaient raison sur la LETTRE et tort sur le FOND : un module d'effet de bord n'a
 * pas de consommateur par définition. C'est le mode d'échec « annoncé mort ≠ mort » de
 * `CLAUDE.md`, dans sa forme la plus coûteuse — la suite serait restée VERTE, parce que tout
 * ce qui touche aux thèmes mocke `ThemeApplierCore`. Le symptôme en production aurait été
 * `TypeError: this._hideAllLayers is not a function` au premier changement de thème.
 *
 * ## Pourquoi ce test et pas une règle de lint
 *
 * Une exemption `eslint-disable` sur les imports dirait « ignore-moi », pas « ces méthodes
 * doivent exister ». Ici on asserte la CONSÉQUENCE : la surface de `ThemeApplierCore` après
 * chargement de la chaîne `globals`. Si un futur nettoyage retire un import, ce test nomme la
 * méthode perdue.
 */
"use strict";

import { describe, test, expect } from "vitest";

// La chaîne globals réelle — c'est elle qui ancre les trois patchers. Ne PAS importer les
// patchers directement ici : ce test doit échouer si `globals.ui.ts` cesse de les tirer.
import "../../src/globals/globals.js";
import { ThemeApplierCore } from "../../src/kernel/themes/theme-applier/core.js";

/** Les 13 méthodes greffées, par module d'origine. */
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

/** Celles que `core.ts` appelle sans les définir — le sous-ensemble qui casse la prod. */
const APPELEES_PAR_APPLY_THEME = [
    "_applyLayerConfig",
    "_hideAllLayers",
    "_scheduleLayerConfig",
    "_syncLegendVisibility",
];

describe("ThemeApplierCore — les greffes d'import (API S4.3)", () => {
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
        // Sous-ensemble redondant avec le test précédent, et c'est délibéré : si quelqu'un
        // réduit la liste des 13 en la jugeant trop stricte, ces 4-là restent, avec la raison.
        for (const m of APPELEES_PAR_APPLY_THEME) {
            expect(
                typeof ThemeApplierCore[m],
                `applyTheme() appelle this.${m}() — sans la greffe, TypeError en production`
            ).toBe("function");
        }
    });

    test("`applyTheme` existe et est bien celle qui dépend des greffes", () => {
        // Garde l'énoncé du test honnête : si `applyTheme` disparaît ou change de nom, les
        // deux assertions ci-dessus deviendraient vraies pour rien.
        expect(typeof ThemeApplierCore.applyTheme).toBe("function");
    });
});
