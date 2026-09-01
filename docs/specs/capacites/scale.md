---
type: spec-capacite
title: scale — la barre d'échelle graphique, l'échelle numérique éditable et le niveau de zoom
capability_id: scale
package: "@geoleaf/core"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: e52f91de
date: 1er septembre 2026
---

# scale — l'échelle graphique, l'échelle numérique éditable et le niveau de zoom

**Type :** capacité in-core · **Code :** `packages/core/src/capabilities/scale/` ·
**Vérifié contre :** `e52f91de` (01/09/2026)

> 🧭 **Contrat ici, mode d'emploi ailleurs.** Cette fiche dit ce que le sujet **doit**
> faire : périmètre, table de configuration gatée, contrat exposé, frontières. Les recettes
> et les exemples pas à pas sont dans [`packages/core/docs/config/SCALE_CONFIG.md`](../../../packages/core/docs/config/SCALE_CONFIG.md). **Les deux ne se recopient pas** — une
> divergence entre elles est un défaut, pas une nuance de point de vue.

> **Trois règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.
> 3. **Un chemin cité sans racine se lit depuis le répertoire annoncé par « Code : » ci-dessus**,
>    ou depuis son `src/`, et à défaut depuis `packages/core/src/`. Un chemin qui commence par
>    `packages/`, `scripts/`, `profiles/`, `docs/`, `apps/` ou `e2e/` est relatif à la **racine du
>    dépôt**. Les cas qui échappent aux deux sont racinés sur place.

> ⚠️ **Ne pas remplacer ce contrôle par celui de MapLibre.** La question a été posée, mesurée, et
> **tranchée dans l'autre sens** : le recouvrement se réduit à un aide de sept lignes, et ce contrôle
> fait quatre choses que celui du moteur ne sait pas faire. Le verdict est consigné dans l'en-tête de
> `scale-control.ts` précisément pour que la ressemblance de surface ne relance pas le débat. Détail
> en §Décisions.

---

## Périmètre

### Ce que la capacité fait

Elle affiche, dans un même bandeau, jusqu'à trois relevés :

- une **barre d'échelle graphique** dont la longueur s'ajuste à une valeur ronde ;
- une **échelle numérique** `1:N`, **éditable** — l'utilisateur tape une échelle et la carte y va ;
- le **niveau de zoom** courant.

Elle fournit aussi le conteneur auquel [`coordinates`](coordinates.md) vient s'amarrer.

### Ce qu'elle ne fait pas

- **Elle ne calcule pas l'échelle.** La formule de Mercator vit dans le kernel
  (`scale-utils`), partagée avec le gestionnaire de visibilité et `labels`. Seul le **contrôle** est
  une capacité.
- **Elle n'offre que le métrique.** Ni impérial, ni nautique — là où le contrôle de MapLibre les
  propose. Basculer serait un changement de fonctionnalité **dans les deux sens**, pas un échange.
- **Elle ne localise pas ses nombres**, et c'est une décision tranchée, pas une localisation en
  attente. Voir §Décisions — la « corriger » casserait la saisie dans cinq langues sur six.
- **Elle n'internationalise pas ses étiquettes** : `Zoom: …`, `km`, `m` sont écrits en dur, comme
  chez [`coordinates`](coordinates.md).

---

## Fonctionnalités

