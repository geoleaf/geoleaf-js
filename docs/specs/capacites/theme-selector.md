---
type: spec-capacite
title: theme-selector — la barre de commutation des thèmes de carte
capability_id: theme-selector
package: "@geoleaf/core"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 2fcbba8a
date: 1er septembre 2026
---

# theme-selector — la barre de commutation des thèmes de carte

**Type :** capacité in-core · **Code :** `packages/core/src/capabilities/theme-selector/` ·
**Vérifié contre :** `2fcbba8a` (01/09/2026)

> **Trois règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.
> 3. **Un chemin cité sans racine se lit depuis le répertoire annoncé par « Code : » ci-dessus**,
>    ou depuis son `src/`, et à défaut depuis `packages/core/src/`. Un chemin qui commence par
>    `packages/`, `scripts/`, `profiles/`, `docs/`, `apps/` ou `e2e/` est relatif à la **racine du
>    dépôt**. Les cas qui échappent aux deux sont racinés sur place.

> ⚠️ **Trois voisins portent le mot « theme » et sont ORTHOGONAUX** — l'encadré complet est dans
> [`theme-palette.md`](theme-palette.md). Ce qui distingue **celle-ci** : elle est la seule à agir
> sur les **données affichées**. Un « thème » ici est un preset nommé de visibilité et de style de
> couches, déclaré dans `themes.json` — pas une couleur, pas un mode clair/sombre.
>
> 📌 **`themes.json` désigne ici `profiles/<profil>/config/core/themes.json`** — un fichier **par
> profil**, pas un fichier du dépôt. Les mentions courtes qui suivent renvoient toutes à celui-là.

> ⚠️ **Le MOTEUR de thème n'est pas ici, il est au kernel.** `ThemeApplierCore`, `ThemeLoader` et
> `ThemeCache` (`kernel/themes/`) chargent, composent et appliquent les thèmes ; le thème par défaut
> est appliqué au boot par `ThemeEngineModule`, **indépendamment de cette capacité**. Ce que la
> capacité apporte, c'est **la barre** : les boutons, la liste déroulante, et le reflet du thème
> actif. Une application sans elle change encore de thème par programme.

---

## Périmètre

### Ce que la capacité fait

Elle construit la **barre de commutation** — boutons pour les thèmes « primaires », liste déroulante
et navigation avant/arrière pour les « secondaires », mode compact au-delà d'un seuil — et relaie le
choix de l'utilisateur au moteur du kernel. Elle **reflète** le thème actif ; elle ne l'applique pas
au boot.

### Ce qu'elle ne fait pas

- **Elle n'applique pas le thème par défaut.** C'est `ThemeEngineModule` (kernel), et c'était une
  décision explicite de la migration : le signal `geoleaf:theme:applied` est central pour le
  dévoilement de l'application, le permalien et les toasts — il ne peut pas dépendre d'une UI
  optionnelle.
- **Elle ne charge pas les couches.** Le kernel les charge indépendamment ; sans thème déclaré, les
  données s'affichent quand même.
- **Elle n'a pas de `config.ts`.** Sa configuration de rendu ne vient pas de `modules.*` mais de
  `themes.json` — voir §Configuration. L'exemption est nommée avec son motif dans
  `__tests__/capabilities/scaffold-taxonomy.test.js` (`NO_CONFIG_ACCESSOR`).
- **Elle ne touche ni au mode clair/sombre ni à la couleur d'accent** — voir l'encadré ci-dessus.

---

## Fonctionnalités

