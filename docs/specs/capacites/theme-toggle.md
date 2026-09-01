---
type: spec-capacite
title: theme-toggle — le bouton de bascule clair / sombre posé sur la carte
capability_id: theme-toggle
package: "@geoleaf/core"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: e52f91de
date: 1er septembre 2026
---

# theme-toggle — le bouton de bascule clair / sombre posé sur la carte

**Type :** capacité in-core · **Code :** `packages/core/src/capabilities/theme-toggle/` ·
**Vérifié contre :** `e52f91de` (01/09/2026)

> **Trois règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — quand une quantité compte, la commande qui
>    l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier (chemin, LOC, exports réels,
>    en-tête de module) est déjà dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée
>    par `docs:tree:check`. Cette fiche **renvoie**, elle ne recopie pas.
> 3. **Un chemin cité sans racine se lit depuis le répertoire annoncé par « Code : » ci-dessus**,
>    ou depuis son `src/`, et à défaut depuis `packages/core/src/`. Un chemin qui commence par
>    `packages/`, `scripts/`, `profiles/`, `docs/`, `apps/` ou `e2e/` est relatif à la **racine du
>    dépôt**. Les cas qui échappent aux deux sont racinés sur place.

---

## Périmètre

### Ce que la capacité fait

Elle pose **un bouton sur la carte** qui fait basculer l'interface entre thème clair et thème
sombre, et garde son icône synchronisée avec le thème courant quelle que soit la source du
changement.

### Ce qu'elle ne fait pas

- **Elle n'est pas le moteur de thème.** `_UITheme` (`kernel/ui/theme.ts`) reste **kernel** : il
  résout le thème initial, applique les classes `gl-theme-dark` / `gl-theme-light`, persiste le
  choix utilisateur, écoute `matchMedia` et émet `geoleaf:ui-theme-changed`. Cette capacité en
  est un **déclencheur parmi d'autres** — le panneau desktop
  (`kernel/ui/desktop/desktop-panel-theme.ts`) et le thème de carte (`kernel/map/theme.ts`) sont
  des consommateurs frères, qui fonctionnent sans elle.
- 🛑 **Et il existe un SECOND bouton de bascule, qui n'est pas celui-ci.** `GeoLeaf.UI.init()`
  (`kernel/ui/ui-api.ts` → `_initThemeControl`) délègue à `GeoLeaf.UI.initThemeToggle`
  (= `_UITheme.initThemeToggle`, monté par `globals/globals.ui.ts`), qui câble un bouton **fourni
  par l'intégrateur** et repéré par `[data-gl-role="theme-toggle"]` : le kernel y pose lui-même
  `role`/`tabindex`, le clic, le clavier, l'`aria-pressed` et les mêmes libellés
  `aria.theme.toggle_to_{light,dark}`. C'est un bouton **hors carte**, que cette capacité
  n'installe ni ne connaît. Les deux chemins pilotent le même moteur et se resynchronisent par le
  même événement, mais aucun des deux n'a besoin de l'autre — et c'est le frère le plus facile à
  confondre avec celui-ci, parce qu'il porte le même nom.
