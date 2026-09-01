---
type: spec-capacite
title: profile-switcher — le sélecteur de profil de données, en tête du gestionnaire de couches
capability_id: profile-switcher
package: "@geoleaf/core"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 5535694b
date: 27 juillet 2026
---

# profile-switcher — le sélecteur de profil de données

**Type :** capacité in-core · **Code :** `packages/core/src/capabilities/profile-switcher/` ·
**Vérifié contre :** `5535694b` (27/07/2026)

> **Trois règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa
>    place. Cette fiche l'applique de façon particulièrement stricte : le CDC dont elle est issue
>    annonçait « 8 profils récoltés au build », il en reste deux.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.
> 3. **Un chemin cité sans racine se lit depuis le répertoire annoncé par « Code : » ci-dessus**,
>    ou depuis son `src/`, et à défaut depuis `packages/core/src/`. Un chemin qui commence par
>    `packages/`, `scripts/`, `profiles/`, `docs/`, `apps/` ou `e2e/` est relatif à la **racine du
>    dépôt**. Les cas qui échappent aux deux sont racinés sur place.

---

## Périmètre

### Ce que la capacité fait

Elle insère un `<select>` **en tête du gestionnaire de couches** qui permet de changer de **profil
de données** — le jeu de couches, la taxonomie, les thèmes et l'emprise — depuis l'interface,
sans URL à taper ni console. Le choix est **persisté** et retrouvé aux visites suivantes.

Un profil est l'unité de configuration métier de GeoLeaf. Le gestionnaire de couches répond déjà
à « quelles couches je regarde ? » ; le profil est la question d'un cran au-dessus.

### Ce qu'elle ne fait pas

- **Elle ne bascule pas à chaud** : changer de profil **recharge la page**. Voir §Décisions.
- **Elle ne découvre pas les profils** au runtime : la liste est **récoltée au build** par
  `scripts/build-deploy.cjs` et injectée dans `data.availableProfiles`. Un navigateur ne peut pas
  énumérer un répertoire serveur.
- **Elle ne résout pas le profil au boot** — c'est `app/boot-core.ts` qui arbitre les trois
  sources ; la capacité ne fait qu'**écrire** dans deux d'entre elles.
- **Elle ne s'affiche pas s'il n'y a qu'un profil** : une liste à une seule option annonce un
  choix qui n'existe pas.
- **Elle ne filtre pas les profils par droits** et **ne les édite pas** — hors périmètre, cela
  dépendrait du plugin `connector` et du futur Studio.
- **Elle ne met pas le profil dans le permalien** — chantier `permalink`, non instruit.

---

## Fonctionnalités

