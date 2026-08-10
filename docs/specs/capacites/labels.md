---
type: spec-capacite
title: labels — les étiquettes de texte par couche
capability_id: labels
package: "@geoleaf/core"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: ed1db5b5
date: 28 juillet 2026
---

# labels — les étiquettes de texte par couche

**Type :** capacité in-core · **Code :** `packages/core/src/capabilities/labels/` ·
**Vérifié contre :** `ed1db5b5` (28/07/2026)

> **Deux règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.

> ⚠️ **Le mot « tooltip » est partout dans le code et il est trompeur.** Ce que la capacité appelle
> `tooltips` n'est **pas** un survol DOM : c'est une `Map` de **fermetures de retrait**, chacune
> appelant `removeLayer()` sur une couche `symbol` MapLibre native. Le rendu des étiquettes est
> entièrement dans le moteur WebGL, sans un seul nœud DOM par entité. Le nom est un vestige de
> l'implémentation Leaflet ; la structure, elle, est celle décrite ici.

---

> ⚠️ **MapLibre 6 — `zoomLevelsToOverscale` passe à `4` par défaut** (il était indéfini). Ce
> réglage change le **placement des étiquettes de polygone** et les résultats de
> `queryRenderedFeatures`. Aucune régression observée au passage en v6 (08/08/2026, sonde de
> boot : 16 couches peintes, 0 erreur) — mais c'est le premier endroit à regarder si des
> étiquettes de polygone se décalent ou disparaissent à certains zooms.

## Périmètre

### Ce que la capacité fait

Elle rend le **texte d'un attribut d'entité** au-dessus d'une couche GeoJSON, sous forme d'une
couche `symbol` **native MapLibre** posée sur la même source. Elle porte aussi le **bouton 🏷️ par
couche** dans le gestionnaire de couches, et le pilotage de la visibilité des étiquettes en fonction
du zoom ou de l'échelle.

### Ce qu'elle ne fait pas

- **Elle ne décide pas de ce qui est étiqueté** : la configuration réelle est **par couche**, dans
  la clé `label` du fichier de style, pas dans le bloc `modules.labels` — voir §Configuration.
- **Elle ne s'abonne à rien au montage.** Contrairement à ce que son voisinage suggère,
  `Labels.init()` **ne fait que journaliser**. Tout le pilotage passe par des appels directs venus
  du kernel. C'est central pour son rang de boot — voir §Dépendances et frontières.
- **Elle ne crée aucun nœud DOM par entité.** Une étiquette est une entrée de couche `symbol` ;
  le seul DOM qu'elle produit est le bouton 🏷️, un par ligne de couche.
- **Elle ne gère pas les infobulles au survol** ni les popups d'entité — c'est `feature-info`.

---

## Fonctionnalités

