---
type: spec-capacite
title: filter — le filtre attributaire générique, et son contrat sérialisable
capability_id: filter
package: "@geoleaf/core"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 00e6bdd7
date: 28 juillet 2026
---

# filter — le filtre attributaire générique, et son contrat sérialisable

**Type :** capacité in-core · **Code :** `packages/core/src/capabilities/filter/` ·
**Vérifié contre :** `00e6bdd7` (28/07/2026)

> **Trois règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.
> 3. **Un chemin cité sans racine se lit depuis le répertoire annoncé par « Code : » ci-dessus**,
>    ou depuis son `src/`, et à défaut depuis `packages/core/src/`. Un chemin qui commence par
>    `packages/`, `scripts/`, `profiles/`, `docs/`, `apps/` ou `e2e/` est relatif à la **racine du
>    dépôt**. Les cas qui échappent aux deux sont racinés sur place.

> ⚠️ **Le chemin natif MapLibre n'existe pas, et son absence est une décision mesurée.** Toute la
> littérature antérieure décrit un filtrage « hybride » — expression GPU quand c'est exprimable,
> repli JavaScript sinon. **Le chemin natif a été écrit, testé, jamais branché, puis retiré.** Il n'y
> a qu'un seul chemin : le prédicat JavaScript, appliqué par le seam du kernel. Voir §Décisions.

---

## Périmètre

### Ce que la capacité fait

Elle rend un **panneau latéral construit depuis une déclaration** — un contrôle par champ
filtrable —, lit ce panneau en un état, et restreint l'affichage des couches en conséquence. Elle est
**agnostique à la géométrie** (point, ligne, polygone) et **indifférente à la source**. Et elle
publie cet état sous une forme **sérialisable et sans DOM**, qui est ce que le permalien manipule.

### Ce qu'elle ne fait pas

- **Elle n'écrit pas le filtre de couche elle-même.** Elle passe le prédicat au seam
  `GeoJSONCore.filterFeatures` du kernel, qui est le **seul écrivain**. C'est ce seam, pas la
  capacité, qui décide du filtre par identifiants côté GPU et de son repli.
- **Elle n'applique aucun filtre au démarrage.** L'état par défaut du panneau est « tout visible » ;
  il n'y a pas de passe initiale.
- **Elle ne monte rien si le profil n'est pas migré.** Sans `fields`, le cycle de vie est **inerte** —
  il ne monte pas un panneau vide, il ne monte pas de panneau du tout.
- **Elle n'a pas de champ de recherche global.** Le seul champ de saisie est le contrôle d'un
  descripteur `text`, qui porte son propre libellé indicatif.
- **Elle n'émet pas `geoleaf:filter:apply` ni `geoleaf:filter:reset`** — voir §Contrat exposé, où
  cette confusion est levée.

---

## Fonctionnalités

