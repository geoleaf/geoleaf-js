---
type: spec-plugin
title: measure — la mesure éphémère, et ses annotations
plugin_id: measure
package: "@geoleaf-plugins/measure"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 00e6bdd7
date: 28 juillet 2026
---

# measure — la mesure éphémère, et ses annotations

**Type :** plugin publié · **Paquet :** `@geoleaf-plugins/measure` ·
**Code :** `packages/plugins/measure/` · **Vérifié contre :** `00e6bdd7` (28/07/2026)

> **Trois règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.
> 3. **Un chemin cité sans racine se lit depuis le répertoire annoncé par « Code : » ci-dessus**,
>    ou depuis son `src/`, et à défaut depuis `packages/core/src/`. Un chemin qui commence par
>    `packages/`, `scripts/`, `profiles/`, `docs/`, `apps/` ou `e2e/` est relatif à la **racine du
>    dépôt**. Les cas qui échappent aux deux sont racinés sur place.

> ⚠️ **« Éphémère » est le mot qui sépare ce plugin d'`editor`.** Ce qu'on trace
> ici n'est pas une donnée du profil : c'est une couche de travail, persistée **localement** dans le
> navigateur, exportable, et sans aucun aller-retour serveur. `editor` écrit dans les données ;
> `measure` écrit à côté.

---

## Périmètre

### Ce que le plugin fait

Il donne cinq façons de **mesurer** — polyligne, rectangle, cercle, polygone, trace GPS — plus
l'**annotation** libre, avec un récapitulatif chiffré, la persistance locale, l'export, et un pont
vers [`print`](CDC_print.md) pour porter les annotations sur une planche imprimée.

### Ce qu'il ne fait pas

- **Il ne touche pas aux données du profil.** Rien de ce qu'il produit ne rejoint une couche
  déclarée.
- **Il n'a aucun cycle de vie.** Comme [`print`](CDC_print.md), il ne s'abonne à rien au démarrage.
- **Il n'a pas d'onglet de bureau.** Créneau **mobile uniquement** — voir §Le créneau.
- **Il ne synchronise rien.** La persistance est un stockage navigateur, pas une file de
  synchronisation.

---

## Manifeste d'enregistrement

Ce que `src/entry.ts` déclare réellement. **Table gatée** par
`packages/core/__tests__/guards/doc-plugin-manifest.guard.test.js`.

| Champ        | Valeur                     |
| ------------ | -------------------------- |
| `name`       | `measure`                  |
| `label`      | `Mesure & annotation`      |
| `requires`   | `[]`                       |
| `optional`   | `[]`                       |
| `namespace`  | `GeoLeaf.Measure`          |
| `paquet npm` | `@geoleaf-plugins/measure` |

⚠️ **`optional` est vide, alors qu'une relation avec `print` existe bel et bien** — et c'est **le bon
choix**, contrairement à ce qu'on pourrait croire. La relation va dans l'autre sens : c'est `print`
qui **lit** `measure`, par le namespace, pour récupérer les annotations imprimables. `measure`, lui,
n'a besoin de rien. Déclarer `optional: ["print"]` aurait inversé la dépendance dans la
documentation même du manifeste.

C'est le seul des quatre manifestes de ce lot dont les deux champs de dépendance sont **exacts** —
`table` a un `label` vide de sens, `print` a deux entrées fausses, `addpoi` omet `requires`.

---

## Les étapes de `src/entry.ts`

| Étape  | Ce qu'elle fait                                                             |
| ------ | --------------------------------------------------------------------------- |
| 1      | Enregistre les six dictionnaires sous l'espace `measure`, **en premier**    |
| 2      | Monte `GeoLeaf.Measure`, **seulement si le core est présent**               |
| 3      | S'enregistre au registre de plugins                                         |
| 4 et 5 | Déclare le créneau de barre d'outils **et** câble l'action — sous condition |

⚠️ **Même patron que [`print`](CDC_print.md)** : les deux dernières étapes sont sous
`if (getMeasureConfig().enabled !== false)`. Éteindre le plugin par la configuration ne cache pas
seulement le bouton — le créneau n'est **jamais déclaré** et l'écouteur **jamais posé**. L'API
programmatique reste vivante.

### Le créneau, et deux singularités

⚠️ **Créneau `mobileIcon` SEUL — pas d'onglet de bureau.** C'est le seul des quatre plugins de ce lot
dans ce cas : `table`, `print` et `addpoi` déclarent les deux surfaces. Conséquence observable :
sur un poste de bureau, l'outil de mesure n'est atteignable **que** par la barre mobile si elle est
rendue, ou par l'API. Rien dans le code ne dit si c'est une décision ou un oubli — c'est un écart de
surface, relevé ici pour être tranché une fois. Versé en **B-71** du
registre.