| ID    | Fonctionnalité                                       | Entrée                                                      | Sortie observable                                                                                                                | Code                                                        |
| ----- | ---------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| LB-01 | Rendu en couche `symbol` native                      | Couche visible, style portant `label.enabled: true`         | Couche MapLibre `gl-<layerId>-label-text` ajoutée sur la source de la couche                                                     | `label-renderer.ts` → `createSymbolLayerForMapLibre`        |
| LB-02 | Initialisation au chargement d'une couche            | Appel direct depuis le chargeur GeoJSON                     | L'état d'étiquette de la couche est (re)construit ; l'ancien est purgé d'abord                                                   | `labels.ts` → `initializeLayerLabels`                       |
| LB-03 | Précédence du style **intégré** sur la configuration | `currentStyle.label` présent                                | Le style intégré gagne ; `enabled !== true` **désactive** franchement, sans repli sur la configuration d'appel                   | `labels.ts` → `_resolveLabelStyleConfig`                    |
| LB-04 | Repli sur une configuration d'appel                  | Aucun style intégré, mais `{ enabled, labelId }` fournis    | Style construit avec des valeurs par défaut (Arial 10 pt, noir, opaque, sans halo ni fond)                                       | `labels.ts` → `_buildLabelStyleFromConfig`                  |
| LB-05 | Affichage initial gouverné par `visibleByDefault`    | Style intégré portant ou non `visibleByDefault`             | Quand la clé est présente elle **l'emporte** sur la demande de l'appelant ; sinon c'est l'appelant qui décide                    | `labels.ts` → `_resolveLabelEffectiveShow`                  |
| LB-06 | Couche masquée : préparé sans être rendu             | Étiquettes configurées, couche invisible                    | L'état est enregistré, **aucune couche `symbol` n'est créée** — le rendu attend que la couche redevienne visible                 | `labels.ts` → `_computeShouldShow`, `_createLabelsForLayer` |
| LB-07 | Bascule par couche                                   | `toggleLabels(layerId)`                                     | Rend le nouvel état. **Refuse** si le style de la couche n'active pas les étiquettes                                             | `labels.ts` → `toggleLabels`                                |
| LB-08 | Réaction au zoom                                     | `zoomend` sur la carte                                      | Chaque couche étiquetée est ré-évaluée : création si elle entre dans la plage, purge si elle en sort                             | `labels.ts` → `_handleZoomChange`, `_processZoomLayerItem`  |
| LB-09 | Plage par **échelle** ou par **zoom**                | `labelScale: { minScale, maxScale }` ou `minZoom`/`maxZoom` | L'échelle prime quand elle est déclarée ; les deux bornes de zoom doivent être présentes pour s'appliquer                        | `labels.ts` → `_resolveShouldShowForZoom`, `_isOutOfRange`  |
| LB-10 | Abonnement `zoomend` **paresseux**                   | Première couche réellement étiquetée                        | L'abonnement est armé à ce moment-là, pas au montage de la capacité                                                              | `labels.ts` → `_ensureZoomListener`                         |
| LB-11 | Ré-armement sur changement d'adaptateur              | Changement de fond de carte ou de thème (échange en place)  | L'abonnement est relâché puis reposé **sur la nouvelle carte** — la comparaison porte sur l'adaptateur, pas sur un drapeau       | `labels.ts` → `_ensureZoomListener`                         |
| LB-12 | Suivi de la visibilité de couche                     | Couche montrée / masquée                                    | Étiquettes recréées ou purgées — le kernel appelle `refreshLabels` / `_hideLabelsForLayer` par le namespace                      | `kernel/geojson/visibility-manager.ts`                      |
| LB-13 | Pile de polices résolue sur le style chargé          | Création d'une couche `symbol`                              | La première `text-font` réellement servie par le style est reprise ; repli `Noto Sans Regular`. **Évite les 404 de glyphes PBF** | `label-renderer.ts` → `_resolveMapFontStack`                |
| LB-14 | Points → pixels                                      | `font.sizePt` d'un profil                                   | `text-size` en pixels au ratio exact 96/72 ; `12` quand aucune taille n'est écrite                                               | `label-renderer.ts` → `_buildLabelSymbolLayout`             |
| LB-15 | Halo optionnel                                       | `buffer.enabled: true`                                      | `text-halo-color` / `-width` / `-blur` posés ; absent sinon                                                                      | `label-renderer.ts` → `_buildLabelSymbolPaint`              |
| LB-16 | Purge tolérante aux styles périmés                   | Retrait d'étiquettes après rechargement du style MapLibre   | Chaque retrait qui jette est absorbé **individuellement**, et la table est vidée dans tous les cas                               | `labels.ts` → `_clearTooltips`                              |
| LB-17 | Bouton 🏷️ injecté par seam                           | `geoleaf:layer-item:controls` émis par le gestionnaire      | Bouton inséré **avant** la bascule de visibilité de la ligne, ou appendu à défaut                                                | `lifecycle.ts`, `label-button-manager.ts` → `createButton`  |
| LB-18 | Rattrapage des couches déjà rendues                  | Capacité montée après le rendu de la liste des couches      | Chaque `[data-layer-id]` du document est resynchronisé — filet de premier rendu                                                  | `lifecycle.ts` → `syncExistingLayers`                       |
| LB-19 | État visuel du bouton                                | Style, visibilité de couche, état des étiquettes            | Désactivé si le style n'active pas les étiquettes ou si la couche est masquée ; `aria-pressed` reflète l'état                    | `label-button-manager.ts` → `_getState`, `_applyState`      |
| LB-20 | Bouton non dupliqué                                  | Seam ré-émis pour la même couche                            | Le bouton existant est rendu tel quel, aucun second bouton                                                                       | `label-button-manager.ts` → `createButton`                  |
| LB-21 | Configuration obsolète refusée bruyamment            | `labels.styleFile` dans une couche                          | **Jette** une erreur nommant la couche — pas d'ignorance silencieuse                                                             | `labels.ts` → `enableLabels`                                |
| LB-22 | Démontage complet                                    | `LabelsModule.destroy()` / `_reset()`                       | Seam détaché, **tous** les boutons 🏷️ retirés du document, étiquettes purgées, abonnement `zoomend` relâché                      | `lifecycle.ts` → `_reset`, `labels.ts` → `destroy`          |
| LB-23 | Déclaration introspectable                           | —                                                           | `getAllCapabilities()` la liste, `getCapabilitySchema("labels")` rend son schéma                                                 | `labels-capability.ts`                                      |

