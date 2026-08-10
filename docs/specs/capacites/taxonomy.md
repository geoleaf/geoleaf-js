---
type: spec-capacite
title: taxonomy — le symbole du point, piloté par la donnée
capability_id: taxonomy
package: "@geoleaf/core"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 81aa8d29
date: 28 juillet 2026
---

# taxonomy — le symbole du point, piloté par la donnée

**Type :** capacité in-core · **Code :** `packages/core/src/capabilities/taxonomy/` ·
**Vérifié contre :** `81aa8d29` (28/07/2026)

> **Deux règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.

> ⚠️ **Capacité de POLITIQUE, purement en lecture tirée.** Elle n'a **ni module, ni cycle de vie,
> ni écouteur, ni installeur de preset au-delà du montage du namespace**. Elle ne s'exécute jamais
> d'elle-même : six familles de consommateurs viennent lui demander une icône, une expression de
> peinture ou une couleur de badge, et elle répond. Même forme que
> [`vector-tiles`](vector-tiles.md) et [`cluster`](cluster.md) — mais avec, contrairement à elles,
> **la plus grosse surface de configuration du dépôt**.

---

## Périmètre

### Ce que la capacité fait

Elle traduit un **mapping déclaratif `valeur de colonne → symbole`** en quatre sorties : l'**icône**
du point sur la carte (et sa teinte), la **pastille** colorée sous cette icône, le **glyphe de
titre** des surfaces de détail, et la **couleur des badges** catégorie / sous-catégorie. Elle sert
aussi, en lecture, la légende et le filtre.

### Ce qu'elle ne fait pas

- **Elle ne pilote pas la TAILLE du point.** `circle-radius` reste intégralement au style de couche.
  Le motif est explicite : un `marker` est déclaré **par catégorie**, or une même catégorie sert
  plusieurs couches de rayons différents — un rayon en taxonomie les uniformiserait.
- **Elle ne colore pas la géométrie.** Le remplissage d'un polygone, le trait d'une polyligne, la
  couleur métier d'un point restent aux `styleRules` de la couche. Taxonomie ne s'occupe que du
  **symbole**.
- **Elle n'outrepasse jamais la couche.** Elle ne réécrit que la **branche par défaut** d'une
  peinture existante — voir §La règle cardinale.
- **Elle ne pose aucun nœud DOM.** Elle **décide** des couleurs de badge ; c'est `feature-info` qui
  les pose.
- **Elle ne s'abonne à rien** et ne se déclenche jamais seule.

---

## Fonctionnalités