| ID    | Fonctionnalité                         | Entrée                                                            | Sortie observable                                                                                                      | Code                                                                  |
| ----- | -------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| PS-01 | Sélecteur inséré dans le panneau       | Seam `geoleaf:layer-manager:panel`, capacité activée, ≥ 2 profils | `.gl-profile-switcher` inséré **entre** le _header wrapper_ et le _body wrapper_ du gestionnaire                       | `lifecycle.ts` → `_injectInto`                                        |
| PS-02 | Rattrapage d'un panneau déjà construit | Panneau présent dans le DOM avant l'`init()` de la capacité       | Même insertion, sans attendre un prochain seam                                                                         | `lifecycle.ts` → `_injectIntoExistingPanel`                           |
| PS-03 | Insertion idempotente                  | Le seam refire (reconstruction du panneau)                        | Un seul sélecteur — la présence de la classe racine sert de marqueur                                                   | `lifecycle.ts` → garde `querySelector`                                |
| PS-04 | Seuil de deux profils                  | `data.availableProfiles` absent, non-tableau, ou < 2 entrées      | **Aucun** sélecteur, un `Log.debug` qui donne le compte, aucune erreur                                                 | `lifecycle.ts` → `_injectInto` ; `config.ts` → `getAvailableProfiles` |
| PS-05 | Libellé affiché                        | Entrées récoltées                                                 | `icon` + `displayLabel` quand l'icône existe, `displayLabel` seul sinon — posé en `textContent`                        | `profile-select.ts` → `createProfileSelect`                           |
| PS-06 | Reflet du profil actif                 | Profil actif connu à la construction                              | L'option correspondante est `selected`                                                                                 | `profile-select.ts` → `createProfileSelect`                           |
| PS-07 | Resynchronisation tardive              | Profil actif **inconnu** à la construction                        | Un écouteur `geoleaf:app:ready` **`{ once: true }`** repositionne la sélection                                         | `lifecycle.ts` + `profile-select.ts` → `syncProfileSelect`            |
| PS-08 | Nom accessible                         | —                                                                 | `aria-label` issu de `aria.profile_switcher.select` — WCAG 2.1 AA 4.1.2, aucun `<label>` visible n'étant attaché       | `profile-select.ts`                                                   |
| PS-09 | Re-sélection du profil actif inerte    | Choix de l'option déjà active                                     | Aucun rechargement                                                                                                     | `profile-select.ts` → écouteur `change`                               |
| PS-10 | Bascule de profil                      | `switchTo(id)` ou choix dans le `<select>`                        | Écriture dans les deux stockages, purge du cache du service worker, puis rechargement sur l'URL portant `?profile=&t=` | `profile-switch.ts` → `switchToProfile`                               |
| PS-11 | Purge du cache du service worker       | idem                                                              | `postMessage({ type: "CLEAR_CACHE" })` au contrôleur — **au mieux**, jamais attendu                                    | `profile-switch.ts` → `_clearServiceWorkerCache`                      |
| PS-12 | Rejet d'un identifiant forgé           | `switchTo("../etc")`                                              | Refus journalisé, **aucune écriture de stockage, aucune navigation**                                                   | `profile-switch.ts` → `PROFILE_ID_RE`                                 |
| PS-13 | Navigation privée tolérée              | `localStorage` indisponible                                       | La bascule fonctionne quand même pour ce chargement (via `sessionStorage`), sans être mémorisée                        | `profile-switch.ts`                                                   |
| PS-14 | Entrées malformées écartées            | `data.availableProfiles` édité à la main                          | Les entrées sans `id` chaîne non vide sont filtrées, les autres restent                                                | `config.ts` → `getAvailableProfiles`                                  |
| PS-15 | Démontage complet                      | `ProfileSwitcherModule.destroy()` / `_reset()`                    | Écouteur du seam détaché **et** tous les nœuds `.gl-profile-switcher` retirés du document                              | `lifecycle.ts` → `_reset`                                             |
| PS-16 | Déclaration introspectable             | —                                                                 | `getAllCapabilities()` la liste, `getCapabilitySchema("profile-switcher")` rend son schéma sans `loader`               | `profile-switcher-capability.ts`                                      |

Les tests qui couvrent ces lignes : `packages/core/__tests__/capabilities/profile-switcher/` —
dont un test qui vérifie que **le kernel émet réellement le seam**, un qui vérifie que
l'installer est **appendu** après les capacités préexistantes du manifeste, et
`packages/core/__tests__/capabilities/profile-switcher/profile-harvest.guard.test.ts`, qui ne teste pas la capacité mais **ce dont PS-04 dépend** : la
récolte lue sur le disque, dérivée du disque et jamais écrite en dur (voir §Configuration).

---

## Configuration

### Bloc de la capacité

| Paramètre | Type      | Défaut  | Où c'est lu                                                                                                |
| --------- | --------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| `enabled` | `boolean` | `false` | `config.ts` → `getProfileSwitcherConfig()` ; **décide de la visibilité** dans `lifecycle.ts` (gate tardif) |

Le bloc vit à la **racine** (`profiles/geoleaf.config.json`), pas dans un profil : un sélecteur
qui disparaîtrait selon le profil affiché serait un piège — on ne pourrait plus revenir.

⚠️ **Double gate, comme [`theme-toggle`](theme-toggle.md)** : `enableWhenAbsent: true` ne concerne
que **l'enregistrement du module** avant fusion, pour qu'un opt-in tardif reste possible ; le
**défaut destiné à l'intégrateur est OFF** et c'est le gate tardif du cycle de vie qui décide de la
visibilité. Le CDC source annonçait `enableWhenAbsent: false` — voir §Écarts au CDC.