| ID    | Fonctionnalité                                    | Entrée                                                               | Sortie observable                                                                                                                | Code                                                       |
| ----- | ------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| TS-01 | Montage différé au dévoilement                    | `geoleaf:app:ready`                                                  | La barre se construit à ce moment-là, **jamais** à l'initialisation du module. Écoute posée en `{ once: true }`                  | `lifecycle.ts` → `init`, `_onAppReady`                     |
| TS-02 | Garde d'acceptation avant montage                 | `app:ready` reçu                                                     | Rien ne monte sans **profil actif** ET **les deux conteneurs** `#gl-theme-primary-container` / `#gl-theme-secondary-container`   | `lifecycle.ts` → `_onAppReady`                             |
| TS-03 | Gate tardif sur la configuration fusionnée        | `modules.theme-selector.enabled`                                     | La barre n'est construite que si la valeur vaut **exactement `true`** — opt-in. Voir §Le double gate                             | `theme-selector.ts` → `_createUI`                          |
| TS-04 | Chargement de la configuration de thèmes          | `profileId`                                                          | `themes.json` résolu, thèmes répartis en primaires / secondaires, thème par défaut retenu comme thème courant                    | `theme-selector.ts` → `init`                               |
| TS-05 | Reflet, jamais application, au montage            | Configuration chargée                                                | Le thème courant est **surligné** dans la barre ; aucun `applyTheme` n'est déclenché                                             | `theme-selector.ts` → `init`, `_updateUIState`             |
| TS-06 | Boutons de thèmes primaires                       | `config.primaryThemes.enabled` et conteneur présent                  | Un bouton par thème primaire : icône + libellé en `textContent`, `data-theme-id`, actif surligné                                 | `theme-selector-primary.ts` → `createPrimaryUI`            |
| TS-07 | Mode compact au-delà d'un seuil                   | Plus de thèmes primaires que `config.primaryThemes.compactThreshold` | Zone défilante horizontale encadrée de deux boutons de navigation, dont l'état désactivé suit le défilement                      | `theme-selector-primary.ts`, `-compact.ts`                 |
| TS-08 | Défilement vers le thème actif                    | Changement de thème en mode compact                                  | Le bouton actif est ramené dans la zone visible, puis l'état des boutons de navigation est recalculé                             | `theme-selector-compact.ts` → `ensurePrimaryThemeVisible`  |
| TS-09 | Liste déroulante des thèmes secondaires           | `config.secondaryThemes.enabled` et conteneur présent                | `<select>` avec une option d'invite désactivée puis un `<option>` par thème secondaire                                           | `theme-selector-secondary.ts` → `createSecondaryUI`        |
| TS-10 | Navigation avant / arrière                        | `config.secondaryThemes.showNavigationButtons`                       | Deux boutons encadrant la liste ; parcours **cyclique** des thèmes secondaires                                                   | `theme-selector-secondary.ts`, `theme-selector.ts`         |
| TS-11 | Point d'entrée depuis un thème primaire           | Thème courant non secondaire, clic « suivant »                       | Le parcours démarre au **premier** secondaire (« précédent » démarre au dernier)                                                 | `theme-selector.ts` → `nextTheme`, `previousTheme`         |
| TS-12 | Commutation utilisateur                           | Clic sur un bouton ou choix dans la liste                            | `ThemeApplierCore.applyTheme(theme)` — les couches, la légende et le gestionnaire de couches se recomposent                      | `theme-selector.ts` → `setTheme`                           |
| TS-13 | Reflet croisé des deux surfaces                   | Thème appliqué                                                       | Boutons et liste déroulante sont mis à jour **ensemble** ; la liste retombe sur son invite si le thème actif est primaire        | `theme-selector.ts` → `_updateUIState`                     |
| TS-14 | Refus avant initialisation                        | `setTheme()` avant le montage                                        | Promesse **rejetée** — pas d'application silencieuse sur un état vide                                                            | `theme-selector.ts` → `setTheme`                           |
| TS-15 | Thème inconnu refusé                              | `setTheme("inexistant")`                                             | Promesse rejetée nommant l'identifiant                                                                                           | `theme-selector.ts` → `setTheme`                           |
| TS-16 | Signal de fin de chargement des thèmes            | Fin de `init()`, **succès comme échec**                              | `geoleaf:themes:ready` émis, avec `error` dans le détail en cas d'échec                                                          | `theme-selector.ts` → `init`                               |
| TS-17 | Clics confinés à la barre                         | Clic sur n'importe quel contrôle                                     | Un second écouteur arrête la propagation : le clic n'atteint jamais le canevas de la carte                                       | `theme-selector-events.ts` → `attachDOMEvent`              |
| TS-18 | Conteneurs vidés en sécurité avant reconstruction | Second montage                                                       | Vidage par le helper de sécurité du kernel, jamais par `innerHTML`                                                               | `-primary.ts`, `-secondary.ts` → `DOMSecurity`             |
| TS-19 | Démontage complet                                 | `ThemeSelectorModule.destroy()` / `_reset()`                         | Écoute `app:ready` détachée, **tous** les écouteurs DOM relâchés par leurs fermetures, et **toutes** les références DOM effacées | `lifecycle.ts` → `_reset`, `theme-selector.ts` → `destroy` |
| TS-20 | Déclaration introspectable                        | —                                                                    | `getAllCapabilities()` la liste, `getCapabilitySchema("theme-selector")` rend son schéma                                         | `theme-selector-capability.ts`                             |