⚠️ **L'action est la seule des quatre à transporter l'élément déclencheur.** Les trois autres
appellent une méthode du namespace sans argument ; celle-ci passe `ce.detail?.element` à
`openMeasureMenu(...)` — parce que le menu flottant se **positionne par rapport au bouton cliqué**.
Et elle appelle une **fonction de module**, pas un membre du namespace : `openMeasureMenu` est
exporté par `public-api.ts` **à côté** de la façade, pas dedans.

---

## Fonctionnalités

| ID    | Fonctionnalité                                     | Entrée                                   | Sortie observable                                                                                                                 | Code                                       |
| ----- | -------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| ME-01 | Menu flottant positionné sur le bouton             | Action de barre d'outils                 | Le menu s'ouvre près du déclencheur, pas à une position fixe                                                                      | `floating-menu.ts`                         |
| ME-02 | Mesure de distance en polyligne                    | Clics successifs                         | Longueur cumulée, segment par segment, mise à jour en continu                                                                     | `tools/tool-distance.ts`, `compute.ts`     |
| ME-03 | Surface par rectangle                              | Cliquer-glisser                          | Aire et périmètre                                                                                                                 | `tools/tool-rect.ts`                       |
| ME-04 | Surface par cercle                                 | Centre + rayon                           | Aire, avec un cercle approché par un nombre de segments configurable                                                              | `tools/tool-circle.ts`                     |
| ME-05 | Surface par polygone                               | Clics successifs, fermeture              | Aire et périmètre                                                                                                                 | `tools/tool-polygon.ts`                    |
| ME-06 | Mesure par trace GPS                               | Position du terminal                     | La trace se construit au déplacement réel                                                                                         | `tools/tool-gps.ts`                        |
| ME-07 | Rejet des sauts GPS aberrants                      | Point trop rapide                        | Le point est écarté au-delà d'une vitesse plafond — sinon un saut de localisation fausserait toute la mesure                      | `tools/tool-gps.ts`                        |
| ME-08 | Fermeture automatique de la trace GPS              | Retour près du point de départ           | La boucle se ferme sous un seuil de distance, ce qui permet de mesurer une parcelle en la longeant                                | `tools/tool-gps.ts`                        |
| ME-09 | Annotation libre, deux formes                      | Outil d'annotation                       | Étiquette simple ou bulle ; le texte est plafonné en longueur                                                                     | `tools/tool-annotation.ts`                 |
| ME-10 | Récapitulatif chiffré                              | Toute mesure en cours                    | Un encart lisible, dont les décimales sont configurables séparément pour distance et surface                                      | `recap-box.ts`                             |
| ME-11 | Unités configurables, avec mode automatique        | `defaultDistanceUnit`, `defaultAreaUnit` | Mètre / kilomètre, mètre carré / hectare / kilomètre carré — ou choix automatique selon l'ordre de grandeur                       | `config.ts`, `compute.ts`                  |
| ME-12 | Persistance locale                                 | `persist`                                | Les mesures survivent au rechargement, sous une clé de stockage configurable                                                      | `persistence.ts`                           |
| ME-13 | Plafond du nombre de mesures                       | `maxFeatures`                            | Borne la collection conservée                                                                                                     | `config.ts`, `persistence.ts`              |
| ME-14 | Export de la collection                            | Action d'export                          | Un fichier géographique, dont le nom est configurable                                                                             | `geojson-export.ts`                        |
| ME-15 | Accrochage aux sommets                             | `snapPx`                                 | Le tracé s'aimante aux points proches, dans un rayon en pixels                                                                    | `tools/tool-shared.ts`                     |
| ME-16 | Types de mesure **extensibles**                    | `registerMeasureType`                    | Un tiers ajoute son propre outil                                                                                                  | `measure-api.ts`, `types.ts`               |
| ME-17 | Pont vers l'impression                             | `getPrintableAnnotations()`              | [`print`](CDC_print.md) récupère les annotations pour les porter sur la planche — **par le namespace**                            | `measure-api.ts`, `annotation-overlays.ts` |
| ME-18 | Configuration **validée**, pas seulement fusionnée | Valeurs hors bornes                      | Les énumérations sont vérifiées, les nombres bornés, et une position de menu invalide retombe sur le défaut avec un avertissement | `config.ts`                                |

Les tests qui couvrent ces lignes : `packages/plugins/measure/src/__tests__/`, plus un scénario
navigateur dédié sous `e2e/`.

---

## Configuration

Bloc `modules.measure` d'un profil. ⚠️ **Cette table n'est PAS gatée** — le garde de cette fiche ne
lit que le manifeste.

