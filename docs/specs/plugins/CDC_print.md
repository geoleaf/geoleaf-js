---
type: spec-plugin
title: print — la carte à l'échelle, composée puis exportée
plugin_id: print
package: "@geoleaf-plugins/print"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 00e6bdd7
date: 28 juillet 2026
---

# print — la carte à l'échelle, composée puis exportée

**Type :** plugin publié · **Paquet :** `@geoleaf-plugins/print` ·
**Code :** `packages/plugins/print/` · **Vérifié contre :** `00e6bdd7` (28/07/2026)

> **Trois règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.
> 3. **Un chemin cité sans racine se lit depuis le répertoire annoncé par « Code : » ci-dessus**,
>    ou depuis son `src/`, et à défaut depuis `packages/core/src/`. Un chemin qui commence par
>    `packages/`, `scripts/`, `profiles/`, `docs/`, `apps/` ou `e2e/` est relatif à la **racine du
>    dépôt**. Les cas qui échappent aux deux sont racinés sur place.

> ⚠️ **C'est le seul plugin du dépôt qui re-rend la carte hors écran.** Il ne photographie pas le
> canevas visible : il construit un rendu **à la dimension du papier et à l'échelle demandée**, ce
> qui est la seule façon d'obtenir une planche dont l'échelle imprimée est exacte. C'est aussi ce
> qui rend le plugin sensible à la mémoire du navigateur — voir `maxCanvasPxMobile`.

---

## Périmètre

### Ce que le plugin fait

Il fait **verrouiller une échelle**, **tracer une emprise**, **composer une planche** (titre,
description, légende, échelle, flèche du nord, annotations) et **l'exporter** en PDF ou en image.

### Ce qu'il ne fait pas

- **Il n'imprime pas.** Il produit un fichier ; l'impression est le geste de l'utilisateur.
- **Il n'a aucun cycle de vie.** Pas d'abonnement à `geoleaf:map:ready`, aucun état monté au
  démarrage : il ne réagit qu'à son action de barre d'outils.
- **Il ne dessine pas les annotations.** Il les **récupère** auprès de `measure`, s'il est chargé.
- **Il ne garantit pas le rendu des fonds tiers.** Un fond dont le serveur ne renvoie pas
  d'autorisation d'origine croisée **souille** le canevas et rend l'export impossible — d'où un
  repli serveur, et un message d'erreur dédié.

---

## Manifeste d'enregistrement

Ce que `src/entry.ts` déclare réellement. **Table gatée** par
`packages/core/__tests__/guards/doc-plugin-manifest.guard.test.js`.

| Champ        | Valeur                                  |
| ------------ | --------------------------------------- |
| `name`       | `print`                                 |
| `label`      | `Print (carte à l'échelle → PDF / JPG)` |
| `requires`   | `[]`                                    |
| `optional`   | `["offline-ui"]`                        |
| `namespace`  | `GeoLeaf.Print`                         |
| `paquet npm` | `@geoleaf-plugins/print`                |

✅ **`optional` portait DEUX entrées fausses, corrigées le 29/07/2026 (B-66).** `"storage"` avait
été renommé **`offline-ui`** ; et `"legend"` **n'a jamais été un plugin** — c'est une capacité
in-core, qu'aucun `isLoaded()` ne verra jamais. `print` était le seul des cinq manifestes fautifs à
porter les deux défauts, et le second était une **erreur de catégorie**, pas un renommage manqué :
`legend` a donc été **retiré**, pas re-pointé.

⚠️ **La dépendance réelle à la légende n'était de toute façon pas dans ce champ**, et c'est ce qui
rend le retrait sûr : `includeLegend` lit `GeoLeaf.Legend` **par le namespace, au moment de
composer**. Ce que `optional` prétendait exprimer, le code l'exprimait déjà ailleurs et
correctement.

✅ **La classe est fermée** : le garde de cette fiche vérifie désormais que tout identifiant cité
dans `requires` / `optional` désigne un plugin **réellement enregistré**, liste dérivée des
`entry.ts` et non écrite.

---

## Les étapes de `src/entry.ts`

