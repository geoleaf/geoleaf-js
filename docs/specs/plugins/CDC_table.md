---
type: spec-plugin
title: table — la vue tabulaire des couches, et son pont vers la carte
plugin_id: table
package: "@geoleaf-plugins/table"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 1d0f5312
date: 1er septembre 2026
---

# table — la vue tabulaire des couches, et son pont vers la carte

**Type :** plugin publié · **Paquet :** `@geoleaf-plugins/table` ·
**Code :** `packages/plugins/table/` · **Vérifié contre :** `1d0f5312` (01/09/2026)

> 🧭 **Contrat ici, mode d'emploi ailleurs.** Cette fiche dit ce que le sujet **doit**
> faire : périmètre, table de configuration gatée, contrat exposé, frontières. Les recettes
> et les exemples pas à pas sont dans [`packages/core/docs/table/GeoLeaf_Table_README.md`](../../../packages/core/docs/table/GeoLeaf_Table_README.md). **Les deux ne se recopient pas** — une
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

---

## Périmètre

### Ce que le plugin fait

Il affiche les entités d'une couche dans un **tiroir bas redimensionnable**, trié et défilable, et
maintient une **sélection bidirectionnelle** avec la carte : sélectionner des lignes met les entités
en surbrillance, permet de zoomer dessus, et de les exporter. Il remplace un onglet qui était
autrefois interne au core.

### Ce qu'il ne fait pas

- **Il ne pagine pas.** Toutes les lignes retenues sont dans le modèle. **Au-delà de
  `VIRTUAL_THRESHOLD`** (`table-renderer-virtual-scroll.ts`, lu par `renderer.ts`) le rendu bascule
  en **défilement virtuel** et seules les lignes visibles sont dans le DOM ; **en deçà, elles y sont
  toutes**. C'est un seuil, pas un régime permanent — et la clé `virtualScrolling` ne le commande
  pas. Voir l'avertissement sur `pageSize`.
- **Il ne modifie pas les données.** Lecture seule ; l'édition est le domaine du plugin `editor`.
- **Il ne se construit pas au démarrage**, sauf demande explicite — voir §Cycle de vie.
- **Il n'embarque pas son moteur de classeur.** Le format tableur est chargé **à la demande**, au
  premier export qui le réclame.

---

## Manifeste d'enregistrement

Ce que `src/entry.ts` déclare réellement. **Table gatée** par
`packages/core/__tests__/guards/doc-plugin-manifest.guard.test.js`.

| Champ        | Valeur                              |
| ------------ | ----------------------------------- |
| `name`       | `table`                             |
| `label`      | `Table (vue tabulaire des couches)` |
| `requires`   | `[]`                                |
| `optional`   | `[]`                                |
| `namespace`  | `GeoLeaf.Table`                     |
| `paquet npm` | `@geoleaf-plugins/table`            |

✅ **Le `label` valait `table` — l'identifiant recopié.** Corrigé le 29/07/2026, en même
temps que celui de [`geocoding`](CDC_geocoding.md), l'autre des deux seuls dans ce cas. Le `label`
est ce qui s'affiche dans les rapports d'état du registre : recopier `name` n'y apportait rien.

⚠️ **`requires` et `optional` sont vides, et c'est exact** : le plugin ne dépend d'aucun autre
plugin. Sa seule dépendance est le **core**, qu'aucun de ces deux champs ne sait exprimer — ils
désignent des plugins.

Son `healthCheck` interroge `GeoLeaf.Table`, c'est-à-dire **la surface qu'il a lui-même montée** :
c'est le cas nominal, contrairement à celui de `offline-ui`, qui interroge une façade du core.

---

## Les six étapes de `src/entry.ts`

C'est le plugin le plus complet du lot : il exerce les **six** étapes numérotées, là où le squelette
figé par [`PLUGIN_ARCHITECTURE_SPEC.md`](../contrats/PLUGIN_ARCHITECTURE_SPEC.md) §4 n'en impose que
trois.