### Données consommées, non configurées — `data.availableProfiles`

`config.ts` lit **deux choses sans rapport**, délibérément : le bloc de la capacité (_comment_ le
sélecteur se comporte) et `data.availableProfiles` (_quels_ profils existent).

`data.availableProfiles` est **généré**, jamais écrit à la main :
`scripts/build-deploy.cjs` parcourt `profiles/`, ignore `schemas/` et tout répertoire préfixé `_`,
et pour chaque profil restant lit son `profile.json` — `profiles/<profil>/profile.json`, un fichier
**par profil** — pour en récolter :

| Champ          | Origine                                                       |
| -------------- | ------------------------------------------------------------- |
| `id`           | Le nom du répertoire du profil                                |
| `displayLabel` | `displayLabel` du `profile.json`, sinon `label`, sinon l'`id` |
| `icon`         | `icon` du `profile.json` — omis s'il est absent               |

Un `profile.json` illisible **n'est jamais ignoré en silence** : la récolte émet un avertissement
nommant le profil exclu, parce qu'un profil absent de la liste est un profil que l'utilisateur ne
peut plus atteindre, et que rien d'autre dans le pipeline ne le signalerait.

⚠️ **Le seuil de deux profils N'EST PLUS « frôlé » : il est TOMBÉ, le 10/08/2026.** Cette ligne a
dit « aujourd'hui frôlé » du 27/07 au 10/08/2026, et la mesure la dément depuis la sortie du profil
client du dépôt (`f218691e`). Le compte se mesure, il ne se recopie pas —
`ls profiles/ | grep -v '^schemas$' | grep -v '^_' | grep -v '\.'`, plus
`data.availableProfiles` du config racine livré. **Le sélecteur ne se rend donc plus dans les
variantes livrées, et c'est PS-04 qui s'applique : une dégradation volontaire, pas une erreur.**
Le tenir pour un défaut du code est l'erreur que ce paragraphe existe pour empêcher — mesuré le
10/08 : dès qu'une seconde entrée est servie, le contrôle se monte à la bonne place avec la bonne
valeur, sans qu'une ligne de la capacité n'ait bougé.

✅ **Et « sans qu'aucune gate ne rougisse » n'est plus vrai depuis le 10/08/2026**.
Une garde unitaire — donc sur le chemin PAR DÉFAUT, « Unit tests » et « Coverage gate » —
affirme que **la récolte est sans perte** :
`packages/core/__tests__/capabilities/profile-switcher/profile-harvest.guard.test.ts`. Elle rougit
si un `profile.json` devient illisible (**PH-02**), si la récolte tombe à zéro (**PH-01**), ou si
une entrée récoltée ne survit pas au filtre runtime de `getAvailableProfiles` (**PH-03**), et son
témoin inverse (**PH-04**) éprouve les deux mécanismes sur un arbre synthétique.

⚠️ **Ce qu'elle ne fait PAS, et qu'il ne faut pas lui prêter** : elle **n'exige pas deux profils**.
Livrer un second profil est une décision produit ; une garde en `≥ 2` imposerait cet arbitrage au
lieu de mesurer une dégradation. Son plancher est **1**. La visibilité effective du sélecteur reste
donc éprouvée par le seul `e2e/24-profile-switcher.spec.js`, **hors chemin par défaut** — et ce
spec porte depuis le 10/08 une précondition mesurée sur la variante servie, qui le fait sauter en
dessous de deux profils **et se réarmer tout seul** au-dessus.

---

## Contrat exposé

### API publique

`GeoLeaf.ProfileSwitcher`, construit par `public-api.ts` → `buildPublicApi()`, monté par
`install.ts` → `registerGlobals(gl)`, re-exporté par la façade ESM
`src/api/geoleaf.profile-switcher.ts` (sans logique — gate `scripts/check-facade-purity.cjs`).