| ID    | Fonctionnalité                                          | Entrée                                         | Sortie observable                                                                                                                                | Code                                             |
| ----- | ------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| FI-01 | Montage différé aux données                             | `geoleaf:app:ready`                            | Le panneau monte quand les couches sont chargées — sans quoi les options déduites des données seraient vides                                     | `lifecycle.ts` → `init`                          |
| FI-02 | **Double** gate tardif                                  | Configuration fusionnée                        | Éteint **ou** non migré (`fields` vide) → rien ne monte. Les deux conditions sont dans la même ligne                                             | `lifecycle.ts` → `_onAppReady`                   |
| FI-03 | Panneau construit depuis la déclaration                 | `fields[]`                                     | Un contrôle par descripteur, selon son genre. Aucun rendu codé en dur, aucun `innerHTML`                                                         | `panel/render.ts`                                |
| FI-04 | Six genres de filtre                                    | `kind`                                         | `taxonomy`, `tag`, `range`, `text`, `boolean`, `proximity` — **six, pas sept** : il n'y a pas de genre `enum`                                    | `types.ts` → `FilterKind`, `engine/predicate.ts` |
| FI-05 | Taxonomie et tag partagent **un** moteur                | Sélection de valeurs                           | Le tag est une taxonomie **plate** : même prédicat d'appartenance, seules la présentation et la source des options diffèrent                     | `engine/predicate.ts`                            |
| FI-06 | Correspondance de taxonomie à **deux niveaux**          | Catégorie ou sous-catégorie                    | Sélectionner un parent (étendu à ses enfants) **ou** une feuille fonctionne — le prédicat teste le champ **et**, s'il est déclaré, le sous-champ | `engine/predicate.ts`, `taxonomy-options.ts`     |
| FI-07 | Options de tag déduites des données                     | `options: "auto"`                              | Les valeurs distinctes présentes dans les couches ciblées                                                                                        | `apply.ts`, `engine/options.ts`                  |
| FI-08 | Portée par couche **opt-in**                            | `layers` d'un descripteur                      | Absent → le champ filtre **toutes** les couches. Présent → **uniquement** celles-là ; une couche qu'aucun champ ne cible n'est jamais filtrée    | `engine/predicate.ts`                            |
| FI-09 | Recherche textuelle tolérante                           | `text`                                         | Tous les mots présents, **dans n'importe quel ordre**, insensible à la casse **et aux accents**                                                  | `engine/predicate.ts`                            |
| FI-10 | Filtre de proximité                                     | Point + rayon                                  | Distance orthodromique ≤ rayon. Le point vient du clic carte **ou** du GPS                                                                       | `panel/proximity/`, `engine/field-access.ts`     |
| FI-11 | Deux modes de proximité, un seul chemin de code         | Panneau ou barre d'outils                      | L'activation GPS et l'activation manuelle sont partagées entre les deux surfaces — elles étaient dupliquées                                      | `panel/proximity/proximity-gps-mode.ts`          |
| FI-12 | Lecture d'attribut par chemin pointé                    | `properties.name`, `attributes.tags`, `fclass` | Essai à la racine de l'entité **puis** dans le sac de propriétés — donc un nom nu sous `properties` se lit sans le préfixer                      | `engine/field-access.ts` → `getFieldValue`       |
| FI-13 | Application **anti-rebond**                             | Frappe au clavier, glissement de curseur       | Une seule application différée, pas une par événement de saisie                                                                                  | `lifecycle.ts` → `_wirePanel`                    |
| FI-14 | Sérialisation sans DOM de l'état actif                  | `getActiveFilter()`                            | Identifiant + genre par champ contraint ; les champs vides sont **omis**. C'est ce que le permalien met dans l'URL                               | `serialize.ts`                                   |
| FI-15 | Restauration sur les **vrais** contrôles                | `applyFilter(state)`                           | L'inverse exact de la lecture. Remplace l'injection de champs fantômes que le permalien pratiquait                                               | `panel/write.ts`                                 |
| FI-16 | La restauration itère les identifiants **de confiance** | État venu d'une URL                            | La boucle parcourt `config.fields`, jamais les identifiants sérialisés — **aucune valeur non fiable n'atteint un sélecteur CSS**                 | `panel/write.ts` → `writePanelControls`          |
| FI-17 | Conversion d'unité nommée par direction                 | Rayon                                          | L'interface et l'URL portent des **kilomètres**, le moteur des **mètres**. Les deux sens sont des fonctions nommées, jamais un `* 1000` en ligne | `units.ts`                                       |
| FI-18 | Signal d'application                                    | Appliquer, réinitialiser, restaurer            | `geoleaf:filters:applied` — l'onglet de bureau et le permalien s'en servent                                                                      | `apply.ts`, `public-api.ts`                      |
| FI-19 | Démontage complet                                       | `FilterModule.destroy()`                       | Échéance annulée, écouteurs détachés, panneau retiré, et la proximité démontée **seulement si elle avait été montée**                            | `lifecycle.ts` → `_reset`                        |
| FI-20 | Le panneau préexistant est écarté au montage            | Second montage, panneau hérité                 | L'élément portant l'identifiant est retiré avant le rendu — sinon deux nœuds porteraient le même identifiant                                     | `lifecycle.ts` → `_mountPanel`                   |

Les tests qui couvrent ces lignes : `packages/core/__tests__/capabilities/filter/` — dont un fichier
d'empreinte DOM du panneau, un dédié à la proximité, et un au moteur de prédicat.

---

## Configuration

Bloc `modules.filter` d'un profil. Conformité de cette table au code gardée par
`__tests__/guards/doc-capability-config.guard.test.js`.

