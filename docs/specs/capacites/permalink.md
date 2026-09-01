---
type: spec-capacite
title: permalink — l'état de la carte dans l'URL, et le partage de la vue
capability_id: permalink
package: "@geoleaf/core"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 2fcbba8a
date: 1er septembre 2026
---

# permalink — l'état de la carte dans l'URL, et le partage de la vue

**Type :** capacité in-core · **Code :** `packages/core/src/capabilities/permalink/` ·
**Vérifié contre :** `2fcbba8a` (01/09/2026)

> 🧭 **Contrat ici, mode d'emploi ailleurs.** Cette fiche dit ce que le sujet **doit**
> faire : périmètre, table de configuration gatée, contrat exposé, frontières. Les recettes
> et les exemples pas à pas sont dans [`packages/core/docs/ui/PERMALINK.md`](../../../packages/core/docs/ui/PERMALINK.md). **Les deux ne se recopient pas** — une
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

> ⚠️ **Cette fiche en décrit DEUX : `permalink` et sa sous-feature `share`.** Ce n'est pas un
> raccourci d'écriture — c'est la forme réelle. `share` a son propre répertoire, son propre module
> de cycle de vie, sa propre façade et **son propre gate**, mais **pas** de déclaration de
> capacité : elle est déclarée sous `PERMALINK_CAPABILITY.configSchema.share`. Une fiche séparée
> décrirait un objet que l'introspection ne connaît pas.

> ⚠️ **Deux gates, deux surfaces — et ils ne commandent pas la même chose.** Un profil qui éteint
> `permalink` **garde** son bouton de partage, et c'est délibéré : c'est le comportement du boot
> historique, préservé par un `moduleGate` distinct.

---

## Périmètre

### Ce que la capacité fait

Elle synchronise **dans les deux sens** l'état de l'application et l'URL : elle lit l'URL **avant
la création de la carte**, restaure la vue, les couches, le thème et les filtres, puis réécrit
l'URL à chaque changement. `share` en tire une fenêtre de partage : le lien courant, et un QR code
à la demande.

### Ce qu'elle ne fait pas

- **Elle n'a aucun `ICoreModule`.** Elle est pilotée par **deux crochets de boot** — voir
  §Dépendances. Le module que l'installeur construit est celui de **`share`**, pas le sien.
- **Elle ne lit plus le DOM des filtres.** L'état de filtre lui est donné par le contrat public
  `GeoLeaf.Filter`, ce qui a supprimé un raclage du DOM et une injection de champs fantômes.
- **Elle ne sérialise pas la vue à la carte** : `lat` / `lng` / `zoom` sont **obligatoires** et ne
  figurent pas dans la liste blanche — voir §Configuration.
- **`share` ne capture aucun état.** Le lien partagé **est** `window.location.href`, que la synchro
  de permalink maintient à jour ; il n'y a pas de seconde capture.

---

## Fonctionnalités