| Membre         | Rend / fait                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| `list()`       | Les profils récoltés (`[]` si aucun — application servie depuis les sources, sans étape de déploiement) |
| `current()`    | L'identifiant du profil actif, ou `null` avant chargement de la configuration                           |
| `switchTo(id)` | Persiste, purge le cache du service worker, recharge — **valide l'identifiant d'abord**                 |
| `isEnabled()`  | `true` quand `modules.profile-switcher.enabled === true`                                                |
| `getConfig()`  | Le bloc `modules.profile-switcher` fusionné sur les défauts                                             |

`current()` passe par `getGeoLeaf()?.Config?.getActiveProfileId()` en accès **défensif** : la
capacité ne suppose ni que le namespace est monté, ni que la façade porte la méthode.

Typage publié : `src/global.d.ts`, section des capacités (`ProfileSwitcher?:` →
`ProfileSwitcherPublicApi`). Ne pas citer de numéro de ligne pour ce fichier.

### Événements

| Événement                     | Sens                         | Rôle                                                                                        |
| ----------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------- |
| `geoleaf:layer-manager:panel` | **écouté** (seam kernel)     | Porte le conteneur, le _main wrapper_ et le _header wrapper_ vivants — le point d'insertion |
| `geoleaf:app:ready`           | **écouté**, `{ once: true }` | Seulement quand le profil actif n'était pas encore connu : resynchronise la sélection       |

La capacité **n'émet aucun événement**.

⚠️ `geoleaf:layer-manager:panel` est un **`CustomEvent` brut**, pas un événement du bus GeoLeaf :
son `detail` transporte des `HTMLElement` vivants, que le bus assainissant (JSON seul, aucune
référence DOM) ne peut pas véhiculer. Le seam lui-même est kernel —
`kernel/layer-manager/panel-seam.ts` — et son en-tête énonce l'obligation d'idempotence des
abonnés, parce qu'il refire à chaque reconstruction du contrôle.

### Stockage écrit

| Clé                                     | Portée       | Rôle                                                                            |
| --------------------------------------- | ------------ | ------------------------------------------------------------------------------- |
| `sessionStorage["gl-selected-profile"]` | **one-shot** | Consommée par `app/boot-core.ts` au chargement suivant (lue **puis supprimée**) |
| `localStorage["gl-profile"]`            | durable      | La préférence, restaurée aux visites ultérieures (`PROFILE_STORAGE_KEY`)        |

Les deux clés sont **déclarées une seule fois**, dans `kernel/shared/profile-storage-keys.ts`
(ré-exportées par le baril) : elles ont deux écrivains de part et d'autre de la frontière
app/capacité, et une copie qui dérive ne casse pas — elle fait cesser le boot de voir le choix,
en silence. `profile-switch.ts` ré-exporte `PROFILE_STORAGE_KEY` pour ses consommateurs.

L'ordre de résolution au boot appartient à `app/boot-core.ts` : `sessionStorage` (one-shot),
puis `localStorage`, puis `data.activeProfile` du JSON. Les deux sources de stockage passent par
la même validation d'identifiant — le stockage est modifiable par l'utilisateur, donc une valeur
forgée ne doit jamais atteindre un chemin de `fetch`.

**Le contrat `sessionStorage` est prioritaire pour une raison mesurable** : plusieurs specs E2E
l'écrivent pour forcer un profil (`e2e/08-realtime.spec.js`, `e2e/16-flatgeobuf.spec.js`,
`e2e/vn-profiles-boot.spec.js`, `e2e/helpers/boot.js`). Le garder prioritaire **et** one-shot
préserve ce contrat tout en servant de canal « forcer sans ancrer ».

---

## Décisions de conception