| ID    | Fonctionnalité                                    | Entrée                                                        | Sortie observable                                                                                                             | Code                                                      |
| ----- | ------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| TX-01 | Liaison d'une couche à une taxonomie              | `layers.<layerId>.use`                                        | Le couple (taxonomie, colonne catégorie) de la couche ; `null` si la couche n'est pas liée ou si la taxonomie est inconnue    | `resolver.ts` → `resolveLayerBinding`                     |
| TX-02 | `categoryField` obligatoire, sans repli implicite | Liaison sans `categoryField` ni côté couche ni côté taxonomie | La liaison est **abandonnée** — pas de retour tacite sur `categoryId`                                                         | `resolver.ts` → `resolveLayerBinding`                     |
| TX-03 | Surcharge de colonne par couche                   | `layers.<id>.categoryField` / `subCategoryField`              | Prime sur la déclaration de la taxonomie — deux couches partagent une taxonomie avec des noms de colonne différents           | `resolver.ts` → `resolveLayerBinding`                     |
| TX-04 | Recherche de catégorie **insensible à la casse**  | Valeur d'entité quelconque                                    | Essai exact, puis majuscules, puis minuscules, puis balayage replié — les profils migrés se comportent à l'identique          | `resolver.ts` → `resolveCategoryKey`                      |
| TX-05 | Lecture d'attribut sur trois formes               | Entité GeoLeaf, GeoJSON ou POI                                | Racine de l'objet, puis `attributes`, puis `properties` — la première valeur non nulle gagne                                  | `resolver.ts` → `readField`                               |
| TX-06 | Icône de carte                                    | `resolvePoiIcon(feature)`                                     | `{ useIcon, iconId, symbolId }` ; priorité sous-catégorie → catégorie → `icons.defaultIcon`                                   | `resolver.ts` → `resolvePoiIcon`                          |
| TX-07 | Teinte du glyphe                                  | `iconColor` de la sous-catégorie, sinon de la catégorie       | Suffixe `--<clé>` ajouté à l'identifiant de l'image MapLibre                                                                  | `tint.ts` → `resolveIconTint`, `tintedSymbolId`           |
| TX-08 | **Sans teinte, aucun suffixe**                    | Catégorie sans `iconColor`                                    | L'identifiant reste **byte-identique** à ce qu'il était avant la teinte — c'est l'invariant qui protège les profils existants | `tint.ts` → `tintedSymbolId`                              |
| TX-09 | Clé de teinte sûre pour un identifiant            | `#6A1B9A`, `rgb(255, 0, 0)`, …                                | `6a1b9a`, `rgb-255-0-0` — les suites de caractères non alphanumériques **s'effondrent** en un seul `-`, jamais en rien        | `tint.ts` → `tintKey`                                     |
| TX-10 | Énumération des variantes à rasteriser            | `getIconVariants()`                                           | Seulement les couples (icône × teinte) qu'une entité peut réellement atteindre — **jamais** le produit cartésien              | `resolver.ts` → `resolveIconVariants`                     |
| TX-11 | Glyphe de titre en surface de détail              | `resolveTitleIcon(layerId, feature, surface)`                 | Identifiant **brut**, non teinté, pour un `<use href="#…">` ; `null` si aucun drapeau de la surface n'est activé              | `resolver.ts` → `resolveTitleIcon`                        |
| TX-12 | Pastille : peinture de la couche complétée        | `resolveMarkerPaint(layerId, existingPaint)`                  | Les seules clés que la taxonomie a à dire, déjà **greffées** dans la peinture existante ; `null` si elle n'a rien à dire      | `marker-paint.ts` → `buildMarkerPaint`                    |
| TX-13 | Imbrication catégorie → sous-catégorie            | Deux sous-catégories homonymes dans deux catégories           | La correspondance est **imbriquée**, donc `nature.parc` et `Environnement.PARC` ne se confondent pas                          | `marker-paint.ts` → `buildRoleMatch`, `buildSubMatch`     |
| TX-14 | `marker: false` — l'icône nue                     | Catégorie déclarant `marker: false`                           | `circle-opacity: 0` et `circle-stroke-width: 0` — le disque est **masqué**, pas peint en transparent                          | `marker-paint.ts` → `MARKER_ROLES`                        |
| TX-15 | `strokeWidth: 0` reste une valeur                 | Catégorie déclarant explicitement `0`                         | La valeur passe telle quelle — un disque sans bordure est un choix, pas une absence                                           | `marker-paint.ts` → `MARKER_ROLES`                        |
| TX-16 | Peinture non démontable : abstention              | Peinture injectée par `expressionPaint`, non construite ici   | La clé est **laissée intacte** — on ne démonte pas une expression qu'on n'a pas produite                                      | `marker-paint.ts` → `deriveFallback`                      |
| TX-17 | Couleur de badge                                  | `resolveBadgeStyle(layerId, feature, surface, field)`         | Fond, bordure et **couleur de texte calculée** ; `null` si la surface n'a pas opté pour les badges colorés                    | `badge.ts` → `resolveBadgeStyle`                          |
| TX-18 | Routage du badge par **nom de colonne**           | Champ `properties.categoryId` sans attribut `style`           | Le nom est comparé aux colonnes de la liaison — un routage par `style` laisserait des surfaces non colorées                   | `badge.ts` → `bareField`, `resolveBadgeStyle`             |
| TX-19 | Contraste du texte de badge                       | Fond hexadécimal                                              | Texte clair ou sombre selon la **luminance relative WCAG** ; repli sur le texte clair quand le fond n'est pas lisible         | `badge.ts` → `pickTextColor`                              |
| TX-20 | `marker: false` ne prête pas ses couleurs         | Sous-catégorie `false`, catégorie colorée                     | **Aucun badge coloré** — `false` est une déclaration, pas une omission, donc il n'hérite pas                                  | `badge.ts` → `resolveBadgeStyle`                          |
| TX-21 | L'omission, elle, hérite                          | Sous-catégorie sans `marker`, catégorie colorée               | La sous-catégorie porte les couleurs de sa catégorie, sur la carte comme sur la pastille                                      | `badge.ts` → `resolveBadgeStyle`                          |
| TX-22 | Couleurs validées avant sortie                    | `marker.fill` invalide                                        | Écarté — l'appelant peut assigner la valeur au DOM sans re-valider                                                            | `badge.ts` → `safeColor`                                  |
| TX-23 | Lecture par couche plutôt que par taxonomie       | `getLayerCategories(layerId)`                                 | Résout `layers.<id>.use` pour l'appelant, qui n'a donc pas à dupliquer la table de liaison                                    | `public-api.ts`                                           |
| TX-24 | Injection du sprite à la demande                  | `ensureSprite()`                                              | Les `<symbol>` du sprite du profil sont dans le DOM ; idempotent, et **sans effet** quand la capacité est éteinte             | `public-api.ts`, `utils/loaders/profile-sprite-loader.ts` |
| TX-25 | Gate **total**                                    | `modules.taxonomy.enabled: false`                             | Plus d'icônes, plus de pastille, plus de badges, plus d'icônes de légende, plus d'options de filtre par catégorie             | tous les lecteurs de `public-api.ts`                      |
| TX-26 | Déclaration introspectable **complète**           | `getCapabilitySchema("taxonomy")`                             | Les **cinq** sous-arbres que le runtime lit, pas la seule clé `enabled`                                                       | `taxonomy-capability.ts`                                  |