⚠️ **TS-19 efface les références DOM, et ce n'est pas de la cosmétique** : un cycle
démontage → remontage opérerait sinon sur les nœuds détachés de l'instance précédente.

Les tests qui couvrent ces lignes : `packages/core/__tests__/capabilities/theme-selector/`
(cinq fichiers, dont un montage réel de la barre).

---

## Configuration

Bloc `modules.theme-selector` d'un profil. Conformité de cette table au code gardée par
`__tests__/guards/doc-capability-config.guard.test.js`.

| Paramètre | Type      | Défaut  | Où c'est lu                                                                                                 |
| --------- | --------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `enabled` | `boolean` | `false` | `theme-selector.ts` → `_createUI()`, sur la configuration **fusionnée**, en test d'égalité stricte à `true` |

⚠️ **Il n'y a pas de `config.ts` ici**, contrairement à presque toutes les autres capacités : le
gate tardif lit `Config.get("modules")` sur place. La conséquence pour le test-garde est qu'il
vérifie le défaut **annoncé** par le schéma, et pas le défaut **appliqué** par un lecteur — puisque
ce lecteur n'existe pas.

### Le double gate, et pourquoi les deux valeurs diffèrent EXPRÈS

C'est le point le plus facile à documenter de travers, et le seul endroit du dépôt où la
divergence est **délibérée et documentée sur place** :

| Étage                                                         | Valeur                   | Ce qu'il décide                                                  |
| ------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------- |
| Gate de déclaration — `theme-selector-capability.ts` → `gate` | `enableWhenAbsent: true` | **L'enregistrement du module**, avant fusion de la configuration |
| Schéma publié — même fichier → `configSchema.enabled.default` | `false`                  | Ce que la capacité **annonce** aux intégrateurs et au studio     |
| Gate tardif — `theme-selector.ts` → `_createUI`               | `enabled === true`       | **La construction de la barre**, sur la configuration fusionnée  |

Le gate de déclaration tourne sur la configuration **d'avant le chargement du profil**, où la clé
`modules.theme-selector` **n'existe pas encore**. Un gate opt-in y lirait `undefined` et
n'enregistrerait **jamais** la capacité — c'est le piège de calendrier documenté du dépôt. D'où
`enableWhenAbsent: true`, qui ne veut donc **pas** dire « active par défaut ».

Le schéma, lui, annonce `false` : c'est ce que `getCapabilitySchema('theme-selector')` publie, et il
doit dire **ce que le runtime fait**. Il déclarait `true` auparavant, promettant une barre qu'un
profil omettant la clé n'obtenait jamais. **Les deux valeurs répondent à deux questions
différentes ; c'est le SCHÉMA qui doit s'aligner sur le runtime, pas sur le gate.**

⚠️ **Les deux en-têtes qui disaient le contraire ont été corrigés.** `module.ts` et `lifecycle.ts`
qualifiaient le gate d'« opt-out » ; ils annoncent aujourd'hui **opt-in**, et `lifecycle.ts` porte
sur place la trace de sa propre erreur — il note que ces deux lignes citaient un test `!== false`
qui n'existe plus. La seule mention « opt-out » qui subsiste est dans `theme-selector.ts` →
`_createUI`, et elle est **juste** : elle nomme le gate d'AMORÇAGE (`enableWhenAbsent: true`), pas
le gate tardif. L'état des mentions se relit à la commande, il ne se recopie pas :

