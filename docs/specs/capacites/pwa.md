---
type: spec-capacite
title: pwa — l'application installable
capability_id: pwa
package: "@geoleaf/core"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 81aa8d29
date: 28 juillet 2026
---

# pwa — l'application installable

**Type :** capacité in-core · **Code :** `packages/core/src/capabilities/pwa/` ·
**Vérifié contre :** `81aa8d29` (28/07/2026)

> 🧭 **Contrat ici, mode d'emploi ailleurs.** Cette fiche dit ce que le sujet **doit**
> faire : périmètre, table de configuration gatée, contrat exposé, frontières. Les recettes
> et les exemples pas à pas sont dans [`packages/core/docs/pwa.md`](../../../packages/core/docs/pwa.md)
> — page unique depuis le 11/08/2026, `packages/core/docs/pwa/pwa.md` y renvoie. **Les deux ne se recopient pas** — une
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

> ⚠️ **Son bloc de configuration a TROIS lecteurs, et c'est la particularité de cette capacité.**
> Une clé de `modules.pwa` est lue par le **runtime** de ce paquet, par la **construction du
> déployé** (`scripts/build-deploy.cjs`, qui fusionne le bloc dans le `apps/geoleaf-app/manifest.json` livré), par
> **une autre capacité** (`offline`), ou par plusieurs. Changer une clé lue seulement par la
> construction n'a **aucun effet** tant que le déployé n'est pas régénéré — et rien à l'exécution
> ne le signale. C'est le piège central de cette fiche.

> ⚠️ **`pwa` et `offline` sont deux capacités distinctes, et la seconde DÉPEND de la première —
> par CONFIGURATION, pas par position.** Celle-ci est la couche _installable_ : enregistrement du
> service worker, invite d'installation, champs du manifeste. Le **moteur de données hors-ligne**
> est `modules.offline`, qui lit `modules.pwa.enabled` — sans quoi il ne démarre pas son moteur.
>
> 🛑 Cette phrase disait « **et l'ordre entre elles porte** » jusqu'au 08/08/2026. **Mesuré faux**
> par `packages/core/__tests__/presets/shared-lifecycle-order.test.ts` (socle-init 7.4) : inverser
> les deux au manifeste produit un ensemble d'effets **identique**, sur les quatre combinaisons
> `{pwa} × {offline}`. Le drapeau est lu dans le **sac de configuration fusionné** que
> `SharedModule` passe à chaque contributeur, pas dans un état posé par le cycle de vie `pwa`.

---

## Périmètre

### Ce que la capacité fait

Elle rend l'application **installable** : elle enregistre le service worker unifié, demande le
**stockage persistant au niveau de l'origine**, affiche une invite d'installation adaptée à la
plateforme (bannière native sur Android, instructions manuelles sur iOS), et fournit les champs que
la construction écrit dans le `apps/geoleaf-app/manifest.json` déployé.

### Ce qu'elle ne fait pas

- **Elle ne met rien en cache.** Le moteur hors-ligne, ses stratégies et son stockage sont la
  capacité `offline` — distincte, chargée paresseusement, et dépendante de celle-ci.
- **Elle n'a pas de `config.ts`.** Sa configuration lui est **poussée** par l'installeur, pas tirée
  d'un lecteur ; l'exemption est nommée avec son motif dans
  `__tests__/capabilities/scaffold-taxonomy.test.js` (`NO_CONFIG_ACCESSOR`).
- **Elle ne génère pas le `apps/geoleaf-app/manifest.json`.** Elle en **déclare** les champs ; c'est
  `scripts/build-deploy.cjs` qui les fusionne sur le gabarit de `apps/geoleaf-app/`.
- **Elle n'affiche pas le badge de connectivité** — elle en déclare seulement le drapeau, que
  `offline` lit.

---

## Fonctionnalités

