/*! GeoLeaf Core / © 2026 Mattieu Pottier / MIT / https://geoleaf.dev */
/**
 * GeoLeaf Contract — the top-level methods of the `GeoLeaf` namespace.
 *
 * Defines:
 * - `GeoLeafTopLevelApi` — the eleven shorthand methods mounted directly on `GeoLeaf`
 *
 * ## Pourquoi ce contrat existe : il y avait DEUX implémentations, et aucun lien
 *
 * ✅ **Il n'y en a plus qu'une depuis socle-init 7.7** : `globals/globals.api.ts`
 * (`defineApiMethods`), qui affecte les onze une à une sur le namespace.
 *
 * Jusque-là, `kernel/api/geoleaf-api.ts` les reposait via un `Object.assign` sur le même objet, et
 * **rien ne les reliait** : `verify-host-contract-sync.cjs` compare des NOMS, les deux portaient
 * les mêmes, et deux membres homonymes aux formes divergentes passaient donc toutes les gates.
 * C'est le trou nommé par le backlog **B-13**, ouvert au S3.5 et refermé en deux temps — ce
 * contrat d'abord (API S4.2), qui a lié les deux formes ; puis 7.7, qui a supprimé l'une des deux.
 *
 * ⚠️ **Ce contrat reste nécessaire après la suppression**, et pour une raison qui a changé : il
 * n'arbitre plus entre deux écrivains, il énonce ce que chaque méthode DOIT rendre — et c'est de
 * là que vient l'asymétrie ci-dessous (trois refusent un contrôleur mort, huit rendent une valeur
 * vide). Il est référencé par `global.d.ts`, donc le compilateur vérifie les affectations
 * (`_gl` y est typé `GeoLeafGlobal`).
 *
 * ✅ Et l'unicité de l'écrivain est désormais **gardée**, pas seulement obtenue :
 * `__tests__/guards/top-level-api-single-writer.guard.test.ts` lit ces onze noms ici même, à
 * l'AST, et refuse qu'un second module les réécrive.
 *
 * ## Ce que la mesure a établi avant d'écrire ces signatures (API S4.2)
 *
 * La duplication était réputée INERTE : `globals.api.ts:119-122` affirmait, depuis PHASE11,
 * que `geoleaf-api.js` est éliminé par la DCE de Rollup dans le build ESM. **C'était faux.**
 * Le marqueur `get BaseLayers`, déclaré nulle part ailleurs, est présent dans le bundle livré,
 * et son offset d'émission montre que ce module s'exécute EN DERNIER.
 *
 * La croyance a coûté deux défauts de production, mesurés dans Chromium sur le bundle livré :
 *
 *   1. `GeoLeaf.BaseLayers === undefined`. `Object.assign` invoque le getter de la source avec
 *      `this` lié au littéral, qui ne déclare pas `Baselayers` — l'alias rétro-compatible
 *      écrivait donc `undefined` par-dessus la valeur correcte posée juste avant.
 *   2. `GeoLeaf.getMetrics` jetait dès qu'on la détachait (`const { getMetrics } = GeoLeaf`),
 *      sa forme ESM étant `this.getHealth()` là où sa jumelle UMD ne dépendait pas de `this`.
 *
 * Aucune gate ne pouvait les voir : elles comparent des noms, et les deux clés existaient.
 *
 * ## La posture des signatures : la plus PRÉCISE, pas la plus accommodante
 *
 * Là où les deux versants divergeaient, c'est le runtime qui a tranché, pas la vue la plus
 * permissive. `kernel/api/api-types.ts` déclarait quatre méthodes du contrôleur en `unknown`
 * alors que `kernel/api/controller.ts` les écrit `(theme: string): boolean` et
 * `(input): Promise<unknown>` : l'interface a été resserrée sur l'implémentation, et les
 * enveloppes ESM avec elle. Un `unknown` ne subsiste ici que là où le contrôleur en rend un.
 */

// ─── Les onze méthodes de premier niveau ─────────────────────────────────────────────

/**
 * Les méthodes raccourcies montées directement sur `globalThis.GeoLeaf`.
 *
 * Tous les membres sont optionnels : le namespace est assemblé au boot (chaîne B1→B11), et un
 * consommateur qui le lit trop tôt voit un objet partiel. C'est la même posture que
 * `GeoLeafGlobal`, qui référence ce contrat membre par membre — **en ligne, jamais par
 * `extends`** : les lecteurs d'AST du dépôt (`scripts/lib/ts-decl-read.cjs`) n'itèrent que les
 * membres déclarés, et un membre hérité leur serait invisible.
 */
export interface GeoLeafTopLevelApi {
    /**
     * Initialise GeoLeaf et crée la carte.
     *
     * ⚠️ `map.target` — ou son raccourci `target`/`mapId` — est **obligatoire** :
     * `APIInitializationManager._normalizeInitOptions` jette sans lui. La forme attendue est
     * `{ map: { target }, data: { activeProfile, profilesBasePath } }`.
     *
     * ⚠️ Distinct de {@link GeoLeafTopLevelApi.boot} : `boot()` lance l'application pilotée par
     * profil (chargement de config puis `registry.init()`), `init()` est l'enveloppe manuelle
     * de `GeoLeaf.Core.init()`. Le `init` du chemin de boot est celui du ModuleRegistry, pas
     * celui-ci.
     */
    init?: (options: Record<string, unknown>) => unknown;

    /** Applique un thème par identifiant. Rend `true` si le thème a été appliqué. */
    setTheme?: (theme: string) => boolean;

    /** Charge une configuration depuis une URL ou un objet. Jette (`TypeError`) sur autre chose. */
    loadConfig?: (input: string | Record<string, unknown>) => Promise<unknown>;

    /** Crée une instance de carte gérée par GeoLeaf. Rend `null` si le contrôleur est absent. */
    createMap?: (id: string, options?: Record<string, unknown>) => unknown;

    /** Rend l'instance de carte enregistrée sous cet identifiant, ou `null`. */
    getMap?: (id: string) => unknown;

    /** Rend toutes les instances de carte enregistrées — tableau vide si aucune. */
    getAllMaps?: () => unknown[];

    /** Rend un module enregistré par son nom, ou `null`. */
    getModule?: (name: string) => unknown;

    /** `true` si un module de ce nom est enregistré. */
    hasModule?: (name: string) => boolean;

    /** Rend un namespace de premier niveau (`GeoLeaf[name]`), ou `null`. */
    getNamespace?: (name: string) => unknown;

    /** Rapport de santé de l'`APIController`, ou `null` s'il est indisponible. */
    getHealth?: () => unknown;

    /**
     * Alias de {@link GeoLeafTopLevelApi.getHealth}.
     *
     * ⚠️ Les deux implémentations doivent pointer une fonction qui ne dépend pas de `this` —
     * la forme `this.getHealth()` jetait dès que la méthode était détachée du namespace.
     */
    getMetrics?: () => unknown;
}