Cinq étapes, dont deux fusionnées sous un même commentaire — un écart au squelette qui est ici
**porteur de sens**.

| Étape  | Ce qu'elle fait                                                                    |
| ------ | ---------------------------------------------------------------------------------- |
| 1      | Enregistre les six dictionnaires sous l'espace `print`, **en premier**             |
| 2      | Monte `GeoLeaf.Print`, **seulement si le core est présent**                        |
| 3      | S'enregistre au registre de plugins                                                |
| 4 et 5 | Déclare les deux créneaux de barre d'outils **et** câble l'action — sous condition |

⚠️ **Les étapes 4 et 5 sont dans un `if (getPrintConfig().enabled !== false)`.** Conséquence
observable, et elle diffère de celle de `table` : éteindre `print` par la configuration ne cache pas
seulement le bouton — **le créneau n'est jamais déclaré et l'écouteur jamais posé**. Le plugin est
alors chargé, monté sur le namespace, et **muet**. L'API programmatique, elle, reste appelable :
`GeoLeaf.Print.openPrintFlow()` fonctionne sur un plugin « éteint ». C'est délibéré — le gate
commande la **surface d'interface**, pas la capacité.

`measure` applique exactement le même patron ; `table`, non.

---

## Fonctionnalités

| ID    | Fonctionnalité                                    | Entrée                                        | Sortie observable                                                                                                      | Code                                                   |
| ----- | ------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| PR-01 | Verrouillage de l'échelle                         | Échelle courante de la carte                  | L'échelle est figée pour toute la suite du parcours, et affichée dans la fenêtre                                       | `modal-open.ts`, `scale-format.ts`                     |
| PR-02 | Tracé d'emprise au cliquer-glisser                | Geste sur la carte                            | Un rectangle géographique ; il peut être retracé sans quitter le parcours                                              | `emprise-selector.ts`                                  |
| PR-03 | Formats de page déclarés **et extensibles**       | `defaultFormat`, `availableFormats`           | A4 et A3 livrés ; un intégrateur en ajoute par `registerPageFormat`                                                    | `page-format.ts`, `format-registry.ts`                 |
| PR-04 | Orientation portrait / paysage                    | Choix dans la fenêtre                         | Les zones de la planche sont recalculées                                                                               | `page-format.ts`                                       |
| PR-05 | Re-rendu **hors écran** à la dimension du papier  | Emprise + format + résolution                 | Un canevas au nombre de points du papier, pas à celui de l'écran — c'est ce qui rend l'échelle imprimée exacte         | `offscreen-render.ts`                                  |
| PR-06 | Plafond de surface de canevas sur mobile          | Grand format à haute résolution               | Au-delà du plafond, le rendu est ramené sous la limite plutôt que de faire échouer l'onglet                            | `offscreen-render.ts`                                  |
| PR-07 | Composition de la planche en zones                | Options cochées                               | Titre, description, carte, légende, échelle, flèche du nord, annotations, assemblés selon les marges                   | `layout-composer.ts`                                   |
| PR-08 | Légende **en ligne**, reconstruite pour le papier | `includeLegend`                               | La légende est lue depuis la capacité in-core et re-rendue à la taille de la planche, pas capturée à l'écran           | `overlays/legend-inline.ts`                            |
| PR-09 | Échelle graphique et flèche du nord               | `includeScale`, `includeNorthArrow`           | Deux surimpressions vectorielles, dessinées à la dimension du papier                                                   | `overlays/scale-overlay.ts`, `overlays/north-arrow.ts` |
| PR-10 | Annotations de `measure`                          | `includeAnnotations`                          | Récupérées par le namespace **si** le plugin est chargé ; sinon la case est sans effet                                 | `overlays/annotations-overlay.ts`                      |
| PR-11 | Deux exportateurs livrés, **et extensibles**      | `exportFormats`                               | PDF et image ; un intégrateur en ajoute par `registerExporter`                                                         | `exporters/`, `format-registry.ts`                     |
| PR-12 | Créneaux de composition ouverts                   | `registerSlot`                                | Un tiers insère son propre bloc dans la planche                                                                        | `format-registry.ts`, `modal-compose.ts`               |
| PR-13 | Repli serveur                                     | `serverEndpoint`, ou canevas souillé          | Le rendu est délégué à un point d'accès HTTP, avec ses en-têtes                                                        | `server-fallback.ts`                                   |
| PR-14 | Repli serveur **forçable**                        | `forceServer`                                 | Le chemin navigateur est court-circuité, même quand il aurait fonctionné                                               | `server-fallback.ts`                                   |
| PR-15 | Trois erreurs nommées                             | Canevas souillé, échec de rendu, pas de carte | Trois messages distincts plutôt qu'un échec unique — le premier est celui qu'un intégrateur peut corriger côté serveur | `lang/`, `flow.ts`                                     |