| ID    | Fonctionnalité                                       | Entrée                                              | Sortie observable                                                                                                                                    | Code                                               |
| ----- | ---------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| PL-01 | Lecture de l'URL **avant** la carte                  | Crochet 1, au démarrage                             | L'état est analysé et mis en réserve avant que la carte n'existe — sans quoi la vue serait posée puis corrigée                                       | `app/boot-modules/core-map-lifecycle.ts`           |
| PL-02 | Restauration après le dévoilement                    | Crochet 2                                           | Vue appliquée, puis couches / filtres / thème, puis la synchronisation démarre                                                                       | `app/init-reveal.ts`, `public-api.ts`              |
| PL-03 | Le cadrage du profil est **sauté** si un lien existe | État permalink présent                              | `fitBounds` n'est pas appliqué — sinon le lien partagé serait immédiatement écrasé par le cadrage par défaut                                         | `app/init-reveal.ts`                               |
| PL-04 | Trois encodages d'URL                                | `mode`                                              | `hash` (défaut), `query`, `compact`                                                                                                                  | `permalink-url.ts` → `readUrl`, `buildUrl`         |
| PL-05 | Bascule **automatique** en compact                   | Chaîne de paramètres > 200 caractères               | Encodage base64, **même en mode `hash`** — donc le compact n'est pas réservé à `mode: "compact"`                                                     | `permalink-url.ts` → `buildUrl`                    |
| PL-06 | Liste blanche appliquée aux **deux** encodages       | `fields` restreint                                  | Les facettes exclues ne sont ni lues ni écrites, y compris sur le chemin compact                                                                     | `permalink-url.ts` → `_pruneToFields`              |
| PL-07 | Charge utile compacte en **UTF-8**                   | Filtre en cyrillique, en CJK, ou une simple ellipse | Encodage correct. `btoa` seul **jetait** au-delà du point de code 255, et la synchro avalait l'erreur : l'URL cessait de suivre la carte, en silence | `permalink-url.ts` → `_encodeCompact`              |
| PL-08 | Les anciens liens continuent de s'ouvrir             | Lien émis avant le passage en UTF-8                 | Décodage UTF-8 en mode **strict** ; l'échec fait basculer sur la lecture historique. Discrimination **décisive**, pas heuristique                    | `permalink-url.ts` → `_decodeCompact`              |
| PL-09 | Vue obligatoire, et validée                          | `gl_lat` / `gl_lng` / `gl_zoom`                     | Absents, vides ou hors bornes → **aucun** état restauré. Un `gl_lat=` vide recentrait la carte sur 0,0                                               | `permalink-url.ts` → `_parseRequiredNumber`        |
| PL-10 | Bornage de toutes les valeurs numériques             | URL forgée                                          | Coordonnées validées, zoom borné, note bornée — y compris depuis une charge utile compacte, où `1e400` donne `Infinity`                              | `permalink-url.ts` → `_validateRaw`                |
| PL-11 | Plafonds de longueur et de nombre                    | Liste de couches, texte de filtre                   | Nombre d'éléments **et** longueur de chaque élément plafonnés                                                                                        | `permalink-url.ts` → `_sanitizeIdList`             |
| PL-12 | Restauration des couches masquées et montrées        | `gl_layers`, `gl_shown`                             | Les masquées sont cachées ; les montrées **hors thème** sont **chargées à la demande** puis affichées                                                | `permalink-restore.ts`                             |
| PL-13 | Restauration du thème avant le reste                 | `gl_theme`                                          | Le thème est appliqué, **puis** couches et filtres — sur l'événement d'application, parce que le thème charge ses couches                            | `permalink-sync.ts` → `applyState`                 |
| PL-14 | Restauration du filtre par le contrat public         | `gl_filter`, `gl_cats`, `gl_tags`, `gl_rating`      | `GeoLeaf.Filter.applyFilter(...)` — les vrais contrôles du panneau sont écrits, pas des champs fantômes                                              | `permalink-sync.ts` → `_restoreFilterState`        |
| PL-15 | Le filtre attend que son panneau existe              | Lien profond avec filtre                            | L'application est différée au montage du panneau — sinon l'écriture était perdue et le panneau montait vide                                          | `permalink-sync.ts`                                |
| PL-16 | Réécriture continue de l'URL                         | Déplacement de carte, visibilité, filtre, thème     | `history.replaceState` — **aucune entrée d'historique créée**, écriture anti-rebond                                                                  | `permalink-sync.ts` → `startSync`                  |
| PL-17 | Arrêt propre de la synchronisation                   | `stopSync()` / ré-initialisation                    | Les écouteurs de carte **et** de document sont détachés ; un second `startSync` démonte d'abord le précédent                                         | `public-api.ts`, `permalink-sync.ts`               |
| PL-18 | Fenêtre de partage                                   | Bouton de partage, bureau ou mobile                 | Lien courant affiché et copiable                                                                                                                     | `share/share-modal.ts`                             |
| PL-19 | QR code **chargé à la demande**                      | Clic sur « afficher le QR »                         | La bibliothèque est importée à ce moment-là, jamais au boot ni à l'ouverture de la fenêtre. Import mémorisé                                          | `share/share-qr.ts`                                |
| PL-20 | Bouton de partage sur les deux surfaces              | Bandeau d'onglets de bureau, barre d'outils mobile  | Le bureau passe par un seam kernel ; le mobile par un créneau déclaré au module                                                                      | `share/share-button-desktop.ts`, `share/module.ts` |
| PL-21 | Rattrapage si le bandeau existe déjà                 | Capacité montée après la construction du bandeau    | Injection immédiate en plus de l'abonnement au seam — les deux sont idempotents                                                                      | `share/lifecycle.ts` → `init`                      |
| PL-22 | Démontage complet de `share`                         | `ShareModule.destroy()`                             | Écouteurs détachés, **fenêtre fermée** et **boutons retirés** — les deux survivaient sinon à un démontage sans remontage                             | `share/lifecycle.ts` → `_reset`                    |
| PL-23 | Déclaration introspectable                           | `getCapabilitySchema("permalink")`                  | Les quatre clés, dont le sous-arbre `share`                                                                                                          | `permalink-capability.ts`                          |