Les tests qui couvrent ces lignes : `packages/core/__tests__/capabilities/taxonomy/` (sept
fichiers, dont un de **parité** contre le profil de référence).

---

## Configuration

Bloc `modules.taxonomy` d'un profil. Conformité de cette table au code gardée par
`__tests__/guards/doc-capability-config.guard.test.js`.

| Paramètre    | Type      | Défaut | Où c'est lu                                                                                                                  |
| ------------ | --------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `enabled`    | `boolean` | `true` | `config.ts` → `getTaxonomyConfig()` ; consulté par **tous** les lecteurs de `public-api.ts`. **Opt-out, et total**           |
| `icons`      | `object`  | —      | `public-api.ts` → `getIcons()`. Le **bloc lui-même est le gate des icônes** : absent, la légende n'affiche aucune icône      |
| `render`     | `object`  | —      | `resolver.ts` → `resolveTitleIcon`, `badge.ts` → `resolveBadgeStyle`. Consommé par `feature-info` à travers le seam          |
| `taxonomies` | `object`  | —      | `resolver.ts` → `resolveLayerBinding`. Clés = **données utilisateur** (noms de taxonomies), donc pas de propriétés énumérées |
| `layers`     | `object`  | —      | `resolver.ts` → `resolveLayerBinding`. Clés = identifiants de couches. Une couche absente n'est **liée à rien**              |

⚠️ **Les quatre blocs n'ont pas de défaut, et c'est une information, pas un trou.** Le code ne
matérialise aucune valeur pour eux : `getTaxonomyConfig()` ne fusionne que `enabled`. Un bloc absent
signifie donc « la taxonomie n'a rien à dire », jamais « valeur implicite ».

### Les sous-clés que le schéma déclare, et leurs défauts