Les tests qui couvrent ces lignes : `packages/core/__tests__/capabilities/labels/`.

---

## Configuration

Bloc `modules.labels` d'un profil. Conformité de cette table au code gardée par
`__tests__/guards/doc-capability-config.guard.test.js`.

| Paramètre | Type      | Défaut | Où c'est lu                                                                                     |
| --------- | --------- | ------ | ----------------------------------------------------------------------------------------------- |
| `enabled` | `boolean` | `true` | `config.ts` → `getLabelsConfig()` ; gate d'enregistrement du module. **Opt-out**, comme le gate |

### Deux étages de configuration, et le gate ne commande que le premier

C'est la nuance qui compte pour un intégrateur, et elle n'est pas dans la table ci-dessus :

| Étage                                  | Où il vit                                     | Ce qu'il décide                                       |
| -------------------------------------- | --------------------------------------------- | ----------------------------------------------------- |
| **Gate de capacité** (table ci-dessus) | `modules.labels.enabled` d'un profil          | Si la capacité existe **du tout**                     |
| **Style d'étiquette, par couche**      | Clé `label` du fichier de **style de couche** | Si CETTE couche est étiquetée, et à quoi ça ressemble |

Un profil qui laisse `modules.labels` absent obtient la capacité, et **aucune étiquette** tant
qu'aucun style de couche ne porte `label.enabled: true`. L'inverse — des styles qui déclarent des
étiquettes et `modules.labels.enabled: false` — éteint tout.

Les clés lues dans le style de couche :

| Clé de style                     | Effet                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `label.enabled`                  | **Doit valoir exactement `true`** — toute autre valeur désactive               |
| `label.field`                    | Attribut d'entité affiché (`text-field`)                                       |
| `label.visibleByDefault`         | Étiquettes montrées dès le chargement ; l'emporte sur la demande de l'appelant |
| `label.font.sizePt`              | Taille en **points**, convertie en pixels                                      |
| `label.color` · `label.opacity`  | Couleur et opacité du texte                                                    |
| `label.buffer.*`                 | Halo : `enabled`, `color`, `sizePx`                                            |
| `labelScale.{minScale,maxScale}` | Plage d'**échelle** — prime sur les bornes de zoom                             |

⚠️ **`label.styleFile` est refusé, pas ignoré.** Une couche qui le porte encore fait **jeter** une
erreur nommant la couche. C'est délibéré : la forme obsolète pointait un second fichier de style,
et l'ignorer aurait produit des couches muettes sans explication.

---

## Contrat exposé

### API publique

`GeoLeaf.Labels`, construit par `public-api.ts` → `buildPublicApi()`, monté par `install.ts` →
`registerGlobals(gl)`, et re-exporté par la façade ESM `src/api/geoleaf.labels.ts`.

