/**
 * Caractérisation de la découverte de modules — API publique S4.3.
 *
 * Écrit AVANT le retrait des 13 clés `_` du namespace, et vert au moment où il est écrit :
 * c'est la définition d'un test de caractérisation. Il ne dit pas ce que le code DEVRAIT
 * faire, il grave ce qu'il fait, pour que le lot suivant produise un diff lisible au lieu
 * d'une régression silencieuse.
 *
 * ## Ce qu'il garde, et pourquoi ça compte
 *
 * `APIModuleManager._scanExistingModules()` (`kernel/api/module-manager.ts:102-108`) ne
 * découvre pas des modules : il **copie toute clé du namespace dont le nom commence par `_`**.
 * Il promeut donc au rang de « module » une chaîne (`_version`), un sac d'état (`_app`), et
 * un ACCESSEUR qu'il invoque au passage (`_APIController`). Retirer 13 de ces clés change
 * mécaniquement `stats.totalModules`, la liste en cache et `getModuleList()`.
 *
 * ⚠️ Une intention du plan de sprint est ici corrigée par la mesure : le catalogue explicite
 * qui remplacera le scan **ne peut pas** « préserver la sortie de `getModuleList()` ».
 * Celle-ci fait l'union avec `Object.keys(gl)` à chaque appel (`:213-226`) — dès que les clés
 * quittent le namespace, elle rétrécit, catalogue ou pas. Ce que le catalogue apporte est
 * autre chose, et se suffit : la découverte cesse d'être un balayage de préfixe, et la
 * ré-entrance du getter disparaît.
 *
 * ## Portée réelle du risque, mesurée
 *
 * `getModule` / `hasModule` / `getNamespace` sont publics (ils sont dans l'oracle post-boot).
 * `getModuleList` ne l'est pas — il n'est joignable que par l'instance du manager. Mesure de
 * confirmation : ces quatre méthodes ont **zéro appelant** hors du core (rien dans `apps/`,
 * `e2e/`, `deploy/`, les 13 plugins, `packages/libs/`, `examples/`, `profiles/`).
 *
 * ## ⚠️ Ce que ces chiffres ne décrivent PAS
 *
 * Ce boot n'est pas celui de la production : `GeoLeaf.loadConfig` est stubé, donc le scan
 * s'exécute à un instant qui n'est pas le sien en conditions réelles, et il y voit un
 * namespace plus peuplé. Ne pas transposer `38` tel quel à un chargement de page. Ce que le
 * test garantit est l'invariant, pas le nombre absolu : **le cache est un sous-ensemble du
 * namespace**, et il bouge exactement quand le namespace bouge.
 *
 * ## Journal
 *
 * API S4.3b : 51 → 38 (14 publics + 24 `_`), `moduleList` 102 → 89. Les 13 clés `_` retirées
 * n'avaient aucun lecteur et n'étaient déclarées dans aucun type.
 *
 * API S4.3f : 38 → 34. Le catalogue déclaratif remplace le balayage de préfixe, et **quatre
 * clés `_` quittent le cache sans quitter le namespace** : `_version` (une chaîne), `_app`
 * (un sac d'état), `_registry` (l'instance du ModuleRegistry) et `_APIController` (un
 * accesseur). Le balayage les prenait parce qu'elles commencent par `_`, pas parce que ce
 * sont des modules.
 *
 * ⚠️ **La surface PUBLIQUE est inchangée**, et c'est le seul critère qui compte ici —
 * mesuré : `getModule("POI")` rend toujours `null` (pas `undefined`), `getModule
 * ("_APIController")` rend toujours l'objet (par le repli), `hasModule` répond pareil sur les
 * quatre, `getModuleList()` vaut toujours l'oracle, et les 3 alias sont identiques.
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
 * Les 14 modules PUBLICS mis en cache par `moduleList` (la liste en dur de `:75-93`).
 *
 * Elle en énumère 17, mais trois ne sont montés par personne depuis leurs dissolutions
 * respectives — `POI` (S9), `Route` (façade dissoute au S11), `Constants` (le namespace porte
 * `CONSTANTS`, en capitales). Le `if (gl[name])` les saute en silence : la liste en dur et le
 * runtime divergent de trois entrées, et rien ne le dit.
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

/** Les 20 modules internes ÉNUMÉRÉS par le catalogue (37 balayés avant l'API S4.3). */
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