| Paramètre | Type      | Défaut | Où c'est lu                                                                                                   |
| --------- | --------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| `enabled` | `boolean` | `true` | `config.ts` → `getFilterConfig()`, appliqué par le gate tardif de `lifecycle.ts`. Opt-out                     |
| `title`   | `string`  | —      | `panel/render.ts` — en-tête du panneau. Le schéma n'annonce **aucun** défaut, le lecteur n'en matérialise pas |
| `fields`  | `array`   | —      | `lifecycle.ts` (gate de migration), `panel/*`, `engine/*`. **C'est le cœur** — voir la table des sous-clés    |
| `actions` | `object`  | —      | `panel/render.ts` — libellés des deux boutons de pied                                                         |

⚠️ **`enabled` est le seul paramètre à porter un défaut.** Les trois autres n'en ont **aucun** au
schéma, et le lecteur ne les matérialise pas non plus : `DEFAULTS` ne contient que `enabled`. Un
profil sans `fields` n'obtient donc pas un panneau vide — il n'obtient **pas de panneau**, et la
capacité reste inerte sans le dire.

### Les sous-clés de `fields[]` — un descripteur par champ filtrable

⚠️ **Cette table n'est PAS gatée**, et c'est structurel : le garde ne lit que les clés de **premier
niveau** du `configSchema`. `fields.kind` y serait rejeté comme « paramètre documenté absent du
configSchema ». L'en-tête dit `Sous-clé` et non `Paramètre` pour cette raison exacte — c'est ce mot
qui décide quelle table est lue.

| Sous-clé      | Type     | Rôle                                                                                  |
| ------------- | -------- | ------------------------------------------------------------------------------------- |
| `id`          | `string` | Identifiant stable — porté par l'état, l'URL et l'attribut `data-gl-filter-id` du DOM |
| `kind`        | `string` | `taxonomy` · `tag` · `range` · `text` · `boolean` · `proximity`                       |
| `label`       | `string` | Libellé affiché                                                                       |
| `layers`      | `array`  | Couches filtrées par ce champ. **Absent ⟹ toutes ; présent ⟹ uniquement celles-là**   |
| `field`       | `string` | Attribut testé (`taxonomy`, `tag`, `range`, `boolean`)                                |
| `taxonomyRef` | `string` | Taxonomie nommée dont viennent les options (`taxonomy`)                               |

⚠️ **Le `configSchema` déclare six sous-clés ; le type `FilterFieldDescriptor` en porte bien
davantage** — `subField`, `options`, `searchFields`, `placeholder`, `min`/`max`/`step`, les quatre
`radius*`, `buttonLabel`, `instructionText`. Elles sont **lues par le code** et **absentes de
l'introspection** : `getCapabilitySchema("filter")` ne les publie pas. L'intégrateur n'est pas
démuni pour autant — l'inventaire les documente toutes, au §12 de
[`GEOLEAF-JS_GUIDE_CONFIGURATIONS_COMPLET.md`](../../reference/GEOLEAF-JS_GUIDE_CONFIGURATIONS_COMPLET.md).
Le trou est donc **côté introspection**, pas côté documentation : c'est un consommateur programmatique
— un studio de configuration, typiquement — qui ne verrait pas de quoi construire un curseur de plage
ni un rayon de proximité.

⚠️ **Les quatre `radius*` sont en km et acceptent des décimales**, et la barre de proximité est
la **seule** surface qui les consomme : `panel/render.ts` saute `kind: "proximity"` (« driven by
the toolbar button, not rendered in the panel »). Jusqu'au 20/08/2026 elle lisait son curseur au
`parseInt` — un `radiusStep` fractionnaire perdait tous ses crans sous le kilomètre, et le
libellé, écrit depuis **trois sources différentes** (le nombre de config, l'entier tronqué, la
chaîne brute de `defaultValue`), affichait la valeur demandée à côté d'un cercle qui ne la
respectait pas. Le libellé passe désormais par `format.proximity.radius`, clé déclarée dans les
six dictionnaires et assertée par `i18n.test.js` — mais qui **n'avait aucun consommateur** : les
trois gabarits `${…} km` la court-circuitaient. Gardé par
`packages/core/__tests__/ui/mobile-toolbar-proximity.test.ts`, dont le cas central verrouille l'invariant
« le libellé affiché et le rayon appliqué sont le même nombre ».

⚠️ **Et ce même §12 enseigne un prédicat « natif GPU » pour trois des six genres.** C'est **faux** :
la capacité ne construit **aucune** expression MapLibre, les six genres passent par le même prédicat
JavaScript, et le filtre GPU par identifiants du seam s'applique **identiquement aux six**. La
distinction que la table publie n'existe nulle part dans le code. C'est un constat versé du
registre, qui porte les deux constats.