| Étape | Ce qu'elle fait                                                                                                               |
| ----- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1     | Enregistre les six dictionnaires sous l'espace `table` — **en premier**, pour que les libellés résolvent pendant le démarrage |
| 2     | Monte `GeoLeaf.Table`                                                                                                         |
| 3     | Abonne le cycle de vie à `geoleaf:map:ready`                                                                                  |
| 4     | S'enregistre au registre de plugins (le manifeste ci-dessus)                                                                  |
| 5     | Déclare **deux** créneaux de barre d'outils — pastille mobile **et** onglet de bureau — **uniquement sur le chemin EAGER**    |
| 6     | Câble l'action : construction paresseuse, puis bascule                                                                        |

⚠️ **L'étape 5 est CONDITIONNELLE depuis le 21/08/2026** — `if (registry.isInitialized() !== true)`.
Avant `boot()`, cet appel est la **seule** déclaration du créneau : un intégrateur n'a pas d'`init.js`
pour la poser à sa place, donc la retirer coûterait le bouton. Après `init()`, la barre d'outils est
déjà construite : l'enregistrement serait mémorisé, jamais dessiné, et produirait un avertissement
dont le lecteur visé a déjà fait ailleurs ce qu'il recommande. ⚠️ Le test est `!== true` et non
`=== false` : un hôte sans `isInitialized` rend `undefined`, et le créneau **est** déclaré — échouer
en ouvrant est le bon sens, un avertissement parasite coûte une ligne de console, une déclaration
manquante coûte le bouton.

⚠️ **Aucune entrée `al` dans le dictionnaire, et c'est délibéré** : le core aliase `al` vers `de`, et
la reconstruction du dictionnaire à plat résout le code actif vers `de` pour les deux.

⚠️ **Le créneau de bureau porte `variant: "tab"`** — un onglet à texte vertical, pas une icône en
bas. Le motif est écrit sur place : la table **remplace un onglet autrefois interne au core**, elle
doit donc en garder l'apparence. C'est le seul créneau du lot à porter cette variante.

---

## Fonctionnalités