| ID    | Fonctionnalité                       | Entrée                                               | Sortie observable                                                                                                                                                                                                                                                      | Code                                                                           |
| ----- | ------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| SC-01 | Montage différé                      | Événement `geoleaf:app:ready`                        | Le bandeau apparaît une fois l'application prête — écouteur `{ once: true }`                                                                                                                                                                                           | `lifecycle.ts` → `init`, `_onAppReady`                                         |
| SC-02 | Conteneur unique                     | Montage                                              | `.gl-scale-main-wrapper` en mise en page horizontale, puis les blocs demandés                                                                                                                                                                                          | `scale-control.ts` → `_createMainContainer`                                    |
| SC-03 | Barre d'échelle graphique            | `scaleGraphic: true`                                 | `.gl-scale-graphic` + `.gl-scale-graphic-line` dont la **largeur en pixels** et l'étiquette suivent une valeur ronde                                                                                                                                                   | `scale-control.ts` → `_addGraphicScaleToContainer`, `_updateScaleLine`         |
| SC-04 | Arrondi à une valeur « propre »      | Distance mesurée quelconque                          | Longueur choisie dans la progression 1 / 2 / 3 / 5 / 10 de la puissance de dix courante                                                                                                                                                                                | `scale-control.ts` → `_getRoundNum`                                            |
| SC-05 | Unité adaptée                        | Distance mesurée                                     | Kilomètres au-delà d'un kilomètre, mètres sinon                                                                                                                                                                                                                        | `scale-control.ts` → `_updateScaleLine`                                        |
| SC-06 | Mesure par projection réelle         | Zoom ou déplacement                                  | La distance est obtenue en projetant **deux points de l'écran** puis en mesurant entre eux — pas par une formule d'écran                                                                                                                                               | `scale-control.ts` → `_addGraphicScaleToContainer`                             |
| SC-07 | Échelle numérique                    | `scaleNumeric: true`, `scaleNumericEditable: false`  | `.gl-scale-numeric` affichant `1:N`                                                                                                                                                                                                                                    | `scale-control.ts` → `_updateScale`                                            |
| SC-08 | Échelle numérique **éditable**       | `scaleNumericEditable: true`                         | Un préfixe `1:`, un dénominateur cliquable, et un champ de saisie qui le remplace en édition                                                                                                                                                                           | `scale-control.ts` → `_createCustomScaleBlock`, `_switchToEditMode`            |
| SC-09 | Saisie d'une échelle                 | L'utilisateur tape `250 000` puis valide             | La carte va au zoom correspondant, à centre constant                                                                                                                                                                                                                   | `scale-control.ts` → `_onScaleInputChange`                                     |
| SC-10 | Saisie invalide                      | Texte non numérique, ou zéro                         | Avertissement journalisé **et remise de la valeur affichée** — jamais de déplacement de carte                                                                                                                                                                          | `scale-control.ts` → `_onScaleInputChange`                                     |
| SC-11 | Zoom cible : amorce puis convergence | Échelle demandée                                     | Amorce par l'inverse analytique `zoomAtScale`, puis raffinement itératif amorti ; résultat arrondi à 4 décimales et **borné à `[0 ; 22]`** — la plage du contrôle, pas celle de MapLibre                                                                               | `scale-control.ts` → `_calculateZoomFromScale`                                 |
| SC-12 | Séparateur de milliers par espace    | Dénominateur à plusieurs groupes                     | `380585` s'affiche `380 585` — espace ASCII, obtenu par un parcours de droite à gauche, **sans expression régulière**                                                                                                                                                  | `scale-control.ts` → `_formatNumber`                                           |
| SC-13 | Niveau de zoom                       | `scaleNivel: true`                                   | `.gl-scale-zoom` affichant `Zoom: <n>` à deux décimales                                                                                                                                                                                                                | `scale-control.ts` → `_updateScale`                                            |
| SC-14 | Le champ en édition n'est pas écrasé | Une mise à jour de zoom arrive **pendant** la saisie | Le dénominateur n'est réécrit que si le champ de saisie est masqué                                                                                                                                                                                                     | `scale-control.ts` → `_updateScale`                                            |
| SC-15 | Garde « aucun relevé demandé »       | Les trois relevés désactivés                         | **Rien n'est monté** — reproduit la garde de l'ancien contrôle                                                                                                                                                                                                         | `lifecycle.ts` → `_onAppReady`                                                 |
| SC-16 | Démontage complet                    | `ScaleModule.destroy()` / `_reset()`                 | Écouteurs de carte détachés, contrôle retiré, conteneur retiré **par ceinture et bretelles**, toutes les références remises à `null`                                                                                                                                   | `scale-control.ts` → `destroy`                                                 |
| SC-17 | Déclaration introspectable           | —                                                    | `getAllCapabilities()` la liste, `getCapabilitySchema("scale")` rend son schéma sans `loader`                                                                                                                                                                          | `scale-capability.ts`                                                          |
| SC-18 | Carte neutralisée sous le champ      | `scaleNumericEditable: true`                         | Le bloc éditable **arrête la propagation** de `click`, `dblclick`, `mousedown`, `touchstart`, `wheel` et `contextmenu` en phase bulle — un clic ou une molette dans le champ ne déplace ni ne zoome la carte ; les désabonnements sont empilés et rejoués au démontage | `scale-control.ts` → `_createEditableScale` (`blockMapPropagation`), `destroy` |