### Le gate est opt-out, et il a deux étages

| Étage               | Ce qu'il commande          | Sur quelle configuration                         |
| ------------------- | -------------------------- | ------------------------------------------------ |
| Gate de la capacité | L'enregistrement du module | La configuration **d'avant** la fusion du profil |
| **Gate tardif**     | Le montage réel du panneau | La configuration **fusionnée**, `fields` compris |

⚠️ **`enableWhenAbsent: true` est ici un VRAI opt-out**, comme pour [`legend`](legend.md) et
[`permalink`](permalink.md) : les deux étages lisent la même clé avec le même défaut. Le motif est le
piège de calendrier du démarrage — le gate de boot tourne sur la configuration d'avant la fusion, où
un opt-in lirait `undefined`.

⚠️ **Mais le gate tardif porte une seconde condition que le premier ignore** : `fields` non vide.
Conséquence pratique, et elle mérite d'être connue : un profil qui active `modules.filter` sans
déclarer de champs **enregistre le module** et **ne monte rien**. Aucun avertissement n'est émis. Le
motif est écrit dans le cycle de vie — la migration est additive, un profil non migré ne devait pas
voir son panneau hérité perturbé.

---

## Contrat exposé

### API publique — `GeoLeaf.Filter`

Construite par `public-api.ts` → `buildPublicApi()`, montée par `install.ts` → `registerGlobals(gl)`,
et **instanciée à l'import** par la façade ESM `src/api/geoleaf.filter.ts`. Le fichier est de la
glu : chaque membre délègue à un module de la capacité, il n'y a aucune logique métier.

| Membre                                                 | Rend / fait                                                                       |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `isEnabled()` · `getConfig()`                          | Le gate et le bloc fusionné                                                       |
| `getActiveFilter()`                                    | L'état actif, **sérialisé et sans DOM** — le contrat que lit le permalien         |
| `applyFilter(state)`                                   | Écrit l'état sur les vrais contrôles, l'applique aux sources, puis émet le signal |
| `applyNow()`                                           | Relit le panneau et applique, sans passer par l'anti-rebond                       |
| `reset()`                                              | Remet les contrôles à zéro puis applique — donc « tout visible »                  |
| `hasActiveFilters()`                                   | Au moins un champ contraint                                                       |
| `proximity.setRadius(km)` · `proximity.toggle(map, …)` | Le sous-ensemble piloté par la barre d'outils                                     |

⚠️ **`GeoLeaf.Filters` — au pluriel — n'existe plus.** Elle portait une seule méthode, sans aucun
appelant dans le dépôt hors sa propre définition, et sa distance d'**une lettre** avec `Filter` était
un piège d'intégration : la typée n'était pas sur l'entrée ESM racine, l'autre si. Sa suppression a
emporté le moteur de filtre de route et son seam de contribution — elle en était l'unique appelant
atteignable.

### Cinq lecteurs, et aucun n'importe la capacité

`GeoLeaf.Filter` est lu **par le namespace** par : [`permalink`](permalink.md) (capture et
restauration), l'initialisation des fonctionnalités de l'application, la barre d'outils mobile, son
volet de proximité, et l'API d'interface du kernel. **Aucun** ne fait d'import statique vers
`capabilities/filter/`. Deux d'entre eux redéclarent même leur propre vue structurelle du contrat
plutôt que d'importer le type — un doublon assumé et motivé sur place.

Ces cinq lecteurs remplacent les globaux `_UIFilterPanel*`, **supprimés**.

### Événements

| Signal                    | Sens       | Rôle                                                           |
| ------------------------- | ---------- | -------------------------------------------------------------- |
| `geoleaf:app:ready`       | **écouté** | Déclenche le montage. `{ once: true }`, détaché par `_reset()` |
| `geoleaf:filters:applied` | **émis**   | Un filtre vient d'être appliqué. Charge utile **vide**         |

⚠️ **`geoleaf:filter:apply` et `geoleaf:filter:reset` ne sont PAS de cette capacité.** Ils sont
déclarés au contrat, documentés par la façade d'événements, et **émis par le kernel** — le cœur
GeoJSON, quand il pose ou retire un filtre de couche. Il y a **zéro occurrence** des deux dans
`capabilities/filter/`. La confusion est facile et coûteuse : le signal de la capacité est le
troisième, au **pluriel** et au participe passé.