| ID    | Fonctionnalité                                  | Entrée                                        | Sortie observable                                                                                                                                                | Code                                             |
| ----- | ----------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| PW-01 | Enregistrement du service worker                | `modules.pwa.enabled === true`                | Service worker unifié enregistré avec la portée `"./"` — ce qui **supporte les déploiements en sous-chemin**                                                     | `lifecycle.ts` → `init`                          |
| PW-02 | Désenregistrement quand le gate est fermé       | `enabled` absent ou différent de `true`       | **Tous** les service workers de l'origine sont désenregistrés — un visiteur qui revient obtient bien « pas de SW »                                               | `lifecycle.ts` → `_unregisterAll`                |
| PW-03 | Gate lu sur la configuration **fusionnée**      | Bloc passé par l'étape #7 du module partagé   | Le gate ne dépend d'aucune ambiguïté de calendrier de fusion : il lit un bloc reçu, pas le singleton de configuration                                            | `lifecycle.ts`, `install.ts` → `sharedLifecycle` |
| PW-04 | Invite d'installation, sous-drapeau             | `installPrompt.enabled === true`              | L'invite se met en place ; sans le sous-drapeau, le SW est enregistré **mais aucune bannière n'apparaît**                                                        | `lifecycle.ts` → `init`                          |
| PW-05 | Routage par plateforme                          | Agent utilisateur                             | iOS → instructions manuelles ; tout le reste → bannière native `beforeinstallprompt`                                                                             | `pwa-manager.ts` → `init`, `platform.ts`         |
| PW-06 | Nom affiché dans la bannière                    | `short_name`, sinon `name`                    | Le nom court gagne ; à défaut le nom complet ; à défaut `"GeoLeaf"`                                                                                              | `pwa-manager.ts` → `init`                        |
| PW-07 | Capture de l'événement d'installabilité         | `beforeinstallprompt` émis par le navigateur  | L'événement est **différé** et une bannière personnalisée est proposée                                                                                           | `install-prompt.ts`                              |
| PW-08 | Refus mémorisé — Android                        | L'utilisateur ferme la bannière               | `localStorage["gl_pwa_install_dismissed"]` — la bannière n'est plus proposée sur ce profil de navigateur                                                         | `install-prompt.ts`                              |
| PW-09 | Refus mémorisé — iOS                            | L'utilisateur ferme la feuille d'instructions | `localStorage["gl_pwa_ios_dismissed"]`, clé **distincte** de la précédente                                                                                       | `ios-banner.ts`                                  |
| PW-10 | Rien sur une application déjà installée         | iOS en mode autonome                          | La feuille d'instructions n'est pas proposée                                                                                                                     | `platform.ts` → `isIOSInstallable`               |
| PW-11 | Détection de plateforme **mutualisée**          | —                                             | Un seul module feuille, qui n'importe rien — donc utilisable par n'importe quelle partie du core, sans cycle                                                     | `platform.ts`                                    |
| PW-12 | Interrogation de l'installabilité               | `GeoLeaf.PWA.isInstallable()`                 | `true` quand un chemin d'installation existe — pour un intégrateur qui veut son propre bouton                                                                    | `pwa-manager.ts` → `isInstallable`               |
| PW-13 | Icône iOS sans ressource externe                | Rendu de la feuille d'instructions            | SVG en ligne, **sans attribut `style`** — compatible avec la directive CSP `style-src`                                                                           | `ios-banner.ts`                                  |
| PW-14 | Démontage complet                               | `sharedTeardown()` / `_reset()`               | Écouteurs globaux de l'invite Android relâchés, minuteur iOS annulé, bannières retirées, service workers désenregistrés                                          | `lifecycle.ts` → `_reset`, `pwa-manager.ts`      |
| PW-15 | Champs du manifeste fusionnés à la construction | `npm run build:deploy`                        | `name`, `short_name`, `description`, `theme_color`, `background_color` écrits dans le `apps/geoleaf-app/manifest.json` déployé                                   | `scripts/build-deploy.cjs`                       |
| PW-16 | Déclaration introspectable                      | `getCapabilitySchema("pwa")`                  | Les huit clés de premier niveau, chacune annotée de **qui la lit**                                                                                               | `pwa-capability.ts`                              |
| PW-17 | Stockage persistant demandé, verdict journalisé | `modules.pwa.enabled === true`                | `navigator.storage.persist()` appelé ; le verdict (accordé / refusé / non supporté) part au `Log` — **le seul endroit où le régime de quota devient observable** | `lifecycle.ts` → `_requestPersistentStorage`     |

