---
type: spec-capacite
title: theme-palette — la couleur d'accent de l'interface
capability_id: theme-palette
package: "@geoleaf/core"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 5535694b
date: 27 juillet 2026
---

# theme-palette — la couleur d'accent de l'interface

**Type :** capacité in-core · **Code :** `packages/core/src/capabilities/theme-palette/` ·
**Vérifié contre :** `5535694b` (27/07/2026)

> **Trois règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.
> 3. **Un chemin cité sans racine se lit depuis le répertoire annoncé par « Code : » ci-dessus**,
>    ou depuis son `src/`, et à défaut depuis `packages/core/src/`. Un chemin qui commence par
>    `packages/`, `scripts/`, `profiles/`, `docs/`, `apps/` ou `e2e/` est relatif à la **racine du
>    dépôt**. Les cas qui échappent aux deux sont racinés sur place.

> ⚠️ **Trois voisins portent le mot « theme » et sont ORTHOGONAUX** — cumulables, jamais
> interchangeables :
>
> | Capacité                          | Ce qu'elle change                                  | Où                                                   |
> | --------------------------------- | -------------------------------------------------- | ---------------------------------------------------- |
> | **`theme-palette`** (cette fiche) | La **couleur d'accent** (variables CSS)            | `data-gl-palette` sur `<html>`                       |
> | [`theme-toggle`](theme-toggle.md) | Le mode **clair / sombre**                         | classe `gl-theme-*` sur `<body>`                     |
> | `theme-selector`                  | Les **thèmes de CARTE** (jeux de couches / styles) | issus de `profiles/<profil>/config/core/themes.json` |
>
> Une palette verte en mode sombre sur un thème de carte donné est un état valide. La relation
> `<html>` → `<body>` est **descendante**, et c'est précisément ce qui garde les deux premiers axes
> indépendants.

---

## Périmètre

### Ce que la capacité fait

Elle applique une **palette de couleur d'accent** à l'interface, et — si l'intégrateur le veut —
offre un bouton pour la choisir. C'est **la seule des trois capacités de sélecteur qui bascule sans
recharger** : poser un attribut sur `<html>` suffit, le navigateur repeint seul.

### Ce qu'elle ne fait pas

- **Elle ne gère ni le clair/sombre ni les thèmes de carte** — voir l'encadré ci-dessus.
- **Elle ne définit pas la palette « par défaut ».** `default` est **l'absence d'attribut**, donc
  les jetons du kernel tels quels. Écrire un bloc pour elle dupliquerait ces jetons et divergerait
  au premier changement.
- **Elle ne charge aucune feuille à la demande.** Les deux blocs de palette entrent par le graphe
  de modules JavaScript, via `install.ts` — pas par un `<link>` injecté.
- **Elle ne teinte pas les données cartographiques.** Ce sont des variables CSS d'interface ; les
  styles de couches viennent des profils.

---

## Fonctionnalités