| Clé                   | Type      | Défaut                       | Rôle                                                      |
| --------------------- | --------- | ---------------------------- | --------------------------------------------------------- |
| `enabled`             | `boolean` | `true`                       | Commande la **surface d'interface**                       |
| `showButton`          | `boolean` | `true`                       | Avec repli sur `ui.showMeasure` — voir ci-dessous         |
| `position`            | `string`  | `"left"`                     | Ancrage du bouton                                         |
| `menuPosition`        | —         | `"top-left"`                 | Position du menu ; accepte aussi un couple de coordonnées |
| `defaultDistanceUnit` | `string`  | `"m"`                        | Parmi mètre, kilomètre, automatique                       |
| `defaultAreaUnit`     | `string`  | `"m2"`                       | Parmi mètre carré, hectare, kilomètre carré, automatique  |
| `snapPx`              | `number`  | `12`                         | Rayon d'accrochage, borné par le bas                      |
| `circleSteps`         | `number`  | `64`                         | Segments du cercle, borné des deux côtés                  |
| `enabledTools`        | `array`   | les six outils               | **Filtré** contre la liste connue                         |
| `tooltipDefaultSize`  | `object`  | `{ width: 160, height: 80 }` | Taille initiale d'une bulle d'annotation                  |
| `labelMaxChars`       | `number`  | `120`                        | Plafond de texte d'une annotation                         |
| `persist`             | `boolean` | `true`                       | Persistance locale                                        |
| `storageKey`          | `string`  | `"geoleaf.measure.fc"`       | Clé de stockage navigateur                                |
| `maxFeatures`         | `number`  | `500`                        | Plafond de la collection, borné par le bas                |
| `gpsCloseThresholdM`  | `number`  | `15`                         | Seuil de fermeture automatique d'une boucle GPS           |
| `gpsMaxJumpMps`       | `number`  | `25`                         | Vitesse au-delà de laquelle un point GPS est écarté       |
| `decimals`            | `object`  | `{ distance: 0, area: 0 }`   | Décimales, **séparément** pour distance et surface        |
| `exportFileName`      | `string`  | `"mesures.geojson"`          | Nom du fichier exporté                                    |

⚠️ **C'est le seul des quatre plugins de ce lot qui VALIDE sa configuration**, au lieu de simplement
fusionner sur des défauts. Les deux énumérations d'unités sont vérifiées, sept valeurs numériques
sont bornées, `enabledTools` est **filtré** contre la liste des outils connus, et une position de
menu invalide retombe sur le défaut **avec un avertissement**. Les trois autres acceptent n'importe
quoi et le passent au code.

⚠️ **`showButton` a un repli sur `ui.showMeasure`**, l'ancienne clé racine — c'est le seul reste de
migration lisible dans ce plugin, et il est **délibéré** : la `profileKey` du créneau, elle, pointe
toujours `ui.showMeasure`. Les deux clés cohabitent donc, avec la clé de module prioritaire.

⚠️ **La clé racine `measureConfig` n'est PLUS acceptée** — même constat que pour
[`print`](CDC_print.md) : un profil resté sur l'ancienne forme est ignoré **en silence**.

---

## Contrat exposé

### API publique — `GeoLeaf.Measure`

| Membre                                 | Rend / fait                              |
| -------------------------------------- | ---------------------------------------- |
| `startMeasure(type)` · `stopMeasure()` | Démarre / arrête un outil                |
| `clearAll()`                           | Vide la collection                       |
| `getCollection()`                      | Les mesures, en données géographiques    |
| `exportGeoJSON()`                      | Déclenche l'export fichier               |
| `setUnits(...)` · `getUnits()`         | Les unités actives                       |
| `getPrintableAnnotations()`            | **Le pont vers [`print`](CDC_print.md)** |
| `registerMeasureType(def)`             | Ajoute un outil                          |

⚠️ **`openMeasureMenu` n'est PAS sur le namespace.** Il est exporté par `public-api.ts` au niveau du
module, à côté de la façade, et l'action de barre d'outils l'appelle **directement**. Un intégrateur
ne peut donc pas ouvrir le menu par `GeoLeaf.Measure` — il n'y a pas de membre pour ça. C'est
cohérent avec le fait que le menu a besoin d'un élément d'ancrage que le namespace ne transporte pas,
mais c'est une asymétrie que la surface publique ne signale pas.

### Événements

**Aucun émis.** Écouté : `geoleaf:toolbar:action`, filtré sur `measure`.

---

## Décisions de conception