describe("découverte de modules — caractérisation (API S4.3)", () => {
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
        // Le `if (gl[name])` les saute sans un mot. Gelé pour que le catalogue explicite du
        // lot suivant ne les recopie pas par fidélité à une liste qui ment déjà.
        for (const fantome of ["POI", "Route", "Constants"]) {
            expect(captured.cached, `${fantome} ne devrait pas être en cache`).not.toContain(
                fantome
            );
            expect(GeoLeaf[fantome], `${fantome} ne devrait pas être sur le namespace`).toBeFalsy();
        }
    });

    test("pose 3 alias sur 4 — `Log → Logger` est MORTE", () => {
        // `_setupAliases()` ne pose un alias que si la CIBLE est déjà en cache. `Logger` n'est
        // ni dans `moduleList` ni sur le namespace, donc `Log → Logger` ne se pose jamais.
        // Elle est inerte depuis toujours ; la geler documente le fait au lieu de le laisser
        // réapparaître comme une intention.
        expect(captured.aliases).toEqual([
            ["BaseLayers", "Baselayers"],
            ["Baselayers", "BaseLayers"],
            ["Logger", "Log"],
        ]);
        expect(captured.stats.aliases).toBe(3);
    });

    describe("le catalogue déclaratif (API S4.3f)", () => {
        test("toute entrée du catalogue est montée, sauf celles motivées comme absentes", () => {
            // L'anti-dérive : un nom que plus personne ne monte doit être RETIRÉ du catalogue
            // ou DÉCLARÉ absent avec sa raison. Une exemption sans motif est indiscernable
            // d'un nom que quelqu'un a cessé de poursuivre.
            const absentes = MODULE_CATALOG.filter((n) => !GeoLeaf[n]);
            const nonMotivees = absentes.filter((n) => !CATALOG_EXPECTED_ABSENT.has(n));
            expect(
                nonMotivees,
                `Entrées du catalogue absentes du namespace SANS motif : ${nonMotivees.join(", ")}`
            ).toEqual([]);
        });

        test("les 3 fantômes restent hors du cache — la garde de présence tient", () => {
            // Sans `if (!descriptor.value) continue`, ces trois entreraient au cache et
            // `getModuleList()` deviendrait STRICTEMENT PLUS GRAND que `Object.keys(gl)`.
            for (const [nom, motif] of CATALOG_EXPECTED_ABSENT) {
                expect(captured.cached, `${nom} en cache — ${motif}`).not.toContain(nom);
                // Et la sortie publique reste `null`, pas `undefined` : c'est le repli sur le
                // namespace qui la produit, et il n'existe que si le nom traverse la boucle.
                expect(GeoLeaf.getModule(nom), `getModule("${nom}") doit rendre null`).toBeNull();
            }
        });

        test("l'accesseur `_APIController` n'est PAS mis en cache, et reste atteignable", () => {
            // La politique d'accesseur : on ne lit jamais `.value` d'un descripteur porteur
            // d'un getter. Lire celui-ci pendant `_scanExistingModules()` re-entrait dans la
            // construction de l'APIController qui l'appelle — récursion mesurée en navigateur.
            const d = Object.getOwnPropertyDescriptor(GeoLeaf, "_APIController");
            expect(typeof d?.get, "_APIController doit rester un accesseur").toBe("function");
            expect(captured.cached).not.toContain("_APIController");
            // …et le repli de `getModule` le sert quand même, hors construction.
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
        // Le cache est un sous-ensemble du namespace (tout y a été lu), donc l'union vaut
        // exactement l'oracle post-boot. C'est ce qui rend impossible de « préserver » cette
        // sortie en retirant des clés : elle SUIT le namespace, par construction.
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
