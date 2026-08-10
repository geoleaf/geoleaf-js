/**
 * Golden master du boot — oracle 0-régression (roadmap boot-di-lifecycle, S0).
 *
 * Capture l'état observable du boot :
 *   (a) l'ordre exact des marqueurs perf `geoleaf:boot:*` émis par boot-core.ts ;
 *   (b) la surface des façades `GeoLeaf.*` présentes après un boot complet.
 *
 * ⚠️ REFORGÉ au S6 (Lot 0) — il était ACTEUR ET ORACLE, donc aveugle.
 *
 * Avant, ce fichier faisait deux choses qui annulaient son propre pouvoir :
 *   1. il **stubait `registry.init()`** — c'est-à-dire précisément l'orchestrateur que le
 *      chantier « convergence boot → registry » réécrit. Il validait un monde qui n'existe pas ;
 *   2. il **rejouait lui-même les 8 `runModuleSetup(id)`**, puis vérifiait que les façades
 *      étaient peuplées. Il testait donc son propre appel, pas celui du code. Commenter
 *      `runModuleSetup` dans n'importe quel `*.module.ts` le laissait VERT.
 *   (Sa liste incluait `"poi"`, un id dissous depuis S9 — resté sans effet, mais révélateur.)
 *
 * Le principe de la reforge : **le stub va SOUS l'objet testé, jamais AU-DESSUS.** MapLibre est
 * mocké globalement (`__tests__/setup.js:486`), donc `registry.init()` tourne POUR DE VRAI et ce
 * sont les vrais `XModule.init()` qui appellent leur setup. Sans carte réelle, les modules
 * posent leurs façades puis s'arrêtent proprement (« Map not available — skipping UI init ») :
 * c'est exactement ce qu'un master de SURFACE doit observer.
 *
 * Ce qu'il attrape désormais : tout module qui cesse de poser ses façades (la surface tombe).
 * Ce qu'il n'attrape PAS, par construction — et qui appartient aux autres tiers :
 *   - les ancres PRÉ-boot (`GeoLeaf.I18n`/`notify`) : ici, `CoreMapModule.init()` les replante
 *     pendant le boot, donc la surface post-boot reste intacte même si l'import ne les pose
 *     plus → c'est le contrat gelé par `__tests__/bundle-boot-contract.test.js` (tier artefact) ;
 *   - le corps du getter `_APIController` : `Object.keys()` n'invoque pas les getters, ce master
 *     n'en voit que le NOM → `__tests__/api/api-controller-getter.test.js` ;
 *   - la DCE Rollup et le rendu → tier artefact et sonde navigateur.
 *
 * Les baselines sont des tableaux en dur, PAS des snapshots : `vitest -u` ne doit pas pouvoir
 * tamponner une régression. Mise à jour à la main, après avoir lu le diff.
 *
 * NB : ce fichier importe la VRAIE chaîne globals — il ne mocke pas `globals.js`
 * (contrairement à boot.test.js) — afin que les façades soient réellement peuplées.
 */
"use strict";

// S1 (presets build) : helpers/boot n'importent plus la chaîne globals en side-effect
// (ils lisent l'accesseur pur `ensureGeoLeaf()`). On charge la VRAIE chaîne globals
// explicitement pour peupler `globalThis.GeoLeaf` (B1→B11) avant de requérir le boot.
// ⚠️ L'ORDRE de ces trois lignes est porteur (B1→B11) et les `import` ESM s'exécutent dans
// l'ordre de la source, exactement comme les `require` qu'ils remplacent.
import "../../src/globals/globals.js";
// Charger helpers (peuple _app) puis le boot réel.
import "../../src/app/app-namespace.js";
import * as bootModule from "../../src/app/boot.js";
import {
    walkNamespace,
    diffSurface,
    EXPECTED_FACADE_KEYS,
    EXPECTED_FACADE_MEMBERS,
    DEPTH2_FACADES,
} from "../../../../scripts/lib/namespace-surface.mjs";

const _app = bootModule._app;
const GeoLeaf = globalThis.GeoLeaf;
// S6 Lot 2: plus AUCUN setup n'est déclenché par ce test. Les façades sont posées par la phase A
// (à l'import de la chaîne globals ci-dessus), exactement comme dans le bundle livré. Le
// `runModuleSetup("config")` que le Lot 0 avait dû ajouter ici — parce que `geoleaf.*.js` est
// aliasé sous vitest, donc la rustine ne tirait pas — est tombé de lui-même, comme annoncé.

// ── Baselines figées (mises à jour S1.2 — 2026-06-28) ──
// Nouvel ordre : profileResources se charge AVANT registry.init()
// (les modules reçoivent la config profil complète à leur init()).

const EXPECTED_BOOT_MARKS = [
    "geoleaf:boot:loadConfig:start",
    "geoleaf:boot:loadConfig:end",
    "geoleaf:boot:profileResources:start",
    "geoleaf:boot:profileResources:end",
    "geoleaf:boot:registry:start",
    "geoleaf:boot:registry:end",
];

// EXPECTED_FACADE_KEYS vit désormais dans `scripts/lib/namespace-surface.mjs` (API S4.1) :
// une seule marche, une seule liste, quatre lecteurs — dont la gate HOST-SYNC, qui la lit à
// l'AST au lieu de la parser au texte.