Les tests qui couvrent ces lignes : `packages/core/__tests__/capabilities/scale/`.

---

## Configuration

Bloc `modules.scale` d'un profil. Conformité de cette table au code gardée par
`__tests__/guards/doc-capability-config.guard.test.js`.

| Paramètre              | Type      | Défaut         | Où c'est lu                                                                                   |
| ---------------------- | --------- | -------------- | --------------------------------------------------------------------------------------------- |
| `enabled`              | `boolean` | `true`         | `config.ts` → `getScaleConfig()` ; gate **opt-out**, revérifié tardivement par `lifecycle.ts` |
| `scaleGraphic`         | `boolean` | `true`         | `lifecycle.ts` puis `scale-control.ts` → `_createMainContainer`                               |
| `scaleNumeric`         | `boolean` | `true`         | `scale-control.ts` → `_createCustomScaleBlock`                                                |
| `scaleNumericEditable` | `boolean` | `true`         | `scale-control.ts` → `_createCustomScaleBlock`, `_updateScale`                                |
| `scaleNivel`           | `boolean` | `true`         | `scale-control.ts` → `_createZoomLevel`                                                       |
| `position`             | `string`  | `"bottomleft"` | `scale-control.ts` → `_createMainContainer`                                                   |

C'est la capacité de ce palier qui expose le **plus** de paramètres, et tous les relevés sont
**actifs par défaut** : les défauts intégrés reproduisent le bloc `scaleConfig` uniforme des profils
réels, de sorte que le bandeau se rend sans aucune configuration de profil.

Migré de l'ancien drapeau `ui.showScale` **et** de l'ancien bloc `scaleConfig`.

### Deux gates, plus une garde de cohérence

| Étage                                          | Décide                                               |
| ---------------------------------------------- | ---------------------------------------------------- |
| Gate de déclaration (`enableWhenAbsent: true`) | L'enregistrement du module, pré-fusion               |
| Gate tardif (`lifecycle.ts`)                   | `enabled !== false` sur la configuration fusionnée   |
| **Garde de cohérence** (`lifecycle.ts`)        | **Aucun** des trois relevés actif ⇒ rien n'est monté |

La troisième n'est pas un gate de configuration mais une garde de bon sens, héritée de l'ancien
contrôle : un bandeau vide occuperait de la place sans rien dire. ⚠️ Noter que
`scaleNumericEditable` **ne compte pas** dans cette garde — c'est un modificateur de
`scaleNumeric`, pas un relevé à part.

---

## Contrat exposé

### API publique

`GeoLeaf.Scale`, construit par `public-api.ts` → `buildPublicApi()`, monté par `install.ts` →
`registerGlobals(gl)`, re-exporté par la façade ESM `src/api/geoleaf.scale.ts`.

Sa forme est **le singleton runtime augmenté** (`Object.assign`), comme
[`branding`](branding.md) et [`coordinates`](coordinates.md) :
`ScalePublicApi = typeof ScaleControl & ScaleReadApi`.

| Membre              | Origine            | Rend / fait                                      |
| ------------------- | ------------------ | ------------------------------------------------ |
| `init(map, config)` | contrôle           | Monte le bandeau (appelé par le cycle de vie)    |
| `destroy()`         | contrôle           | Démonte et détache tout                          |
| `isEnabled()`       | helper de capacité | `true` quand `modules.scale.enabled !== false`   |
| `getConfig()`       | helper de capacité | Le bloc `modules.scale` fusionné sur les défauts |