| Décision                                                    | Pourquoi                                                                                                                                                                                                                              | Alternative écartée                                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Liste récoltée au build**, pas au runtime                 | Un serveur HTTP ne renvoie pas d'index de répertoire, et ne doit pas. La récolte se greffe sur la boucle qui **copie déjà** les profils : les deux deviennent impossibles à désynchroniser                                            | Une liste maintenue à la main — elle dérive de `profiles/` la première fois que quelqu'un oublie              |
| **Bascule = rechargement de page**                          | Un profil redéfinit couches, taxonomie, thèmes et emprise ; un échange à chaud demanderait de démonter et rebâtir tout le pipeline GeoJSON, pour un gain nul                                                                          | Le remplacement à chaud                                                                                       |
| **Injection par seam**, jamais par import                   | Le kernel ne doit pas importer une capacité. Patron déjà éprouvé par `geoleaf:layer-item:controls` (labels) et `geoleaf:desktop-panel:tabs-ready` (share)                                                                             | Un import direct du gestionnaire de couches vers la capacité — aurait épinglé le code dans toutes les entrées |
| **Insertion entre header et body**, jamais dans le body     | `renderSections()` **vide** le conteneur du corps à chaque rendu : un sélecteur monté là disparaîtrait au premier basculement de couche. C'est une contrainte dure, écrite dans le seam lui-même                                      | L'insertion dans le corps du panneau                                                                          |
| **Abonnement vivant + scan de rattrapage**                  | Le gestionnaire peut être construit avant **ou** après l'`init()` de la capacité, et il est reconstruit sur un cycle destroy → recreate. Un seul des deux mécanismes laisserait un cas à découvert                                    | Le seul abonnement (rate un panneau déjà construit) ou le seul scan (rate les constructions ultérieures)      |
| **Deux stockages, deux rôles**                              | `sessionStorage` est un contrat existant que des specs E2E écrivent ; `localStorage` est la préférence durable, nouvelle. Les confondre casserait l'un ou perdrait l'autre                                                            | Un seul stockage                                                                                              |
| **`_reset()` interroge tout le document**                   | Le sélecteur vit dans un conteneur que la capacité ne possède pas ; sa classe racine n'appartient qu'à elle, donc rien d'autre ne peut correspondre. Retirer le nœud libère aussi son écouteur `change`                               | Une portée limitée au conteneur mémorisé — inopérante si le panneau a été reconstruit entre-temps             |
| **Rendu conditionné à ≥ 2 profils**                         | Une liste à une seule option annonce un choix qui n'existe pas                                                                                                                                                                        | Toujours afficher                                                                                             |
| **Classes CSS écrites en littéraux**, jamais composées      | purgecss lit les sources **statiquement** : un nom qu'il ne peut pas lire comme littéral est déclaré règle morte et **la règle est retirée du CSS de production**. Le contrôle s'afficherait sans style, tous les tests restant verts | `` `${ROOT}__select` `` — élégant, et invisible à purgecss                                                    |
| **Champs `displayLabel` / `icon` additifs**                 | Les `label` existants sont techniques et hétérogènes ; les réécrire risquait de casser un affichage ailleurs. Un champ dédié est additif et réversible, avec repli en cascade                                                         | Réécrire les `label`                                                                                          |
| **Purge du cache du service worker au mieux, non attendue** | Une page sans service worker, ou dont le worker ne répond jamais, doit tout de même recharger                                                                                                                                         | Attendre l'acquittement                                                                                       |
| **Style aligné sur le sélecteur de style de couche**        | Ce sont les deux seuls `<select>` du panneau ; un visiteur doit les lire comme un même type de contrôle. Les jetons de thème portent leurs propres replis, pour rester lisibles si une palette en omet un                             | Un style propre                                                                                               |
| Pas de `loader`                                             | Inline avec le bundle UI ; le gate de configuration décide                                                                                                                                                                            | Un `import()` paresseux                                                                                       |

---

## Dépendances et frontières

### Dépendance de cycle de vie

`module.ts` → `ProfileSwitcherModule` : `id = "profile-switcher"`,
`dependencies = ["geojson"]` — pour que l'`init()` passe **avant** le premier tir possible du seam
du gestionnaire de couches. `init()` **n'utilise pas la carte** : le contrôle vit dans le panneau,
atteint par le seam, pas sur la carte.

Position dans `presets/manifest.full.ts` : **appendue en dernier** au moment de son ajout, et un
test le vérifie. L'ordre d'enregistrement est observable par introspection et le golden master
l'affirme — appendre laisse tous les index antérieurs intacts.

### Frontière `capabilities/` → `kernel/` (règle ESLint R.8)