Les tests qui couvrent ces lignes ne sont pas tous sous
`packages/core/__tests__/capabilities/permalink/` — on y trouve bien un fichier dédié à l'encodage
UTF-8 compact, un au durcissement de la liste blanche et un aux couches montrées hors thème, mais
l'analyse d'URL, la synchronisation, l'injection et l'installeur sont éprouvés ailleurs :
`packages/core/__tests__/ui/permalink.test.js`,
`packages/core/__tests__/ui/permalink-sync.test.js`,
`packages/core/__tests__/security/permalink-injection.test.js` et
`packages/core/__tests__/capabilities/permalink-share-installer.test.js`. Le périmètre se mesure, il
ne se recopie pas : `git ls-files 'packages/core/__tests__/*' | grep -i permalink`.

---

## Configuration

Bloc `modules.permalink` d'un profil. Conformité de cette table au code gardée par
`__tests__/guards/doc-capability-config.guard.test.js`.

| Paramètre | Type      | Défaut                                                                   | Où c'est lu                                                                                |
| --------- | --------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `enabled` | `boolean` | `true`                                                                   | `config.ts` → `getPermalinkConfig()` ; les **deux crochets de boot** l'appliquent. Opt-out |
| `mode`    | `string`  | `"hash"`                                                                 | `permalink-url.ts` → `readUrl`, `buildUrl`. Valeurs : `hash`, `query`, `compact`           |
| `fields`  | `array`   | `["layers","shownLayers","filter","categories","tags","rating","theme"]` | `permalink-url.ts`, `permalink-sync.ts`. **Liste blanche des facettes optionnelles**       |
| `share`   | `object`  | —                                                                        | Porte `enabled` (défaut `true`). Lu par `share/config.ts`, **jamais** par permalink        |

⚠️ **`fields` est en divergence CONNUE et quarantainée.** Le schéma annonce le jeu complet ; le
lecteur `getPermalinkConfig()` ne matérialise que `enabled` et `mode`. C'est l'entrée
`permalink.fields` de `KNOWN_DEFAULT_DRIFT` (`packages/core/__tests__/capabilities/config-schema-defaults.test.js`), que le test-garde
de cette fiche **lit à sa source** au lieu de la recopier — le jour où la divergence est soldée, la
vérification reprend ici sans qu'on y touche.

