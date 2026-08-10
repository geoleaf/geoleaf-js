---
type: spec-capacite
title: legend — la légende cartographique, déduite des fichiers de style
capability_id: legend
package: "@geoleaf/core"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 00e6bdd7
date: 28 juillet 2026
---

# legend — la légende cartographique, déduite des fichiers de style

**Type :** capacité in-core · **Code :** `packages/core/src/capabilities/legend/` ·
**Vérifié contre :** `00e6bdd7` (28/07/2026)

> **Deux règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.

---

## Périmètre

### Ce que la capacité fait

Elle construit un panneau d'accordéons — **un par couche visible** — dont les entrées sont
**générées** à partir du fichier de style JSON de la couche, croisé avec la taxonomie pour les
catégories, les couleurs et les icônes. Elle **reflète** la visibilité ; elle ne la pilote pas.

### Ce qu'elle ne fait pas

- **Elle ne décide pas de la visibilité.** L'autorité est le `VisibilityManager` du kernel : la
  légende lit `getVisibilityState(layerId)` et exclut du rendu ce qui est hors échelle. Une couche
  masquée par le zoom disparaît de la légende sans que la légende l'ait su autrement.
- **Elle ne charge pas les légendes du thème actif** — elle charge celles de **toutes** les couches
  configurées. Le filtrage par thème a existé, il était **mort** (`ThemeSelector` n'a jamais exposé
  le `getActiveTheme()` qu'il lisait, la lecture valait toujours `undefined`), et la branche a été
  retirée. Le comportement n'a pas changé : il est seulement devenu lisible.
- **`toggleAccordion()` ne fait rien.** La méthode est publiée par la façade et son corps est vide —
  le pliage est géré visuellement par le rendu. Elle est conservée parce qu'elle est dans la surface
  gelée par le golden-master des façades, pas parce qu'elle agit.
- **Elle ne peint pas la carte.** Aucune écriture de style, aucune couche MapLibre ; son seul effet
  sur le moteur est nul, et son seul effet sur le DOM est son propre contrôle.

---

## Fonctionnalités

| ID    | Fonctionnalité                                           | Entrée                                            | Sortie observable                                                                                                                                            | Code                                          |
| ----- | -------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| LG-01 | Montage différé au démarrage complet                     | `geoleaf:app:ready`                               | Le contrôle est construit et ajouté à la carte. Écouteur `{ once: true }` — un seul montage par cycle de vie                                                 | `lifecycle.ts` → `init`                       |
| LG-02 | Gate tardif sur la configuration **fusionnée**           | `modules.legend.enabled` d'un profil              | Le gate de boot tourne sur la configuration d'**avant** la fusion du profil ; la décision réelle se prend ici — voir §Configuration                          | `lifecycle.ts` → `_onAppReady`                |
| LG-03 | Registre des couches issu du profil                      | Profil actif                                      | Une entrée par couche déclarée, **dans l'ordre du profil** — c'est cet ordre qui ordonne les accordéons                                                      | `legend.ts` → `_initializeAllLayers`          |
| LG-04 | Génération d'une légende depuis un style                 | `loadLayerLegend(layerId, styleId, layerConfig)`  | Le fichier de style est récupéré, converti en sections / items, et le panneau est reconstruit                                                                | `legend.ts`, `legend-generator.ts`            |
| LG-05 | Reconstruction **anti-rebond**                           | Rafale d'appels de visibilité ou de chargement    | Une seule reconstruction, différée. Sans quoi un changement de thème en déclencherait une par couche                                                         | `legend.ts` → `_scheduleRebuild`              |
| LG-06 | Exclusion des couches hors échelle                       | Zoom                                              | L'accordéon disparaît. L'état vient du `VisibilityManager`, avec repli sur l'état local si le gestionnaire est absent                                        | `legend.ts` → `_updateLegendContent`          |
| LG-07 | Retrait du contrôle quand il n'y a plus rien             | Registre vidé                                     | Le contrôle est retiré de la carte plutôt que laissé vide                                                                                                    | `legend.ts` → `_rebuildDisplay`               |
| LG-08 | Icônes de taxonomie par sprite SVG                       | Style dont les règles sont indexées par catégorie | Symboles rendus par `<use href="#…">` sur le sprite du profil, injecté par le chargeur neutre — **jamais** par l'adaptateur MapLibre                         | `legend-generator.ts`, `legend-control.ts`    |
| LG-09 | Nouvelle tentative si le sprite manque                   | Icônes détectées, sprite pas encore prêt          | Un seul essai en vol à la fois, et il ne re-rend que si le sprite est **effectivement** arrivé                                                               | `legend.ts` → `_updateLegendContent`          |
| LG-10 | Correspondance de catégorie insensible à la casse        | Table de taxonomie                                | Le rapprochement passe par le résolveur de `taxonomy` — la légende portait sa propre correspondance, qui pouvait diverger                                    | `legend-generator.ts`, `taxonomy/resolver.ts` |
| LG-11 | Deux balayages inter-catégories **non interchangeables** | Sous-catégorie sans parent connu                  | L'un s'arrête à la première clé qui correspond (il **nomme** un parent), l'autre continue jusqu'à en trouver une qui porte une icône (il **rend** une icône) | `legend-generator.ts`                         |
| LG-12 | Voile d'attente avec échéance propre                     | `showLoadingOverlay()`                            | Le voile se retire de lui-même passé son délai, **quoi que fasse l'appelant**. Le conteneur est résolu **au moment du retrait**, pas capturé                 | `legend-overlay.ts`                           |
| LG-13 | Signal de montage du contrôle                            | Premier montage réussi                            | `geoleaf:legend:ready` — **une seule fois par cycle de vie** (la fonction sort tôt si le contrôle existe déjà)                                               | `legend.ts` → `_ensureLegendControl`          |
| LG-14 | Titre localisé, résolu à l'appel                         | `ui.language`                                     | Le titre suit la langue active. Résolu **par appel**, jamais figé à l'import — voir §Configuration                                                           | `config.ts` → `getLegendConfig`               |
| LG-15 | Démarrage autonome, hors configuration du core           | Aucun `Config` sur le namespace                   | Les défauts sont dupliqués sur ce chemin, **sauf le titre**, qui interroge le dictionnaire comme l'autre chemin                                              | `legend.ts` → `init`                          |
| LG-16 | Démontage complet                                        | `LegendModule.destroy()`                          | Les **trois** échéances en attente sont annulées, le contrôle retiré, le registre vidé, les références carte / profil / taxonomie relâchées                  | `legend.ts` → `_reset`, `legend-overlay.ts`   |
| LG-17 | Pastille de barre d'outils mobile                        | Barre mobile                                      | Icône de bascule, visible par défaut, gouvernée par la **même** clé que la capacité                                                                          | `module.ts` → `ui.mobileIcon`                 |
| LG-18 | Membrane pour les appelants du kernel                    | Sélecteur de style, synchro d'interface du thème  | Ils appellent au travers d'un contrat gardé, sans dépendre du cycle de vie de la légende ni toucher au namespace global                                      | `legend-seam.ts` → `LegendContract`           |
| LG-19 | Silence quand la capacité est éteinte                    | `loadLayerLegend` sur une légende non initialisée | Aucun avertissement — le module **est** délibérément non initialisé. L'avertissement ne sort que si la capacité est censée être active                       | `legend.ts` → `loadLayerLegend`               |

Les tests qui couvrent ces lignes vivent dans **deux** répertoires — `__tests__/capabilities/legend/`
et `__tests__/legend/`, hérité. C'est la seule capacité du dépôt dans ce cas ; le décompte se
mesure, il ne se recopie pas.

---

## Configuration

Bloc `modules.legend` d'un profil. Conformité de cette table au code gardée par
`__tests__/guards/doc-capability-config.guard.test.js`.

| Paramètre            | Type      | Défaut         | Où c'est lu                                                                                              |
| -------------------- | --------- | -------------- | -------------------------------------------------------------------------------------------------------- |
| `enabled`            | `boolean` | `true`         | `config.ts` → `getLegendConfig()`, appliqué par le **gate tardif** de `lifecycle.ts`. Opt-out            |
| `title`              | `string`  | `"Légende"`    | `config.ts` → `getLegendConfig()`, puis `legend.ts` → `init`. **Résolu par appel** — voir ci-dessous     |
| `position`           | `string`  | `"bottomleft"` | `legend.ts` → `init` → options du contrôle. Valeurs : `bottomleft`, `bottomright`, `topleft`, `topright` |
| `collapsedByDefault` | `boolean` | `false`        | `legend.ts` → `init` → option `collapsed` du contrôle                                                    |

### Le titre est le seul défaut que le lecteur ne porte pas en dur

`DEFAULTS` ne contient **pas** `title` : il est ajouté à chaque appel de `getLegendConfig()` en
interrogeant le dictionnaire sur `ui.legend.title`. Le motif est un piège d'ordre de démarrage : un
`getLabel()` au niveau du module s'exécuterait **à l'import**, avant que l'initialisation i18n n'ait
lu `ui.language`, et **figerait la langue de repli pour tout le processus**. Le défaut annoncé par le
schéma (`"Légende"`) est donc la **référence française**, pas une constante — c'est la valeur servie
tant qu'aucun profil ni aucune autre langue n'intervient, et un profil qui pose la clé gagne toujours.

⚠️ **Ce champ a servi la chaîne anglaise `"Legend"` aux six langues** jusqu'à ce que B.24/B.38 le
mette au jour : le schéma n'annonçait alors **aucun** défaut, donc rien ne rougissait. Les deux
chemins d'initialisation — avec et sans `Config` sur le namespace — passent désormais par le
dictionnaire.

### `collapsible` n'est pas configurable, et c'est délibéré

Le contrôle reçoit `collapsible: true` en constante. Le CDC source l'avait déjà noté ; la fiche le
répète parce que la clé **existe dans les options du contrôle** et qu'un lecteur du code pourrait la
croire exposée. Elle ne l'est pas : elle n'est ni dans le `configSchema`, ni dans `DEFAULTS`.

### Deux étages de gate, une seule clé

| Étage               | Ce qu'il commande           | Sur quelle configuration                         |
| ------------------- | --------------------------- | ------------------------------------------------ |
| Gate de la capacité | L'enregistrement du module  | La configuration **d'avant** la fusion du profil |
| **Gate tardif**     | Le montage réel du contrôle | La configuration **fusionnée**                   |

⚠️ **`enableWhenAbsent: true` est ici un VRAI opt-out**, comme pour
[`permalink`](permalink.md) et contrairement à [`theme-toggle`](theme-toggle.md) et
[`theme-selector`](theme-selector.md) : les deux étages lisent la même clé avec le même défaut. Le
motif est le piège de calendrier ci-dessus — un opt-in `=== true` lirait `undefined` au boot et la
légende disparaîtrait **en silence**.

✅ **Deux `description` de ce `configSchema` citaient une ligne de `config.ts`, et les deux visaient
à côté** — elles sont **publiées** par `getCapabilitySchema("legend")`. Corrigées le 29/07/2026
(**B-63**), avec les 22 autres du même gisement, en citant le **symbole** plutôt que la ligne.

✅ **Et la classe est fermée** : `__tests__/guards/no-line-citations-in-published.guard.test.js`
interdit désormais toute citation `fichier:ligne` dans un `configSchema` ou une façade ESM — les
deux surfaces que l'intégrateur reçoit, et où il ne peut pas constater la dérive.

---

## Contrat exposé

### API publique — `GeoLeaf.Legend`

⚠️ **Ce n'est pas une façade en lecture seule** : `public-api.ts` ré-exporte le **singleton runtime
complet**, celui qui porte l'état du module, l'anti-rebond et les appels réseau. Le fichier est mince
par construction depuis B.28 — il a **été** ce runtime, sous un nom qui promettait le contraire, ce
qui obligeait `lifecycle.ts` à importer sa propre API publique. Il importe désormais
l'implémentation, comme toutes les autres capacités.

| Membre                                           | Rend / fait                                                                      |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| `init(map, options?)`                            | Lit le bloc du profil, résout le profil actif et la taxonomie, bâtit le registre |
| `loadLayerLegend(layerId, styleId, layerConfig)` | Récupère le style de la couche et en génère la légende                           |
| `setLayerVisibility(layerId, visible)`           | Met à jour l'état local et programme une reconstruction                          |
| `getAllLayers()`                                 | Le registre, **en accès direct** — la carte interne, pas une copie               |
| `hideLegend()` · `removeLegend()`                | Masque le contrôle · retire le contrôle et vide les légendes générées            |
| `isLegendVisible()`                              | Contrôle monté **et** registre non vide                                          |
| `showLoadingOverlay()` · `hideLoadingOverlay()`  | Le voile d'attente                                                               |
| `toggleAccordion(layerId)`                       | **Ne fait rien** — voir §Périmètre                                               |
| `_loadTaxonomy()` · `_reset()`                   | Interne · démontage complet, appelé par le cycle de vie                          |

### Trois montages, pas un

`install.ts` → `registerGlobals(gl)` pose `Legend` (la façade), plus **deux** constructeurs de rendu :
`_LegendControl` et `_LegendGenerator`. Ils sont lus **par le namespace** depuis le runtime de la
capacité, ce qui est le contraire d'une importation — c'est ce qui permet au contrôle et au
générateur de rester substituables. `_LegendRenderer` a été monté jusqu'à ce qu'on mesure qu'il
n'était **jamais lu** par le global (le contrôle importe le rendu statiquement) : il a été retiré.

### Le seam, et ses deux appelants

`legend-seam.ts` expose `LegendContract` — `isAvailable()`, `loadLayerLegend()`,
`setLayerVisibility()`. Il existe pour que le kernel n'ait à connaître **ni** le cycle de vie de la
légende, **ni** le namespace global. Ses deux importateurs sont `kernel/layer-manager/style-selector`
et `kernel/themes/theme-applier/ui-sync`.

⚠️ Le seam importe la légende **par la façade ESM** (`api/geoleaf.legend.js`), pas par
`public-api.ts`. `install.ts` fait de même. Ce n'est pas une irrégularité isolée : `filter` et
`feature-info` importent aussi leur propre façade depuis leur installeur.

### Événements

| Signal                 | Sens       | Rôle                                                                                   |
| ---------------------- | ---------- | -------------------------------------------------------------------------------------- |
| `geoleaf:app:ready`    | **écouté** | Déclenche le montage. `{ once: true }`, et détaché par `_reset()`                      |
| `geoleaf:legend:ready` | **émis**   | Le contrôle est monté. Charge utile `{ position, layerCount }`. **Une fois par cycle** |

`geoleaf:legend:ready` est **typé** dans `contracts/event-bus.contract.ts` — ce qui n'est pas le cas
de tous les signaux du dépôt, et vaut d'être noté ici plutôt que supposé.

### Stockage écrit

Aucun. Ni `localStorage`, ni `sessionStorage`, ni IndexedDB. Le seul état survivant à un rendu est le
registre en mémoire, que `_reset()` vide.

---

## Décisions de conception

| Décision                                                    | Pourquoi                                                                                                                                                                                           | Alternative écartée                         |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Capacité in-core, pas plugin**                            | Extraire la légende ne gagnait rien au bundle, et le kernel devait de toute façon l'appeler. La frontière est le gate de configuration, pas la frontière de paquet                                 | Un plugin publié                            |
| **Montage sur `app:ready`, dans un cycle de vie unique**    | L'initialisation réelle était amorcée depuis **deux** endroits extérieurs à la légende. Les réunir a rendu la capacité autonome — et c'est un changement boot-sensible, assumé comme tel           | Garder les deux amorces                     |
| **`dependencies = ["geojson"]`, et surtout pas `"ui"`**     | Le module doit être dépilé **avant** le moteur de thème, qui est ce qui émet `app:ready` sur le chemin thémé. Ajouter `ui` le ferait dépiler après, et l'écouteur manquerait l'événement           | `["geojson", "ui"]`                         |
| **Gate opt-out, et un second gate tardif**                  | Le gate de boot lit une configuration d'avant la fusion du profil. Un opt-in y serait indiscernable d'une absence — la légende disparaîtrait sans trace                                            | Un gate unique, opt-in                      |
| **Le titre est résolu à chaque appel**                      | Le résoudre à l'import figerait la langue de repli avant que l'i18n n'ait lu `ui.language`. Le danger est réel, pas théorique : l'ordre de démarrage le produit                                    | Le hisser dans `DEFAULTS`                   |
| **Le runtime a quitté `public-api.ts`**                     | Un fichier nommé « API publique » portant l'état, trois échéances, `fetch()` et des écritures DOM forçait le cycle de vie à importer sa propre façade — la seule capacité dans ce cas              | Laisser le runtime sous le nom de la façade |
| **Le rendu de symbole reste dans le kernel**                | `_UIComponents` est de l'infrastructure d'interface partagée, lue par seam. La migrer dans la capacité aurait déplacé du code partagé pour un seul appelant                                        | Absorber le rendu dans la capacité          |
| **La visibilité-zoom reste au kernel**                      | Le `VisibilityManager` est l'autorité unique et la légende s'y abonne déjà. Recalculer ici aurait créé une seconde vérité                                                                          | Recalculer l'échelle dans la légende        |
| **Le conteneur du voile est un RÉSOLVEUR, pas un élément**  | L'échéance se déclenche longtemps après ; d'ici là le contrôle peut avoir été remplacé ou détruit. Capturer l'élément retirait `aria-busy` d'un nœud détaché en laissant le panneau courant occupé | Capturer le conteneur à l'ouverture         |
| **Une seule nouvelle tentative de sprite en vol**           | Une rafale de mises à jour de contenu aurait empilé une tentative par mise à jour — et la référence unique est ce que `_reset()` sait annuler                                                      | Une tentative par mise à jour               |
| **Les deux balayages inter-catégories restent distincts**   | Ils ont la même forme et une règle d'arrêt différente : nommer un parent, ou rendre une icône. Sur une table où deux catégories partagent une clé de sous-catégorie, ils répondent différemment    | Les fusionner en un seul                    |
| **`LEGEND_TAXONOMY_REF` est une constante partagée**        | Elle est **codée en dur** — voir l'avertissement ci-dessous. La centraliser garantit au moins que les deux sites de lecture ne divergent pas, et que lever la limite est une seule modification    | Une copie par site de lecture               |
| **Le résolveur de taxonomie ne sert QUE de correspondance** | La légende applique l'identifiant **brut** du sprite ; le résolveur d'icône de POI rend l'identifiant **teinté** de l'atlas, que `<use href="#…">` ne sait pas résoudre                            | Réutiliser le résolveur d'icône de POI      |
| **Pas de `loader`**                                         | La légende est dans le bundle chargé au démarrage ; un chargement paresseux arriverait après le besoin. Le gate suffit à ne pas la monter                                                          | Un `import()` paresseux                     |

⚠️ **La taxonomie lue est codée en dur, et c'est une limitation connue.** La bonne source est
`modules.taxonomy.layers.<layerId>.use`, et la capacité `taxonomy` expose déjà le seam qui la résout.
La légende ne peut pas s'en servir pour deux raisons écrites dans le code : le point d'entrée
documenté du générateur ne transporte **aucun identifiant de couche**, et le seam n'a pas de
contrepartie par couche pour les correspondances de champ. **L'impact mesuré aujourd'hui est nul** —
tous les liens des profils livrés nomment la même taxonomie —, et le défaut est **latent** : il mord
le premier profil qui nomme la sienne autrement. C'est **B.36d**, et la mesure vit dans le TSDoc de
la constante.

---

## Dépendances et frontières

### Le module, et pourquoi son rang est porteur

`LegendModule` déclare `id = "legend"`, `dependencies = ["geojson"]`, et porte un créneau
`ui.mobileIcon` dont la `profileKey` est **la clé de la capacité elle-même** — le bouton et la
capacité s'éteignent donc ensemble, ce qui n'est pas le cas partout (voir
[`theme-palette`](theme-palette.md), où le gate ne commande que le bouton).

🛑 **Cette phrase disait « Sa position dans `presets/manifest.full.ts` est porteuse : la barre
d'outils mobile rend ses pastilles dans l'ordre d'enregistrement » — et ce n'est plus vrai depuis
le 07/08/2026** (socle-init 7.5). `ui.mobileIcon` porte désormais un `order` explicite — `legend`
déclare **10**, `share` **20** — et `_appendRegistryIcons` trie dessus, avec un tri **stable** qui
laisse les modules sans `order` à leur rang d'enregistrement, derrière les ordonnés. La position au
manifeste reste porteuse pour ses **autres** raisons (départage du tri topologique, séquence des
`sharedLifecycle`), mais **plus pour la barre d'outils** : c'était le quatrième sens qui voyageait
en silence sur une même liste, et il en est sorti. Reste vrai : **seules `legend` et `share`
déclarent une icône mobile côté core** (mesuré). Le numéro d'ordre ne se recopie pas ici ; la garde
est `__tests__/ui/mobile-toolbar-pill-order.test.ts`.

⚠️ **La question de rang de B-57 se pose bien ici** :
`dependencies = ["geojson"]` n'exprime pas un besoin de données, il exprime un besoin **d'ordre** —
être dépilé avant le moteur de thème. Le motif est écrit dans l'en-tête du module, ce qui le
distingue d'une astuce silencieuse, mais c'est la même astuce.

### Frontière `capabilities/` → `kernel/` (règle ESLint R.8)

| Import                                               | Statut vis-à-vis de R.8                                                |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| `kernel/shared/index.js` (`getAllLayerConfigs`)      | **Baril de médiation** — la légende en est l'unique lecteur traversant |
| `kernel/security/index.js` (`DOMSecurity`)           | **Baril**                                                              |
| `kernel/ui/index.js` (bascule repliable, composants) | **Baril**                                                              |
| `kernel/events/index.js`                             | **Baril**                                                              |

Deux lectures échappent au typage et passent par le namespace global :
`_GeoJSONLayerManager._loadLayerLegend` et `_LayerVisibilityManager.getVisibilityState`. Ce sont des
seams runtime assumés — la légende n'a pas de dépendance de module vers le gestionnaire de couches.

### Frontière avec `taxonomy`

**Deux voies, et elles ne sont pas du même ordre.** Les **types** viennent d'un import statique de
`capabilities/taxonomy/types.js` (ré-exportés par ceux de la légende) ; les **valeurs** viennent du
namespace `GeoLeaf.Taxonomy`, jamais d'un import. La correspondance de clé, elle, est **importée**
depuis le résolveur de `taxonomy` — c'est la seule arête de valeur, et elle existe précisément pour
qu'il n'y ait pas deux correspondances pour une taxonomie.

⚠️ **Les trois capacités qui lisent la taxonomie le font de trois façons différentes** : `legend`
code la référence en dur, [`filter`](filter.md) passe une référence configurable par champ, et
[`feature-info`](feature-info.md) canardise le seam avec une interface déclarée localement. Ce n'est
consigné nulle part ailleurs, et c'est visible seulement en lisant les trois.

### Frontière avec le moteur cartographique

**Aucune.** L'injection du sprite passe par le chargeur neutre `utils/loaders/`, jamais par
l'adaptateur MapLibre, et la frontière est gardée par ESLint. `DEFAULT_FEATURE_COLOR` vient des
constantes partagées.

### Frontière côté CSS

`install.ts` importe `./css/legend.css`. La feuille entre dans le graphe **depuis l'installeur** —
sauter l'installeur, c'est aussi ne pas embarquer la CSS : elle s'élague avec le code.

---

## Écarts au CDC source

Le CDC `CDC_capacite-legend.md` (v1.0.4, 11/07/2026) a été **consommé** en écrivant cette fiche, puis
**supprimé** du dossier de tri — ligne au §Journal des décisions de
`roadmap_documentation-v3.md`.

| Énoncé du CDC                                                                   | Ce que dit le code                                                                                                                                                                               |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §3 — `title` a pour défaut `"Legend"`                                           | **Faux, et le document se contredit** : son propre exemple JSON, huit lignes plus haut, écrit `"Légende"`. Le schéma annonce `"Légende"` et la vraie source est le dictionnaire (B.24/B.38)      |
| §5 — `public-api.ts` → `buildPublicApi()` + `isEnabled`/`getConfig`             | **Faux** : c'est un pur ré-export du singleton runtime. Il n'y a **ni** `buildPublicApi()`, **ni** `isEnabled`, **ni** `getConfig`. La façade n'est pas en lecture seule                         |
| §5, §6, §7 — toutes les citations `legend-api.ts:NNN`                           | Le fichier **n'existe plus** : renommé `legend.ts` par B.28, et le mince `public-api.ts` a pris sa place. Aucune de ces plages ne désigne plus rien                                              |
| §5 — `LegendModule.dependencies` `["geojson","ui"]` « inchangé »                | **Faux** : `["geojson"]` seul, et l'en-tête du module écrit **pourquoi** — avec `ui`, le module serait dépilé après le moteur de thème et manquerait `app:ready`                                 |
| §5 — CSS `css/geoleaf-legend.css`, « `@import` via `geoleaf-main.css` »         | Le fichier est `css/legend.css` et il est importé **par l'installeur**, ce qui le rend élaguable avec la capacité                                                                                |
| §6 — `_LegendRenderer` « inchangé (re-pointé) »                                 | **Supprimé** — mesuré en écriture seule, jamais lu par le global                                                                                                                                 |
| §6 — charge utile `{ layerCount }`, émis par `_rebuildDisplay`                  | Charge utile réelle `{ position, layerCount }`, et l'émetteur est `_ensureLegendControl` **seul**, qui sort tôt si le contrôle existe — donc **une fois par cycle**, pas à chaque reconstruction |
| §1 — « charge les légendes des couches actives dans le **thème** »              | Le filtrage par thème était **mort** (`getActiveTheme()` n'a jamais existé) et la branche a été retirée. Ce sont **toutes** les couches configurées                                              |
| §2, §9 — « présente en Full **et** Lite », `boot-lite.ts`, `globals.ui-lite.ts` | **Le build Lite n'existe plus.** Gisement : **B-07**                                                                                                                                             |
| §8 — l'écart `fieldMappings` reste « à trancher (A/B/C) »                       | **Tranché et exécuté** : option A, `TaxonomyDef.fieldMappings?`, la façade expose `getFieldMappings(ref)`. Ce qui **reste** ouvert est ailleurs — la référence de taxonomie codée en dur (B.36d) |
| §2 — « la légende n'émet rien (`grep` = 0) »                                    | ✅ **Vrai à sa date**, et l'événement promis existe — typé au contrat, ce que le CDC ne demandait pas                                                                                            |
| §11 — risque « fuite d'état sur recreate »                                      | ✅ **Traité** pour les trois échéances et les références. ⚠️ **Mais pas pour la requête réseau** — voir ci-dessous                                                                               |

⚠️ **Un risque du §11 est traité pour les échéances et pas pour le réseau.** `_reset()` annule les
trois `setTimeout`, mais `loadLayerLegend` émet son `fetch` **sans `AbortController`** et rien ne
l'annule. Une réponse qui arrive après un démontage **repeuple** le registre qui vient d'être vidé ;
et comme la ré-initialisation **préserve** les entrées déjà présentes, l'instance suivante démarre
avec une légende produite par la précédente. C'est exactement le scénario que le TSDoc de la
tentative de sprite nomme et se garde de — « reconstruire l'instance SUIVANTE depuis la fermeture de
la précédente » —, laissé ouvert sur le seul chemin qui sort du processus. **B-67** au
registre.

Ce qui a été **retenu** du CDC et ne se lit pas dans le code : le motif du choix in-core, la raison de
la migration cassante depuis `ui.showLegend` et `legendConfig`, le fait que les trois clés d'affichage
étaient **mortes** avant d'être réveillées (écrasées par des options codées en dur, ce qui a changé le
rendu du contrôle), le motif du maintien de `_UIComponents` au kernel, et les alternatives écartées de
la table §Décisions.