| Import                                                     | Statut vis-à-vis de R.8                          |
| ---------------------------------------------------------- | ------------------------------------------------ |
| `kernel/config/config-primitives.js`                       | **Exception** nommée par la règle                |
| `kernel/config/geoleaf-config/config-types.js` (type seul) | **Hub de types** — exception nommée par la règle |
| `kernel/layer-manager/panel-seam.js` (type seul)           | **Seam** — exception nommée par la règle         |

Les trois accès kernel de cette capacité tombent donc dans les trois exceptions que la règle
énumère explicitement — et c'est le cas d'école : un seam est la forme prévue pour une dépendance
inversée. Le reste passe par `utils/` : `utils/log`, `utils/i18n`,
`utils/general/dom-helpers` (`domCreate`), `utils/general/geoleaf-global` (`getGeoLeaf`).

### Le seam est kernel, la capacité n'est pas importée

`kernel/layer-manager/panel-seam.ts` est **du kernel** : c'est lui qui émet, depuis la
construction de la structure du gestionnaire de couches. Le kernel ne connaît donc aucun abonné.
C'est le mécanisme qui permet à la capacité d'être entièrement retirable :
**ni le JS ni le CSS n'entrent dans le graphe** si une entrée ne liste pas son installer.

**Aucune référence à un plugin** — règle `no-plugin-in-core`, vérifiée par
`scripts/verify-core-standalone.cjs`.

### Un point de couplage avec le déploiement

Cette capacité est la seule des quatre premières fiches à dépendre d'une **étape de build** :
sans passage par `scripts/build-deploy.cjs`, `data.availableProfiles` est absent et le sélecteur ne
s'affiche pas. Ce n'est pas un défaut, c'est la dégradation prévue (PS-04) — mais c'est à savoir
quand on sert l'application directement depuis les sources.

---

## Écarts au CDC source

Le CDC `CDC_capacite-profile-switcher.md` (v1.0.0, 25/07/2026) a été **consommé** en écrivant cette
fiche, puis retiré du dossier de tri — trace au §Journal des décisions de
la refonte documentaire V3. Ce qu'il
disait et que le code contredit est consigné ici plutôt que perdu :

| Énoncé du CDC                                                                   | Ce que dit le code                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Décision 3 — gate opt-in avec **`enableWhenAbsent: false`**                     | `enableWhenAbsent: **true**` — enregistrement seul, plus un gate tardif sur la configuration fusionnée. La **sémantique** visible est bien opt-in ; le **mécanisme** est celui de `theme-toggle` version double gate |
| « **8 profils** récoltés au build »                                             | Six profils de démonstration supprimés le 27/07/2026, puis le profil client sorti du dépôt le 10/08/2026. Le compte se mesure, il ne se recopie pas — et le seuil de PS-04 est **franchi** depuis cette date         |
| « Profils : `tourism`, `france-rail`, `guyane-biodiversite`… »                  | `france-rail` et `guyane-biodiversite` n'existent plus                                                                                                                                                               |
| « `verify-facade-purity`, **26 façades** conformes aujourd'hui »                | Chiffre périmé, et de la classe qu'il ne faut pas recopier. La gate est `scripts/check-facade-purity.cjs`, son décompte est celui qu'elle imprime                                                                    |
| Seuils de couverture cités en clair (`90/88/88/79`)                             | Les seuils vivent dans `packages/*/vitest.config.ts` et **cliquettent vers le haut** ; les recopier ici les périmerait au prochain sprint                                                                            |
| Références à des numéros de ligne (`boot-core.ts:144`, `render-sections.ts:74`) | L'ordre de résolution et la remise à zéro du corps du panneau sont **exacts** ; seules les lignes ne sont pas reprises, elles se déplacent                                                                           |

Ce qui a été **retenu** du CDC et ne se lit pas dans le code : les cas d'usage (démonstration
client, application multi-territoires, recette), l'origine de la capacité — le sprint T1b a
supprimé `packages/core/demo/`, qui portait ce sélecteur, **sans migration**, et cette capacité
le réintroduit —, et les alternatives écartées de la table §Décisions de conception.