⚠️ **`isEnabled()` teste `!== false`** — gate opt-out, comme [`cluster`](cluster.md) et
[`coordinates`](coordinates.md).

Typage publié : `src/global.d.ts`, section des capacités (`Scale?:` → `ScalePublicApi`). Ne pas
citer de numéro de ligne pour ce fichier.

### Événements

| Événement            | Sens                         | Rôle                                                     |
| -------------------- | ---------------------------- | -------------------------------------------------------- |
| `geoleaf:app:ready`  | **écouté**, `{ once: true }` | Déclenche le montage                                     |
| `zoomend`, `moveend` | **écoutés sur l'adaptateur** | Recalculent la barre graphique et les relevés numériques |

La capacité **n'émet aucun événement**. Les écouteurs de carte sont mémorisés dans un sac de
gestionnaires, ce qui permet un détachement exact au démontage — sur la **même référence** que
celle passée à l'abonnement.

### Le conteneur qu'elle fournit aux autres

`.gl-scale-main-wrapper` est le point d'amarrage de [`coordinates`](coordinates.md), et
`packages/core/src/capabilities/scale/css/scale.css` **style les deux nœuds que `coordinates` crée dans ce conteneur** — le séparateur et le relevé lui-même. Ce couplage n'est déclaré dans
aucun `dependencies` — il est documenté des deux côtés, ici et dans la fiche de `coordinates`.

---

## Décisions de conception

| Décision                                                            | Pourquoi                                                                                                                                                                                                                                                                                                                    | Alternative écartée                                                                                                   |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Réimplémentation assumée**, pas le contrôle de MapLibre           | Mesuré : le moteur ne fournit **ni** échelle numérique, **ni** échelle éditable, **ni** relevé de niveau de zoom, **ni** ce format de nombre. Le recouvrement réel est un aide de sept lignes que le moteur garde privé, donc non réutilisable                                                                              | Le remplacer — la question a été ouverte, instruite et **fermée** ; le verdict est écrit dans le fichier              |
| **La formule d'échelle reste kernel**                               | Elle est partagée par le gestionnaire de visibilité et `labels` : une copie locale avait déjà **dérivé** avant d'être supprimée                                                                                                                                                                                             | Garder un calcul privé au contrôle                                                                                    |
| **Mesure par projection de deux points d'écran**                    | Cela donne la distance **réelle** au sol pour une largeur d'écran donnée, quelle que soit la latitude, sans réimplémenter la géodésie                                                                                                                                                                                       | Une formule d'écran approchée                                                                                         |
| **Longueur arrondie à une valeur « propre »**                       | Une barre annonçant « 3,742 km » est illisible ; l'œil a besoin d'un repère rond                                                                                                                                                                                                                                            | Afficher la valeur exacte                                                                                             |
| **Espace ASCII comme séparateur de milliers — CHOIX TRANCHÉ**       | Deux raisons, dans cet ordre : c'est le séparateur ISO 31-0 / SI, non ambigu partout ; et il est **porteur pour la saisie**, puisque la relecture du champ reparse cette sortie même                                                                                                                                        | `Intl.NumberFormat` — proposé, **mesuré, puis fermé** : voir l'encadré ci-dessous                                     |
| **Format de nombre écrit en boucle, pas en expression régulière**   | L'expression régulière évidente imbrique un quantificateur dans une anticipation, ce que la règle de sécurité signale ; la désactiver reposait sur une **borne de type** qu'un élargissement ultérieur aurait rendue fausse **sans qu'aucune gate ne le voie**. La boucle **supprime la question** au lieu de la documenter | La regex plus un `eslint-disable` justifié                                                                            |
| **Amorce analytique, puis raffinement amorti du zoom cible**        | L'inverse exact `zoomAtScale` donne l'amorce ; la boucle amortie (20 passes, facteur 0,95, sortie dès que l'écart d'échelle est < 1) absorbe l'arrondi entier de `scaleAtZoom` et évite les oscillations, avant un bornage à `[0 ; 22]` — la plage du contrôle, plus étroite que le `[0 ; 24]` de `scaleToZoom`             | La **seule** inversion en forme fermée, sans raffinement — pas l'inversion elle-même, qui est utilisée                |
| **Le champ en édition n'est jamais écrasé**                         | Sans cette garde, un déplacement de carte pendant la saisie remplacerait ce que l'utilisateur est en train de taper                                                                                                                                                                                                         | Rafraîchir inconditionnellement                                                                                       |
| **Une saisie invalide remet la valeur affichée**                    | Laisser un texte invalide dans le champ ferait croire qu'il a été pris en compte                                                                                                                                                                                                                                            | Laisser la saisie en place, ou lever                                                                                  |
| **Rien n'est monté si aucun relevé n'est demandé**                  | Un bandeau vide occupe le coin de la carte sans rien apporter                                                                                                                                                                                                                                                               | Monter le conteneur quand même — et casser en prime l'amarrage de `coordinates`, qui le prendrait pour un hôte valide |
| **Retrait du conteneur « par ceinture et bretelles » au démontage** | Le contrôle est retiré par la poignée de l'adaptateur **et** le conteneur est décroché du DOM : les deux chemins existent parce que le nœud principal n'est pas toujours celui que l'adaptateur a enregistré                                                                                                                | Se fier au seul retrait par la poignée                                                                                |
| **Étiquettes non internationalisées** (`Zoom:`, `km`, `m`)          | Mêmes abréviations conventionnelles que chez `coordinates`. Choix assumé, cohérent entre les deux relevés du même bandeau — mais c'est bien un choix, pas un oubli                                                                                                                                                          | Passer par l'i18n                                                                                                     |
| Pas de `loader`                                                     | Inline avec le bundle UI ; le gate de configuration décide                                                                                                                                                                                                                                                                  | Un `import()` paresseux                                                                                               |