Les tests qui couvrent ces lignes : `packages/core/__tests__/capabilities/pwa/` — dont
`packages/core/__tests__/capabilities/pwa/manifest-only-keys.test.js`, qui **épingle** le partage entre les clés lues à l'exécution et
celles lues seulement à la construction.

---

## Configuration

Bloc `modules.pwa` d'un profil. Conformité de cette table au code gardée par
`__tests__/guards/doc-capability-config.guard.test.js`.

| Paramètre          | Type      | Défaut  | Où c'est lu                                                                                         |
| ------------------ | --------- | ------- | --------------------------------------------------------------------------------------------------- |
| `enabled`          | `boolean` | `false` | `lifecycle.ts` → `init()`, sur le bloc reçu de l'étape #7. **Opt-in** — rien ne se produit sans lui |
| `name`             | `string`  | —       | **Runtime ET construction** : repli du nom de bannière, et champ `name` du manifeste déployé        |
| `short_name`       | `string`  | —       | **Runtime ET construction** : nom de bannière préféré, et champ `short_name` du manifeste           |
| `description`      | `string`  | —       | **Construction seulement** — `scripts/build-deploy.cjs`. Aucun code d'exécution ne la lit           |
| `theme_color`      | `string`  | —       | **Construction seulement** — idem                                                                   |
| `background_color` | `string`  | —       | **Construction seulement** — idem                                                                   |
| `installPrompt`    | `object`  | —       | `lifecycle.ts` → `init()`. Porte `enabled` (défaut `false`)                                         |
| `offlineDetector`  | `object`  | —       | **Lu par la capacité `offline`**, pas par celle-ci. Porte `enabled` (défaut `false`)                |

⚠️ **Trois lecteurs, et un seul est visible à l'exécution.** C'est la table qu'il faut avoir en tête
avant de modifier une clé :

| Clé                                                | Runtime `@geoleaf/core` | Construction du déployé | Capacité `offline` |
| -------------------------------------------------- | ----------------------- | ----------------------- | ------------------ |
| `enabled`                                          | ✅ le gate              | —                       | ✅ lue             |
| `installPrompt.enabled`                            | ✅                      | —                       | —                  |
| `name` · `short_name`                              | ✅                      | ✅                      | —                  |
| `description` · `theme_color` · `background_color` | —                       | ✅ **seule**            | —                  |
| `offlineDetector.enabled`                          | —                       | —                       | ✅ **seule**       |

⚠️ **La quatrième ligne est celle qui trompe.** Ces trois clés existent bien dans le core, mais
**comme membres de type** — aucun code d'exécution ne les lit. Elles ne sont pas mortes pour autant :
la construction du déployé les consomme. Conséquence pratique : **en changer une n'a aucun effet
tant que `npm run build:deploy` n'a pas régénéré le manifeste**, et rien à l'exécution ne le dit.

⚠️ **La cinquième ligne est la symétrique** : `offlineDetector` est déclaré ici et lu **ailleurs**.
La vue que le cycle de vie de cette capacité reçoit ne le contient même pas — elle est dérivée par
`Pick<>` sur `enabled`, `installPrompt`, `name` et `short_name`. C'est la capacité `offline` qui lit
`modules.pwa.offlineDetector.enabled` pour décider du badge de connectivité.