```bash
grep -n "opt-in\|opt-out" packages/core/src/capabilities/theme-selector/*.ts
```

### La vraie configuration de la barre est dans `themes.json`

Le bloc `modules.theme-selector` ne porte **que** le gate. Tout ce qui règle l'apparence et le
contenu de la barre vient de la clé `config` de `themes.json`, chargée par le loader du kernel :

| Clé de `themes.json` → `config`         | Effet                                                              |
| --------------------------------------- | ------------------------------------------------------------------ |
| `primaryThemes.enabled`                 | Construit ou non la barre de boutons                               |
| `primaryThemes.compactThreshold`        | Nombre de thèmes primaires au-delà duquel le mode compact s'active |
| `secondaryThemes.enabled`               | Construit ou non la liste déroulante                               |
| `secondaryThemes.placeholder`           | Libellé de l'option d'invite                                       |
| `secondaryThemes.showNavigationButtons` | Ajoute les deux boutons avant / arrière                            |

Le seuil de compacité a un défaut de code (`PRIMARY_COMPACT_THRESHOLD`) qui s'applique quand la clé
est absente. Les autres n'en ont pas ici : elles viennent validées par le loader du kernel.

⚠️ **La barre n'a pas besoin d'une garde « aucun thème déclaré ».** Sans `themes.json` exploitable,
le chargement **rejette**, `_createUI` n'est jamais atteint, et l'événement de fin est tout de même
émis avec son `error`. C'est ce qui rend l'exigence « aucun thème → pas de barre, mais les données
s'affichent » vraie **par le chemin d'erreur**, pas par un test de longueur de liste.

---

## Contrat exposé

### API publique

`GeoLeaf.ThemeSelector` — l'objet `ThemeSelector` lui-même, monté par `install.ts` →
`registerGlobals(gl)`.

⚠️ **Cette capacité n'a ni `public-api.ts` ni façade ESM** `src/api/geoleaf.theme-selector.ts`,
contrairement à `labels` ou `theme-palette`. Le namespace expose directement l'orchestrateur. Il n'y
a donc **pas** d'aides `isEnabled()` / `getConfig()` ici : un intégrateur qui veut connaître l'état
du gate lit sa propre configuration, ou passe par `getCapabilitySchema`.

⚠️ **Le motif de cette absence a été RÉÉCRIT dans `install.ts` le 24/08/2026, et l'ancien était
faux.** Il disait que la capacité « ne monte aucun namespace » : elle en monte un —
`registerGlobals` écrit `gl.ThemeSelector`, symbole issu de ce répertoire et déclaré de surcroît
dans `global.d.ts`. C'est donc bien une surface propre, et l'argument de la « coquille vide »
tombait de lui-même. **La décision d'absence tient quand même, sur un autre motif, écrit au site du
montage** : ce montage direct est fonctionnellement identique à un fichier de ré-export, la clé est
déjà gelée par les oracles de surface, et conformer un fichier livré stable à un patron interne ne
changerait aucun octet observable. Ce qui rouvrirait la question est nommé : **l'apparition d'un
second consommateur de `ThemeSelector` à l'intérieur du paquet**.

| Membre                                                        | Rend / fait                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `init({ profileId, primaryContainer, secondaryContainer })`   | Charge la configuration, construit la barre, reflète le thème actif                        |
| `setTheme(themeId)`                                           | Applique le thème par le moteur du kernel — **rejette** si non initialisé ou thème inconnu |
| `nextTheme()` · `previousTheme()`                             | Parcours cyclique des thèmes **secondaires** uniquement                                    |
| `getCurrentTheme()`                                           | L'identifiant du thème actif, ou `null`                                                    |
| `getThemes()` · `getPrimaryThemes()` · `getSecondaryThemes()` | Les listes chargées                                                                        |
| `isInitialized()`                                             | `true` après un chargement réussi                                                          |
| `destroy()`                                                   | Relâche les écouteurs et efface **toutes** les références DOM et de données                |

