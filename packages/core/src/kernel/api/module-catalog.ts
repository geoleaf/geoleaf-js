/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Catalogue déclaratif des modules du namespace — API publique S4.3f.
 *
 *
 * ## Ce qu'il remplace
 *
 * `APIModuleManager._scanExistingModules()` découvrait ses modules en balayant
 * `Object.keys(gl)` sur le préfixe `_`. Ce n'était pas une découverte, c'était une **copie de
 * tout ce qui commence par un underscore** — et elle promouvait au rang de « module » une
 * chaîne (`_version`), un sac d'état (`_app`), et un ACCESSEUR qu'elle invoquait au passage
 * (`_APIController`).
 *
 * Ce dernier point n'est pas théorique : lire `GeoLeaf._APIController` construit un
 * `APIController`, dont `init()` → `_setupModuleAccess()` → `_scanExistingModules()` **relit
 * l'accesseur en pleine construction**. La récursion a réellement fait exploser la pile en
 * navigateur (`controller.ts:331-340` en garde le récit), et elle n'était retenue que par le
 * parking d'instance posé juste avant `init()`. Le catalogue applique une politique
 * d'accesseur — on enregistre le NOM, on ne lit jamais la valeur — ce qui fait du parking une
 * ceinture au lieu du seul frein.
 *
 * ## Ce qu'il ne prétend PAS faire
 *
 * ⚠️ Il ne préserve pas la sortie de `getModuleList()`. Celle-ci fait l'union avec
 * `Object.keys(gl)` **à chaque appel** : elle suit le namespace par construction, catalogue ou
 * pas. Le plan de sprint annonçait le contraire ; la mesure l'a corrigé (cf. l'en-tête de
 * `__tests__/api/module-discovery.characterisation.test.js`).
 *
 * ## La garde de présence est OBLIGATOIRE
 *
 * Trois noms de `PUBLIC_MODULES` ne sont montés par personne — `POI` (sous-système dissous au
 * S9), `Route` (façade dissoute au S11) et `Constants` (le namespace porte `CONSTANTS`, en
 * capitales). Le `if (gl[name])` de l'ancien code les sautait en silence ; le nouveau les
 * écarte sur `!descriptor`, puisqu'une clé absente n'a pas de descripteur.
 *
 * ⚠️ Ce paragraphe affirmait d'abord qu'une « garde de présence » explicite était OBLIGATOIRE
 * pour eux. **La sonde de rougissement ne l'a pas confirmé** : désarmer cette garde ne rendait
 * aucun test rouge, parce que le cas était déjà couvert en amont. Ce qu'elle garde réellement,
 * c'est la clé PRÉSENTE mais falsy (`_gl.X = undefined` crée bien une propriété propre) — une
 * façade posée à `undefined` n'est pas un module, et la mettre en cache la rendrait
 * indiscernable d'une vraie pour `hasModule`. Les trois noms restent déclarés dans
 * {@link CATALOG_EXPECTED_ABSENT}, ce qui est leur vrai filet.
 */
"use strict";

/**
 * Les modules publics interrogés au boot — liste héritée, conservée telle quelle.
 *
 * ⚠️ Trois entrées ne correspondent à rien au runtime : voir {@link CATALOG_EXPECTED_ABSENT}.
 * Elles restent ici parce que les retirer changerait la sortie de `getModule()` pour un nom
 * qu'un intégrateur pourrait encore interroger — `getModule("POI")` doit rendre `null`, pas
 * `undefined`. C'est le repli sur le namespace qui produit ce `null`, et il n'existe que si le
 * nom traverse la boucle sans être mis en cache.
 */
const PUBLIC_MODULES: readonly string[] = [
    "Core",
    "UI",
    "Config",
    "Baselayers",
    "BaseLayers",
    "POI",
    "GeoJSON",
    "Route",
    "Legend",
    "LayerManager",
    "Storage",
    "Log",
    "Security",
    "Utils",
    "Constants",
    "Validators",
    "Errors",
];

/**
 * Les modules internes du namespace, ÉNUMÉRÉS au lieu d'être balayés au préfixe.
 *
 * 24 entrées — c'était 37 avant que l'API S4.3 n'en retire 13 sans lecteur.
 *
 * ⚠️ Cette liste ne contient PAS `_app`, `_registry`, `_version` ni `_APIController` alors
 * qu'ils sont sur le namespace, et c'est délibéré : ce ne sont pas des modules. `_version` est
 * une chaîne, `_app` un sac d'état, `_registry` l'instance du `ModuleRegistry`, et
 * `_APIController` un accesseur qu'on ne veut pas déclencher. Les mettre en cache n'apportait
 * rien — le balayage les prenait parce qu'ils commencent par `_`, pas parce qu'ils sont des
 * modules. Ils restent atteignables par `getModule()`, via le repli sur le namespace.
 */
const INTERNAL_MODULES: readonly string[] = [
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

/**
 * L'ordre est porteur : les publics d'abord, comme le faisait le balayage historique.
 *
 * ⚠️ `PUBLIC_MODULES` et `INTERNAL_MODULES` ne sont PAS exportés : ce sont des détails de
 * composition, et les exporter les rendait orphelins au sens de `check-orphan-exports` et de
 * knip — les deux l'ont signalé, et ils avaient raison. La surface du module est ce tableau-ci
 * plus {@link CATALOG_EXPECTED_ABSENT}.
 */
export const MODULE_CATALOG: readonly string[] = [...PUBLIC_MODULES, ...INTERNAL_MODULES];

/**
 * Entrées du catalogue dont l'ABSENCE du namespace est attendue et motivée.
 *
 * Le test anti-dérive (`__tests__/api/module-discovery.characterisation.test.js`) exige que
 * toute entrée du catalogue soit montée au runtime, SAUF celles-ci. Une exemption sans motif
 * est indiscernable d'un nom que quelqu'un a cessé de poursuivre — d'où la `Map`.
 */
export const CATALOG_EXPECTED_ABSENT: ReadonlyMap<string, string> = new Map([
    ["POI", "Sous-système POI dissous au S9 — aucun installeur ne monte cette clé."],
    ["Route", "Façade de namespace dissoute au S11 ; la capacité `route` n'a pas de layer B."],
    ["Constants", "Le namespace porte `CONSTANTS`, en capitales. Ce nom-ci n'a jamais existé."],
]);
