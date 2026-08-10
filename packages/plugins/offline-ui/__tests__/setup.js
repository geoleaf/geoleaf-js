/**
 * Vitest global setup for @geoleaf-plugins/offline-ui tests
 *
 * ## Ce qu'il reste, et pourquoi
 *
 * 1. **`jest` → `vi`.** Les `__mocks__/*.js` du paquet construisent leurs espions avec
 *    `jest.fn()` à l'évaluation (héritage de l'ère Jest) ; sans cet alias ils jettent au
 *    chargement.
 * 2. **Le seam `globalThis.GeoLeaf.Utils`** (ARCHI S7 7.3, geste 5). Ce n'est PAS de la
 *    résolution de modules : les sources lisent les utilitaires du core sur cette surface,
 *    que le core monte au boot en production (`globals.core.ts` B2). Les tests doivent la
 *    monter aussi, sinon les accesseurs rendent leur repli neutre et les assertions
 *    échouent. Rien dans le sprint 5 ne la rend inutile.
 *
 * ## Ce qui a été retiré au sprint 5 COUVERTURE (22/07/2026), et sur quelle preuve
 *
 * Ce fichier portait **227 lignes**, dont ~150 de résolution : un patch
 * `Module._resolveFilename` aliasant `@core/*`, `@core-offline/*`,
 * `@geoleaf/field-renderer`, les variantes d'`indexeddb.js` et de `cache-control.js`, plus
 * un repli `.js → .ts`. Son en-tête énonçait sa propre raison d'être : « Vite alias
 * directives are NOT applied to transitive source imports in forks+tsx mode ». Cette
 * prémisse tombe avec la branche `require()`.
 *
 * **Retiré sur mesure, pas sur raisonnement** : une sonde a comparé, à chaque appel, ce que
 * le patch rendait à ce qu'une résolution pristine aurait rendu. Sur les 7 fichiers et 90
 * tests du paquet, elle s'est installée 7 fois et n'a relevé **aucune redirection**.
 *
 * ⚠️ Ce que le patch faisait revient à `vitest.config.ts`, et l'équivalence n'était pas
 * acquise : `resolveJsToTs` réécrit `.js` → `.ts` dans les fichiers source, donc un alias
 * déclaré en `.js` seul ne les atteint jamais. Ce paquet l'avait déjà anticipé pour
 * `cache-control.(js|ts)` ; l'entrée `@geoleaf/field-renderer` a dû être ajoutée au S5.
 *
 * ⚠️ **Cette entrée d'alias n'existe plus** : au Sprint 6 (S6b / B-144), `confirmDialog` et
 * `createFocusTrap` ont quitté `field-renderer` pour `host-runtime`, et le paquet a perdu
 * toute dépendance à `field-renderer`. L'alias vise désormais `@geoleaf/host-runtime`, avec
 * un mock **partiel** — neuf symboles y sont consommés, pas trois. Le récit ci-dessus reste
 * vrai *au passé* ; la note évite qu'on aille chercher une entrée disparue.
 */

// ── 1. jest → vi alias ────────────────────────────────────────────────────────
if (typeof jest === "undefined" && typeof vi !== "undefined") {
    globalThis.jest = vi;
}

// ── 2. Seam GeoLeaf.Utils (ARCHI S7 7.3, geste 5) ─────────────────────────────
// Les implémentations viennent des mêmes `__mocks__/` que les alias Vite, pour que le
// comportement observé par les tests soit inchangé.
import * as domSecurity from "../__mocks__/dom-security.js";
import * as domHelpers from "../__mocks__/dom-helpers.js";
import * as formatters from "../__mocks__/formatters.js";
import * as elm from "../__mocks__/event-listener-manager.js";

globalThis.GeoLeaf = globalThis.GeoLeaf || {};
globalThis.GeoLeaf.Utils = {
    ...(globalThis.GeoLeaf.Utils || {}),
    DOMSecurity: domSecurity.DOMSecurity ?? domSecurity,
    applyCssText: domHelpers.applyCssText,
    createElement: domHelpers.createElement ?? domHelpers.$create,
    Formatters: {
        formatDateTime: formatters.formatDateTime,
        toMB: formatters.toMB,
        toGB: formatters.toGB,
    },
    events: elm.events ?? elm.EventListenerManager,
};