Le `configSchema` de cette capacité est le plus profond du dépôt — il a été élargi de **1 clé sur
~19 consommées** à ses cinq sous-arbres réels, parce qu'un schéma partiel rend la taxonomie
invisible à `getCapabilitySchema` et donc au studio.

| Sous-clé                               | Type      | Défaut  | Effet                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------- | --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `icons.spriteUrl`                      | `string`  | —       | URL du sprite. **Absent : aucune icône ne résout**                                                                                                                                                                                                                                                                                                                              |
| `icons.symbolPrefix`                   | `string`  | `""`    | Préfixe de l'identifiant de `<symbol>`. ⚠️ **Ne pas le répéter dans `svgId`** — double préfixe                                                                                                                                                                                                                                                                                  |
| `icons.defaultIcon`                    | `string`  | —       | Repli quand une catégorie ne résout aucune icône                                                                                                                                                                                                                                                                                                                                |
| `icons.iconSize`                       | `number`  | `0.5`   | `icon-size` MapLibre. Seul un nombre **strictement positif** est honoré. ⚠️ MapLibre 6 a **désactivé la mise à l'échelle des icônes par l'offset** (changement de rendu assumé en amont) : sans effet ici, le dépôt ne posant **ni `icon-offset` ni `icon-translate`** (mesuré le 08/08/2026) — mais c'est ce qui rendrait un décalage visible si l'un des deux était introduit |
| `icons.showOnMap`                      | `boolean` | `true`  | Seul un `false` explicite éteint les icônes de légende                                                                                                                                                                                                                                                                                                                          |
| `render.<surface>.showIconCategory`    | `boolean` | `false` | Glyphe de catégorie près du titre                                                                                                                                                                                                                                                                                                                                               |
| `render.<surface>.showIconSubcategory` | `boolean` | `false` | Idem pour la sous-catégorie                                                                                                                                                                                                                                                                                                                                                     |
| `render.<surface>.colorBadges`         | `boolean` | `false` | Colore les badges de cette surface                                                                                                                                                                                                                                                                                                                                              |

`<surface>` vaut `popup`, `tooltip` ou `sidepanel`.

Ce que le schéma ne détaille **pas**, délibérément : le contenu de `taxonomies` et de `layers`.
Leurs clés sont des données utilisateur — noms de taxonomies, identifiants de couches — et les
énumérer n'aurait pas de sens. Même traitement que la feuille opaque `mapping` de la gate de
couverture de configuration.

Une entrée de `taxonomies.<nom>` porte : `categoryField` (**obligatoire**), `subCategoryField`
(facultatif), une table `categories` et une table facultative `fieldMappings` (valeur brute →
catégorie, lue par le générateur de légende). Une entrée de `categories.<valeur>` porte `svgId`,
`iconColor`, `label`, `marker` et `subcategories`.

⚠️ **`marker` a trois états, pas deux** — et les confondre change le rendu :

| Valeur de `marker` | Sens                                          | Effet sur la pastille                        |
| ------------------ | --------------------------------------------- | -------------------------------------------- |
| **absent**         | « la taxonomie n'a rien à dire »              | Le style de couche garde entièrement la main |
| **objet**          | `fill` / `stroke` / `strokeWidth`             | Ces trois clés sont pilotées                 |
| **`false`**        | « icône nue » — une **déclaration** explicite | Disque masqué, et **aucune couleur prêtée**  |

Il n'y a **pas** de `marker.radius`, et c'est une décision : la taille appartient à la couche.

---

## La règle cardinale — la taxonomie remplace le DÉFAUT, elle ne surclasse pas la couche

C'est le point le plus important de cette fiche, et celui qu'une lecture rapide inverse.

Le convertisseur de style émet, pour toute clé de peinture qui varie selon les règles de style d'une
couche, une expression `["case", condition₁, valeur₁, …, DÉFAUT]`. La taxonomie ne réécrit que
**le dernier élément** — le défaut — en une correspondance sur la colonne de catégorie, qui elle-même
retombe sur cet ancien défaut. La cascade effective est donc :