⚠️ **La façade expose le singleton COMPLET, pas une vue en lecture.** `buildPublicApi()` fait un
`Object.assign` sur `Labels` lui-même et lui ajoute deux aides. Ce n'est pas un relâchement : le
kernel et le gestionnaire de couches consomment `initializeLayerLabels` / `enableLabels` /
`refreshLabels` / `toggleLabels` **à travers cet objet** (voir §Frontière inverse). Une façade
restreinte les couperait de leur seul point d'accès.

| Membre                                              | Rend / fait                                                                        |
| --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `initializeLayerLabels(layerId)`                    | (Re)construit l'état d'étiquette d'une couche depuis son style courant             |
| `enableLabels(layerId, config?, showImmediately?)`  | Prépare les étiquettes ; **asynchrone**, et n'affiche que si la couche est visible |
| `disableLabels(layerId)` · `_hideLabelsForLayer(…)` | Purge le rendu ; le premier éteint aussi l'état, le second non                     |
| `toggleLabels(layerId)`                             | Bascule et rend le nouvel état — `false` si le style ne les autorise pas           |
| `refreshLabels(layerId)`                            | Purge puis recrée, si la couche est visible et les étiquettes actives              |
| `hasLabelConfig` · `areLabelsEnabled`               | Lectures d'état, par couche                                                        |
| `isEnabled()` · `getConfig()`                       | Le gate de capacité et le bloc `modules.labels` fusionné sur les défauts           |
| `destroy()`                                         | Purge toutes les couches et relâche l'abonnement `zoomend`                         |

Deux autres clés sont montées par l'installeur : `_LabelButtonManager` et `_LabelRenderer`. Le
préfixe `_` marque l'usage interne — elles existent parce qu'elles étaient déjà dans la surface
publiée avant la migration.

Typage publié : `src/global.d.ts`, section des capacités (`Labels?:` → `LabelsPublicApi`). Ne pas
citer de numéro de ligne pour ce fichier.

### Événements et abonnements

| Signal                        | Sens                     | Détail                                                                 |
| ----------------------------- | ------------------------ | ---------------------------------------------------------------------- |
| `geoleaf:layer-item:controls` | **écouté** (seam kernel) | Porte l'identifiant de couche et le conteneur de contrôles de la ligne |
| `zoomend` (carte)             | **écouté**, paresseux    | Armé par `_ensureZoomListener`, pas au montage. Relâché au `destroy()` |

La capacité **n'émet aucun événement**.

⚠️ **Un seam a existé sans jamais avoir d'émetteur.** `Labels.init()` s'abonnait autrefois à
`geoleaf:layer-loaded` — un événement que **rien n'a jamais publié dans toute l'histoire du
dépôt**. C'est le motif du `init()` réduit à une journalisation aujourd'hui, et la raison pour
laquelle le chargeur pilote les étiquettes **par appel direct**.

### Stockage écrit

Aucun. Ni `localStorage`, ni paramètre d'URL : l'état d'étiquette d'une couche est en mémoire, et se
reconstruit depuis le style au rechargement.

---

## Décisions de conception