Le contraste entre `name` / `short_name` (lues des **deux** côtés) et les trois champs de manifeste
est ce qui rend la distinction observable : sans lui, on croirait tout le bloc lu à l'exécution.

### Un gate opt-in, et sans le piège de calendrier des autres

`enableWhenAbsent: false` — contrairement à la plupart des capacités in-core. Ce n'est pas une
inconséquence : `modules.pwa` est **app-global**, il vit dans `profiles/geoleaf.config.json` et non
dans une ressource de profil. Il est donc **déjà présent** dans la configuration lue par le gate de
boot, avant toute fusion. Le piège qui force les autres capacités à l'opt-out ne s'applique pas ici.

Et le gate est de toute façon **ré-appliqué après la fusion**, sur le bloc que l'étape #7 du module
partagé passe au cycle de vie.

### Il n'y a pas de `config.ts`, et c'est un choix

La configuration est **poussée** par l'installeur (`sharedLifecycle` reçoit `ctx.config.modules.pwa`
et l'injecte), au lieu d'être tirée du singleton par un lecteur. Le motif est écrit dans
`NO_CONFIG_ACCESSOR` : un accesseur typé **absorberait le transtypage** au lieu de le rendre
visible. La conséquence pour le test-garde est qu'il vérifie ici le défaut **annoncé** par le
schéma, et pas un défaut **appliqué** — il n'y a pas de lecteur à interroger.

---

## Contrat exposé

### API publique

`GeoLeaf.PWA` — c'est `PWAManager`, ré-exporté tel quel par `public-api.ts`, monté par `install.ts` →
`registerGlobals(gl)`, et re-exporté par la façade ESM `src/api/geoleaf.pwa.ts`.

| Membre            | Rend / fait                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `init(config)`    | Met en place l'invite pour la plateforme courante — **sans effet** sans `installPrompt.enabled` |
| `isInstallable()` | `true` quand un chemin d'installation est disponible **maintenant**                             |
| `_reset()`        | Démonte les deux sous-flux (écouteurs Android, minuteur et bannière iOS)                        |

⚠️ **`isInstallable()` ne dit pas la même chose sur les deux plateformes**, et l'écart est réel :

| Plateforme         | Ce que la méthode répond                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| iOS Safari         | « iOS, et pas déjà installée » — aucun écouteur nécessaire, donc la réponse est fiable                                                     |
| Android / Chromium | « **une invite est disponible** » — donc `false` quand `installPrompt.enabled` est absent, même sur un navigateur parfaitement installable |

Un intégrateur qui veut son propre bouton d'installation sur Android doit donc **activer l'invite**
pour que l'événement soit capté, quitte à ne pas afficher la bannière intégrée.

⚠️ **`public-api.ts` ne construit rien, et son en-tête dit pourquoi.** Une version antérieure y avait
ajouté un `buildPwaPublicApi()` et un type `PWAPublicApi`, par mimétisme avec une capacité voisine.
La gate `check-orphan-exports` les a signalés sans consommateur — à raison : cette capacité
n'assemble rien, son gestionnaire porte déjà le contrat. Le même en-tête nomme les **quatre**
capacités qui n'auront jamais de `public-api.ts` parce qu'elles n'exposent aucune façade :
`offline`, [`route`](route.md), [`theme-selector`](theme-selector.md) et
[`vector-tiles`](vector-tiles.md).

### Événements

**Aucun événement GeoLeaf**, dans les deux sens. La capacité écoute en revanche deux signaux du
**navigateur** : `beforeinstallprompt` (Android) et les événements de cycle de vie de son propre
DOM de bannière.

### Stockage écrit

| Clé                        | Portée                                              |
| -------------------------- | --------------------------------------------------- |
| `gl_pwa_install_dismissed` | Refus de la bannière Android — durable              |
| `gl_pwa_ios_dismissed`     | Refus des instructions iOS — durable, clé distincte |