| ID    | Fonctionnalité                             | Entrée                                               | Sortie observable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Code                                                |
| ----- | ------------------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| TB-01 | Construction **paresseuse** du panneau     | Premier clic sur l'action                            | Rien n'est construit avant. Avec `defaultVisible`, la construction se fait au démarrage                                                                                                                                                                                                                                                                                                                                                                                                                                          | `lifecycle.ts` → `ensureInitialized`                |
| TB-02 | Sélecteur de couche                        | Couches déclarant un binding                         | Seules les couches dont le binding porte `enabled` **vrai** apparaissent — une couche sans bloc `table`, ou avec `table: {}`, est **exclue**                                                                                                                                                                                                                                                                                                                                                                                     | `table-layer.ts`, `panel.ts`                        |
| TB-03 | Colonnes déclarées ou déduites             | `columns` du binding de couche                       | Libellé, largeur, triabilité et type par colonne. ⚠️ **Sans `columns`, la table ne rend RIEN** — `renderer.ts` journalise l'absence puis vide le conteneur. La déduction depuis les propriétés n'existe que sur le chemin d'**export**                                                                                                                                                                                                                                                                                           | `renderer.ts`, `table-layer.ts`                     |
| TB-04 | Tri initial déclaré                        | `defaultSort`                                        | Champ et sens appliqués à l'ouverture                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `sort.ts`                                           |
| TB-05 | Défilement **virtuel**                     | Couche volumineuse                                   | Seules les lignes visibles sont dans le DOM. Le nombre de lignes retenues est borné — voir §Configuration                                                                                                                                                                                                                                                                                                                                                                                                                        | `table-renderer-virtual-scroll.ts`                  |
| TB-06 | Sélection bidirectionnelle                 | Clic sur une ligne, ou appel programmatique          | La sélection est un état partagé : la table la reflète, la carte la surligne                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `table-selection.ts`, `table-highlight.ts`          |
| TB-07 | Zoom sur la sélection                      | Action de sélection                                  | La carte se cadre sur les entités sélectionnées                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `table-selection.ts` (calcul), `panel.ts` (bouton)  |
| TB-08 | Surbrillance commutable                    | Action de surbrillance                               | Un état, pas un geste : elle s'active et se désactive                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `table-highlight.ts`                                |
| TB-09 | Export de la sélection **ou** de la couche | Deux actions distinctes                              | Deux chemins séparés, deux événements distincts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `export.ts`                                         |
| TB-10 | Format tableur chargé **à la demande**     | Export au format classeur                            | Le module d'écriture est importé à ce moment-là, jamais au démarrage                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `lazy/export-excel.ts`, `lazy/xlsx-writer.ts`       |
| TB-11 | Résolveur d'identifiant **unique**         | Nom de repère, attribut DOM, table de correspondance | Les trois passent par le même résolveur — sinon la sélection et l'export désigneraient des entités différentes                                                                                                                                                                                                                                                                                                                                                                                                                   | `feature-id.ts`                                     |
| TB-12 | Redimensionnement à la poignée             | Glissement du bord haut, **souris ou doigt**         | Hauteur bornée par un minimum et un maximum — voir §Configuration. Le geste passe par des **Pointer Events**, donc un seul chemin pour les deux entrées ; il était souris-seul jusqu'au 14/08/2026. ⚠️ La poignée porte `touch-action: none` — **sans cette règle CSS le portage serait purement cosmétique** : au doigt le navigateur revendique le glissement vertical comme un défilement et n'émet aucun `pointermove`. Un geste confisqué (`pointercancel`) relâche le curseur et la sélection posés sur le document entier | `panel-resize.ts`                                   |
| TB-13 | Formatage localisé des valeurs             | Nombres, dates                                       | Suit la langue active                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `format-value.ts`                                   |
| TB-14 | Neuf événements de cycle                   | Chaque geste                                         | Émis sur le document **et**, si la carte sait le faire, répliqués sur la carte                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `table-state.ts` → `fireEvent`                      |
| TB-15 | Membrane pour les appelants                | Autres plugins                                       | Un seam typé plutôt qu'un accès direct au namespace                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `table-seam.ts`                                     |
| TB-16 | Recherche plein texte dans les lignes      | Saisie dans le champ de la barre d'outils            | Filtre débouncé sur le texte des cellules **du DOM**. ⚠️ Il n'est **pas** réappliqué par le défilement virtuel, qui reconstruit le `tbody` : au-delà de `VIRTUAL_THRESHOLD`, le filtre ne voit que la fenêtre rendue et disparaît au premier défilement. Son écouteur ne passe pas par le seam `utils/events.ts` et n'est pas enregistré au registre de démontage                                                                                                                                                                | `panel.ts` → `createSearchInput`, `filterTableRows` |

Les tests qui couvrent ces lignes : `packages/plugins/table/src/__tests__/`, plus un scénario
navigateur dédié sous `e2e/`.

---

## Configuration

Bloc `modules.table` d'un profil, lu par `coreConfigGet("modules.table", {})` et fusionné sur les
défauts. ⚠️ **Cette table n'est PAS gatée** — le garde de cette fiche ne lit que le manifeste. La
couverture de ces clés relève de `scripts/check-config-coverage.cjs` et de l'inventaire.