Les tests qui couvrent ces lignes : `packages/plugins/print/src/__tests__/`, plus un scénario
navigateur dédié sous `e2e/`.

---

## Configuration

Bloc `modules.print` d'un profil. ⚠️ **Cette table n'est PAS gatée** — le garde de cette fiche ne lit
que le manifeste.

| Clé                  | Type      | Défaut                                         | Rôle                                                   |
| -------------------- | --------- | ---------------------------------------------- | ------------------------------------------------------ |
| `enabled`            | `boolean` | `true`                                         | Commande la **surface d'interface** — voir §Les étapes |
| `showButton`         | `boolean` | `true`                                         | Affiche le bouton                                      |
| `position`           | `string`  | `"left"`                                       | Ancrage du bouton                                      |
| `defaultFormat`      | `string`  | `"A4"`                                         | Format proposé à l'ouverture                           |
| `availableFormats`   | `array`   | `["A4", "A3"]`                                 | Formats offerts au choix                               |
| `dpi`                | `number`  | `300`                                          | Résolution du rendu hors écran                         |
| `availableDpi`       | `array`   | `[300]`                                        | Résolutions offertes — **une seule** par défaut        |
| `margins`            | `object`  | `{ top: 10, right: 10, bottom: 10, left: 10 }` | Marges de la planche                                   |
| `includeLegend`      | `boolean` | `false`                                        | Case « légende » — **décochée** par défaut             |
| `includeScale`       | `boolean` | `true`                                         | Case « échelle »                                       |
| `includeNorthArrow`  | `boolean` | `true`                                         | Case « flèche du nord »                                |
| `includeAnnotations` | `boolean` | `true`                                         | Case « annotations »                                   |
| `title`              | `string`  | `""`                                           | Titre pré-rempli                                       |
| `exportFormats`      | `array`   | `["pdf", "jpg"]`                               | Boutons d'export proposés                              |
| `jpgQuality`         | `number`  | `0.92`                                         | Qualité de l'image                                     |
| `serverEndpoint`     | `string`  | —                                              | Point d'accès du repli serveur. **Sans défaut**        |
| `serverHeaders`      | `object`  | `{}`                                           | En-têtes joints à l'appel serveur                      |
| `forceServer`        | `boolean` | `false`                                        | Court-circuite le chemin navigateur                    |
| `maxCanvasPxMobile`  | `number`  | 16 millions de points                          | Plafond de surface du canevas sur mobile               |

⚠️ **`includeLegend` est le seul des quatre à valoir `false`.** Ce n'est pas une asymétrie fortuite :
la légende est la seule surimpression qui dépend d'une **autre** brique — la capacité in-core — et
dont l'absence produirait une planche incomplète sans erreur. Le défaut décoché évite de promettre
ce qui n'est pas garanti.

⚠️ **`serverEndpoint` n'a pas de défaut, et c'est structurant** : sans lui, le repli serveur est
indisponible et un canevas souillé devient un échec définitif, pas une dégradation.

⚠️ **La clé racine `printConfig` n'est PLUS acceptée.** L'ancienne forme a été retirée sans repli :
`applyModulesCompat`, `LEGACY_ROOT_KEYS` et la retombée de résolution ont **zéro occurrence** dans
`packages/core/src/`. Un profil resté sur `printConfig` est ignoré **en silence**. Le fait est déjà
consigné à l'inventaire.