- **Elle ne choisit pas la palette d'accent** — c'est la capacité `theme-palette`, un axe
  orthogonal (voir `contracts/event-bus.contract.ts`, qui énonce l'orthogonalité des trois axes).
- **Elle ne fournit pas de sélecteur de thème nommé** — c'est `theme-selector`, dont la LISTE de
  thèmes vient de `profiles/<profil>/config/core/themes.json`. ⚠️ Son **activation**, elle, passe
  bien par `modules.theme-selector.enabled` — même forme de gate qu'ici, `enableWhenAbsent: true`
  compris : ce qui les sépare est la source des thèmes, pas la nature de la clé.
- **Elle n'expose aucune commande impérative.** Aucun `show()` / `hide()` / `toggle()` public :
  le bouton est piloté par la configuration, la bascule elle-même passe par le moteur kernel.
- **Elle n'apporte pas de feuille de style.** Voir §Décisions de conception.

---

## Fonctionnalités

| ID    | Fonctionnalité                      | Entrée                                                           | Sortie observable                                                                                                              | Code                                                           |
| ----- | ----------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| TT-01 | Bouton posé sur la carte            | `ThemeToggleModule.init(adapter)` avec `enabled: true`           | Contrôle `.geoleaf-ctrl-theme-toggle.geoleaf-ctrl-group.geoleaf-ctrl` ajouté via `adapter.addControl` à `position`             | `theme-toggle.ts` → `initThemeToggleControl`                   |
| TT-02 | Bascule clair ↔ sombre              | Clic, ou `Enter` / `Espace` sur le lien                          | `_UITheme.toggleTheme()` → classes `gl-theme-dark` / `gl-theme-light` sur `body` et le conteneur de carte, et l'événement      | `theme-toggle.ts` → `toggleHandler`, `keydownHandler`          |
| TT-03 | Icône synchronisée avec le thème    | Événement `geoleaf:ui-theme-changed`, **toute source**           | Soleil affiché quand le thème est sombre, lune quand il est clair (bascule par `style.display`)                                | `theme-toggle.ts` → `_syncState`, `themeChangedHandler`        |
| TT-04 | Étiquettes accessibles et traduites | idem TT-03                                                       | `role="button"`, `aria-pressed` = « le thème est sombre », `aria-label` + `title` issus de `aria.theme.toggle_to_{light,dark}` | `theme-toggle.ts` → `_syncState` + `utils/i18n` → `getLabel`   |
| TT-05 | Icônes SVG sans `innerHTML`         | —                                                                | Deux `<svg>` (soleil, lune) construits par le helper de sécurité, jamais par affectation de HTML                               | `theme-toggle.ts` → `DOMSecurity.createSVGIcon`                |
| TT-06 | Neutralisation de la propagation    | Interaction dans le contrôle                                     | Ni pan ni zoom parasite de la carte sous le bouton                                                                             | `theme-toggle.ts` → `blockMapPropagation`                      |
| TT-07 | Montage idempotent                  | Plusieurs appels au montage                                      | Un seul contrôle ; les appels suivants sont inertes                                                                            | `lifecycle.ts` → drapeau `_started`                            |
| TT-08 | Démontage complet                   | `ThemeToggleModule.destroy()` ou `ThemeToggleLifecycle._reset()` | Contrôle retiré de la carte **et** tous les écouteurs détachés (clic, clavier, événement global, propagation)                  | `theme-toggle.ts` → `_destroyThemeToggleControl` + `_cleanups` |
| TT-09 | Garde « carte absente »             | `initThemeToggleControl(null)`                                   | Aucun contrôle, un `Log.warn`, retour `undefined` — pas de throw                                                               | `theme-toggle.ts` → garde d'entrée                             |
| TT-10 | Déclaration introspectable          | —                                                                | `GeoLeaf.Introspection.getAllCapabilities()` la liste, `getCapabilitySchema("theme-toggle")` rend son schéma sans `loader`     | `theme-toggle-capability.ts`                                   |

Les tests qui couvrent ces lignes : `packages/core/__tests__/capabilities/theme-toggle/`.

---

## Configuration

Bloc `modules.theme-toggle` d'un profil. Les deux clés ci-dessous sont déclarées dans le
`configSchema` de `theme-toggle-capability.ts` **et** matérialisées par les `DEFAULTS` de
`config.ts` — la cohérence des deux est gardée par
`__tests__/capabilities/config-schema-defaults.test.js`, et la conformité de cette table au code
par `__tests__/guards/doc-capability-config.guard.test.js`.

| Paramètre  | Type      | Défaut      | Où c'est lu                                                                                            |
| ---------- | --------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| `enabled`  | `boolean` | `false`     | `config.ts` → `getThemeToggleConfig()` ; **décide de la visibilité** dans `lifecycle.ts` (gate tardif) |
| `position` | `string`  | `"topleft"` | `config.ts` → `getThemeToggleConfig()` ; passé à `adapter.addControl` par `initThemeToggleControl`     |

### Le double gate, et pourquoi il n'y a pas de contradiction

C'est le point le plus facile à documenter de travers, parce que la déclaration et le
comportement observable disent des choses opposées :

| Étage                                                       | Valeur                                   | Ce qu'il décide                                             |
| ----------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------- |
| Gate de déclaration — `theme-toggle-capability.ts` → `gate` | `configPath` + `enableWhenAbsent: true`  | **L'exécution de `init()`**, sur la configuration fusionnée |
| Gate tardif — `lifecycle.ts`                                | `cfg.enabled !== true` → retour immédiat | **La visibilité du bouton**, sur la configuration fusionnée |

`enableWhenAbsent: true` ne veut donc **pas** dire « activé par défaut » : la clé absente, le gate
répond `true` et le module **s'exécute** — il ne décide plus de son **enregistrement**.
⚠️ `presets/apply-preset.ts` → `gatedModule` enregistre tous les modules du manifeste sans
condition et n'évalue le gate qu'à l'intérieur d'`init()`, que le registre appelle **après** la
fusion du profil. Les deux étages lisent donc la **même** configuration ; ce qui les sépare n'est
plus le moment, mais la question posée. Le **défaut destiné à l'intégrateur est OFF** (`enabled: false`) — le bouton
n'apparaît que si la configuration fusionnée porte `modules.theme-toggle.enabled === true`.

Migré de l'ancien drapeau profile-level `ui.showThemeToggle`.

---

## Contrat exposé

### API publique

`GeoLeaf.ThemeToggle`, construit par `public-api.ts` → `buildPublicApi()`, monté par
`install.ts` → `registerGlobals(gl)`, et re-exporté par la façade ESM
`src/api/geoleaf.theme-toggle.ts`.

| Membre        | Rend                                                    |
| ------------- | ------------------------------------------------------- |
| `isEnabled()` | `true` quand `modules.theme-toggle.enabled === true`    |
| `getConfig()` | Le bloc `modules.theme-toggle` fusionné sur les défauts |

Deux lectures, aucune écriture — voir §Décisions de conception.

Typage publié : `src/global.d.ts`, section des capacités (`ThemeToggle?:` → l'interface
`ThemeTogglePublicApi`). ⚠️ **Ne pas citer de numéro de ligne pour ce fichier** : il est réécrit
au fil du typage du namespace, et la roadmap V3 en citait déjà une plage périmée.

### Événements

| Événement                  | Sens            | Détail                                                                                                                                                                                                                               |
| -------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `geoleaf:ui-theme-changed` | **écouté** seul | Émis par le moteur kernel (`kernel/ui/theme.ts`), pas par cette capacité. Sert à resynchroniser l'icône, l'`aria-pressed` et le libellé, y compris quand la bascule vient d'ailleurs (auto-détection, `applyTheme`, panneau desktop) |

Cet événement fait partie des **non typés** — il figure dans
`scripts/.baselines/event-map-coverage.json`, dont la liste ne peut que décroître (EM-02). Il n'a
donc pas d'interface de détail dans `contracts/event-bus.contract.ts` ; le code lit son `detail`
défensivement et retombe sur `_UITheme.getCurrentTheme()`.

La capacité **n'émet aucun événement**.

---

## Décisions de conception

| Décision                                                               | Pourquoi                                                                                                                                                                                                                                                                                     | Alternative écartée                                                                                                                                                    |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Le moteur de thème reste **kernel**, seul le bouton est une capacité   | `_UITheme` sert aussi le panneau desktop et le thème de carte, et résout le thème au boot. Le rendre optionnel casserait le boot ; le bouton, lui, est retirable sans conséquence                                                                                                            | Embarquer le moteur dans la capacité — aurait rendu `theme-toggle` non tree-shakeable de fait                                                                          |
| **Deux gates** au lieu d'un                                            | Une capacité profile-level doit voir son module enregistré **avant** la fusion, sinon l'opt-in tardif est impossible ; la visibilité, elle, ne peut se décider que **après** la fusion                                                                                                       | Un gate unique pré-fusion : le profil n'aurait plus jamais pu activer le bouton                                                                                        |
| **Aucune feuille de style propre**                                     | Le kernel possède le **rôle** `.geoleaf-ctrl` (reset, chrome du bouton, hover, icône) dans `src/css/geoleaf-controls.css`, et ce fichier **ne doit jamais nommer une capacité**. theme-toggle n'a rien de spécifique à styler : la visibilité des deux icônes est pilotée en `style.display` | Des sélecteurs groupés côté kernel (`.geoleaf-ctrl-zoom, …, .geoleaf-ctrl-theme-toggle { … }`) — c'est exactement ce qui **soudait** la capacité au bundle avant le S6 |
| Classes `gl-theme-toggle-icon--sun` / `--moon` posées mais non stylées | Ce sont des **points d'accroche** pour l'intégrateur et les tests, pas des sélecteurs actifs : aucune règle CSS du dépôt ne les cible (`grep` sur `packages/*/src`)                                                                                                                          | Les retirer — priverait l'intégrateur du seul moyen de cibler une icône plutôt que l'autre                                                                             |
| API publique en **lecture seule**                                      | Le bouton est _fire-and-forget_ : la config décide de sa présence, le moteur kernel de l'état du thème. Une commande impérative créerait un second chemin de vérité sur un état déjà porté par `_UITheme`                                                                                    | Exposer `show()` / `hide()` / `toggle()` sur `GeoLeaf.ThemeToggle`                                                                                                     |
| Pas de `loader`                                                        | La capacité est _inline_, chargée avec le bundle UI ; c'est le gate de configuration qui décide, pas un `import()`                                                                                                                                                                           | Un chargement paresseux — coût d'un aller-retour réseau pour quelques centaines de lignes déjà dans la clôture                                                         |
| Icônes construites par `DOMSecurity.createSVGIcon`                     | Les tracés SVG sont des constantes statiques, mais le dépôt interdit `innerHTML` hors des helpers de sécurité — la règle vaut aussi quand l'entrée est sûre, sinon elle devient négociable                                                                                                   | `innerHTML` avec une chaîne SVG littérale                                                                                                                              |

---

## Dépendances et frontières

### Dépendance de cycle de vie

`module.ts` → `ThemeToggleModule` : `id = "theme-toggle"`, `dependencies = ["geojson"]`. La
capacité monte **après la carte** ; le tri topologique du registre de modules place son `init()`
en conséquence. Sa position dans `presets/manifest.full.ts` n'est pas libre — l'ordre
d'enregistrement est observable par introspection et sert de départage au tri, et le manifeste le
documente sur place, lot par lot.

### Frontière `capabilities/` → `kernel/` (règle ESLint R.8)

Tous les accès kernel passent par un **baril** ou par une exception nommée par la règle :

| Import                                     | Statut vis-à-vis de R.8                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `kernel/ui/index.js` (`_UITheme`)          | Baril — conforme                                                                      |
| `kernel/security/index.js` (`DOMSecurity`) | Baril — conforme                                                                      |
| `kernel/config/config-primitives.js`       | **Exception explicite** de la règle, qui la nomme avec les hubs de types et les seams |

Si un symbole manque sur un baril, **l'élargir est le geste que la règle désigne** — le
contourner, non.

### Contrats et utilitaires

- Contrats : `contracts/map-adapter.contract.js` — `IMapAdapter`, `GeoLeafControl`,
  `GeoLeafControlPosition`. La capacité ne touche jamais MapLibre directement (une règle ESLint
  interdit à `capabilities/**` d'importer `adapters/maplibre/*`).
- Utilitaires : `utils/log`, `utils/i18n`, `utils/general/dom-helpers` (`domCreate`),
  `utils/controls/propagation-blocker` (`blockMapPropagation`).
- **Aucun seam** : la capacité ne renverse aucune dépendance.
- **Aucune référence à un plugin** — règle `no-plugin-in-core`, vérifiée par
  `scripts/verify-core-standalone.cjs`.

### Frontière côté CSS

Le rôle visuel `.geoleaf-ctrl` appartient au kernel (`src/css/geoleaf-controls.css`, dont
l'en-tête énonce « KERNEL ONLY. This file must never name a capability »). La capacité
**consomme** ce rôle en posant la classe ; elle n'apporte pas de feuille et n'en exige pas.