| Décision                                                   | Pourquoi                                                                                                                                                                                | Alternative écartée          |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **Mesure éphémère, pas édition**                           | Ce qu'on mesure n'est pas une donnée du profil. Confondre les deux aurait demandé un schéma, une validation et une synchronisation — c'est le rôle d'`editor`                           | Écrire dans une couche       |
| **Persistance locale, pas serveur**                        | Une mesure de terrain doit survivre à un rechargement sans exiger de connexion ni de compte                                                                                             | Une file de synchronisation  |
| **La configuration est validée, pas seulement fusionnée**  | Les valeurs pilotent de la géométrie : un `circleSteps` à 2 ou un `snapPx` négatif produisent un rendu absurde plutôt qu'une erreur. Borner en amont est ce qui rend l'échec impossible | Faire confiance au profil    |
| **`enabledTools` est filtré contre la liste connue**       | Un nom d'outil inconnu dans un profil serait sinon transmis au menu, qui rendrait une entrée morte                                                                                      | Passer la liste telle quelle |
| **Décimales séparées pour distance et surface**            | Une distance au mètre et une aire au mètre carré n'ont pas la même précision utile — un réglage unique aurait forcé à choisir                                                           | Un seul réglage              |
| **Rejet des sauts GPS**                                    | Une perte de fixation produit un saut de plusieurs centaines de mètres. Sans plafond de vitesse, ce saut entre dans la mesure et la fausse **définitivement**                           | Accepter tous les points     |
| **Fermeture automatique de la boucle GPS**                 | Mesurer une parcelle en la longeant est le cas d'usage terrain ; exiger un clic de fermeture exact au retour serait impraticable                                                        | Une fermeture manuelle       |
| **Le pont vers `print` est une LECTURE, par le namespace** | `measure` ne connaît pas `print`. C'est `print` qui vient chercher, et seulement s'il est là. Aucune des deux directions n'est un import                                                | Une dépendance déclarée      |
| **Les types de mesure sont extensibles**                   | Les mesures métier (dénivelé, emprise réglementaire) ne peuvent pas être livrées ; un registre les rend possibles sans modifier le paquet                                               | Un jeu figé                  |
| **Aucun cycle de vie**                                     | Rien à faire tant que l'utilisateur ne demande rien                                                                                                                                     | Un abonnement au démarrage   |

---

## Dépendances et frontières

| Dépendance                                                                            | Nature         | Note                                                                                                               |
| ------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `@geoleaf/core`                                                                       | production     | —                                                                                                                  |
| `@turf/distance` · `@turf/area` · `@turf/circle` · `@turf/centroid` · `@turf/helpers` | **production** | Cinq modules, importés séparément plutôt que le paquet entier — c'est ce qui garde le coût proportionnel à l'usage |
| `maplibre-gl`                                                                         | **pair**       | Hors paquet                                                                                                        |
| `@geoleaf/host-runtime`                                                               | développement  | Regroupée à la construction                                                                                        |

**Frontière avec `print` : le namespace, dans un seul sens.** Aucun import statique entre les deux
paquets.

`README.md` **est** dans `files[]`, comme celui de [`print`](CDC_print.md).

---

## Écarts au CDC source

Le CDC `CDC_plugin-measure.md` (v0.9.0, 23/07/2026) a été **consommé** en écrivant cette fiche, puis
**supprimé** du dossier de tri — ligne au §Journal des décisions de
`roadmap_documentation-v3.md`.

| Énoncé du CDC                             | Ce que dit le code                                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| §1.7 — configuration sous `measureConfig` | **Le bloc est `modules.measure`.** La clé racine n'est plus lue, et son abandon est **silencieux**                      |
| §1.9 — cadrage « Hors périmètre **V1** »  | Le plugin est publié en MIT sur le registre public ; le versionnage annoncé est caduc (**B-07**)                        |
| §1.2, étapes 1 à 10 — le parcours         | ✅ **Vérifié exact** : ouverture, choix d'outil, les cinq mesures, l'annotation, l'export, et le passage à l'impression |
| §1.1 — « éphémère, pas un éditeur »       | ✅ **Vérifié exact**, et c'est la ligne la plus utile du document — elle nomme la frontière avec `editor`               |
| §1.7 — les clés et leurs défauts          | ✅ **Vérifiés exacts**, à la racine près                                                                                |

⚠️ **Ce que le CDC ne dit pas, et que la fiche ajoute** : le créneau est **mobile seul** (aucun onglet
de bureau, seul cas du lot), `openMeasureMenu` n'est **pas** sur le namespace, et le gate ne commande
que la surface d'interface. Le premier point est versé en **B-71**.

Ce qui a été **retenu** du CDC et ne se lit pas dans le code : le positionnement « outil éphémère,
pas éditeur », les quatre scénarios d'usage — dont la mesure GPS de terrain, qui explique les deux
seuils —, les limites connues, et les alternatives écartées de la table §Décisions.