Le repli est cependant réel : les **trois** sites de lecture (capture d'état, analyse d'URL,
construction d'URL) retombent tous sur la même constante partagée. C'est ce qui les rend identiques
**par construction** — auparavant chacun portait sa propre copie du tableau, et en modifier une
seule faisait perdre ou ajouter une facette sur une moitié de l'aller-retour.

### La vue n'est PAS listable, et c'est une correction

`lat` / `lng` / `zoom` figuraient dans la liste des facettes jusqu'à une version récente, et
c'était **inerte** : les retirer de `fields` ne changeait rien, puisque la construction d'URL les
écrit inconditionnellement et que l'analyse les exige. Ils ont été **sortis du type public** plutôt
que laissés comme une promesse que le runtime ne tient pas.

### Le double gate — et pourquoi les deux ne se recouvrent pas

| Étage                         | Clé                               | Ce qu'il commande                  | Défaut |
| ----------------------------- | --------------------------------- | ---------------------------------- | ------ |
| Gate de la capacité           | `modules.permalink.enabled`       | La synchronisation URL ↔ état      | `true` |
| **Gate du module de `share`** | `modules.permalink.share.enabled` | Le bouton et la fenêtre de partage | `true` |

⚠️ **Éteindre `permalink` n'éteint PAS `share`**, et l'installeur l'exprime comme un **champ de
contrat** (`moduleGate`) plutôt que par une condition dans du code. Le motif est la préservation du
comportement du boot historique. La conséquence pratique mérite d'être connue : dans cet état, la
fenêtre de partage propose l'URL courante, que rien ne synchronise plus — donc **le lien partagé ne
reproduit plus la vue**. C'est cohérent avec le passé, ce n'est pas forcément ce qu'un intégrateur
attend.

⚠️ **`enableWhenAbsent: true` est ici un VRAI opt-out**, contrairement à
[`theme-toggle`](theme-toggle.md) et [`theme-selector`](theme-selector.md) : les deux étages lisent
la même clé avec le même défaut. Le motif reste le même piège de calendrier — le gate de boot tourne
sur la configuration **d'avant la fusion du profil**, où un opt-in lirait `undefined`.

---

## Contrat exposé

### API publique — `GeoLeaf.Permalink`

Construite par `public-api.ts`, montée par `install.ts` → `registerGlobals(gl)`, re-exportée par la
façade ESM `src/api/geoleaf.permalink.ts`.

| Membre                        | Rend / fait                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------ |
| `init(config)`                | Reçoit le bloc du profil — appelé par le crochet 1, avant la carte             |
| `readAndStore()`              | Analyse l'URL courante et met le résultat en réserve                           |
| `applyStoredState(map)`       | Restaure la réserve sur la carte — appelé après le dévoilement                 |
| `startSync(map)`              | Démarre la réécriture continue. **Idempotent** : démonte la session précédente |
| `stopSync()`                  | Détache **tout** ce que `startSync` a attaché                                  |
| `getState()`                  | La réserve courante, en lecture                                                |
| `buildUrl(state?)`            | Sérialise un état, ou la réserve                                               |
| `isEnabled()` · `getConfig()` | Le gate et le bloc fusionné                                                    |

### API publique — `GeoLeaf.Share`

| Membre                                     | Rend / fait                                     |
| ------------------------------------------ | ----------------------------------------------- |
| `openShareDialog()` · `closeShareDialog()` | Ouvre / ferme la fenêtre                        |
| `isOpen()`                                 | État de la fenêtre                              |
| `getShareUrl()`                            | `window.location.href` — pas de seconde capture |
| `isEnabled()` · `getConfig()`              | Le gate de `share` et son bloc                  |

### Événements

| Signal                               | Sens                             | Rôle                                                                                                                                                                                                                                                                                            |
| ------------------------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `geoleaf:app:ready`                  | **écouté**                       | Déclenche la restauration différée                                                                                                                                                                                                                                                              |
| `geoleaf:themes:ready`               | **écouté**                       | Rendez-vous de la restauration de thème — **voir l'avertissement**                                                                                                                                                                                                                              |
| `geoleaf:theme:applied`              | **écouté**                       | Séquence la restauration des couches et du filtre ; réécrit l'URL                                                                                                                                                                                                                               |
| `geoleaf:geojson:visibility-changed` | **écouté**                       | Réécrit l'URL                                                                                                                                                                                                                                                                                   |
| `geoleaf:filters:applied`            | **écouté**                       | Réécrit l'URL                                                                                                                                                                                                                                                                                   |
| `moveend` (carte)                    | **écouté**                       | Réécrit l'URL, avec anti-rebond                                                                                                                                                                                                                                                                 |
| `geoleaf:toolbar:action`             | **émis** _et_ **écouté** (share) | Émis BRUT par le bouton de bureau (`share/share-button-desktop.ts`) — seul des déclencheurs de barre d'outils à ne pas passer par la fabrique canonique, divergence motivée sur place ; écouté par `share/lifecycle.ts`, qui ouvre la fenêtre quand l'action est la sienne, d'où qu'elle vienne |
| `geoleaf:desktop-panel:tabs-ready`   | **écouté** (share)               | Point d'injection du bouton de bureau                                                                                                                                                                                                                                                           |

⚠️ **Le rendez-vous sur `geoleaf:themes:ready` a un REPLI depuis le 18/08/2026.**
Cet événement n'a qu'un seul émetteur — [`theme-selector`](theme-selector.md) —, lui-même gaté
**opt-in** : quand la barre de thèmes ne monte pas, l'événement ne part jamais. Jusqu'au repli,
la branche de restauration **restait en attente** : ni le thème, ni les couches, ni le filtre du
lien n'étaient restaurés, **sans trace**. Désormais un délai de grâce court après
`geoleaf:app:ready` (qui part toujours — le reveal a son propre filet) : s'il expire sans
`themes:ready`, les couches et le filtre différés s'appliquent quand même, et **seul le
changement de thème est abandonné** — rien de monté ne peut changer de thème — avec un
avertissement journalisé. Un verrou interdit la double application quand l'événement finit par
partir. Constantes et motif : `permalink-sync.ts`, `THEMES_READY_GRACE_MS`.

### Stockage écrit

Aucun stockage navigateur. La capacité écrit **l'URL**, exclusivement par `history.replaceState` —
donc sans jamais créer d'entrée d'historique, ce qui laisse le bouton « retour » se comporter
normalement.

---

## Décisions de conception

| Décision                                                         | Pourquoi                                                                                                                                                                                                                       | Alternative écartée                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| **Deux crochets de boot plutôt qu'un module**                    | La lecture de l'URL doit précéder la **création** de la carte : aucun module du registre ne s'exécute assez tôt. Un module aurait posé la vue par défaut puis l'aurait corrigée — un saut visible                              | Un `ICoreModule` comme les autres capacités      |
| **`share` est une sous-feature, pas une capacité**               | Elle n'a pas de configuration propre au-delà d'un gate, et son sujet **est** le permalink. En faire une capacité dupliquerait une déclaration pour une seule clé                                                               | Une capacité `share` de plein droit              |
| **Le gate de `share` est un CHAMP de contrat**                   | La différence de gate est déclarée par `moduleGate` au lieu d'être une condition dans du code : elle est lisible dans le manifeste, pas enfouie dans une branche                                                               | Une condition à l'intérieur de l'installeur      |
| **Éteindre permalink laisse `share` debout**                     | C'est le comportement du boot historique, et le changer casserait des profils sans avertissement                                                                                                                               | Faire cascader le gate parent                    |
| **La liste blanche s'applique aussi au compact**                 | Le chemin compact l'ignorait **dans les deux sens** : une URL forgée pilotait des facettes exclues, et la construction les publiait. Et le compact est **automatique** au-delà d'un seuil — donc ce n'était pas un cas de bord | Ne filtrer que le chemin verbeux                 |
| **La vue est obligatoire, pas listable**                         | La proposer était une promesse non tenue : la construction l'écrit toujours, l'analyse l'exige toujours. Retirer l'illusion vaut mieux que documenter une exception                                                            | La laisser dans l'énumération                    |
| **Une seule constante pour le jeu de facettes**                  | Le tableau vivait en **trois** copies qui devaient s'accorder — capture, analyse, construction. En modifier une faisait diverger une moitié de l'aller-retour, sans erreur                                                     | Un défaut local à chaque site                    |
| **Charge utile compacte en UTF-8, avec lecture des anciens**     | Le remplacement pur aurait cassé **tous** les liens déjà partagés. La double lecture est décisive et non heuristique : l'UTF-8 est décodé en mode strict, son échec bascule sur l'ancien                                       | Substituer l'encodage                            |
| **L'état de filtre vient du contrat `GeoLeaf.Filter`**           | Auparavant permalink **raclait le DOM** du panneau et y injectait des champs fantômes pour restaurer. Le contrat rend l'état sérialisable et l'écriture propre                                                                 | Le raclage du DOM et les cales `_UIFilterPanel*` |
| **La restauration du filtre attend son panneau**                 | Depuis que l'application écrit sur les **vrais** contrôles, un panneau absent avalait l'écriture : la donnée était filtrée et la boîte de recherche vide, puis la première interaction remettait tout à zéro                   | Appliquer immédiatement                          |
| **`history.replaceState`, jamais `pushState`**                   | Un déplacement de carte n'est pas une navigation. Empiler une entrée par `moveend` rendrait le bouton « retour » inutilisable                                                                                                  | `pushState`                                      |
| **`startSync` démonte avant de remonter**                        | Une ré-initialisation laissait sinon les écouteurs de l'ancienne carte attachés — une fuite proportionnelle au nombre de cycles                                                                                                | Attacher sans vérifier                           |
| **QR code chargé à la demande**                                  | Le chemin normal — ouvrir, copier le lien — ne télécharge **aucun octet** de la bibliothèque. Elle n'arrive qu'au clic explicite, et l'import est mémorisé                                                                     | L'inclure dans le paquet                         |
| **Le lien partagé EST `window.location.href`**                   | La synchro le maintient déjà à jour ; le recalculer introduirait une seconde source de vérité qui pourrait en diverger                                                                                                         | Une capture d'état dédiée au partage             |
| **`_reset()` de `share` ferme la fenêtre et retire les boutons** | Les deux survivaient à un démontage : un bouton cliquable câblé sur une capacité détruite, et une fenêtre plein écran avec son écouteur de clavier                                                                             | Ne détacher que les écouteurs                    |
| Pas de `loader`                                                  | La lecture d'URL est le tout premier geste du boot : un chargement paresseux arriverait après le besoin                                                                                                                        | Un `import()` paresseux                          |

---

## Dépendances et frontières

### Aucun module — deux crochets, et leur ordre est le contrat

| Crochet | Où                                       | Ce qu'il fait                                                                    |
| ------- | ---------------------------------------- | -------------------------------------------------------------------------------- |
| **1**   | `app/boot-modules/core-map-lifecycle.ts` | `Permalink.init(bloc)` puis `readAndStore()` — **avant la création de la carte** |
| **2**   | `app/init-reveal.ts`                     | `applyStoredState(map)` puis `startSync(map)` — après le dévoilement             |

Les deux lisent `GeoLeaf.Permalink` **sur le namespace** et appliquent le gate sur la configuration
fusionnée : ils sont donc indifférents à l'endroit où la façade est assignée. C'est ce qui permet à
la capacité de n'avoir aucun module.

⚠️ **`share`, lui, A un module** — `ShareModule`, `dependencies = []`. Il est donc dépilé très tôt,
bien avant que le panneau de bureau ne construise son bandeau d'onglets ; le rattrapage de
`init()` couvre le cas inverse.

Position dans `presets/manifest.full.ts` : **permalink en dernier de son lot**, parce qu'il porte le
module de `share`.

🛑 **Le motif de cette position a changé le 07/08/2026, et la phrase disait l'ancien.** Elle
justifiait le rang par la barre d'outils mobile, qui « rend ses pastilles dans l'ordre
d'enregistrement » — **elle ne le fait plus** (socle-init 7.5) : `ui.mobileIcon` porte désormais un
`order` explicite, `share` déclare **20**, et `_appendRegistryIcons` trie dessus. Garder `share` en
dernier ne « garde » donc plus rien de l'ordre rendu. Reste vrai en revanche : **seules `legend` et
`share` déclarent une icône mobile côté core** (mesuré — deux `mobileIcon:` sous
`src/capabilities/`), et le rang du manifeste reste porteur pour les **autres** raisons
(départage du tri topologique, séquence des `sharedLifecycle`). Garde : `packages/core/__tests__/ui/mobile-toolbar-pill-order.test.ts`,
qui enregistre `share` **avant** `legend` et exige quand même legend→share.

⚠️ **La question de rang des dépendances ne se pose pas ici** :
`permalink` n'a pas de module, et celui de `share` ne déclare **aucune** dépendance.

### Frontière `capabilities/` → `kernel/` (règle ESLint R.8)

| Import                                                           | Statut vis-à-vis de R.8                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| `kernel/config/config-primitives.js`                             | **Exception** nommée par la règle                                   |
| `kernel/config/geoleaf-config/config-types.js` (type seul)       | **Hub de types** — route ouverte par la règle (`*-types.js`)        |
| `kernel/security/index.js` (validation, `DOMSecurity`)           | **Baril**                                                           |
| `kernel/geojson/index.js` (`GeoJSONShared`, `VisibilityManager`) | **Baril**                                                           |
| `kernel/themes/index.js` (`ThemeApplierCore`)                    | **Baril** — pour le chargement à la demande d'une couche hors thème |
| `kernel/ui/desktop/desktop-tabs-seam.js` (type seul)             | **Seam** — exception nommée par la règle                            |

⚠️ **La frontière avec `filter` est délibérément une frontière de CONTRAT, pas d'import.**
L'identifiant DOM du panneau de filtre est **redéclaré** dans `constants.ts` plutôt qu'importé de
`capabilities/filter/` : permalink parle à `filter` par `GeoLeaf.Filter` uniquement, et ne doit pas
en prendre de dépendance de module. C'est un doublon **assumé et motivé sur place** — un identifiant
DOM public, stable, que trois surfaces interrogent déjà de la même façon.

### Frontière côté CSS

`install.ts` importe `./css/share.css` — la feuille du partage, pas de permalink : la
synchronisation d'URL ne peint rien.

---

## Écarts au CDC source

Le CDC `CDC_capacite-permalink.md` a été **consommé** en écrivant cette fiche, puis **supprimé** du
dossier de tri — ligne au §Journal des décisions de
la refonte documentaire V3.

| Énoncé du CDC                                                     | Ce que dit le code                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1 — « **12 champs** », dont `subCategories`                      | **10** : 3 de vue + 7 facettes. `subCategories` et `gl_subs` n'existent **nulle part** — le §5 du même document acte pourtant leur aplatissement en un seul paramètre. Le document se contredit lui-même                                                        |
| §2 — « **Full-only**, absent du Lite »                            | **Le build Lite n'existe plus**, et `share/public-api.ts` ne porte plus la mention comme une contrainte vivante : son en-tête a été réécrit le 19/08/2026 et la mention n'y subsiste que datée et démentie sur place. Le gisement est soldé pour cette capacité |
| §6 — crochet 1 dans `core-map.module.ts:59-68`                    | Il vit dans `packages/core/src/app/boot-modules/core-map-lifecycle.ts`. Le fichier a été scindé depuis ; la plage de lignes ne désigne plus rien                                                                                                                |
| §2 et §8 — « `PermalinkModule.destroy()` détache les listeners »  | ⚠️ **Il n'y a pas de `PermalinkModule`** — la capacité n'a aucun `ICoreModule`, et le CDC le dit lui-même ailleurs. Le démontage est `stopSync()` / `_reset()`, qui existent bien et font ce qui était promis                                                   |
| §5 — le contrat `Filter` à 8 membres                              | ✅ **Vérifié exact** — les huit sont implémentés (`isEnabled`, `getConfig`, `getActiveFilter`, `applyFilter`, `applyNow`, `reset`, `hasActiveFilters`, `proximity`)                                                                                             |
| §2 — « `startSync` attache sans jamais détacher »                 | ✅ **Corrigé depuis** : `startSync` rend son démontage, `stopSync()` l'expose, et `startSync` démonte la session précédente avant d'en ouvrir une                                                                                                               |
| §3 — la vue non listable, la liste blanche sur les deux encodages | ✅ **Vérifiés exacts** tous les deux                                                                                                                                                                                                                            |

Ce qui a été **retenu** du CDC et ne se lit pas dans le code : le motif du choix in-core, la raison
de la migration cassante depuis l'ancien bloc `ui.permalink`, l'historique du découplage d'avec le
DOM du filtre (raclage, injection de champs fantômes, cales `_UIFilterPanel*`) — dont le CDC
documente que l'un des objets purgés n'avait **jamais** été alimenté —, et les alternatives écartées
de la table §Décisions.