Le moteur, lui, reste au kernel — mais **une seule** de ses clés est encore sur le namespace :
`GeoLeaf.ThemeCache`, montée par `globals/globals.ui.ts`. `_ThemeApplier` et `_ThemeLoader` en sont
partis, faute de lecteur, et rien n'a cassé — c'est la mesure, pas une prévision. Deux conséquences
qui ne se devinent pas : le retrait de `_ThemeApplier` a emporté la composition `Object.assign` qui
n'existait que pour cette écriture (les correctifs qu'elle ancrait sont désormais tenus par des
imports à effet de bord, nommés sur place) ; et il a laissé le cache du loader **sans porte
publique**, d'où l'unique point d'entrée `GeoLeaf.Config.clearThemesCache()`, posé au même endroit
et pour cette seule raison. La barre, elle, n'a jamais lu ces clés : elle atteint le moteur par
import ESM du baril `kernel/themes/`.

```bash
grep -n "_gl\.\|clearThemesCache" packages/core/src/globals/globals.ui.ts
```

Typage publié : `src/global.d.ts`, section des capacités. Ne pas citer de numéro de ligne pour ce
fichier.

### Événements

| Événement              | Sens                   | Détail                                                                              |
| ---------------------- | ---------------------- | ----------------------------------------------------------------------------------- |
| `geoleaf:app:ready`    | **écouté**, `{ once }` | Le déclencheur de montage — dispatché par le dévoilement de l'application           |
| `geoleaf:themes:ready` | **émis**               | Fin de chargement, **succès comme échec** (`{ time }`, plus `error` en cas d'échec) |

⚠️ **`geoleaf:themes:ready` est émis par CETTE capacité et par elle seule** — et le permalien
l'attend pour restaurer un thème d'URL.

🛑 **Mais le gate tardif ne le supprime PAS, contrairement à ce qu'on suppose.** Quand
`modules.theme-selector.enabled` ne vaut pas `true`, `_createUI` **sort sans lever** : `init()` va
jusqu'au bout, marque la capacité initialisée et émet l'événement — **sans barre**. Les trois
conditions qui l'empêchent réellement sont énumérées au site de l'attente
(`capabilities/permalink/permalink-sync.ts`) : la capacité doit être enregistrée, un profil doit
être actif, et les **deux** conteneurs doivent exister dans la page.

⚠️ **Et le permalien ne reste plus en attente indéfiniment.** Il arme un second écouteur sur
`geoleaf:app:ready` — qui, lui, part toujours, le dévoilement ayant sa propre temporisation de
sûreté — puis conclut au bout d'un délai de grâce que l'émetteur ne viendra pas : il **journalise
un avertissement** et applique tout de même les couches, les couches visibles et le filtre
différés. **Seule la bascule de thème est abandonnée**, faute de sélecteur pour l'opérer — et elle
l'est bruyamment. Avant ce repli, c'est tout l'état différé qui était perdu, silencieusement. Le
délai est une constante du fichier, à lire sur place plutôt qu'ici.

⚠️ **Les deux événements n'ont pas le même statut de typage** : `geoleaf:app:ready` est **typé**
dans `contracts/event-bus.contract.ts` ; `geoleaf:themes:ready` — celui que cette capacité **émet**
— ne l'est pas, il figure dans la liste de référence des événements non typés
(`scripts/.baselines/event-map-coverage.json`).

### Stockage écrit

Aucun. Le thème actif voyage par le permalien (`gl_theme`), écrit par la capacité `permalink` qui
lit `getCurrentTheme()` — pas par cette capacité.

---

## Décisions de conception

| Décision                                                           | Pourquoi                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Alternative écartée                                                 |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Le moteur reste au kernel, seule la barre sort**                 | `geoleaf:theme:applied` est le signal central du dévoilement, du permalien, des toasts et de plusieurs plugins. Le faire dépendre d'une UI optionnelle rendrait l'application aveugle dès qu'un intégrateur retire la barre                                                                                                                                                                                                                                            | Sortir le moteur entier en capacité                                 |
| **Le thème par défaut est appliqué par un module kernel**          | Corollaire du point précédent : la capacité ne fait que **refléter**. Un profil sans barre obtient quand même son thème par défaut                                                                                                                                                                                                                                                                                                                                     | Laisser l'`init()` du sélecteur appliquer, comme avant la migration |
| **Montage sur `app:ready`, pas à l'`init()` du module**            | La barre a besoin d'un profil actif et de deux conteneurs que le kernel construit plus tard ; l'écoute est posée pendant la passe synchrone du registre et l'événement est asynchrone, donc il est toujours capté                                                                                                                                                                                                                                                      | Monter dans `init()`                                                |
| **Garde d'acceptation, sortie silencieuse**                        | Une page hôte a le droit de ne pas fournir les conteneurs. La capacité ne les crée pas : elle s'abstient                                                                                                                                                                                                                                                                                                                                                               | Créer les conteneurs manquants                                      |
| **Le schéma annonce `false`, le gate `enableWhenAbsent: true`**    | Ils répondent à deux questions distinctes. Annoncer `true` promettait une barre qu'un profil omettant la clé ne recevait jamais — le schéma doit décrire le RUNTIME                                                                                                                                                                                                                                                                                                    | Aligner les deux valeurs, dans un sens ou dans l'autre              |
| **Accès au moteur par IMPORT DIRECT, pas par seam**                | Le seam **n'existe plus** : `GeoLeaf._ThemeApplier` a quitté le namespace faute de lecteur, et l'objet composé par `Object.assign` qui l'y portait n'existait que pour cette écriture — il est parti avec elle. La décision était déjà bonne avant ce retrait (cette copie superficielle divergeait de l'état interne des chemins d'ajout et de bascule) ; elle est aujourd'hui la seule possible. L'import typé du baril `kernel/themes/` atteint le singleton vivant | Le seam `getGeoLeaf()._ThemeApplier`, prévu par le CDC source       |
| **Les réglages de barre restent dans `themes.json`**               | Ils décrivent la présentation d'un jeu de thèmes, pas une option d'application. Les dupliquer dans `modules.*` créerait deux sources pour un même fait                                                                                                                                                                                                                                                                                                                 | Les remonter dans le bloc `modules.theme-selector`                  |
| **`setTheme` REJETTE au lieu de dégrader**                         | Une commutation silencieusement ignorée laisserait la barre surligner un thème qui n'est pas appliqué. Le rejet remonte à l'appelant, y compris au permalien                                                                                                                                                                                                                                                                                                           | Journaliser et continuer                                            |
| **`themes:ready` est émis même en cas d'échec**                    | Ses consommateurs attendent un signal de fin, pas un signal de succès. Ne l'émettre qu'au succès les ferait attendre indéfiniment sur un profil dont les thèmes ne chargent pas                                                                                                                                                                                                                                                                                        | N'émettre qu'au succès                                              |
| **Un écouteur d'arrêt de propagation par contrôle**                | Sans lui, un clic sur un bouton de thème atteint le canevas et déclenche l'interaction cartographique sous la barre                                                                                                                                                                                                                                                                                                                                                    | Un seul écouteur sur le conteneur                                   |
| **Vidage par le helper de sécurité**                               | Les libellés de thème viennent d'un profil, donc d'une source que le core ne contrôle pas : **toute donnée de profil** est posée en `textContent`, et le vidage passe par `DOMSecurity.clearElementFast`. Les seuls `innerHTML` de la capacité posent les deux chevrons du mode compact — une entité HTML statique, sans donnée d'origine externe, annotée `SAFE:` sur place                                                                                           | `innerHTML = ""`                                                    |
| **Le mode compact scinde le DOM plutôt qu'il ne le réduit**        | Au-delà du seuil, une zone défilante encadrée de deux boutons garde tous les thèmes accessibles ; réduire la liste en cacherait                                                                                                                                                                                                                                                                                                                                        | Tronquer la liste, ou un menu déroulant unique                      |
| **`destroy()` efface les références, pas seulement les écouteurs** | Un cycle démontage → remontage opérerait sinon sur des nœuds détachés de l'instance précédente                                                                                                                                                                                                                                                                                                                                                                         | Ne relâcher que les écouteurs                                       |
| Pas de `loader`                                                    | La barre est une surface de premier plan, montée au dévoilement : un `import()` paresseux la ferait apparaître après coup                                                                                                                                                                                                                                                                                                                                              | Un chargement paresseux                                             |

---

## Dépendances et frontières

### Dépendance de cycle de vie — et son cas particulier

`module.ts` → `ThemeSelectorModule` : `id = "theme-selector"`, `dependencies = ["geojson"]`.

C'est le cas désigné comme « à traiter
séparément », au motif que retirer `geojson` **changerait le rang relatif** vis-à-vis de
`ThemeEngineModule`. Le pré-vol confirme le fait et **requalifie le risque** — ce n'est pas celui
qui était écrit.

**Ce que `init()` fait réellement** : il pose **un** écouteur `app:ready` en `{ once: true }`.
Il ne lit ni la carte, ni l'état GeoJSON, ni la configuration. Même classe que
[`labels`](labels.md).

**Le graphe des modules du kernel, mesuré** :

```bash
grep -rn "readonly id = \|readonly dependencies = " packages/core/src/app/boot-modules/*.ts
```

| Module         | Dépendances                               |
| -------------- | ----------------------------------------- |
| `config`       | —                                         |
| `core-map`     | `config`                                  |
| `shared`       | `config`                                  |
| `geojson`      | `config`, `core-map`                      |
| `ui`           | `config`, `core-map`, `shared`, `geojson` |
| `theme-engine` | `geojson`, `ui`                           |

⚠️ **L'invariant que la dépendance est censée protéger tient de toute façon.** `theme-engine`
dépend de `ui`, qui dépend lui-même de `geojson` : il est donc **toujours** dépilé après
`geojson`. Une capacité qui ne dépendrait que de `config` serait dépilée **encore plus tôt** —
donc son écouteur `app:ready` serait posé **avant**, pas après. Le retrait ne peut pas casser la
capture de l'événement ; il la renforce.

⚠️ **Le vrai risque est ailleurs, et il est réel : l'ORDRE ENTRE LES ÉCOUTEURS `app:ready`.**
Plusieurs capacités s'abonnent au même événement, et l'ordre de déclenchement est celui de
l'abonnement, donc celui de l'initialisation des modules. Le manifeste de preset garde
`theme-selector` en **dernier** pour cette raison précise, et un commentaire de
`capabilities/permalink/permalink-sync.ts` montre que cette classe d'ordonnancement **porte du
comportement** : le panneau de filtre y est garanti monté parce que son écouteur a été posé
strictement avant. Ramener la dépendance à `["config"]` ferait passer `theme-selector` **devant**
`legend` et `filter`, qui déclarent la même dépendance et sont départagées par l'ordre
d'enregistrement.

**Verdict** : sous-classe **« l'`init()` ne lit rien, mais la position est
observable »**. Le geste reste possible ; il exige un observable sur l'**ordre des écouteurs
`app:ready`**, pas sur la date de montage. Il n'est pas exécuté ici.

Position dans `presets/manifest.full.ts` : **dernière du lot de clôture** (les quatre sélecteurs
d'interface ajoutés ensuite le sont par simple ajout en queue, leur position étant libre).

### Frontière `capabilities/` → `kernel/` (règle ESLint R.8)

| Import                                     | Statut vis-à-vis de R.8                                      |
| ------------------------------------------ | ------------------------------------------------------------ |
| `kernel/config/config-primitives.js`       | **Exception** nommée par la règle                            |
| `kernel/themes/index.js`                   | **Baril** — `ThemeApplierCore`, `ThemeLoader` et leurs types |
| `kernel/security/index.js` (`DOMSecurity`) | **Baril**                                                    |

Le reste passe par `utils/` : `utils/log`, `utils/i18n`, `utils/general/dom-helpers`,
`utils/general/geoleaf-global`. **Aucun accès direct à la carte** : la recomposition est faite par
le moteur. **Aucune référence à un plugin** — règle `no-plugin-in-core`.

### Frontière côté CSS

`install.ts` importe `./css/theme-selector.css` — la feuille entre dans le graphe de modules par
l'installeur, comme pour toutes les capacités.

⚠️ **L'en-tête de `install.ts` annonce que « le bundle Lite garde sa propre assignation
(`globals.ui-lite.ts`) ».** Ce fichier **n'existe pas** et le build Lite **non plus** — son retrait
est motivé sur place dans `packages/core/rollup.config.mjs`. Gisement complet versé au
registre.

---

## Écarts au CDC source

Le CDC `CDC_capacite-theme-selector.md` (v1.0.7, 10/07/2026) a été **consommé** en écrivant cette
fiche, puis **retiré du dépôt** — plus aucun fichier de ce nom n'y existe. La table ci-dessous est
donc désormais la seule trace de ses écarts, et c'est la raison pour laquelle elle cite l'énoncé
source _in extenso_ plutôt que d'y renvoyer.

| Énoncé du CDC                                                                                  | Ce que dit le code                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| « Gate **opt-out**, `configSchema {enabled}` défaut `true` »                                   | Le schéma annonce **`false`**, et le gate tardif teste `=== true` : c'est un **opt-in**. Corrigé après coup pour que le schéma décrive le runtime — voir §Le double gate         |
| `config.ts` → `getThemeSelectorConfig()` sur `DEFAULTS {enabled:true}`                         | **Ce fichier n'existe pas.** Le gate tardif lit `Config.get("modules")` sur place ; l'exemption est nommée dans `packages/core/__tests__/capabilities/scaffold-taxonomy.test.js` |
| `public-api.ts` → `buildPublicApi()` → façade `ThemeSelector`                                  | **Ce fichier n'existe pas non plus.** L'installeur monte l'orchestrateur directement, et il n'y a pas de façade ESM                                                              |
| Garde d'acceptation « activée **ET `themes.length > 0`** »                                     | La garde mesurée est **profil actif + les deux conteneurs**. Le cas « aucun thème » est couvert par le **rejet du chargement**, pas par un test de longueur                      |
| Accès au moteur par **seams** `_ThemeApplier` / `_ThemeLoader`                                 | **Import direct** du baril `kernel/themes/`. Le CDC l'a lui-même requalifié en v1.0.4 : le namespace ne porte qu'une copie superficielle divergente de l'applier                 |
| `ThemeEngineModule` deps `["geojson"]` (§5)                                                    | `["geojson", "ui"]` — déjà requalifié en v1.0.4 du CDC, et c'est ce qui rend l'invariant d'ordre robuste au retrait discuté ailleurs                                             |
| Façade montée dans `packages/core/src/globals/globals.ui.ts` **et** `globals.ui-lite.ts`       | Montée par `install.ts` → `registerGlobals`. `globals.ui-lite.ts` **n'existe pas**                                                                                               |
| §10 « Le sélecteur est présent en **Lite** », `boot-lite.ts`                                   | **Le build Lite n'a plus d'existence** — ni entrée, ni manifeste, ni fichier `*-lite`. Versé au registre                                                                         |
| Enregistrement inline dans `app/boot.ts`                                                       | Passe par l'installeur du manifeste de preset ; le module de cycle de vie vit **dans** la capacité                                                                               |
| CSS `css/components/_theme-selector.css` importée par `packages/core/src/css/geoleaf-main.css` | La capacité possède sa feuille et l'importe depuis `install.ts`                                                                                                                  |

Ce qui a été **retenu** du CDC et ne se lit pas dans le code : la décision de conception centrale
(découpler le chargement des couches du système de thème, et garder le moteur au kernel parce que
`geoleaf:theme:applied` est le signal central), l'exigence d'acceptation formulée par Mattieu
(sans thème ou sans capacité, pas de barre **mais les données s'affichent**), les pièges de
nommage voisins (le sélecteur de style par couche, le mode clair/sombre, les fonds de carte), et
les alternatives écartées de la table §Décisions.