| Clé                  | Type      | Défaut  | Rôle                                                                                    |
| -------------------- | --------- | ------- | --------------------------------------------------------------------------------------- |
| `enabled`            | `boolean` | `true`  | Éteint le plugin — ni panneau, ni construction, même à l'activation                     |
| `showButton`         | `boolean` | `true`  | La `profileKey` des deux créneaux de barre d'outils                                     |
| `defaultVisible`     | `boolean` | `false` | `true` → construction **et** ouverture au démarrage ; `false` → construction paresseuse |
| `pageSize`           | `number`  | —       | ⚠️ **Déprécié, sans défaut, lu nulle part** — voir ci-dessous                           |
| `maxRowsPerLayer`    | `number`  | `1000`  | Borne le nombre de lignes retenues par couche                                           |
| `enableExportButton` | `boolean` | `true`  | Affiche les boutons d'export                                                            |
| `virtualScrolling`   | `boolean` | `true`  | Rendu virtuel                                                                           |
| `defaultHeight`      | `string`  | `"40%"` | Hauteur initiale du tiroir                                                              |
| `minHeight`          | `string`  | `"20%"` | Borne basse du redimensionnement                                                        |
| `maxHeight`          | `string`  | `"60%"` | Borne haute du redimensionnement                                                        |
| `resizable`          | `boolean` | `true`  | Autorise la poignée                                                                     |

Trois clés supplémentaires sont **tolérées et transmises aux options d'export**, sans défaut :
`exportFormats`, `csvSeparator`, `csvIncludeGeometry`.

⚠️ **`pageSize` n'a plus de défaut, il est `@deprecated`, et il n'est toujours lu nulle part.**

```bash
grep -rn "pageSize" packages/plugins/table/src/ | grep -v __tests__
```

**Les occurrences restantes sont toutes dans `types.ts`** : la déclaration du champ, et la prose
de son propre `@deprecated`. Aucun site de lecture, et plus une ligne dans `config.ts` — le défaut
a été retiré le 28/07/2026 parce qu'il matérialisait une valeur que rien ne consomme. Le champ,
lui, est **conservé et marqué** plutôt que supprimé : le type est publié, le retirer casserait la
compilation d'un intégrateur qui l'a écrit, tandis que le déprécier le lui **dit** — ce que son
silence d'avant ne faisait pas. ⚠️ **Cette fiche a écrit « aucun effet et aucun avertissement »
jusqu'au 01/09/2026** : la première moitié reste vraie, la seconde a cessé de l'être le jour même
où la fiche a été écrite. Rien n'en subsiste au registre, la ligne y étant soldée puis purgée.

🛑 **Et `pageSize` n'était pas seule : `virtualScrolling` est dans le même cas, et la fiche ne le
disait nulle part.** La bascule en rendu virtuel se décide sur le seuil `VIRTUAL_THRESHOLD`
(`table-renderer-virtual-scroll.ts`), lu par `renderer.ts` — **jamais sur la clé de profil**.
L'éteindre n'éteint rien.

```bash
grep -rn "virtualScrolling" packages/plugins/table/src/ | grep -v __tests__
```

### Binding par couche — `layer.config.table.*`

Lu par le seam `GeoLeaf.GeoJSON`. Le schéma de référence est `profiles/schemas/layer-config.schema.json`, et il **ne recouvre pas ce que le plugin lit** — il ferme le bloc (`additionalProperties: false`) dans les deux sens :