---

## Contrat exposé

### API publique — `GeoLeaf.Print`

| Membre                                        | Rend / fait                                             |
| --------------------------------------------- | ------------------------------------------------------- |
| `openPrintFlow(options?)`                     | Ouvre le parcours complet — c'est ce que câble l'action |
| `captureExtent(...)` · `captureViewport(...)` | Rend hors écran une emprise, ou la vue courante         |
| `exportPDF(...)` · `exportImage(...)`         | Les deux exportateurs livrés                            |
| `registerExporter(...)`                       | Ajoute un format d'export                               |
| `registerPageFormat(...)`                     | Ajoute un format de page                                |
| `registerSlot(...)`                           | Insère un bloc dans la composition                      |
| `_getExporter(...)`                           | ⚠️ **Membre à préfixe interne sur une façade publique** |

⚠️ **`_getExporter` est publié.** Le préfixe `_` signale l'usage interne, et la façade le monte
quand même sur le namespace : la convention du dépôt et la surface réelle se contredisent ici. Il est
consommé par les tests. Versé en **B-71** du registre.

**Les trois `register*` sont la vraie surface d'extension du plugin** — c'est ce qui le distingue de
`table` et `measure`, et ce qui permet à un intégrateur d'ajouter un gabarit de planche maison sans
modifier le paquet.

### Événements

**Aucun émis.** Le plugin est un parcours modal : il n'a pas d'état que d'autres surfaces auraient à
suivre. Écouté : `geoleaf:toolbar:action`, filtré sur `print`.

---

## Décisions de conception

| Décision                                                    | Pourquoi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Alternative écartée                                                                        |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Re-rendu hors écran, pas capture d'écran**                | Une capture du canevas visible a la résolution de l'écran : à l'impression, l'échelle est fausse et le rendu crénelé. Rendre à la dimension du papier est la seule façon d'obtenir une échelle exacte                                                                                                                                                                                                                                                                                                                                                    | Photographier le canevas                                                                   |
| **L'échelle se verrouille AVANT l'emprise**                 | L'emprise se trace à échelle constante, sinon le cadre et l'échelle se poursuivent l'un l'autre                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Choisir l'échelle en fin de parcours                                                       |
| **Plafond de surface sur mobile**                           | Un canevas trop grand ne lève pas d'erreur exploitable : il rend un canevas **vide**, ou l'onglet meurt. Le plafond dégrade au lieu de perdre le travail                                                                                                                                                                                                                                                                                                                                                                                                 | Laisser le navigateur arbitrer                                                             |
| **La légende est reconstruite, pas capturée**               | Capturer le panneau écran donnerait une image à la résolution de l'écran dans une planche à 300 points par pouce                                                                                                                                                                                                                                                                                                                                                                                                                                         | Photographier le panneau                                                                   |
| **Les annotations viennent de `measure`, par le namespace** | Le plugin ne doit ni dépendre de `measure`, ni le dupliquer. La lecture au namespace rend la case sans effet quand il est absent, plutôt qu'en erreur                                                                                                                                                                                                                                                                                                                                                                                                    | Un `requires: ["measure"]`                                                                 |
| **Un repli serveur explicite**                              | Un fond tiers sans autorisation d'origine croisée souille le canevas et rend l'export **impossible** côté navigateur. Le repli est la seule issue                                                                                                                                                                                                                                                                                                                                                                                                        | Échouer                                                                                    |
| **Le gate ne commande que la surface d'interface**          | Un intégrateur qui pilote l'export par programme n'a pas besoin du bouton. Éteindre l'un ne doit pas éteindre l'autre                                                                                                                                                                                                                                                                                                                                                                                                                                    | Un gate qui coupe tout                                                                     |
| **Registres ouverts pour formats, exportateurs et blocs**   | Une planche est un objet métier : les besoins réels sont trop variés pour être livrés. Trois points d'extension valent mieux qu'un paquet à modifier                                                                                                                                                                                                                                                                                                                                                                                                     | Un jeu figé                                                                                |
| **Aucun cycle de vie**                                      | Le plugin n'a rien à faire tant que l'utilisateur ne demande rien. S'abonner au démarrage aurait coûté sans servir                                                                                                                                                                                                                                                                                                                                                                                                                                       | Un abonnement à `geoleaf:map:ready`                                                        |
| **Le garde-fou d'attente `idle` est LARGE, pas serré**      | Il existe pour un fond de plan qui ne répond jamais, **pas** pour du matériel lent — son rejet ne dégrade pas l'export, il le **supprime**. Mesuré le 01/08/2026 sur un hôte à 2 cœurs, et **la première bascule domine** : A4→A3 à froid **109 280 ms**, A3→A4 28 062 ms, A4→A3 à chaud 34 819 ms. Le budget de 30 s tombait donc dans la durée réelle, pas au-dessus. ⚠️ Un premier relèvement à 90 s, calé sur un unique échantillon **tiède** (~36 s), s'est révélé marginal à son tour. Porté à **180 s**, calé sur le cas FROID plus marge (B-105) | Serrer le budget pour « échouer vite » ; caler sur une moyenne plutôt que sur le cas froid |