| Décision                                                    | Pourquoi                                                                                                                                                                                                                                    | Alternative écartée                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Couche `symbol` native, pas de nœuds DOM**                | Le placement, l'évitement de collision et le rendu sont faits par le moteur WebGL. Une surcouche DOM coûterait un nœud par entité et ne saurait pas éviter les chevauchements                                                               | Des étiquettes DOM positionnées à la main — c'est ce que faisait Leaflet |
| **La pile de polices vient du style chargé**                | Les noms de police CSS ne sont pas des glyphes PBF : demander « Lucida Sans » à un serveur de tuiles produit des 404 en série. Reprendre ce que le style sert déjà est la seule valeur garantie disponible                                  | Écrire une police en dur, ou laisser le défaut de la spécification       |
| **Le style intégré l'emporte, et `enabled !== true` coupe** | Le style est la source la plus proche de la donnée. Un repli sur la configuration d'appel quand le style dit « non » ferait réapparaître des étiquettes qu'un profil a explicitement retirées                                               | Fusionner les deux sources                                               |
| **`init()` ne s'abonne à rien**                             | Son unique abonnement historique visait un événement sans émetteur. Le garder aurait entretenu l'illusion d'un pilotage par événement là où le pilotage est un appel direct                                                                 | Recréer un émetteur pour l'événement fantôme                             |
| **Le kernel atteint la capacité par le NAMESPACE**          | `capabilities/` ne peut pas être importé depuis `kernel/`. La lecture tardive de `GeoLeaf.Labels` garde la capacité réellement élaguable et le kernel autonome                                                                              | Un import statique du kernel vers la capacité                            |
| **Abonnement `zoomend` armé paresseusement**                | Une carte sans couche étiquetée ne doit pas payer un gestionnaire de zoom                                                                                                                                                                   | S'abonner dans `init()`                                                  |
| **Le ré-armement compare l'ADAPTATEUR, pas un drapeau**     | Un changement de fond de carte ou de thème remplace l'adaptateur **en place**, sans `destroy()`. Sur le drapeau seul, l'abonnement restait sur la carte jetée et les étiquettes cessaient de réagir au zoom                                 | Un booléen « déjà abonné »                                               |
| **Purge : `try` DANS la boucle, vidage EN DEHORS**          | Un style MapLibre rechargé fait jeter `removeLayer`. Envelopper toute la boucle laisserait la table non vide — or « table non vide » se lit ailleurs comme « les étiquettes sont affichées », et la couche ne se reconstruirait plus jamais | Un seul `try` autour du `forEach`                                        |
| **Les boutons sont RETIRÉS au démontage**                   | Chaque bouton porte **deux** écouteurs posés par l'utilitaire d'attache, qui ne rend rien pour se désabonner. Laissés en place, ils restaient cliquables et appelaient un singleton détruit                                                 | Ne retirer que les écouteurs                                             |
| **Balayage du document, pas d'un conteneur**                | Les boutons sont injectés un par ligne, depuis un seam dont la capacité ne conserve aucun conteneur                                                                                                                                         | Mémoriser les conteneurs reçus par le seam                               |
| **`styleFile` jette au lieu d'être ignoré**                 | Une couche silencieusement muette est plus coûteuse à diagnostiquer qu'une erreur qui nomme la couche                                                                                                                                       | Journaliser un avertissement et continuer                                |
| **Ratio points → pixels exact plutôt que `1.33`**           | Les deux ne divergent qu'à partir de 53 pt, soit une étiquette d'environ 71 px : la valeur arrondie ne gagnait rien et introduisait une constante inexplicable                                                                              | Garder `1.33`                                                            |
| **La façade expose le singleton complet**                   | Le kernel consomme les méthodes de pilotage **par cet objet** ; une vue en lecture le couperait de son seul accès                                                                                                                           | Une façade restreinte aux lectures                                       |
| Pas de `loader`                                             | Le rendu d'étiquette est tiré dès le premier chargement de couche : un `import()` paresseux arriverait après le besoin                                                                                                                      | Un chargement paresseux                                                  |

---

## Dépendances et frontières

### Dépendance de cycle de vie — et le pré-vol de B-57

`module.ts` → `LabelsModule` : `id = "labels"`, `dependencies = ["geojson"]`.

⚠️ **Ce que `init()` fait réellement, mesuré fichier par fichier** — c'est la question que
**B-57** pose, et la réponse n'est pas celle que le nom de
la capacité suggère :

| Étape de `LabelsLifecycle.init()`                 | Ce qu'elle lit                            | Besoin de l'état GeoJSON ? |
| ------------------------------------------------- | ----------------------------------------- | -------------------------- |
| `Labels.init()`                                   | rien — **une seule journalisation**       | **non**                    |
| `addEventListener("geoleaf:layer-item:controls")` | rien — pose un écouteur                   | **non**                    |
| `syncExistingLayers()`                            | le DOM (`[data-layer-id]`), pas la donnée | **non**                    |

**Verdict : `labels` opère sur des couches, mais son `init()` n'en lit aucune.** Le pilotage réel
arrive **plus tard**, par appels directs venus du kernel — et ces appels passent tous par le
namespace `GeoLeaf.Labels` ou par une dépendance injectée, jamais par le module de cycle de vie.
Or le namespace est monté par `registerGlobals`, à la passe 1 des installeurs, c'est-à-dire
**avant** l'initialisation de tout module. Le pipeline d'étiquettes ne dépend donc pas du rang de
`LabelsModule`.