`geoleaf:filters:applied` est **typé** dans `contracts/event-bus.contract.ts`, avec une charge utile
explicitement vide.

### Stockage écrit

Aucun. L'état du filtre ne survit pas au rechargement **par lui-même** — il survit par l'URL, que le
permalien maintient. C'est la seule persistance, et elle appartient à l'autre capacité.

---

## Décisions de conception

| Décision                                                       | Pourquoi                                                                                                                                                                                                                                                                                                                                                                                    | Alternative écartée                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Refonte générique, pas relocalisation**                      | Le filtre historique était centré sur les POI et sur les routes, avec un champ « catégories » **implicite**. Un filtre agnostique à la géométrie exigeait un modèle de données neuf — le descripteur de champ                                                                                                                                                                               | Déplacer le code existant                       |
| **Taxonomie et tag sur un seul moteur**                        | Les deux sont une appartenance à un ensemble de valeurs sur un champ déclaré. Seules la présentation et la source des options diffèrent — le tag **est** une taxonomie plate                                                                                                                                                                                                                | Deux moteurs                                    |
| **Le chemin natif MapLibre a été RETIRÉ, pas branché**         | Il était complet et testé. Mesuré avant de trancher : `text` est JavaScript-seul et présent dans **tous** les profils livrés, la majorité n'avait **aucun** champ nativement exprimable, et le seul profil gagnant est clusterisé — où un filtre natif laisse les compteurs d'agrégat périmés, garde que le chemin JavaScript a et que celui-là n'avait pas                                 | Le brancher en chemin prioritaire               |
| **Un seul écrivain du filtre de couche**                       | Deux chemins auraient posé deux `setFilter` sur la même couche. Le seam du kernel est l'écrivain unique                                                                                                                                                                                                                                                                                     | Écrire depuis la capacité                       |
| **Portée par couche opt-in**                                   | Un champ sans `layers` filtre tout ; avec, il ne filtre que celles-là. Le corollaire est voulu : une couche qu'aucun champ ne cible s'affiche **intégralement**                                                                                                                                                                                                                             | Filtrer toutes les couches inconditionnellement |
| **Aucun filtre appliqué au démarrage**                         | L'état par défaut du panneau est « tout visible » : appliquer au démarrage ferait le même travail pour le même résultat, sur le chemin le plus sensible                                                                                                                                                                                                                                     | Une passe initiale                              |
| **Inerte sans `fields`**                                       | La migration devait être **additive** : un profil non migré ne devait pas voir son panneau hérité remplacé par un panneau vide                                                                                                                                                                                                                                                              | Monter un panneau sans contrôles                |
| **Les conversions d'unité sont des fonctions nommées**         | Le rayon traverse trois représentations. Le facteur vivait en ligne sur sept sites, la direction lisible seulement au contexte — et une fonction rendant des kilomètres a déjà été préférée à celle rendant des mètres, décalant le rayon d'un facteur mille selon l'ordre de chargement                                                                                                    | Un `* 1000` au site d'appel                     |
| **La restauration écrit sur les VRAIS contrôles**              | Le permalien injectait des champs cachés. La donnée était filtrée, la boîte de recherche vide, et la première interaction remettait tout à zéro                                                                                                                                                                                                                                             | L'injection de champs fantômes                  |
| **La restauration itère les identifiants de la CONFIGURATION** | Les identifiants sérialisés viennent d'une URL. Les passer à un sélecteur CSS serait une injection ; ceux de la configuration sont de confiance                                                                                                                                                                                                                                             | Itérer l'état reçu                              |
| **La proximité se démonte depuis son montage**                 | L'initialisation attache des écouteurs au **document**, plus un cercle et un marqueur. Enregistrer le démontage **là où le montage a eu lieu** garantit qu'il ne se déclenche jamais pour une proximité jamais montée                                                                                                                                                                       | Appeler `destroy()` depuis `_reset`             |
| **Le panneau préexistant est retiré avant le rendu**           | Sinon deux nœuds portent le même identifiant, et tous les sélecteurs du dépôt visent le premier                                                                                                                                                                                                                                                                                             | Réutiliser le conteneur                         |
| **La taxonomie est lue par le namespace, pas importée**        | La capacité fonctionne que `taxonomy` soit activée ou non : options vides plutôt qu'échec. Seuls les **types** sont importés                                                                                                                                                                                                                                                                | Un import statique de la capacité               |
| **Pas de `loader`**                                            | Le panneau est de l'interface du démarrage ; un chargement paresseux arriverait après le besoin. Le gate suffit                                                                                                                                                                                                                                                                             | Un `import()` paresseux                         |
| **Le curseur de proximité se pose sur le CANVAS**              | MapLibre v6 n'écrit jamais `style.cursor` en JavaScript : il gouverne le curseur par des classes CSS sur `.maplibregl-canvas-container`, dont le `cursor: grab` bat tout héritage venu de `.maplibregl-map`. Écrire sur `getContainer()` atteint le DOM et n'est **jamais peint** — c'est ce que cette capacité a fait jusqu'au 14/08/2026, avec un test qui verrouillait la mauvaise cible | Écrire sur le conteneur racine                  |
| **La proximité pose `__geoleafExclusiveMode`**                 | C'est le drapeau par lequel un outil armé dit aux gestionnaires de survol du core de ne pas toucher au curseur ni d'ouvrir de popup. Sans lui, quitter un POI réécrivait le curseur et effaçait la croix. La protection est **par la cause** — les écrivains se taisent — et non par un observateur qui répare après coup                                                                   | Un `MutationObserver` de rattrapage             |