Les deux lectures et écritures sont protégées : un `localStorage` indisponible (navigation privée)
n'empêche jamais l'affichage, il empêche seulement la mémorisation du refus.

⚠️ **Elle n'écrit aucune autre clé, mais elle change le RÉGIME de tout le stockage de l'origine.**
`_requestPersistentStorage` (PW-17) appelle `navigator.storage.persist()`, qui fait sortir l'origine
entière du régime « best-effort ». La portée est **l'origine, pas un magasin** : le verdict couvre
d'un coup le Cache API et IndexedDB — donc l'`outbox`, dont les entrées sont des saisies terrain
**sans autre copie**. C'est ce qui rend le geste indifférent à l'arbitrage du cache de tuiles à
venir : quel que soit le magasin retenu, il est couvert.

---

## Décisions de conception

| Décision                                                      | Pourquoi                                                                                                                                                                                                                                                                                                                                                                                                                                 | Alternative écartée                                            |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Deux capacités : `pwa` installable, `offline` moteur**      | La couche installable est minuscule et sert au boot ; le moteur hors-ligne est lourd et se charge paresseusement. Les fondre imposerait le poids du second à qui ne veut que le premier                                                                                                                                                                                                                                                  | Une capacité PWA unique                                        |
| **Gate opt-in, contrairement aux autres capacités**           | Enregistrer un service worker est un effet **persistant** sur l'origine : il survit aux rechargements. Un défaut actif l'imposerait à des applications qui n'en veulent pas                                                                                                                                                                                                                                                              | Opt-out, par symétrie avec le reste                            |
| **Le gate fermé DÉSENREGISTRE au lieu de ne rien faire**      | Un service worker déjà enregistré continue de contrôler la page indéfiniment. « Ne rien faire » laisserait un visiteur qui revient sur l'ancien comportement, sans moyen de s'en sortir                                                                                                                                                                                                                                                  | Sortir sans rien faire                                         |
| **Le cycle de vie reçoit son bloc au lieu de le lire**        | Cela rend le gate testable et supprime toute ambiguïté de calendrier de fusion : la valeur reçue est celle qui a été fusionnée, par construction                                                                                                                                                                                                                                                                                         | Lire le singleton de configuration                             |
| **Piloté par le module partagé, pas par un `ICoreModule`**    | La capacité est **app-globale** : elle n'a ni carte, ni couche, ni place dans le tri topologique. Lui inventer un module lui donnerait un rang qui ne veut rien dire                                                                                                                                                                                                                                                                     | Un module de cycle de vie comme les autres                     |
| **La dépendance vers l'installeur a été INVERSÉE**            | Le module partagé importait le cycle de vie **statiquement** — un module du kernel câblé en dur sur une capacité optionnelle, qui la clouait dans la clôture de tous les paquets. Il reçoit désormais les installeurs et appelle qui a contribué : une entrée sans PWA n'a aucun contributeur, et PWA s'élague                                                                                                                           | L'import statique                                              |
| **Position LIBRE au manifeste, dépendance par configuration** | Le cycle de vie de `offline` lit `modules.pwa.enabled` **du sac fusionné**, donc la condition lui est disponible quel que soit son rang. 🛑 Cette ligne disait « La position est donc **porteuse** » jusqu'au 08/08/2026 : réfuté par `packages/core/__tests__/presets/shared-lifecycle-order.test.ts` (7.4), qui inverse le couple sur les 4 combinaisons sans différence observable. L'alternative écartée est devenue le choix retenu | ~~Une position libre~~ · **Un couplage par position**          |
| **Détection de plateforme dans un module feuille**            | Le reniflage vivait en **deux exemplaires** et avait dérivé : une expression nue d'un côté, une variante avec la vérification du mode autonome de l'autre. Un module qui n'importe rien peut être partagé sans cycle                                                                                                                                                                                                                     | Deux copies, une par consommateur                              |
| **Deux clés de refus distinctes**                             | Refuser les instructions iOS et refuser la bannière Android sont deux gestes différents, sur deux plateformes qui ne se croisent pas. Une clé unique ferait taire l'une au nom de l'autre                                                                                                                                                                                                                                                | Une clé de refus commune                                       |
| **`PWAConfig` est déclaré UNE fois, les vues en dérivent**    | Les trois copies avaient déjà divergé : aucune ne portait les champs de manifeste, et l'une n'avait ni `enabled` ni `offlineDetector`. Les vues sont désormais des `Pick<>` sur la forme canonique                                                                                                                                                                                                                                       | Une interface par consommateur                                 |
| **Pas de `public-api.ts` qui assemble**                       | Cette capacité n'assemble rien : son gestionnaire porte déjà le contrat. Copier la forme d'une voisine qui, elle, a quelque chose à assembler serait du mimétisme — et la gate d'exports orphelins l'a dit                                                                                                                                                                                                                               | Un `buildPwaPublicApi()` par symétrie                          |
| **SVG en ligne sans attribut `style`**                        | La directive CSP `style-src` du dépôt refuse les styles en ligne. La mise en page vient de l'enveloppe                                                                                                                                                                                                                                                                                                                                   | Un attribut `style` sur l'icône                                |
| **Portée `"./"` pour le service worker**                      | Elle supporte les déploiements en sous-chemin, ce qu'une portée absolue interdirait                                                                                                                                                                                                                                                                                                                                                      | La portée `"/"`                                                |
| Pas de `loader`                                               | L'enregistrement du SW et l'invite sont minuscules et servent au boot. Le poids réel — le moteur hors-ligne — est déjà dans une capacité à chargement paresseux                                                                                                                                                                                                                                                                          | Un `import()` paresseux                                        |
| **`persist()` ici, et pas dans le service worker**            | `navigator.storage` est une API **`Window`** : elle est **absente** de la portée du worker, donc `packages/core/src/kernel/storage/sw-core.js` ne peut pas la porter. Ce cycle de vie est le premier code `Window` qui tourne derrière le gate PWA                                                                                                                                                                                       | L'appeler depuis `packages/core/src/kernel/storage/sw-core.js` |
| **`persist()` non chaîné sur l'enregistrement du SW**         | La donnée protégée est écrite par le moteur hors-ligne dans IndexedDB, pas par le SW. Chaîner ferait sauter la protection quand l'enregistrement échoue — exactement le cas où l'on en a le plus besoin. Épinglé par un test dédié                                                                                                                                                                                                       | `register().then(persist)`                                     |
| **Le verdict est journalisé, pas silencieux**                 | Un refus est **indiscernable** d'un appel jamais fait. Sans la trace, personne ne sait sous quel régime de quota l'application tourne — et c'est ce régime qui décide si les saisies non synchronisées peuvent être évincées                                                                                                                                                                                                             | Un appel « best-effort » sans trace                            |