```
règles de style  >  sous-catégorie  >  catégorie  >  défaut propre de la couche
```

Une couche qui colore ses points par `mag` ou par `fclass` continue de le faire ; la taxonomie ne
colore que **ce que la couche n'a pas dit**.

⚠️ **Et elle s'abstient quand elle ne peut pas garantir cela** : face à une expression MapLibre
qu'elle n'a pas construite (injectée par `expressionPaint`), elle laisse la clé entièrement
tranquille plutôt que de tenter de la démonter.

---

## Les deux espaces d'identifiants — le piège central

Deux résolutions d'icône coexistent et **leurs identifiants ne sont pas interchangeables**. Les
confondre ne produit aucune erreur : le glyphe disparaît, en silence.

| Résolution         | Destination                   | Forme de l'identifiant                                       |
| ------------------ | ----------------------------- | ------------------------------------------------------------ |
| `resolvePoiIcon`   | `icon-image` → atlas MapLibre | **Teinté** — suffixe `--<clé>` quand une couleur est résolue |
| `resolveTitleIcon` | `<use href="#…">` → DOM       | **Brut** — un identifiant teinté ne pointe sur rien          |

Le glyphe de titre prend sa couleur de `currentColor`, pas d'une teinte cuite dans l'image.

**Pourquoi une teinte cuite dans l'identifiant plutôt qu'un `icon-color` MapLibre** : MapLibre ne
recolore que les images SDF, et GeoLeaf n'utilise pas de sprite MapLibre — il rasterise lui-même
chaque `<symbol>` sur un canevas et l'enregistre par `addImage()`. Rasteriser une fois par teinte est
donc le geste le moins cher, sans SDF et sans couche supplémentaire. Les sprites multicolores gardent
leurs remplissages explicites : seul `currentColor` est teinté.

---

## Contrat exposé

### API publique

`GeoLeaf.Taxonomy`, construit par `public-api.ts` → `buildPublicApi()`, monté par `install.ts` →
`registerGlobals(gl)`, re-exporté par la façade ESM `src/api/geoleaf.taxonomy.ts` (sans logique —
gate `scripts/check-facade-purity.cjs`).

| Membre                                                | Rend / fait                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `isEnabled()`                                         | `true` sauf `modules.taxonomy.enabled === false`                                            |
| `getIcons()`                                          | Le bloc `icons`, ou `null` — source de vérité du sprite, de la taille et du gate de légende |
| `resolvePoiIcon(feature)`                             | L'icône de carte — identifiant d'**atlas**, teinté                                          |
| `getIconVariants()`                                   | Les couples (icône × teinte) à rasteriser                                                   |
| `getCategories(ref)` · `getFieldMappings(ref)`        | Les tables d'une taxonomie **nommée** — lues par la légende et le filtre                    |
| `getLayerCategories(layerId)`                         | Les catégories liées à une **couche**, `use` résolu pour l'appelant                         |
| `resolveMarkerPaint(layerId, existingPaint)`          | Les surcharges de peinture du disque, greffées dans l'existant                              |
| `resolveTitleIcon(layerId, feature, surface)`         | Le glyphe de titre — identifiant **DOM**, brut                                              |
| `resolveBadgeStyle(layerId, feature, surface, field)` | Fond, bordure et texte du badge, déjà validés                                               |
| `ensureSprite()`                                      | Injecte les `<symbol>` du profil, idempotent                                                |

⚠️ **`getLayerCategories` existe pour empêcher une faute précise.** `getCategories` demande un
**nom de taxonomie**, que seule la table `layers` connaît : lire cette table depuis l'extérieur
revient à dupliquer la résolution de liaison. C'est exactement ainsi que le formulaire d'ajout de POI
a fini par lire une clé de profil qui n'a jamais existé, et par n'afficher **aucun** champ de
catégorie.

Typage publié : `src/global.d.ts`, section des capacités. Ne pas citer de numéro de ligne pour ce
fichier.

### Événements