---

## Dépendances et frontières

### Le module

`FilterModule` déclare `id = "filter"`, `dependencies = ["geojson"]`, et **aucun créneau
d'interface** — le bouton de bascule du panneau est une pièce structurelle de la barre d'outils, que
le cycle de vie câble s'il la trouve, pas un créneau déclaré au module.

Sa position dans `presets/manifest.full.ts` est **porteuse** et documentée sur place : `route` est
enregistrée **avant** `filter`, et comme les deux déclarent la même dépendance, c'est l'ordre
d'enregistrement qui départage le tri topologique. Le numéro d'ordre ne se recopie pas ici.

⚠️ **La question de rang des dépendances se pose ici aussi** :
`dependencies = ["geojson"]` exprime un besoin réel — le panneau lit les données au montage pour
déduire les options `"auto"` — **et** un besoin d'ordre. Contrairement à [`legend`](legend.md), le
besoin de données est authentique ; c'est le cas le plus favorable des quatorze.

### Frontière `capabilities/` → `kernel/` (règle ESLint R.8)

| Import                                              | Statut vis-à-vis de R.8 |
| --------------------------------------------------- | ----------------------- |
| `kernel/config/config-primitives.js`                | **Exception** nommée    |
| `kernel/geojson/index.js` (`GeoJSONCore`)           | **Baril**               |
| `kernel/ui/index.js` (champ de recherche en pilule) | **Baril**               |
| `kernel/events/index.js`                            | **Baril**               |

### ⚠️ Une frontière inter-capacités franchie en import profond

`panel/proximity/proximity-gps-mode.ts` importe `GeoLocationState` depuis
`capabilities/geolocation/state.js` — **un import profond d'une autre capacité**, pas un seam, pas un
namespace. Il est reconnu des deux côtés : le module d'état de [`geolocation`](geolocation.md) le
mentionne. C'est le seul de la capacité, et il vaut d'être nommé ici parce que les trois autres
frontières de `filter` sont, elles, toutes des seams runtime.

### Frontière avec `taxonomy`

**Types importés, valeurs lues au namespace.** Le type de catégorie vient d'un import statique de
`capabilities/taxonomy/types.js` ; l'arbre vient de `GeoLeaf.Taxonomy.getCategories(ref)`, avec
repli sur un objet vide quand la taxonomie est éteinte ou la référence inconnue — le filtre dégrade
alors vers « aucune option », il n'échoue pas.

⚠️ **La référence de taxonomie est ici CONFIGURABLE**, portée par chaque descripteur (`taxonomyRef`).
C'est le contraire de [`legend`](legend.md), qui la code en dur, et de
[`feature-info`](feature-info.md), qui canardise le seam. Les trois capacités qui lisent la taxonomie
le font de trois façons différentes ; seule celle-ci fait ce que le modèle prévoit.

### Frontière avec le moteur cartographique