### ⚠️ Le format de nombre : pourquoi la localisation a été refusée

C'est la décision la mieux instruite de cette capacité, et celle qu'on est le plus tenté de
« réparer ». Une ligne de backlog proposait `Intl.NumberFormat` ; elle a été **mesurée sur les six
langues fournies puis fermée**.

1. **Ambiguïté.** Quatre des six langues groupent les milliers avec un point. `1:250.000` se lit
   alors comme un **décimal** quand le nombre est un dénominateur d'échelle. Localiser échangerait un
   séparateur neutre contre un séparateur ambigu — sur ce champ précis, c'est une régression.
2. **La sortie est relue en entrée.** La saisie de l'échelle reparse **cette même sortie** en
   retirant les espaces puis en lisant un entier. Mesuré : avec un séparateur localisé, cinq des six
   langues appliqueraient silencieusement une échelle **1:250** au lieu de 1:250 000. Le français ne
   survit que par accident, son séparateur ICU étant une espace fine insécable que la classe
   d'espaces reconnaît.

Localiser ce champ demanderait donc de **dériver le séparateur de groupe et de réécrire l'analyse
dans le même geste** — pour un relevé moins bon. Le motif complet est dans le TSDoc de
`_formatNumber`, avec la vérification d'équivalence de la boucle par rapport à l'expression
régulière qu'elle remplace.

---

## Dépendances et frontières

### Dépendance de cycle de vie

`module.ts` → `ScaleModule` : `id = "scale"`, `dependencies = ["geojson"]`. L'adaptateur reçu à
l'`init()` est **capturé** puis utilisé au montage, comme chez [`coordinates`](coordinates.md) —
c'est ce qui permet de différer sans perdre la poignée de carte.

Sa position dans `presets/manifest.full.ts` est celle du lot des contrôles de carte simples.

⚠️ **Ordre de fait avec `coordinates`** : `scale` doit avoir construit son conteneur pour que
`coordinates` s'y amarre. Ce n'est **pas** garanti par une dépendance déclarée — les deux montent sur
le même événement. C'est l'observateur de mutations de `coordinates` qui absorbe l'incertitude, avec
son délai de repli. Ne pas « simplifier » ce dispositif en supposant un ordre.

### Frontière `capabilities/` → `kernel/` (règle ESLint R.8)