---

## Dépendances et frontières

### Aucune dépendance de cycle de vie — pilotée par le module partagé

Il n'y a **ni `module.ts`, ni `createModule`**. L'installeur contribue à la place un
`sharedLifecycle` et un `sharedTeardown`, appelés à l'**étape #7** de `shared.module`. La capacité
n'entre donc pas dans le tri topologique du registre, et la question de rang de
La question des dépendances **ne se pose pas ici**.

🛑 **Et sa position dans `presets/manifest.full.ts` est LIBRE — cette section affirmait l'inverse
jusqu'au 08/08/2026, dans les termes les plus forts du dépôt.** Elle disait : « ⚠️ **Mais sa
position dans `presets/manifest.full.ts` est porteuse quand même**, pour une autre raison : les
contributions `sharedLifecycle` sont appelées **dans l'ordre du manifeste**, et l'étape #8 est celle
de `offline`, qui lit `modules.pwa.enabled`. **Inverser les deux empêcherait le moteur hors-ligne de
démarrer.** »

**La dernière phrase a été exécutée, et elle est fausse.** `packages/core/__tests__/presets/shared-lifecycle-order.test.ts`
(socle-init 7.4) inverse le couple et observe un ensemble d'effets **identique** sur les quatre
combinaisons `{pwa} × {offline}`, service worker compris. Trois raisons, toutes mesurées :