Aucun import de MapLibre. La proximité manipule la carte au travers de l'interface d'adaptateur, et
la distance passe par l'utilitaire orthodromique partagé du dépôt.

### Frontière côté CSS

`install.ts` importe **trois** feuilles — le panneau, les contrôles, et le champ de recherche en
pilule. Elles entrent dans le graphe depuis l'installeur : sauter l'installeur, c'est aussi ne pas
les embarquer.

---

## Écarts au CDC source

Le CDC `CDC_capacite-filter.md` (v1.2.0, 21/07/2026) a été **consommé** en écrivant cette fiche, puis
**supprimé** du dossier de tri — ligne au §Journal des décisions de
la refonte documentaire V3.

| Énoncé du CDC                                                                                      | Ce que dit le code                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §Résumé, §4 — filtrage **hybride**, « en priorité en natif MapLibre »                              | **Il n'y a qu'un chemin, le prédicat JavaScript.** Le natif a été retiré, et le motif est **mesuré** dans `taxonomy-options.ts`. Le bandeau de statut du CDC le dit — son §4 entier décrit pourtant l'architecture hybride. Il se contredit |
| §Statut — options de taxonomie via le seam **transitoire** `taxonomy-source.ts`                    | **Le fichier n'existe plus** et l'échéance annoncée a été tenue : la lecture passe par `GeoLeaf.Taxonomy.getCategories(ref)`                                                                                                                |
| §Ce que la refonte change — « ajoute les kinds `range`/`boolean`/**`enum`** »                      | **Il n'y a pas de genre `enum`.** Ils sont **six**, et la table du §3.2 du même document les liste correctement. Contradiction interne                                                                                                      |
| §Statut, §9 — `_UIFilterPanel*` « conservés en shims lazy (`compat.ts`) »                          | **Supprimés**, et `compat.ts` n'existe pas. Les lecteurs passent par `GeoLeaf.Filter` et par l'API d'interface du kernel                                                                                                                    |
| §7, §9 — `GeoLeaf.Filters` (pluriel) « conservée »                                                 | **Supprimée**, avec le moteur de filtre de route et son seam de contribution — elle en était l'unique appelant atteignable                                                                                                                  |
| §7 — sous-dossier `filters/` conservé pour l'alias Lite                                            | **Le build Lite n'existe plus**, et `capabilities/filter/filters/` **n'existe pas** : les répertoires réels sont `engine/` et `panel/`. ⚠️ Un en-tête du code porte encore ce chemin mort — mesuré : **une** occurrence                     |
| §7 — façade `modules/geoleaf.filter.ts`, montée dans `globals.ui(.lite).ts`                        | La façade est `api/geoleaf.filter.ts` et le montage se fait dans l'installeur de la capacité                                                                                                                                                |
| §8 — la façade a **5** méthodes                                                                    | **8 membres.** Manquent à la liste `applyNow`, `hasActiveFilters` et le sous-ensemble `proximity` — les trois consommés par la barre d'outils mobile                                                                                        |
| §Résumé — « un contrat d'events stable (`geoleaf:filter:apply/reset`, `geoleaf:filters:applied`) » | Les deux premiers sont émis par le **kernel**, pas par la capacité — la table du §8 du même document l'écrit correctement. Le résumé se contredit                                                                                           |
| §3.2 — les attributs spécifiques par genre                                                         | ✅ **Vrais** dans le type… et **absents du `configSchema`**, donc non publiés à l'introspection. C'est le même constat                                                                                                                      |
| §Statut — le cycle de vie n'applique **aucun** filtre initial                                      | ✅ **Vérifié exact**                                                                                                                                                                                                                        |
| §3.1, B.22 — `searchPlaceholder` retiré, aucun champ de recherche global                           | ✅ **Vérifié exact** — le seul champ de saisie est celui d'un descripteur `text`                                                                                                                                                            |
| §Portée par couche opt-in                                                                          | ✅ **Vérifié exact**, corollaire compris                                                                                                                                                                                                    |

Ce qui a été **retenu** du CDC et ne se lit pas dans le code : le motif du choix in-core, la règle de
migration des filtres de catégorie — **un filtre `taxonomy` n'est migré que si les entités portent
les identifiants de catégorie**, ce qui explique pourquoi plusieurs profils livrés n'en ont pas —, le
fait que le filtre de catégorie hérité était **implicitement POI** et sans champ déclaré, et les
alternatives écartées de la table §Décisions.