describe("boot — golden master (oracle 0-régression S1→S4)", () => {
    let captured;

    beforeAll(async () => {
        const marks = [];
        const origMark = performance.mark;
        // Spy performance.mark — plus robuste que getEntriesByName sous happy-dom.
        performance.mark = (name) => {
            marks.push(name);
            return undefined;
        };
        window.__GEOLEAF_PERF__ = true;

        // I/O only — network reads are out of this master's scope. We replace the METHOD, not
        // the whole `GeoLeaf.Config` façade: overwriting the object would hand the real modules
        // a Config without `.get()` during registry.init().
        GeoLeaf.loadConfig = (opts) => setTimeout(() => opts.onLoaded({}), 0);
        GeoLeaf.Config.loadActiveProfileResources = () => Promise.resolve({});

        _app._appStarted = false;
        // S6 Lot 1: public API instead of forcing the private `_initialized = false`. Harmless
        // here (the registry has never been init'd at this point, so `_initOrder` is empty and
        // destroy() only re-arms), but the crutch had no reason to outlive the bug it hid.
        if (GeoLeaf._registry) GeoLeaf._registry.destroy();

        await _app.startApp();
        await new Promise((r) => setTimeout(r, 30));

        performance.mark = origMark;
        captured = {
            // `geoleaf:boot:*` only — CALIBRATED, not assumed. 16 marks exist in the codebase,
            // but the 10 `geoleaf:init:*` ones are emitted from INSIDE the module init()s that
            // need a real map (`core-map.module.ts:141`, `ui.module.ts:128/134`,
            // `init-deferred-ui.ts:38`). Under a mocked MapLibre the map is never created,
            // UIModule logs "Map not available — skipping UI init", and those marks never fire.
            // Freezing them here would freeze a fiction. The browser probe (FILET 4) is what
            // asserts their real order.
            marks: marks.filter((m) => String(m).startsWith("geoleaf:boot:")),
            facades: walkNamespace(GeoLeaf).keys,
            members: walkNamespace(GeoLeaf, { descend: DEPTH2_FACADES }).members,
            // Second instantané 30 ms plus tard : à la profondeur 2, la surface dépend de
            // l'avancement des `init()`, pas seulement de la phase A. Une divergence entre
            // les deux est le début d'un test intermittent — et un test intermittent finit
            // toujours par être `skip`é.
            membersAgain: null,
        };
        await new Promise((r) => setTimeout(r, 30));
        captured.membersAgain = walkNamespace(GeoLeaf, { descend: DEPTH2_FACADES }).members;
    });

    it("émet les marqueurs `geoleaf:boot:*` dans l'ordre figé", () => {
        expect(captured.marks).toEqual(EXPECTED_BOOT_MARKS);
    });

    it("expose exactement les MEMBRES figés des façades contractuelles", () => {
        // API S4.1b — la profondeur 2. Sans elle, commenter `on` dans `kernel/events/facade.ts`
        // laissait TOUS les tests de surface verts : la clé `Events` était toujours là, sur un
        // objet ayant perdu la seule méthode que les plugins appellent.
        // ⚠️ Ce titre disait « les 8 façades » jusqu'au 10/08/2026 ; elles sont 22 depuis
        // l'élargissement du contrat inverse (S1.4/1.5). Le nombre est retiré du titre plutôt
        // que corrigé : il se lit dans `DEPTH2_FACADES`, sur lequel cette boucle itère, et un
        // titre de test est le dernier endroit où l'on pense à mettre un compteur à jour.
        for (const facade of DEPTH2_FACADES) {
            const d = diffSurface(EXPECTED_FACADE_MEMBERS[facade], captured.members[facade] ?? []);
            expect(
                d.missing,
                `GeoLeaf.${facade} — membres DISPARUS : ${d.missing.join(", ")}`
            ).toEqual([]);
            expect(d.extra, `GeoLeaf.${facade} — membres APPARUS : ${d.extra.join(", ")}`).toEqual(
                []
            );
        }
    });

    it("la surface de profondeur 2 est stable entre deux mesures", () => {
        // Un instantané qui bouge entre deux lectures à 30 ms d'écart est un test intermittent
        // en devenir, et un test intermittent finit par être `skip`é — donc par ne plus rien
        // garder. Mieux vaut le savoir ici que dans six mois.
        expect(captured.membersAgain).toEqual(captured.members);
    });

    it("expose exactement la surface de façades `GeoLeaf.*` figée", () => {
        // Le diff nommé d'abord : sur ~90 clés, `toEqual` seul dit « array differs at index 11 ».
        const d = diffSurface(EXPECTED_FACADE_KEYS, captured.facades);
        expect(d.missing, `clés DISPARUES du namespace : ${d.missing.join(", ")}`).toEqual([]);
        expect(d.extra, `clés APPARUES sur le namespace : ${d.extra.join(", ")}`).toEqual([]);
        // Filet final : l'égalité stricte reste, elle n'est pas remplacée.
        expect(captured.facades).toEqual([...EXPECTED_FACADE_KEYS].sort());
    });
});