1. `offline` lit `modules.pwa.enabled` dans le **sac fusionné** que `SharedModule` passe à chaque
   contributeur — pas dans un état que le cycle de vie `pwa` poserait ;
2. `GeoLeaf.Storage` et `GeoLeaf._OfflineDetector` sont posés **à l'import**, en phase A par
   `globals/globals.storage.ts`, donc avant l'un comme l'autre ;
3. le seul effet que `pwa` produirait avant `offline` — l'enregistrement du service worker — est
   **différé** par `Helpers.lazyExecute` (plafond 3 s) : même dans l'ordre nominal, il n'a pas eu
   lieu quand l'étape #8 s'exécute.

⚠️ Ce qui reste vrai est le **gate** — `offline` refuse de démarrer si `modules.pwa.enabled` est
faux — et il est désormais épinglé par `SLO-05`, dans les deux ordres. Une condition, pas un rang.
Le fichier incriminé se contredisait d'ailleurs déjà lui-même : `packages/core/src/presets/manifest.full.ts` écrit
« Position is free (no module, no mobileIcon) » juste au-dessus du couple.

### Frontière `capabilities/` → `kernel/` (règle ESLint R.8)

| Import                                   | Statut vis-à-vis de R.8                         |
| ---------------------------------------- | ----------------------------------------------- |
| `kernel/storage/index.js` (`SWRegister`) | **Baril** — l'enregistrement du SW reste kernel |

Le reste passe par `utils/` : `utils/log`, `utils/i18n`, `utils/general/dom-helpers`
(`applyCssText`). **Aucun accès à la carte**, aucun `IMapAdapter`. **Aucune référence à un plugin**
— règle `no-plugin-in-core`.

### Frontière avec la CONSTRUCTION — la seule du dépôt

C'est la seule capacité dont une partie du contrat est consommée par un **script de build** plutôt
que par du code livré. `scripts/build-deploy.cjs` lit `modules.pwa` dans
`profiles/geoleaf.config.json` et fusionne cinq champs sur le gabarit `apps/geoleaf-app/manifest.json` de
`apps/geoleaf-app/`. Le gabarit est une des cinq sources irremplaçables de ce répertoire.

Vérification de ce que la construction a réellement écrit :

```bash
grep -o '"\(name\|short_name\|theme_color\|background_color\)":[^,}]*' deploy/deploy-full/manifest.json
```

### Frontière côté CSS

`install.ts` n'importe aucune feuille : les deux bannières écrivent leur mise en forme
**propriété par propriété** en CSSOM, ce qui n'est pas soumis à la directive CSP `style-src`,
contrairement à un attribut `style`.

---

## Écarts au CDC source

**Aucun CDC source.** `pwa` n'a jamais eu de cahier des charges dédié dans le dossier de tri : cette
fiche est écrite intégralement contre le code, comme [`labels`](labels.md) et sept des onze fiches
du palier S.

⚠️ **En revanche, sa DÉCLARATION porte cinq citations de ligne périmées**, et elles sont
**publiées** : `getCapabilitySchema('pwa')` sert les descriptions du schéma aux intégrateurs et au
studio sans code. Elles renvoient à `scripts/build-deploy.cjs:676-680` alors que la fusion du
manifeste vit à présent bien plus bas dans le fichier. Le gisement complet — 25 citations sur
4 déclarations de capacités, toutes vérifiées — est du gisement des citations mortes.