- `columns[].type` est **lu par `renderer.ts`** (il pilote `formatValue` et l'alignement des nombres) et **refusé par le schéma**, qui n'admet que `field`, `label`, `sortable`, `width` ;
- `searchFields` est **admis par le schéma** et **lu par personne** ;
- le libellé du sélecteur ne vient pas d'ici mais de `layer.label`, puis de `layer.config.title` — **hors du bloc `table`**.

L'écart se re-mesure, il ne se recopie pas :

```bash
grep -rn "col\." packages/plugins/table/src/renderer.ts
node -e "const s=require('./profiles/schemas/layer-config.schema.json'); console.log(JSON.stringify(s.properties.table,null,1))"
```

| Clé            | Type      | Rôle                                                                                                            |
| -------------- | --------- | --------------------------------------------------------------------------------------------------------------- |
| `enabled`      | `boolean` | La couche apparaît dans le sélecteur **si et seulement si la valeur est vraie** — absente, la couche est exclue |
| `searchFields` | `array`   | Accepté par le schéma de couche, **lu par aucun code du plugin**                                                |
| `columns`      | `array`   | Colonnes : champ, libellé, largeur, triabilité, type                                                            |
| `defaultSort`  | `object`  | Champ et sens du tri initial                                                                                    |

---

## Contrat exposé

### API publique — `GeoLeaf.Table`

Construite par `public-api.ts` → `buildPublicApi()`. Chaque membre délègue au module d'API ; la
façade ne porte aucune logique, ce que la gate de pureté des façades vérifie.

| Groupe        | Membres                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| Visibilité    | `show()` · `hide()` · `toggle()` · `open()` · `isOpen()`                |
| Contenu       | `setLayer(layerId)` · `refresh()` · `sortByField(field)`                |
| Sélection     | `setSelection(ids, add?)` · `getSelectedIds()` · `clearSelection()`     |
| Actions carte | `zoomToSelection()` · `highlightSelection(active)`                      |
| Export        | `exportSelection(format?, options?)` · `exportLayer(format?, options?)` |

⚠️ **`open()` appelle `toggle()`.** Son nom promet une ouverture ; il bascule. Sur un panneau déjà
ouvert, il **ferme**. C'est le membre que câble l'action de barre d'outils, donc le comportement
attendu au clic — mais un intégrateur qui appelle `GeoLeaf.Table.open()` pour garantir un état
ouvert n'obtient pas ce qu'il demande.

✅ **`isOpen()` rend ce défaut CONTOURNABLE** (13/08/2026) :
`if (!GeoLeaf.Table.isOpen()) GeoLeaf.Table.open()`. Avant elle, l'intégrateur ne pouvait pas
tester l'état avant d'appeler, donc pas contourner du tout — c'est ce trou-là qui se ferme, et
non le comportement d'`open()`, qu'on ne corrige pas silencieusement.

🛑 **Rien de mécanique ne garde cette table, ni le membre qu'elle décrit.** Le garde de cette
fiche ne lit que `## Manifeste d'enregistrement` ; `Table` n'est pas dans `EXPECTED_FACADE_KEYS`,
donc le golden master post-boot ne le voit pas ; et `CC-03` dérive son périmètre d'un manifeste
hors dépôt, absent d'un clone. Le seul filet réel est `src/__tests__/entry.test.ts`, dont la
liste des 15 membres est écrite à la main — pas un instantané, pour que `vitest -u` ne puisse
pas tamponner une régression de surface.

### Événements

Neuf, tous préfixés `geoleaf:table:`, émis sur le document **et** répliqués sur la carte quand
celle-ci expose de quoi le faire.

| Événement                         | Émis par                              |
| --------------------------------- | ------------------------------------- |
| `opened` · `closed`               | `show` / `hide` / `toggle`            |
| `layerChanged`                    | `setLayer`, et le sélecteur de couche |
| `sortChanged`                     | `sortByField`                         |
| `selectionChanged`                | Chaque modification de la sélection   |
| `zoomToSelection`                 | L'action de cadrage                   |
| `highlightSelection`              | La bascule de surbrillance            |
| `exportSelection` · `exportLayer` | Les deux chemins d'export             |

✅ **Les neuf sont TYPÉS** dans `contracts/event-bus.contract.ts` du core (seam `table`), depuis le
Contrat inverse — 13/08/2026. L'émission est vérifiée contre la map : `fireEvent`
(`src/table-state.ts`) est générique sur `GeoLeafEventMap`, et son union de noms se **dérive** de
la map au lieu d'en être une seconde copie.

⚠️ **Cette ligne disait « Aucun de ces neuf n'est typé […] C'est le régime normal des événements de
plugin »**, et les deux moitiés méritent d'être corrigées ensemble. Le typage n'était pas l'enjeu :
`fireEvent` composait son nom à l'exécution (`"geoleaf:" + eventName`), donc **aucun littéral
complet n'existait en source** et les gates d'événements du dépôt — qui relèvent des littéraux sur
l'AST — étaient structurellement aveugles aux neuf. Ce n'était donc pas un « régime normal » mais un
angle mort, et il a coûté : `geoleaf:table:opened` et `:closed` ont été classés « cassés » dans le
manifeste du consommateur aval jusqu'à sa v1.4.0, **alors qu'ils étaient émis ET écoutés**. Le
précédent inverse existait déjà — les neuf `geoleaf:editor:*` sont typés depuis la tâche 7.3.

### Écoutés

**Six abonnements, sur DEUX bus distincts** — et c'est la distinction qui compte : un abonnement
posé sur le mauvais bus est indiscernable d'un abonnement absent. La liste se re-dérive :

```bash
grep -rn 'addEventListener("geoleaf:\|\.on("geoleaf:' packages/plugins/table/src/ | grep -v __tests__
```

| Événement                            | Bus        | Où               | Effet                                             |
| ------------------------------------ | ---------- | ---------------- | ------------------------------------------------- |
| `geoleaf:map:ready`                  | `document` | `lifecycle.ts`   | Construit **seulement** si `defaultVisible`       |
| `geoleaf:toolbar:action`             | `document` | `entry.ts`       | Filtré sur `table` — construit puis bascule       |
| `geoleaf:filters:applied`            | `document` | `table-layer.ts` | Recharge les lignes de la couche active           |
| `geoleaf:theme:applied`              | `document` | `table-layer.ts` | Rafraîchit le sélecteur (débouncé)                |
| `geoleaf:geojson:layers-loaded`      | carte      | `table-layer.ts` | Rafraîchit le sélecteur (débouncé)                |
| `geoleaf:geojson:visibility-changed` | carte      | `table-layer.ts` | Recharge, ou retombe sur une autre couche visible |

🛑 **Le troisième était mort DEUX FOIS jusqu'au 25/08/2026, et une seule des deux corrections
n'aurait rien réparé.** Il s'abonnait à `geoleaf:filters:changed` — un nom qu'aucun émetteur ne
porte — **et** sur le bus de la carte, alors que le vrai `geoleaf:filters:applied` sort par
`dispatchGeoLeafEvent()`, donc sur `document`. Conséquence utilisateur : la table ne se
rafraîchissait **jamais** à l'application d'un filtre, et les lignes affichées contredisaient la
carte.

---

## Décisions de conception

| Décision                                          | Pourquoi                                                                                                                                                    | Alternative écartée              |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **Construction paresseuse par défaut**            | Le panneau est coûteux et minoritairement ouvert. Le construire au démarrage aurait pesé sur le chemin le plus sensible pour une surface souvent jamais vue | Construire au démarrage          |
| **Défilement virtuel plutôt que pagination**      | Une table cartographique se parcourt en continu, pas page par page — et la sélection doit pouvoir traverser tout le jeu                                     | Une pagination classique         |
| **Un seul résolveur d'identifiant d'entité**      | Le nom du repère exporté, l'attribut DOM et la table de correspondance de sélection doivent désigner la **même** entité. Trois résolutions auraient divergé | Une résolution par site          |
| **Le moteur de classeur est chargé à la demande** | La majorité des exports sont textuels. Embarquer l'écriture de classeur aurait pesé sur tous pour servir une minorité                                       | L'inclure au paquet              |
| **Onglet de bureau en variante « onglet »**       | La table **remplace** un onglet autrefois interne au core ; une icône en bas aurait déplacé un repère visuel acquis                                         | Le créneau d'icône standard      |
| **Deux chemins d'export distincts**               | Exporter la sélection et exporter la couche ne se replient pas l'un sur l'autre — et leurs deux événements portent des charges utiles différentes           | Un export unique paramétré       |
| **Un seam plutôt qu'un accès au namespace**       | Les appelants n'ont pas à connaître le cycle de vie du panneau ni à toucher au global                                                                       | Lire `GeoLeaf.Table` directement |
| **Aucune entrée `al` au dictionnaire**            | Le core aliase déjà `al` vers `de` ; une septième entrée aurait été une copie à maintenir                                                                   | Une entrée dédiée                |

---

## Dépendances et frontières

**Aucune dépendance de production : le paquet n'a plus de bloc `dependencies`.** `@geoleaf/core`
l'a quitté pour rejoindre `maplibre-gl` en dépendance **pair** — les deux sont hors paquet, et
c'est l'hôte qui fournit le core, ce qui interdit qu'un intégrateur en installe deux copies.
`@geoleaf/host-runtime` est une dépendance de **développement** — elle est regroupée à la
construction, jamais installée chez l'intégrateur. Les trois blocs se lisent au fichier :

```bash
node -e "const p=require('./packages/plugins/table/package.json'); console.log({dependencies: p.dependencies, peerDependencies: p.peerDependencies, devDependencies: Object.keys(p.devDependencies)})"
```

**Aucune dépendance vers un autre plugin**, ce que le manifeste dit correctement.

⚠️ **`README.md` n'est PAS dans `files[]`** — il n'est donc pas dans l'archive npm. ⚠️ Cette ligne
citait `addpoi` comme compagnon d'infortune : **ce paquet n'existe plus**, il a fusionné dans
`editor` le 05/08/2026. Et le cas n'est pas la minorité qu'elle laissait entendre — il est
**majoritaire** parmi les plugins. La liste se mesure, elle ne se recopie pas :

```bash
grep -L '"README.md"' packages/plugins/*/package.json
```

L'écart n'est toujours pas tranché ; il est relevé ici pour qu'il le soit une fois, et pour tous.

---

## Écarts au CDC source

Le CDC `CDC_plugin-table.md` (v1.5.0, 23/07/2026) a été **consommé** en écrivant cette fiche, puis
**supprimé** du dossier de tri — ligne au §Journal des décisions de
la refonte documentaire V3.

**C'est le CDC le mieux tenu des quatre de ce lot** : sa table de configuration est exacte clé par
clé, défaut par défaut ; sa table d'événements liste les neuf, correctement attribués ; et sa section
licence dit **MIT sur le registre public**, ce qui est vrai depuis la bascule.

| Énoncé du CDC                                                        | Ce que dit le code                                                                                                                                                                      |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §2.6 — le rendu vit dans `table-renderer-utils.ts`                   | **Le fichier n'existe pas.** Le rendu est réparti entre `renderer.ts` et `table-renderer-virtual-scroll.ts`                                                                             |
| §2.5 — `pageSize` « ⚠️ orphelin runtime (ANO-038) »                  | ✅ **L'orphelin subsiste** (aucun site de lecture) mais la ligne est **soldée** : défaut retiré de `config.ts`, champ `@deprecated` dans `types.ts` (28/07/2026). Plus rien au registre |
| §2.5 — `virtualScrolling` « ne pagine pas par `pageSize` » (ANO-039) | ✅ **Vrai**, et c'est le corollaire du précédent : il n'y a pas de pagination du tout                                                                                                   |
| §2.5, §2.9 — configuration, binding de couche, neuf événements       | ✅ **Vérifiés exacts**, clé par clé et ligne par ligne                                                                                                                                  |

⚠️ **Ce que le CDC ne dit pas, et que la fiche ajoute** : le `label` du manifeste vaut `table`, et
`open()` bascule au lieu d'ouvrir. Les deux sont au même registre.

Ce qui a été **retenu** du CDC et ne se lit pas dans le code : le motif du passage du core au plugin
(migration cassante), le parcours utilisateur, et les alternatives écartées de la table §Décisions.