| ID    | Fonctionnalité                                  | Entrée                                                                  | Sortie observable                                                                                           | Code                                              |
| ----- | ----------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| TP-01 | Application de la palette résolue, **toujours** | `ThemePaletteModule.init()`                                             | `data-gl-palette` posé sur `<html>` **avant le premier rendu** — même quand le sélecteur est désactivé      | `lifecycle.ts` → `init` (étape 1)                 |
| TP-02 | Résolution au boot                              | Choix mémorisé, sinon `default` configuré                               | Ordre : choix stocké **connu** → `default` configuré **connu** → `"default"`                                | `palette-engine.ts` → `resolveInitialPalette`     |
| TP-03 | Bascule sans rechargement                       | `set(id)` ou clic dans le popover                                       | L'attribut change, le navigateur repeint — **aucun** rechargement, aucun aller-retour réseau                | `palette-engine.ts` → `applyPalette`              |
| TP-04 | `default` = absence d'attribut                  | `applyPalette("default")`                                               | L'attribut est **retiré** de `<html>` (aucun bloc `data-gl-palette="default"` n'existe)                     | `palette-engine.ts` → `applyPalette`              |
| TP-05 | Persistance du choix                            | `set(id)` par l'utilisateur                                             | Écriture `localStorage["gl-palette"]`                                                                       | `palette-engine.ts` → `applyPalette`              |
| TP-06 | Lecture qui ne réécrit pas                      | Application de la valeur résolue au boot                                | `persist: false` — lire une préférence ne la réécrit pas immédiatement                                      | `lifecycle.ts`, `palette-engine.ts`               |
| TP-07 | Palette inconnue refusée                        | `set("mauve")`                                                          | Avertissement journalisé, **aucun changement d'attribut, aucune écriture**                                  | `palette-engine.ts` → `applyPalette`              |
| TP-08 | Événement de changement                         | Palette appliquée                                                       | `geoleaf:palette-changed` avec `{ palette }` — pour les consommateurs qui reflètent l'accent                | `palette-engine.ts` → `applyPalette`              |
| TP-09 | Bouton dans le bandeau d'onglets desktop        | Seam `geoleaf:desktop-panel:tabs-ready`, capacité activée, ≥ 2 palettes | `.gl-rp-tab-btn.gl-rp-palette-btn` inséré **avant** `.gl-rp-theme-toggle`                                   | `palette-button.ts` → `appendPaletteButtonToTabs` |
| TP-10 | Bouton dans la barre d'outils mobile            | `.gl-map-toolbar__scroll` (repli `.gl-map-toolbar`)                     | Même bouton, plus `.gl-map-toolbar__btn` et `data-variant="mobile"`                                         | `lifecycle.ts` → `_tryInjectMobile`               |
| TP-11 | Attente de la barre d'outils                    | Barre construite après l'`init()`                                       | `MutationObserver` qui injecte puis **se déconnecte**                                                       | `lifecycle.ts` → `init`                           |
| TP-12 | Seuil de deux palettes                          | Une seule palette offerte                                               | **Aucun bouton** — un choix unique est un leurre d'interface                                                | `lifecycle.ts` → `init`                           |
| TP-13 | Popover d'échantillons                          | Clic sur le bouton                                                      | `.gl-palette-popover` en `role="menu"`, une ligne par palette : pastille colorée + libellé en `textContent` | `palette-button.ts` → `_buildPopover`             |
| TP-14 | Reflet **vivant** de la palette active          | Choix dans le popover, popover **resté ouvert**                         | `aria-current` déplacé sur la nouvelle ligne, **sans reconstruire** le popover                              | `palette-button.ts` → `_syncActive`               |
| TP-15 | Fermeture au clic extérieur / `Échap`           | Clic hors du popover, ou `Échap`                                        | Popover retiré ; sur `Échap`, **focus rendu au bouton**. Écoute en phase de **capture**                     | `palette-button.ts` → `_openFor`                  |
| TP-16 | Entrées de palette malformées écartées          | `palettes` édité à la main, entrée sans `id`                            | L'entrée est abandonnée — une pastille qui ne bascule vers rien serait pire                                 | `config.ts` → `getPalettes`                       |
| TP-17 | Liste vide neutralisée                          | `palettes: []`, ou filtre qui ne garde rien                             | Repli sur les palettes intégrées                                                                            | `config.ts` → `getPalettes`                       |
| TP-18 | Navigation privée tolérée                       | `localStorage` indisponible                                             | La palette s'applique à la session, sans être mémorisée — ni au lire ni à l'écrire                          | `palette-engine.ts`                               |
| TP-19 | Démontage complet                               | `ThemePaletteModule.destroy()` / `_reset()`                             | Popover fermé, observateur déconnecté, écouteur du seam détaché, **tous** les boutons retirés du document   | `lifecycle.ts` → `_reset`                         |
| TP-20 | Déclaration introspectable                      | —                                                                       | `getAllCapabilities()` la liste, `getCapabilitySchema("theme-palette")` rend son schéma sans `loader`       | `theme-palette-capability.ts`                     |

⚠️ **TP-01 n'est pas gaté, et c'est la particularité de cette capacité.** Le cycle de vie a **deux**
responsabilités et **seule la seconde** dépend de `enabled` : la palette configurée s'applique
toujours, le bouton est opt-in. Voir §Configuration.

Les tests qui couvrent ces lignes : `packages/core/__tests__/capabilities/theme-palette/`.

---

## Configuration

Bloc `modules.theme-palette` d'un profil. Conformité de cette table au code gardée par
`__tests__/guards/doc-capability-config.guard.test.js`.

| Paramètre  | Type      | Défaut      | Où c'est lu                                                                                                     |
| ---------- | --------- | ----------- | --------------------------------------------------------------------------------------------------------------- |
| `enabled`  | `boolean` | `false`     | `config.ts` → `getThemePaletteConfig()` ; gate **du bouton seulement**, appliqué tardivement par `lifecycle.ts` |
| `default`  | `string`  | `"default"` | `palette-engine.ts` → `resolveInitialPalette()`. **S'applique même quand `enabled` est `false`**                |
| `palettes` | `array`   | `[]`        | `config.ts` → `getPalettes()`. **Vide signifie « les palettes intégrées »**, pas « aucune »                     |

Le bloc vit à la **racine** (`profiles/geoleaf.config.json`) : la palette est une identité visuelle
d'application, pas une propriété du jeu de données affiché.

### Le gate ne commande qu'une moitié de la capacité

C'est la nuance la plus importante de cette fiche, et celle qu'une lecture rapide du gate inverse :

| Comportement                    | Dépend de `enabled` ? |
| ------------------------------- | --------------------- |
| Appliquer la palette `default`  | **Non** — toujours    |
| Afficher le bouton de sélection | Oui                   |

⚠️ **C'est le cas majoritaire en production** : un intégrateur fixe la couleur de sa marque
(`default: "green"`) et **n'offre aucun choix** (`enabled: false`). Toute l'interface est verte, il
n'y a pas de bouton. Si le gate commandait aussi l'application, ce cas serait impossible à exprimer.

C'est aussi la raison du `enableWhenAbsent: true` : le module **doit** être enregistré pour que
l'étape 1 tourne, indépendamment de la visibilité du bouton. La déclaration le dit sur place.

### Les palettes intégrées

`config.ts` → `BUILT_IN_PALETTES` : `default` (Orange), `green` (Vert), `blue` (Bleu), chacune avec
son libellé et la couleur de sa pastille.

⚠️ **`default` ne porte aucune feuille de style**, délibérément : c'est l'absence de l'attribut,
donc `css/geoleaf-theme.css` intact. Une palette « par défaut » écrite en dur dupliquerait les
jetons du kernel et divergerait dès leur premier changement.

Deux replis protègent `palettes`, pour la même raison que chez
[`language-switcher`](language-switcher.md) : un popover vide est un cul-de-sac. Liste absente ou
vide → les intégrées ; entrées sans `id` → écartées ; filtre qui ne garde rien → les intégrées.

---

## Contrat exposé

### API publique

`GeoLeaf.ThemePalette`, construit par `public-api.ts` → `buildPublicApi()`, monté par `install.ts` →
`registerGlobals(gl)`, re-exporté par la façade ESM `src/api/geoleaf.theme-palette.ts` (sans
logique — gate `scripts/check-facade-purity.cjs`).

| Membre        | Rend / fait                                                                   |
| ------------- | ----------------------------------------------------------------------------- |
| `list()`      | Les palettes offertes (`id`, `label`, `swatch`)                               |
| `get()`       | La palette appliquée — **lue sur le DOM** (`<html>`), pas sur un état interne |
| `set(id)`     | Applique **immédiatement** et persiste — **valide l'`id` d'abord**            |
| `isEnabled()` | `true` quand `modules.theme-palette.enabled === true` (le **bouton**)         |
| `getConfig()` | Le bloc `modules.theme-palette` fusionné sur les défauts                      |

⚠️ **`get()` lit le DOM, et c'est volontaire** : l'attribut sur `<html>` **est** l'état. Un cache
interne pourrait divulguer un écart avec ce que l'utilisateur voit ; ici c'est structurellement
impossible.

⚠️ **`isEnabled()` ne dit pas « la palette est active »** mais « le bouton est offert ». Une palette
est toujours appliquée, y compris quand cette méthode rend `false`.

Typage publié : `src/global.d.ts`, section des capacités (`ThemePalette?:` →
`ThemePalettePublicApi`). Ne pas citer de numéro de ligne pour ce fichier.

### Événements

| Événement                          | Sens                     | Détail                                                                  |
| ---------------------------------- | ------------------------ | ----------------------------------------------------------------------- |
| `geoleaf:palette-changed`          | **émis**                 | `{ palette: string }` — **typé** dans `contracts/event-bus.contract.ts` |
| `geoleaf:desktop-panel:tabs-ready` | **écouté** (seam kernel) | Porte le bandeau d'onglets vivant — le point d'insertion desktop        |

⚠️ **L'émission est enveloppée d'un `try/catch` qui avale tout**, délibérément : un constructeur
`CustomEvent` absent ne doit pas empêcher la bascule de palette elle-même. Le changement visuel a
déjà eu lieu quand l'événement part.

Contrairement à l'événement écouté par [`theme-toggle`](theme-toggle.md), celui-ci **est typé** —
il n'est pas dans la baseline des événements non typés.

### Stockage écrit

`localStorage["gl-palette"]` (`PALETTE_STORAGE_KEY`), durable. Lecture et écriture sont **toutes
deux** protégées : la lecture ne jette jamais, l'écriture journalise et continue.

Il n'y a **pas** de paramètre d'URL, contrairement à `language-switcher` et `profile-switcher` :
la palette n'a pas à voyager dans un lien partagé, c'est une préférence d'affichage locale.

---

## Décisions de conception

| Décision                                              | Pourquoi                                                                                                                                                                                                                      | Alternative écartée                                                                              |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Un attribut sur `<html>`, pas un `<link>` injecté** | Un `<link>` mis en place au runtime est du CSS **hors du graphe de modules** : ni tree-shakeable, ni couvert par la cascade `@layer`, et il obligeait la construction du déployé à copier un répertoire de CSS                | Le `<link>` injecté — c'est ce que faisait l'ancienne couche de démonstration                    |
| **Bascule à chaud, sans rechargement**                | Changer une variable CSS ne demande ni nouvelle requête ni reconstruction du DOM. C'est la **seule** des trois capacités de sélecteur qui peut s'en passer                                                                    | Recharger, par symétrie avec `profile-switcher` et `language-switcher` — un rechargement gratuit |
| **Application avant le premier rendu**                | Poser l'attribut dans `module.init()` évite le flash de la couleur par défaut vers la couleur choisie qu'un `app:ready` produirait                                                                                            | Appliquer sur `geoleaf:app:ready`                                                                |
| **Le gate ne commande que le bouton**                 | L'intégrateur qui fixe une couleur de marque **et** n'offre aucun choix est le cas majoritaire en production. Gater l'application le rendrait inexprimable                                                                    | Un gate unique commandant les deux                                                               |
| **`persist: false` à la résolution du boot**          | Lire une préférence ne doit pas la réécrire : sinon la valeur configurée par l'intégrateur serait gravée dans le stockage du visiteur au premier chargement, et cesserait de suivre le profil                                 | Toujours persister                                                                               |
| **`default` = absence d'attribut**                    | Aucun bloc CSS à écrire pour elle : c'est le thème kernel nu. Un bloc explicite dupliquerait les jetons et divergerait au premier changement                                                                                  | Un bloc `data-gl-palette="default"`                                                              |
| **Palettes récupérées depuis git, jamais réécrites**  | Les deux feuilles existaient et étaient réglées en clair **et** en sombre, contraste compris. Les recomposer de mémoire aurait réintroduit des régressions déjà résolues — seuls les sélecteurs de tête ont changé            | Les réécrire                                                                                     |
| **Cascade `@layer gl.capabilities`**                  | Cette couche vient **après** celle des jetons dans l'ordre déclaré : les surcharges de palette gagnent **sans `!important`** et sans guerre de spécificité                                                                    | Des `!important`, ou une élévation de spécificité                                                |
| **`get()` lit le DOM**                                | L'attribut **est** l'état. Un état interne parallèle pourrait divulguer un écart avec ce que l'utilisateur voit                                                                                                               | Un cache module-local                                                                            |
| **Reflet vivant du popover** (`_syncActive`)          | La bascule est instantanée : le popover reste ouvert, donc il doit refléter le nouveau choix sans être reconstruit — sinon la sélection affichée mentirait                                                                    | Reconstruire le popover, ou le fermer au choix                                                   |
| **Pastille colorée écrite par propriété CSSOM**       | La couleur vient de la configuration, donc ne peut pas vivre dans la feuille. Une écriture propriété par propriété (`applyCssText`) **n'est pas soumise** à la directive CSP `style-src`, contrairement à un attribut `style` | Un attribut `style` — bloqué par la CSP du dépôt                                                 |
| **Seuil de deux palettes**                            | Un choix unique annonce une option qui n'existe pas                                                                                                                                                                           | Toujours afficher le bouton                                                                      |
| **Émission d'événement en `try/catch` muet**          | Le changement visuel a déjà eu lieu ; un environnement sans `CustomEvent` ne doit pas transformer une bascule réussie en erreur                                                                                               | Laisser remonter                                                                                 |
| **Pas de paramètre d'URL**                            | La palette est une préférence d'affichage locale, pas une propriété du contenu partagé                                                                                                                                        | Un `?palette=` — aurait fait voyager une préférence esthétique dans les liens                    |
| Pas de `loader`                                       | Inline avec le bundle UI ; le gate de configuration décide de la visibilité du bouton                                                                                                                                         | Un `import()` paresseux                                                                          |

---

## Dépendances et frontières

### Dépendance de cycle de vie

`module.ts` → `ThemePaletteModule` : `id = "theme-palette"`, `dependencies = ["geojson"]`.
`init()` **n'utilise pas la carte** : l'attribut va sur `<html>` et le bouton dans le bandeau
d'onglets ou la barre d'outils.

Position dans `presets/manifest.full.ts` : **appendue en dernier** au moment de son ajout, pour la
même raison que ses deux sœurs — aucune icône de barre d'outils mobile, dépendance de module
identique, donc position libre, et appendre laisse tous les index antérieurs intacts.

⚠️ **Conséquence observable de cet ordre, et elle n'est déclarée nulle part** :
[`language-switcher`](language-switcher.md) et cette capacité insèrent **toutes deux** leur bouton
_avant_ `.gl-rp-theme-toggle`. Celle qui injecte en dernier se retrouve donc la plus proche du
toggle. Comme `theme-palette` est enregistrée après `language-switcher` dans le manifeste, l'ordre
rendu est **langue, puis palette, puis toggle de thème**. Cet ordre dépend de l'ordre du manifeste,
pas d'une position déclarée : le changer réordonne les boutons.

### Frontière `capabilities/` → `kernel/` (règle ESLint R.8)

| Import                                               | Statut vis-à-vis de R.8                  |
| ---------------------------------------------------- | ---------------------------------------- |
| `kernel/config/config-primitives.js`                 | **Exception** nommée par la règle        |
| `kernel/ui/desktop/desktop-tabs-seam.js` (type seul) | **Seam** — exception nommée par la règle |

Le reste passe par `utils/` : `utils/log`, `utils/i18n` (`getLabel`), et
`utils/general/dom-helpers` (`domCreate`, `applyCssText`). **Aucun accès à la carte**, aucun
`IMapAdapter` utilisé. **Aucune référence à un plugin** — règle `no-plugin-in-core`.

### Frontière côté CSS, et son avertissement corrigé

`css/theme-palette.css` tire les deux blocs de palette par `@import` — un `@import` **nu**, sans
`layer()`, parce que **chaque fichier de palette s'enveloppe lui-même** dans
`@layer gl.capabilities`. `install.ts` importe cette feuille unique, ce qui fait entrer bouton,
popover **et** les deux palettes dans le graphe de modules : une entrée qui omet l'installeur ne
livre ni le code ni les palettes.

⚠️ **Trois en-têtes de ces feuilles annonçaient une protection qui n'existe pas**, requalifiés le
27/07/2026 : ils affirmaient que les sélecteurs `:root[data-gl-palette=…]` étaient « safelistés dans
`scripts/lib/purgecss-config.cjs` ». Mesuré — ce fichier ne contient **aucune** entrée de palette,
et `scripts/verify-purgecss.baseline.json` non plus.

Ce qui les livre réellement : **purgecss n'est pas une étape du build CSS**. Le pipeline est
rollup + `postcss-import` + cssnano (`packages/core/rollup.config.mjs`, `cssExtract`) ;
`scripts/verify-purgecss.cjs` est une gate de **rapport**. Vérification :

```bash
grep -o 'data-gl-palette=[a-z]*' packages/core/dist/geoleaf-main.min.css | sort -u
```

⚠️ **Le risque résiduel est réel et il est ouvert au backlog.** Ces sélecteurs ne portent **aucune
classe**, donc la gate purgecss ne les regarde pas : ni safelistés, ni baselinés, ni signalés morts.
S'ils cessaient d'être atteints, rien ne rougirait — et si purgecss devenait un jour une étape de
build, les deux blocs tomberaient. Une sonde le montre : un contenu qui ne cite pas littéralement
`data-gl-palette="blue"` fait purger le bloc bleu.

---

## Écarts au CDC source

Le CDC `CDC_capacite-theme-palette.md` (v1.0.0, 25/07/2026) a été **consommé** en écrivant cette
fiche, puis retiré du dossier de tri — trace au §Journal des décisions de
`roadmap_documentation-v3.md`.

| Énoncé du CDC                                                        | Ce que dit le code                                                                                                                                 |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| « `theme-selector` agit sur des conteneurs `#gl-theme-*-container` » | `theme-selector` lit le `config/core/themes.json` de chaque profil ; le CDC décrivait un mécanisme DOM qui n'est pas celui de la capacité actuelle |
| Gate présenté comme un opt-in simple                                 | Le gate ne commande que **le bouton** ; la palette configurée s'applique toujours. Le CDC le disait en prose ailleurs, pas dans la table           |
| « les 2 blocs de palette sont safelistés purgecss »                  | **Faux**, et corrigé dans les trois en-têtes CSS concernés — voir §Frontière côté CSS                                                              |
| Exemple de configuration listant les 3 palettes en clair             | Utile pédagogiquement, mais `palettes: []` suffit : les intégrées s'appliquent. Le schéma annonce `[]`, pas la liste                               |

Ce qui a été **retenu** du CDC et ne se lit pas dans le code : les cas d'usage (démonstration
client « GeoLeaf s'habille à vos couleurs », intégrateur aux couleurs de sa marque — le cas
majoritaire —, préférence utilisateur sur un portail public, intégrateur indifférent), la
récupération des feuilles depuis git plutôt que leur réécriture, et les alternatives écartées de la
table §Décisions.