**Aucun, dans les deux sens.** C'est la conséquence directe du modèle en lecture tirée : la capacité
ne se réveille jamais d'elle-même.

### Stockage écrit

Aucun.

---

## Décisions de conception

| Décision                                                               | Pourquoi                                                                                                                                                                                                                                                                                                                      | Alternative écartée                                                          |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Purement en lecture tirée, aucun cycle de vie**                      | La cible n'exige rien de plus : il suffit que la taxonomie **fournisse une expression** et que l'adaptateur la consomme à la construction de la peinture. Le « peintre » qui existait avant était **mort** — son gate opt-in lisait une clé de ressource de profil avant la fusion, donc son module n'était jamais enregistré | Un module avec cycle de vie qui applique la peinture, comme avant la refonte |
| **Gate opt-out, et TOTAL**                                             | Le même piège de calendrier : la clé vit dans une **ressource de profil**, chargée après la lecture du gate de boot. Un gate opt-in lirait `undefined` et éteindrait la capacité pour **tous** les profils                                                                                                                    | Opt-in — c'est ce qui gardait l'ancien peintre mort                          |
| **Seul `enabled === false` éteint**                                    | Sémantique stricte : `0`, `""` et `null` ne comptent pas pour faux. Une valeur ambiguë ne doit pas éteindre silencieusement toute la symbologie                                                                                                                                                                               | Un test de véracité JavaScript                                               |
| **La taxonomie remplace le défaut, jamais les règles de style**        | Une couche qui colore par un attribut métier a une raison de le faire. Surclasser ses règles ferait disparaître une intention explicite au profit d'une convention                                                                                                                                                            | Écraser la peinture de la couche                                             |
| **Abstention devant une expression étrangère**                         | On ne démonte pas une expression qu'on n'a pas construite. Le faire produirait une peinture syntaxiquement valide et sémantiquement fausse                                                                                                                                                                                    | Tenter de réécrire quand même                                                |
| **Correspondance imbriquée catégorie → sous-catégorie**                | Les libellés de sous-catégorie ne sont uniques **qu'à l'intérieur** d'une catégorie : une correspondance plate replierait deux sous-catégories homonymes sur la même couleur, sans erreur                                                                                                                                     | Une correspondance plate sur la colonne de sous-catégorie                    |
| **Teinte cuite dans l'identifiant de l'image**                         | Le pipeline rasterise déjà chaque `<symbol>` et cuit `currentColor`. Paramétrer ce blanc est le geste le moins cher : ni SDF, ni couche supplémentaire, et les sprites multicolores gardent leurs remplissages                                                                                                                | `icon-color` (exige du SDF), ou une couche d'icônes par teinte               |
| **Sans teinte, aucun suffixe**                                         | Les profils qui ne déclarent aucune couleur gardent des identifiants **byte-identiques**. Briser cet invariant ferait pointer `icon-image` sur des identifiants jamais enregistrés — icônes disparues, aucun test rouge                                                                                                       | Toujours suffixer                                                            |
| **La clé de teinte effondre, elle ne supprime pas**                    | Supprimer les caractères non alphanumériques replierait `rgb(255,0,0)` et `rgb(25,50,0)` sur la même clé. Les effondrer garde des couleurs distinctes distinctes — et interdit au séparateur d'apparaître dans la clé                                                                                                         | Un simple filtrage des caractères                                            |
| **Pas de `marker.radius`**                                             | Un `marker` est déclaré **par catégorie**, une catégorie sert plusieurs couches, et leurs rayons diffèrent. Un rayon en taxonomie les uniformiserait                                                                                                                                                                          | Piloter aussi `circle-radius`                                                |
| **`marker: false` masque au lieu d'inventer une couleur transparente** | Une opacité nulle décrit exactement l'intention (« pas de disque ») ; une couleur transparente serait une valeur arbitraire à maintenir                                                                                                                                                                                       | `fill: "transparent"`                                                        |
| **`false` ne prête pas ses couleurs, l'omission oui**                  | Les deux formes disent des choses différentes : l'une est une déclaration, l'autre un silence. Les traiter pareil ferait réapparaître une pastille sur une icône voulue nue                                                                                                                                                   | Traiter `false` comme une absence                                            |
| **Routage des badges par nom de colonne**                              | Les champs de badge d'un profil ne sont **pas** étiquetés uniformément : la même donnée porte un `style` sur une surface et rien sur une autre. Router par `style` laisserait une surface non colorée                                                                                                                         | Router sur l'attribut `style` du champ                                       |
| **Couleur de texte calculée, pas configurée**                          | La lisibilité d'un badge dépend de son fond, que l'intégrateur choisit. La calculer par luminance évite un second réglage à maintenir cohérent avec le premier                                                                                                                                                                | Une couleur de texte déclarée                                                |
| **Couleurs validées dans la capacité**                                 | L'appelant assigne directement au DOM ; valider en amont évite de répartir la même vérification sur chaque surface                                                                                                                                                                                                            | Valider côté `feature-info`                                                  |
| **`taxonomies` et `layers` sans `properties` dans le schéma**          | Leurs clés sont des **données utilisateur**. Les énumérer serait décrire le contenu d'un profil dans le schéma du code                                                                                                                                                                                                        | Déclarer des propriétés fixes                                                |
| **Le schéma couvre les cinq sous-arbres**                              | Il ne déclarait que `enabled` — 1 clé sur ~19 réellement lues — ce qui rendait toute la taxonomie invisible au studio sans code                                                                                                                                                                                               | Ne déclarer que le gate                                                      |
| Pas de `loader`                                                        | Quasi-universelle, légère, et sollicitée dès le premier rendu de couche : la charger paresseusement la rendrait indisponible au moment où elle sert                                                                                                                                                                           | Un `import()` paresseux                                                      |

