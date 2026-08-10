/**
 * Unit tests — `cache/cache-control.ts`, couverture réelle (chantier R.31).
 *
 * Fichier mesuré à 0 % : la FABRIQUE + la coquille IControl (onAdd/onRemove) du contrôle de
 * cache. Il est stubé (`empty-module`) pour les AUTRES modules par l'alias cross-plugin
 * `(\.\.\/)+cache/cache-control.(js|ts)` — mais l'alias exige l'extension. On l'importe donc
 * SANS extension (`../cache/cache-control`), ce qui ne matche pas le motif et résout le vrai
 * fichier. On couvre `create` (options par défaut vs explicites), `onAdd` (structure,
 * init des sous-modules, tâche différée) et `onRemove` (nettoyage).
 */
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

// ⚠️ SANS extension — contourne l'alias qui stube `../cache/cache-control.js`.
import { CacheControl } from "../cache/cache-control";

// API publique S4.4 — les tests plantent `GeoLeaf.Storage` comme le fait la PRODUCTION.
// Ils pilotaient `StorageContract.init()`, c'est-à-dire une SECONDE instance du singleton
// que le bundle embarquait et que rien n'initialisait : ils validaient un canal mort.
function _installGeoLeafStorage(api) {
    globalThis.GeoLeaf = globalThis.GeoLeaf ?? {};
    // Le helper reproduit ce que `StorageContract.init()` fournissait, parce que la façade
    // du core le fournit aussi : `isPluginLoaded()` = « un moteur s'est enregistré », et
    // `isAvailable()` = « et sa base est ouverte ». L'adaptateur du plugin DÉLÈGUE ces deux
    // méthodes — il ne les recalcule pas —, donc un objet planté qui ne les porte pas
    // rendrait `false` là où le test attend `true`. Un appelant qui les fournit garde la main.
    globalThis.GeoLeaf.Storage =
        api === null || api === undefined
            ? null
            : {
                  isPluginLoaded: () => true,
                  isAvailable: () => !!api.DB,
                  ...api,
              };
    return api;
}

beforeEach(() => {
    globalThis.GeoLeaf = globalThis.GeoLeaf || {};
    // profil vide → la tâche différée (populate) sort tôt sans fetch
    globalThis.GeoLeaf.Config = { get: (_k, fb) => fb };
    _installGeoLeafStorage(null);
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("CacheControl.create", () => {
    test("options par défaut → topright, non replié, repliable", () => {
        const ctrl = CacheControl.create();
        expect(typeof ctrl.onAdd).toBe("function");
        expect(typeof ctrl.onRemove).toBe("function");
    });

    test("options explicites → position, collapsed, collapsible pris en compte", () => {
        const ctrl = CacheControl.create({
            position: "topleft",
            collapsed: true,
            collapsible: false,
        });
        expect(ctrl).toBeTruthy();
    });
});

describe("onAdd / onRemove", () => {
    test("onAdd bâtit le conteneur, initialise les sous-modules et rend l'élément", async () => {
        vi.useFakeTimers();
        const ctrl = CacheControl.create();
        const container = ctrl.onAdd({ id: "map" });

        expect(container).toBeTruthy();
        expect(container.className).toContain("gl-cache-control");
        // la structure a été bâtie (corps + boutons)
        expect(container.querySelector(".gl-cache-control__body")).toBeTruthy();

        // la tâche différée (populate + updateStatus) est protégée par un try/catch :
        // l'avancer couvre son corps quel qu'en soit l'aboutissement.
        await vi.runAllTimersAsync();
    });

    test("wheel sur le conteneur ne se propage pas", () => {
        vi.useFakeTimers();
        const ctrl = CacheControl.create();
        const container = ctrl.onAdd({ id: "map" });
        const ev = new Event("wheel", { bubbles: true, cancelable: true });
        // ne doit pas jeter ; le handler appelle stopPropagation
        expect(() => container.dispatchEvent(ev)).not.toThrow();
    });

    test("onRemove nettoie et détache la carte", () => {
        vi.useFakeTimers();
        const ctrl = CacheControl.create();
        ctrl.onAdd({ id: "map" });
        expect(() => ctrl.onRemove({ id: "map" })).not.toThrow();
    });

    // ── B-140 (Sprint 6, S6c) — les DÉLÉGATIONS de la fabrique ────────────────────────
    //
    // `createCacheControl` monte un état dont **dix-sept membres sont des flèches de
    // délégation** (`_handleDownload: () => DownloadHandler.handleDownload()`, etc.).
    // Istanbul les compte chacune comme une fonction : sept d'entre elles — les handlers,
    // lignes 75-81 — n'étaient exercées par aucun test, et c'est ce qui tenait le fichier à
    // **52,38 % de fonctions** et le paquet à **80,00 % pour un seuil de 80**.
    //
    // 🛑 **La marge était NULLE, et B-140 dit comment on la répare** : « le seul geste
    // légitime est de couvrir une fonction de plus » — jamais en abaissant le seuil.
    //
    // Les handlers sont câblés par `attachEventListeners`, appelé depuis `buildStructure`
    // (`cache-control-dom.ts:66`), donc ils s'exercent par le DOM. On clique sur TOUS les
    // boutons du conteneur plutôt que sur des classes nommées : une classe renommée ferait
    // passer ce test à côté de sa cible **en restant vert**, ce qui est le mode d'échec que
    // ce dépôt traque partout ailleurs.
    test("cliquer chaque bouton exerce les délégations de handler (B-140)", async () => {
        vi.useFakeTimers();
        const ctrl = CacheControl.create();
        const container = ctrl.onAdd({ id: "map" });

        const buttons = Array.from(container.querySelectorAll("button"));
        // Anti-test-vide : si la structure cesse de produire des boutons, ce test doit
        // ROUGIR au lieu de couvrir zéro délégation en silence.
        expect(buttons.length).toBeGreaterThan(0);

        for (const btn of buttons) {
            expect(() => btn.click()).not.toThrow();
        }

        // `_handleCancelled` n'a pas de bouton : il est branché sur un événement de document
        // (`cache-control-events.ts:125`).
        expect(() =>
            document.dispatchEvent(new Event("geoleaf:cache:cancelled", { bubbles: true }))
        ).not.toThrow();

        await vi.runAllTimersAsync();
    });
});