Les sites d'appel du kernel, mesurés — **cinq fichiers** :

```bash
grep -rn "initializeLayerLabels\|refreshLabels\|enableLabels\|disableLabels\|_hideLabelsForLayer" \
  packages/core/src --include=*.ts | grep -v "src/capabilities/labels/"
```

⚠️ **Ce que le geste de B-57 coûterait ici, et il n'est pas nul.** Ramener la dépendance à
`["config"]` ferait poser l'écouteur de seam **plus tôt** — donc il capterait davantage — et
laisserait `syncExistingLayers()` ne trouver aucune ligne de couche, puisque la liste n'est pas
encore rendue. Le filet de premier rendu deviendrait vide, mais il est **redondant** avec le seam
dans ce cas : il n'existe que pour le cas inverse, une capacité montée après le rendu de la liste.
Le geste paraît sûr ; il n'est pas exécuté ici, et **l'observable reste à construire** avant de le
faire — c'est le travail de B-57, pas de cette fiche.

Position dans `presets/manifest.full.ts` : **première du manifeste**, seule de son lot. La position
est porteuse — l'ordre d'enregistrement départage les égalités du tri topologique et l'ordre
d'insertion est observable par introspection.

### Frontière `capabilities/` → `kernel/` (règle ESLint R.8)

| Import                                       | Statut vis-à-vis de R.8                                        |
| -------------------------------------------- | -------------------------------------------------------------- |
| `kernel/config/config-primitives.js`         | **Exception** nommée par la règle                              |
| `kernel/geojson/index.js` (`GeoJSONCore`)    | **Baril** — accès par le point de médiation, pas en profondeur |
| `kernel/ui/index.js` (`_UIComponents`)       | **Baril**                                                      |
| `kernel/layer-manager/item-controls-seam.js` | **Seam** — type seul                                           |

Le reste passe par `utils/` : `utils/log`, `utils/i18n`, `utils/general/dom-helpers`,
`utils/general/scale-utils`. L'accès à la carte se fait par la façade `api/geoleaf.core.js`
(`Core.getMap()`), jamais par un adaptateur importé. **Aucune référence à un plugin** — règle
`no-plugin-in-core`.

### Frontière inverse : le kernel appelle la capacité, sans l'importer

Cinq fichiers du kernel pilotent les étiquettes, et **aucun n'importe la capacité** :

- `kernel/geojson/loader/single-layer.ts` — par une **dépendance injectée** (`_deps.getLabels()`),
  au chargement d'une couche ;
- `kernel/geojson/layers/visibility.ts`, `kernel/geojson/visibility-manager.ts`,
  `kernel/themes/theme-applier/visibility.ts` et `kernel/layer-manager/style-selector.ts` — par
  lecture tardive de `GeoLeaf.Labels`.

C'est ce qui rend `labels` réellement élaguable : une entrée qui omet l'installeur n'a aucun
écrivain pour le namespace, et les quatre sites dégradent en no-op.

### Frontière côté CSS

`install.ts` importe `./css/labels.css` — la feuille entre dans le graphe de modules par
l'installeur. Elle ne couvre que le bouton 🏷️ : le texte des étiquettes est peint par MapLibre et
n'a aucune règle CSS.

⚠️ **Deux en-têtes de cette capacité annoncent une exclusion du « build Lite »**
(`api/geoleaf.labels.ts` et `public-api.ts`, motif « PERF-02 »). **Le build Lite n'existe plus** —
son retrait est motivé sur place dans `packages/core/rollup.config.mjs`, et
`globals.ui-lite.ts`, que ces en-têtes citent comme site de montage, **n'existe pas**. Mesure et
gisement complet : ligne **B-61** du registre.

---

## Écarts au CDC source

**Aucun CDC source.** `labels` n'a jamais eu de cahier des charges dédié dans le dossier de tri :
cette fiche est écrite intégralement contre le code. C'est déjà le régime de sept des onze fiches du
palier S.