---

## Dépendances et frontières

### Aucune dépendance de cycle de vie

Il n'y a **ni `module.ts`, ni `lifecycle.ts`, ni `createModule`**. `install.ts` ne fait qu'une
chose : déclarer la capacité et monter le namespace. Elle n'apparaît donc **pas** dans le tri
topologique du registre, et la question de rang que pose
**B-57** aux quatorze capacités qui déclarent `["geojson"]`
**ne se pose pas ici**.

Position dans `presets/manifest.full.ts` : dans le lot des capacités d'API simple, **avant
`feature-info` et `cluster`**, ce qui reproduit l'ordre historique de leurs déclarations. L'ordre
d'insertion est observable par introspection ; la position n'a **aucun effet d'exécution** pour une
capacité sans module.

### Six familles de consommateurs, toutes par le namespace

Personne n'importe cette capacité : tout le monde la lit tardivement sur `GeoLeaf.Taxonomy`.

| Consommateur                                          | Ce qu'il demande                                           |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| `globals.geojson.ts` — l'injecteur de symboles        | `resolvePoiIcon` → `properties.symbolId`                   |
| `adapters/maplibre/maplibre-poi-icons.ts`             | `getIconVariants`, `getIcons`                              |
| `adapters/maplibre/maplibre-taxonomy-paint.ts`        | `getIcons().iconSize`, `resolveMarkerPaint`                |
| `legend` — `legend.ts`, `legend-generator.ts`         | `getCategories`, `getFieldMappings`, `getIcons`            |
| `filter` — `engine/options.ts`, `taxonomy-options.ts` | `getCategories`                                            |
| `feature-info` — `render/dom.ts`                      | `resolveTitleIcon`, `resolveBadgeStyle`                    |
| **Plugin `addpoi`** — `add-form/fields-manager.ts`    | Les catégories d'une couche, pour construire le formulaire |

⚠️ **Le dernier traverse la frontière `core → plugin` dans le bon sens** : c'est le plugin qui lit le
namespace du core, jamais l'inverse. La règle `no-plugin-in-core` reste tenue.