---

## Dépendances et frontières

| Dépendance              | Nature         | Note                                                                   |
| ----------------------- | -------------- | ---------------------------------------------------------------------- |
| `@geoleaf/core`         | production     | —                                                                      |
| `jspdf`                 | **production** | La seule bibliothèque tierce embarquée du lot avec celles de `measure` |
| `maplibre-gl`           | **pair**       | Hors paquet, fournie par l'hôte                                        |
| `@geoleaf/host-runtime` | développement  | Regroupée à la construction, jamais installée chez l'intégrateur       |

**Frontière avec `legend` et `measure` : le namespace, jamais l'import.** Aucun import statique vers
une capacité du core ni vers un autre plugin — ce qui est ce qui rend les deux surimpressions
optionnelles pour de bon.

`README.md` **est** dans `files[]` : il part dans l'archive npm, contrairement à ceux de `table` et
`addpoi`.

---

## Écarts au CDC source

Le CDC `CDC_plugin-print.md` (v1.6.0, 21/06/2026) a été **consommé** en écrivant cette fiche, puis
**supprimé** du dossier de tri — ligne au §Journal des décisions de
`roadmap_documentation-v3.md`.

⚠️ **C'est le plus ancien CDC du lot — un mois de plus que les trois autres — et son §1.6 documente
la configuration sous le nom `printConfig`.** C'est précisément la clé racine que le core
**n'accepte plus**, et sans repli ni avertissement. Le CDC enseigne donc une forme qui échoue en
silence.

| Énoncé du CDC                              | Ce que dit le code                                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| §1.6 — configuration sous `printConfig`    | **Le bloc est `modules.print`.** La clé racine n'est plus lue, et son abandon est **silencieux**                  |
| §1.8 / §Hors périmètre V1 — cadrage « V1 » | **Le cadrage par version n'a plus d'objet** : le plugin est publié tel qu'il est décrit ici                       |
| §2.3 — l'API publique                      | ✅ **Les neuf membres vérifiés exacts**, `_getExporter` compris — que le CDC documente donc bien, préfixe et tout |
| §1.2 — le parcours en sept étapes          | ✅ **Vérifié exact** dans son enchaînement : échelle, activation, emprise, fenêtre, format, composition, export   |
| §2.2 — le montage du namespace             | ✅ **Vérifié exact**, y compris la garde de présence du core                                                      |

⚠️ **Ce que le CDC ne dit pas, et que la fiche ajoute** : les deux entrées d'`optional` sont fausses
(**B-66**), et le gate ne commande que la surface d'interface — l'API programmatique reste vivante
sur un plugin « éteint ».

Ce qui a été **retenu** du CDC et ne se lit pas dans le code : le positionnement (pourquoi un plugin
d'impression dédié plutôt que l'impression du navigateur), les trois scénarios d'usage, les limites
connues du canevas souillé, et les alternatives écartées de la table §Décisions.