| Import                                       | Statut vis-à-vis de R.8                          |
| -------------------------------------------- | ------------------------------------------------ |
| `kernel/config/config-primitives.js`         | **Exception** nommée par la règle                |
| La formule d'échelle (`scale-utils`, kernel) | Consommée, **jamais recopiée** — voir ci-dessous |

Le reste passe par `utils/` : `utils/log`, `utils/general/dom-helpers` (`domCreate`),
`utils/controls/propagation-blocker`, `utils/geo/haversine` — et `utils/general/scale-utils`, que
cette liste omettait pour l'avoir rangé dans la ligne « kernel » ci-dessus. S'y ajoute un import de
**types seuls** depuis `contracts/map-adapter.contract.js` (`GeoLeafControl`, `GeoLeafLatLng`,
`GeoLeafPoint`), effacé à la compilation. La liste se relit à la commande, jamais de mémoire :
`grep -n '^import' packages/core/src/capabilities/scale/scale-control.ts`.

⚠️ **La formule de Mercator est consommée, pas dupliquée**, et l'histoire est instructive : le
contrôle en portait une **copie privée**, qui a **dérivé** de la version kernel. Elle a été
supprimée au profit d'un appel unique. ⚠️ Cette ligne annonçait ensuite « trois consommateurs », en
les nommant — un compte recopié, et il a divergé : le décompte se dérive, il ne s'écrit pas ici.

```bash
grep -rl 'scale-utils\.js' packages/core/src --include=*.ts
```

Et la source unique **porte désormais ses vérificateurs**, ce que cette section ne disait pas :
`packages/core/__tests__/capabilities/kernel-reuse.test.js` recalcule chaque valeur attendue **avec**
la primitive partagée, donc toute re-fork numérique rougit quelle que soit son écriture ; et un bloc
`no-restricted-syntax` d'`eslint.config.mjs` interdit la copie littérale de la constante de Mercator
(`156543.03392` et sa forme arrondie), en nommant le symbole à importer. Ni `knip` ni la sonde
d'exports orphelins ne pouvaient tenir ce rôle : `scaleAtZoom` a aussi des appelants internes à son
propre module, donc une re-fork les laisserait verts.

De même, la distance géodésique est un **utilitaire partagé** par trois capacités, et la projection
d'un point d'écran est une **méthode du contrat d'adaptateur** : aucune des deux n'est une
réimplémentation locale. L'en-tête de `scale-control.ts` le dit nommément, pour couper court à une
seconde accusation de duplication.

### Contrats

Comme [`branding`](branding.md) et [`coordinates`](coordinates.md), la capacité se donne une vue
**structurelle** locale de l'adaptateur (`scale-control.ts` → `MapLike`, ré-exportée en
`ScaleMapLike`) plutôt que de dépendre de tout `IMapAdapter`. Elle ne touche jamais MapLibre
directement.

**Aucun seam**, et **aucune référence à un plugin** — règle `no-plugin-in-core`, vérifiée par
`scripts/verify-core-standalone.cjs`.

### Frontière côté CSS

`css/scale.css`, sous `@layer gl.capabilities`, tirée par `install.ts` — donc elle se tree-shake
avec le code.

⚠️ **Elle style DEUX nœuds qu'elle ne crée pas** : `.gl-scale-separator` **et**
`.gl-scale-coordinates` sont créés par [`coordinates`](coordinates.md) et habillés ici — y compris
la reprise mobile, où la feuille bascule le bandeau en deux rangées, met le relevé de coordonnées
seul sur la première et masque le séparateur au profit d'un `border-bottom`. La fiche n'en nommait
qu'un, ce qui sous-estimait exactement ce que la phrase suivante annonce. Le couplage est
bidirectionnel et **implicite** :
`coordinates` écrit dans le DOM de `scale`, et dépend du CSS de `scale`. Aucune gate ne le vérifie ;
retirer une règle de séparateur d'ici casse l'apparence d'une autre capacité.

La feuille partage aussi le conteneur `.maplibregl-ctrl-bottom-left` avec `branding`, `legend` et
`coordinates` — voir l'avertissement de `packages/core/src/capabilities/branding/css/branding.css`, qui en possède la mise en page.