### Frontière `capabilities/` → `kernel/` (règle ESLint R.8)

| Import                               | Statut vis-à-vis de R.8           |
| ------------------------------------ | --------------------------------- |
| `kernel/config/config-primitives.js` | **Exception** nommée par la règle |

Le reste passe par `utils/` : `utils/validators/general-validators` (validation de couleur) et
`utils/loaders/profile-sprite-loader`. **Aucun accès à la carte**, aucun `IMapAdapter` : la capacité
rend des **expressions**, c'est l'adaptateur qui les pose.

### Aucune feuille de style

`install.ts` n'importe aucun CSS — la capacité ne peint rien elle-même. Les couleurs qu'elle décide
sont posées par `feature-info` en CSSOM, ce qui n'est pas soumis à la directive CSP `style-src`,
contrairement à un attribut `style`.

---

## Écarts au CDC source

Le CDC `CDC_plugin-taxonomy.md` (v3.0.0, 14/07/2026) a été **consommé** en écrivant cette fiche.
⚠️ **Il n'a PAS été retiré du dossier de tri** — même motif que les deux CDC de la passe précédente,
tracé au §Journal des décisions de
`roadmap_documentation-v3.md`.

⚠️ **C'est le CDC le plus exact rencontré jusqu'ici** — parce qu'il est la spécification qui a
**produit** le code actuel, et non un document écrit avant lui puis dérivé. Les écarts sont peu
nombreux et tous du même type : des ajouts que le code a faits après.

| Énoncé du CDC                                        | Ce que dit le code                                                                                                                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Son **nom de fichier**, `CDC_plugin-taxonomy.md`     | `taxonomy` est une **capacité in-core**, pas un plugin. Le nom est un vestige de la reclassification, et le titre du document dit déjà « capacité »                          |
| §3.1 — la table de référence des clés                | **`icons.showOnMap` y manque**, alors que la clé existe, porte un défaut `true` et est lue par le générateur de légende. Gisement **sous-estimé**                            |
| §6 — « les **cinq** résolveurs consultent le gate »  | Ils sont **plus de cinq**, et surtout la plupart le consultent **transitivement** par `resolveFeatureEntry`. Le résultat annoncé est juste, le mécanisme décrit ne l'est pas |
| §12 D5 — « `forceConfig` et `baseConfig` supprimés » | ✅ **Vérifié exact** — zéro occurrence dans tout le dépôt                                                                                                                    |
| §12 D4 — « le peintre disparaît, 100 % pull-based »  | ✅ **Vérifié exact** — ni `module.ts`, ni `lifecycle.ts`, ni `createModule`                                                                                                  |

⚠️ **En revanche, la façade publiée porte DEUX énoncés faux**, et ce n'est pas le CDC qui les
introduit — c'est le TSDoc de `src/api/geoleaf.taxonomy.ts`, **publié sur npm** via TypeDoc :

| Énoncé de la façade                                                                           | Mesure                                                                                                 |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| « La capacité est inerte tant que `modules.taxonomy.enabled` n'est pas posé »                 | **Faux** : le gate est **opt-out**, défaut `true`. Seul un `false` explicite l'éteint                  |
| « La peinture de catégorie est appliquée automatiquement via le cycle de vie de la capacité » | **Faux** : il n'y a **aucun cycle de vie**. `install.ts` l'écrit noir sur blanc au-dessus du même code |

Ligne **B-63** du registre — même classe que B-62, et le corollaire est le même : **relire le
fichier plutôt que son commentaire**.

Ce qui a été **retenu** du CDC et ne se lit pas dans le code : le motif de la refonte (le
« peintre » était mort depuis toujours, tué par un gate opt-in lu avant la fusion des ressources de
profil), les trois hypothèses infirmées pendant l'instruction (pas de doublon avec les règles de
style, le pipeline d'icônes est déjà un rasteriseur maison, la capacité peut rester en lecture
tirée), les décisions arbitrées **D1 à D11**, et les alternatives écartées de la table §Décisions.
