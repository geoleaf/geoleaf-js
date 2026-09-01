---
type: spec-plugin
title: offline-ui — l'interface du hors-ligne, sur un moteur qu'elle ne contient pas
plugin_id: offline-ui
package: "@geoleaf-plugins/offline-ui"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 1d0f5312
date: 1er septembre 2026
---

# offline-ui — l'interface du hors-ligne, sur un moteur qu'elle ne contient pas

**Type :** plugin publié · **Paquet :** `@geoleaf-plugins/offline-ui` ·
**Code :** `packages/plugins/offline-ui/` · **Vérifié contre :** `1d0f5312` (01/09/2026) — ⚠️ cette ligne portait `1a8f7137` (28/07/2026),
dix jours plus tôt que le frontmatter.

> **Trois règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.
> 3. **Un chemin cité sans racine se lit depuis le répertoire annoncé par « Code : » ci-dessus**,
>    ou depuis son `src/`, et à défaut depuis `packages/core/src/`. Un chemin qui commence par
>    `packages/`, `scripts/`, `profiles/`, `docs/`, `apps/` ou `e2e/` est relatif à la **racine du
>    dépôt**. Les cas qui échappent aux deux sont racinés sur place.

> ⚠️ **Ce plugin ne contient PAS le moteur hors ligne.** Il pilote celui du core — capacité
> `offline`, fiche [`offline.md`](../capacites/offline.md) — au travers de la seule façade
> `GeoLeaf.Storage`, posée par `packages/core/src/kernel/storage/facade.ts`. **Il ne monte donc
> aucun namespace propre**, ce que sa ligne `namespace` écrit `—` et que §Le plugin sans façade
> motive. Sans la capacité `offline` activée, toute cette interface est **inerte** — et elle le
> détecte, plutôt que d'attendre indéfiniment.

---

## Périmètre

### Ce que le plugin fait

Il donne les **surfaces** du hors-ligne : un bouton, une fenêtre de gestion du cache, un sélecteur
de couches à télécharger, l'état d'occupation, et un panneau de synchronisation.

### Ce qu'il ne fait pas

- **Il ne télécharge rien lui-même.** Il appelle le gestionnaire de cache du core.
- **Il ne monte aucun namespace.** Ni `public-api.ts`, ni façade — voir la section dédiée.
- **Il ne lit aucun bloc de profil qui lui soit propre.** Pas de `config.ts` : il lit des clés du
  core, ponctuellement. La table de configuration du système est dans
  [`offline.md`](../capacites/offline.md), et **elle n'est pas dupliquée ici**.
- **Il ne rejoue pas la file de synchronisation.** Il récupère le gestionnaire déposé par
  [`editor`](CDC_editor.md) et le déclenche.

---

## Manifeste d'enregistrement

Ce que `src/entry.ts` déclare réellement. **Table gatée** par
`packages/core/__tests__/guards/doc-plugin-manifest.guard.test.js`.

| Champ        | Valeur                                                  |
| ------------ | ------------------------------------------------------- |
| `name`       | `offline-ui`                                            |
| `label`      | `Offline UI (cache button, layer selector, sync panel)` |
| `requires`   | `[]`                                                    |
| `optional`   | `["editor"]`                                            |
| `namespace`  | `—`                                                     |
| `paquet npm` | `@geoleaf-plugins/offline-ui`                           |

⚠️ **`requires` vaut `[]` parce que la clé est ABSENTE de `entry.ts`, pas parce qu'elle y vaut
`[]`.** Les deux sont indiscernables à l'exécution : le registre normalise le champ optionnel en
tableau obligatoire, et l'activation n'itère que le stocké. La table dit ce que le **registre**
porte. Même cas qu'[`editor`](CDC_editor.md).

⚠️ **Et l'absence n'est surtout pas « aucune dépendance ».** Ce plugin a la dépendance la plus
**dure** du dépôt : sans la capacité in-core `offline`, il n'a rien à piloter. Elle n'est simplement
pas de la sorte que `requires` sait nommer — ce champ désigne des **plugins**, et une capacité du
core n'y est pas adressable. Le plugin exprime donc cette dépendance là où elle est vérifiable :
dans son `healthCheck`, qui interroge `GeoLeaf.Storage`.

⚠️ **`optional: ["editor"]` est EXACT**, et il était le **seul** juste des cinq manifestes qui en
déclarent un. ⚠️ Il citait `addpoi` jusqu'à la fusion : le gestionnaire `"poi"` n'a pas
changé d'identifiant, il a changé de **fournisseur**. Le plugin va bien chercher le gestionnaire
`poi` déposé par `editor`, et se passe de
lui quand il est absent. Les quatre autres pointaient vers `storage` — c'est-à-dire vers **ce
plugin-ci**, qu'ils désignaient tous du mauvais nom. Corrigés le 29/07/2026, et la classe
est **fermée par une gate** : tout identifiant cité doit désigner un plugin réellement enregistré.

---

## Le plugin sans façade — et pourquoi une coquille aurait été pire

**Il ne monte aucun namespace, et c'est une décision, pas un oubli.** Son `entry.ts` l'écrit ; le
dépôt l'inscrit à deux endroits qui le lisent :

- `packages/core/__tests__/_helpers/no-own-namespace.js` — l'entrée nommée, son motif, la surface
  qu'il pilote (`GeoLeaf.Storage`) et qui la pose
  (`packages/core/src/kernel/storage/facade.ts`) ;
- deux gardes lisent cette **même** entrée — celui des namespaces déclarés, et celui de cette fiche.

⚠️ **L'exemption est FALSIFIABLE, et c'est ce qui la distingue d'une dispense de complaisance.** Le
garde propriétaire vérifie que le plugin **atteint vraiment** la surface qu'il déclare piloter, et
que le fichier qui la pose **existe**. Un plugin qui aurait simplement oublié sa façade ne pilote
rien : il ne peut pas satisfaire ces deux assertions.

⚠️ **Créer un `public-api.ts` vide pour « entrer dans la gate » aurait été un mensonge de
structure** : le fichier annoncerait une façade là où il n'y a rien à exposer, et la gate le
validerait. Le garde refuse donc explicitement ce contournement — il vérifie **aussi** qu'un plugin
exempté ne porte pas de `public-api.ts`.

⚠️ **Et monter `GeoLeaf.OfflineUI = { …Storage }` aurait été pire encore** : cela créerait une
**seconde poignée** sur un singleton du core — exactement le défaut que son adaptateur documente
avoir corrigé, voir §La seule voie.

**Ce que le plugin expose tout de même** : des **types**, ré-exportés par son entrée. Et
`GeoLeaf.UI.CacheButton`, écrit par son module de bouton et relu par son enregistrement de barre
d'outils — un aller-retour **interne**, pas une API publique.

---

## La seule voie vers le core — un adaptateur, pas un import

`src/shared/storage-contract.ts` est le **point de passage unique** vers le moteur. Il résout
`GeoLeaf.Storage` sur le global, et expose ses membres par des **accesseurs** — jamais par des
valeurs capturées.

⚠️ **Pourquoi un adaptateur plutôt qu'un import du contrat du core.** Le plugin importait auparavant
ce contrat directement. Or un plugin chargé comme module a **son propre graphe de modules** : la
copie qu'il embarquait n'était **jamais initialisée**. `isAvailable()` rendait `false` pour toujours,
l'attente ne se résolvait jamais, et **toute l'interface hors ligne était morte dans le paquet
livré** — sans erreur, sans trace. C'est ce défaut qui a fait ajouter à la façade du core les deux
délégations dont l'adaptateur se sert aujourd'hui.

⚠️ **Les membres sont des accesseurs, pas des captures.** Le moteur est injecté **tard**, par import
dynamique : capturer `Storage.DB` à l'import du plugin donnerait `undefined` pour toujours.

### La détection de disponibilité ne pend jamais

`src/core/engine-ready.ts` mesure l'état dans cet ordre :

1. le moteur est-il déjà là → **oui**, on continue ;
2. sinon, la configuration active-t-elle `offline` **et** `pwa` → **non**, on rend `false`
   **immédiatement** ;
3. sinon, on attend le signal de disponibilité.

⚠️ **La deuxième marche est ce qui empêche l'attente infinie.** Sans elle, une interface sur un
profil qui n'active pas le hors-ligne attendrait un signal qui ne viendra jamais. La condition est le
**miroir exact** du gate du cycle de vie de la capacité.

---

## Fonctionnalités

| ID    | Fonctionnalité                                       | Entrée                                                   | Sortie observable                                                                                           | Code                                                           |
| ----- | ---------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| OU-01 | Bouton de cache, deux surfaces                       | Barre mobile et bandeau de bureau                        | **Invisible par défaut** — il faut l'activer par profil                                                     | `ui/cache-button/toolbar-registration.ts`                      |
| OU-02 | Fenêtre de gestion du cache                          | Clic sur le bouton                                       | État, quota, actions                                                                                        | `ui/cache-button/modal-manager.ts`, `cache/cache-control-*.ts` |
| OU-03 | Sélecteur de couches à télécharger                   | Profil actif                                             | Une ligne par couche, avec son état de cache — quelle que soit sa PROVENANCE, voir sous la table            | `cache/layer-selector/`                                        |
| OU-04 | Sélection persistée entre sessions                   | Choix de l'utilisateur                                   | Relue au chargement suivant, par le cache du core                                                           | `cache/layer-selector/selection-cache.ts`                      |
| OU-05 | Estimation d'une zone de tuiles vectorielles         | Emprise et niveaux                                       | Un volume annoncé avant de télécharger                                                                      | `sync/vector-zone-estimate.ts`                                 |
| OU-06 | Suivi de progression                                 | Signaux du core                                          | Remplissage et vidage suivis séparément                                                                     | `cache/cache-control-events.ts`                                |
| OU-07 | Annulation d'un téléchargement                       | Bouton d'annulation                                      | Relayée au gestionnaire du core                                                                             | `cache/cache-control-state.ts`                                 |
| OU-08 | Purge du cache d'un profil                           | Action de vidage                                         | Avec confirmation, et progression                                                                           | `cache/download-handler.ts`                                    |
| OU-09 | Panneau de synchronisation                           | File en attente                                          | Liste, déclenchement, et résultat                                                                           | `sync/sync-manager.ts`                                         |
| OU-10 | Rejeu par le gestionnaire d'un autre plugin          | `Sync.getHandler("poi")`                                 | Le plugin déclenche ce qu'[`editor`](CDC_editor.md) a déposé — sans jamais l'importer                       | `core/sync-seam.ts`                                            |
| OU-11 | Export de la file en attente                         | Action d'export                                          | Lue depuis la base du core, puis vidée entrée par entrée                                                    | `ui/cache-button/export-logic.ts`                              |
| OU-12 | Détection de disponibilité sans attente infinie      | Profil sans hors-ligne                                   | Rend `false` tout de suite — voir §La seule voie                                                            | `core/engine-ready.ts`                                         |
| OU-13 | Sélecteur de zone de téléchargement, **trois** modes | Vue courante · emprise du profil · corridor d'itinéraire | Une emprise et un plafond de zoom persistés dans la sélection sauvegardée                                   | `cache/cache-control-zone.ts`                                  |
| OU-14 | Corridor d'un itinéraire persisté                    | Tracé lu dans le magasin `routes` de la base du core     | Un corridor estimé, **ou un refus qui nomme ses deux leviers** — plafond de zoom et tampon, avec leur effet | `cache/corridor-selection.ts`, `sync/corridor-tiles.ts`        |

```callout info label="OU-03 — une couche vaut une couche, quelle que soit la PROVENANCE de sa config"
Une couche déclare sa configuration de **deux** façons : par un fichier (`configFile`) ou en ligne
(`inlineConfig`, ce que `expandLayerTemplates` produit pour chaque instance de `layerTemplates`).
**Le sélecteur doit être indifférent aux deux**, et c'est une propriété gardée —
`src/__tests__/templated-layer-selector.guard.test.ts`, qui compare systématiquement une couche
en ligne à une couche à fichier servant de témoin.

🛑 **Elle ne l'était pas, et le défaut a vécu jusqu'au 07/08/2026.** Les trois sites du
sélecteur branchaient sur `configFile` seul : mesuré en navigateur sur `tourism`, les 42 couches
apparaissaient mais les **24 templatées** se rendaient avec leur identifiant technique à la place
du libellé, sans style et **sans sélecteur de style** — et leur état de cache était **toujours
faux**, `searchUrls` restant vide. Corrigé aux trois sites ensemble ; après correctif, 0 des 24.

⚠️ **La cause racine était dans le CORE, pas ici** : `inlineConfig` était la seule forme de config
dont le chemin de données ne se dérivait qu'avec `layerDataPath`, helper interne au core que ce
plugin n'a pas le droit d'importer. C'est `expandLayerTemplates` qui normalise désormais `dataFile`.
Un correctif purement local aurait dû redériver ce chemin ici — deuxième endroit libre de diverger.

✅ **Et la colonne géométrie est réparée du même jour, pour une cause DISTINCTE** — elle
affichait `-` sur 38 des 42 lignes, **dont 14 des 18 couches directes**, ce qui prouvait que
l'`inlineConfig` n'y était pour rien. Deux défauts empilés : `getLayerGeometryType` lisait
`geometryType` seul, alors que le schéma en fait un **alias de `geometry`** (ANO-007) que 18 des
24 configs ne déclarent pas ; et la table i18n de la cellule était keyée sur le vocabulaire
**GeoJSON** quand les configs portent le vocabulaire **profil**, donc elle ne traduisait jamais
rien. La résolution de l'alias vit maintenant en **un seul endroit** pour tout le dépôt —
`packages/core/src/kernel/config/layer-geometry.ts`, publié au `exports` du core.
```

Les tests qui couvrent ces lignes : `packages/plugins/offline-ui/src/__tests__/`, dont une
sous-suite `integration/` qui vérifie la jonction avec le core, **plus une suite sur le paquet
construit** (`vitest.bundle.config.ts`, script `test:bundle`) — ce que seuls **ce plugin et le
core** portent. ⚠️ Cette phrase citait [`editor`](CDC_editor.md) : il n'a **ni**
`vitest.bundle.config.ts` **ni** script `test:bundle`. Le relevé se dérive, il ne se recopie pas :
`grep -l '"test:bundle"' packages/*/package.json packages/plugins/*/package.json`.

---

## Configuration

**Aucun `config.ts`, et un seul bloc propre : sa clé de visibilité.** Le plugin déclare
`modules.offline-ui.showButton` comme clé **canonique** de son bouton, dans la définition de slot de
`ui/cache-button/toolbar-registration.ts`, avec `ui.showCacheButton` en **repli** ; c'est le core
qui les lit, dans cet ordre (`kernel/ui/ui-slot-builder.ts`). Pour tout le reste il lit des clés du
**core**, au moment de s'en servir : le gate du hors-ligne, celui de l'ouvrier de service, l'option
de cache des tuiles, le profil actif et son chemin de base, et les fonds de carte. La liste exacte
se dérive : `grep -rn "coreConfigGet" packages/plugins/offline-ui/src/ --include=*.ts`.

🛑 **Rupture assumée du 24/08/2026 — la clé héritée ne coupe plus la capture de carte.**
`ui/cache-button/button-control.ts` ne rend plus aucun bouton depuis le passage à la barre d'outils :
il ne fait que **capturer** la carte réelle pour la fenêtre de cache. Il lisait pourtant encore
`ui.showCacheButton` et rendait `null` sur `false`. Le profil pervers `showButton: true` +
`showCacheButton: false` affichait donc un bouton **visible** au-dessus d'une fenêtre dont les
sous-modules recevaient `null` de `getMap()`. La capture est désormais inconditionnelle ; la
visibilité appartient au slot seul. Un profil qui posait la clé héritée à `false` ne perd rien : il
gagne une fenêtre fonctionnelle derrière un bouton que le slot masque toujours.

➡️ **La table de configuration du système est dans [`offline.md`](../capacites/offline.md), et elle
n'est pas dupliquée ici.** C'est le partage de propriété entre les deux fiches : la capacité possède
la configuration et les signaux **émis**, le plugin possède les surfaces et les signaux **écoutés**.

---

## Contrat exposé

### Internationalisation — l'espace et le préfixe des clés DIFFÈRENT

Le dictionnaire est enregistré sous l'espace **`offline-ui`**, mais **toutes ses clés portent le
préfixe `storage.`**. Ce n'est pas une incohérence laissée en place : c'est une **surface de
surcharge** que des profils livrés utilisent déjà, et la renommer les casserait sans avertissement.
Le motif est écrit dans `entry.ts`.

### Événements écoutés

Le vocabulaire du plugin est centralisé dans une constante unique (`cache/cache-control-types.ts`) —
ce qui évite que deux écouteurs du même paquet ne divergent sur une chaîne.

| Signal                           | Émetteur                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `geoleaf:cache:completed`        | La capacité [`offline`](../capacites/offline.md)                                                         |
| `geoleaf:cache:cleared`          | idem                                                                                                     |
| `geoleaf:cache:progress`         | idem                                                                                                     |
| `geoleaf:cache:clear-progress`   | idem                                                                                                     |
| `geoleaf:profile:loaded`         | Le core, hors de la capacité                                                                             |
| `geoleaf:cache:cancelled`        | La capacité [`offline`](../capacites/offline.md) — `CacheManager.cancelDownload()`, depuis le 03/08/2026 |
| `geoleaf:storage:quota-exceeded` | La capacité [`offline`](../capacites/offline.md) — écouté par `core/engine-signals.ts`                   |
| `geoleaf:toolbar:action`         | Le kernel                                                                                                |

⚠️ **L'inventaire se dérive, il ne se recopie pas.** Ce que la capacité émet :
`grep -rn "dispatchEvent\|CustomEvent(" packages/core/src/capabilities/offline/ --include=*.ts | grep -o "geoleaf:[a-z:-]*" | sort -u`.
Ce que ce plugin écoute :
`grep -rn "addEventListener\|events.on(" packages/plugins/offline-ui/src/ --include=*.ts | grep -o "geoleaf:[a-z:-]*" | sort -u`.

Un seul signal de la capacité n'a pas d'écouteur **ici**, `geoleaf:cache:evicted`, et c'est
délibéré : son écouteur a été **remonté dans le core** le 16/08/2026
(`packages/core/src/kernel/storage/eviction-notice.ts`) parce qu'il était le seul du dépôt — sur
`deploy-core`, qui n'embarque pas ce plugin, l'alerte partait dans le vide. Le rétablir ici
afficherait deux notices sur `deploy-full`. **L'utilisateur est donc bien informé de l'éviction**,
sur toutes les variantes et non sur les seules qui portent cette interface.

🛑 **`geoleaf:cache:cancelled` — le verdict « il l'écoute pour rien » est RENVERSÉ, et il l'était
déjà quand cette fiche a été vérifiée.** Le 02/08/2026 la mesure était juste : deux poses
d'écouteur, zéro émetteur. Le **03/08/2026** le chantier de cache a tranché dans l'autre sens — ce
n'était pas un écouteur mort mais un **bug** : sans émission, annuler un téléchargement laissait le
panneau bloqué sur « Stopping… », bouton désactivé, sans autre issue qu'un rechargement de page.
L'écouteur avait raison ; c'est l'émetteur qui manquait, et `CacheManager.cancelDownload()` l'émet
depuis cette date.

⚠️ **Et cette fiche a conclu deux fois le contraire — le 07/08 puis en ré-mesurant le 11/08.** Le
périmètre de la mesure était le paquet du plugin ; l'émetteur est dans le core. **Une mesure dont le
périmètre exclut l'endroit où la réponse se trouve sort verte en se trompant** — et un chiffre
re-mesuré à l'identique donne toute l'apparence d'une confirmation.

| Rôle                       | Compte | Où                                                                                                                                                                                                                                                                                           |
| -------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Définition de la constante | 1      | `CACHE_EVENTS.CANCELLED`, dans `cache/cache-control-types.ts`                                                                                                                                                                                                                                |
| Poses d'écouteur           | 2      | toutes deux dans `cache/cache-control-events.ts`, mais ce sont les **deux branches d'un `if (events) … else …`** : `events.on(…)` quand le gestionnaire d'écouteurs du core est là, `addEventListener(…)` en repli sans nettoyage. Mutuellement exclusives — **un seul abonnement effectif** |
| Émetteur de **production** | oui    | `packages/core/src/capabilities/offline/cache/cache-manager.ts`, `cancelDownload()` — depuis le 03/08/2026                                                                                                                                                                                   |
| Le relevé du dépôt         | —      | ne se recopie pas : `grep -rn "geoleaf:cache:cancelled" packages/*/src packages/plugins/*/src`                                                                                                                                                                                               |

> ⚠️ **Ré-mesuré le 11/08/2026 (6.11) — les quatre citations de ce tableau étaient fausses, et
> de deux façons distinctes.** ① Les trois numéros de ligne étaient décalés **d'exactement un**
> (`:20` au lieu de `:21`, `:69`/`:125` au lieu de `:70`/`:126`) : une ligne insérée plus haut a
> suffi, et `:20` désignait dès lors `CLEARED` — **une autre constante**, ce qu'aucune relecture
> ne voit. ② Le compte des `dispatchEvent` disait **1**, il y en a **2**
> (`packages/plugins/offline-ui/src/__tests__/cache-control-factory.test.js` n'était pas compté). Le verdict, lui, tient : **zéro émetteur
> de production**. Les citations sont ré-ancrées **par symbole** — un symbole renommé se voit,
> une ligne décalée non.

⚠️ **Ce que le défaut a coûté reste bon à garder.** Tant que rien n'émettait, la suite prouvait
qu'un écouteur réagit correctement à un signal que **rien n'envoie jamais**, et sortait verte en le
prouvant : un vert de test ne vaut pas chemin câblé. Les deux `dispatchEvent` de test sont toujours
là — ils ne sont simplement plus seuls.

⚠️ **En revanche, l'écouteur n'est PAS posé deux fois** : cette phrase l'a affirmé, c'est faux, et
ça l'était déjà. Les deux poses de `cache/cache-control-events.ts` sont les **branches d'un
`if (events) … else …`** — `events.on(…)` quand le gestionnaire d'écouteurs du core est présent,
`document.addEventListener(…)` en repli sans nettoyage. Elles ne peuvent pas s'exécuter ensemble :
ni double abonnement, ni double appel.

**Le geste est fait, et c'est la première branche qui a été prise.** L'annulation existe, traverse
bien la chaîne jusqu'au `Downloader`, et **se dit** désormais : le moteur émet le signal depuis le
03/08/2026, l'écouteur remet la barre de progression à zéro et réactive le bouton.
⚠️ L'émission est posée dans l'**orchestrateur** (`CacheManager`) et non dans le `Downloader` :
celui-ci est aussi appelé par des chemins internes, et l'on veut un émetteur par **intention**, pas
par mécanisme.

✅ **Les trois signaux du sens inverse sont refermés, chacun autrement — et c'est le partage qui
instruit.** ① La **disponibilité de la base** n'a pas reçu d'écouteur : le signal a été **retiré du
moteur** le 03/08/2026. Il ne portait aucune charge utile et se déclenchait à chaque ouverture de
base, donc à chaque démarrage — une notification par boot est du bruit, et un écouteur qui se
contenterait de journaliser aurait fermé le compteur à la lettre sans rien apporter.
② Le **dépassement de quota** est écouté **ici** depuis la même date (`core/engine-signals.ts`), en
ton _erreur_ : le navigateur a refusé une écriture, la capture suivante peut ne pas tenir.
③ L'**éviction par budget** est rendue **par le core** depuis le 16/08/2026
(`kernel/storage/eviction-notice.ts`), sur un chemin de boot inconditionnel — donc sur toutes les
variantes livrées, et pour ses deux émetteurs. ⚠️ **Ne pas la restaurer ici « pour l'interface
riche »** : les deux écouteurs afficheraient deux notices sur `deploy-full`.

Ces constats étaient tous de la même famille — un vocabulaire déclaré d'un côté et non honoré de
l'autre. Ils sont **soldés**, et chacun par un geste différent : l'annulation a reçu son émetteur,
le dépassement de quota son écouteur, l'éviction sa notice in-core, et la disponibilité de la base a
vu son signal retiré faute de porter quoi que ce soit.

---

## Décisions de conception

| Décision                                                 | Pourquoi                                                                                                                                                                                               | Alternative écartée                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| **Interface et moteur dans deux paquets**                | Le moteur est in-core parce que le rejeu et la base doivent exister sans plugin ; l'interface est un plugin parce qu'un profil sans hors-ligne ne doit pas la payer                                    | Tout in-core, ou tout en plugin         |
| **Aucun namespace monté**                                | Le plugin n'a rien à exposer : il est fait de CSS, de dictionnaires, d'un enregistrement de barre d'outils et d'effets de bord. Une façade vide serait un mensonge de structure que la gate validerait | Une façade de complaisance              |
| **Un adaptateur, pas un import du contrat du core**      | Un plugin chargé comme module a son propre graphe : la copie importée n'était jamais initialisée, et **toute l'interface était morte dans le paquet livré**, sans erreur                               | Importer le contrat partagé             |
| **Des accesseurs, pas des valeurs capturées**            | Le moteur arrive tard, par import dynamique. Capturer à l'import donnerait `undefined` pour toujours                                                                                                   | Capturer les modules au chargement      |
| **La détection de disponibilité court-circuite**         | Sans la marche intermédiaire, une interface sur un profil sans hors-ligne attendrait un signal qui ne vient jamais                                                                                     | Attendre le signal inconditionnellement |
| **Le `healthCheck` interroge une surface du CORE**       | C'est la seule chose dont le plugin dépend vraiment. Interroger sa propre existence n'aurait rien dit d'utile                                                                                          | Vérifier un membre à lui                |
| **L'espace i18n et le préfixe des clés diffèrent**       | Le préfixe est une surface de surcharge que des profils livrés utilisent. L'aligner sur le nom du paquet les casserait en silence                                                                      | Renommer les clés                       |
| **Le bouton est invisible par défaut**                   | Le hors-ligne est opt-in côté capacité ; un bouton visible par défaut proposerait une fonction éteinte                                                                                                 | Un bouton visible                       |
| **Le vocabulaire d'événements est une constante unique** | Deux écouteurs du même paquet sur deux orthographes d'une même chaîne échouent en silence                                                                                                              | Des littéraux au site d'écoute          |

---

## Dépendances et frontières

| Dépendance                    | Nature        | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@geoleaf/core`               | **pair**      | Passé de `dependencies` à `peerDependencies` le 25/08/2026, sur tous les plugins publiés. Il reste en `devDependencies` pour la construction et les tests — un plugin ne doit pas embarquer sa propre copie du core                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ~~`@geoleaf/field-renderer`~~ | —             | ⚠️ **Ce n'est plus une dépendance du tout.** `confirmDialog` et `createFocusTrap` sont passés de `field-renderer` à `@geoleaf/host-runtime` ; le manifeste ne cite plus `field-renderer`, et le double de test qui l'aliasait vise désormais `host-runtime`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| aucun peer `maplibre-gl`      | pair          | Il ne touche pas la carte, donc pas de peer `maplibre-gl` — mais il **a** un peer depuis le 25/08/2026, `@geoleaf/core`, ligne ci-dessus. 🛑 Cette case a écrit « **aucune** dépendance pair » et « une majorité des plugins n'en déclarent aucune » : les deux sont faux depuis cette bascule — **tous** les plugins publiés déclarent au moins le core, et la question utile est devenue « avec ou sans `maplibre-gl` ». ⚠️ Elle avait déjà annoncé « 7 des **13** » jusqu'au 11/08/2026, dans la parenthèse même qui dit « se compte, ne se recopie pas ». Le relevé se dérive : `node -e "const p=require('./scripts/lib/packages.cjs'); for (const k of p.all()) console.log(k.name, JSON.stringify(k.manifest.peerDependencies\|\|{}))"` |
| `@geoleaf/host-runtime`       | développement | Utilisé, lui — journalisation, lecture de configuration, accès au namespace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### Les arêtes statiques vers le core — et une seule vers la capacité

Le plugin atteint le core par des sous-chemins **publiés** de sa carte `exports` — la résolution des
couches d'un profil, la résolution de la géométrie d'une couche, le calcul de tuiles de la capacité
`offline` elle-même, et le contrat de synchronisation en `import type`. La liste se lit à la
commande, elle ne se recopie pas :
`grep -rn 'from "@geoleaf/core' packages/plugins/offline-ui/src/`.

Le calcul de tuiles reste **la seule** arête vers le moteur — désormais tirée depuis la voie bbox
**et** la voie corridor — et elle porte sur de l'arithmétique **sans état**, sur un module sans
import : ce qu'il importerait, le plugin l'embarquerait.

⚠️ **Le motif ne vit plus « dans la ligne de base » : il n'y a plus de ligne de base.** `BASELINE`
vaut `{}` dans `scripts/verify-plugin-core-boundary.cjs`, l'entrée `"offline-ui"` ayant été soldée.
La gate ne tolère plus ces arêtes par exemption : elle **dérive** de la carte `exports` du core la
frontière entre un sous-chemin publié et un deep import, et scanne tous les plugins du registre avec
tolérance zéro. Un plugin absent de la baseline n'est donc plus un plugin non scanné.

### Frontière avec `editor` — médiée par le core

Le plugin ne l'importe pas. Il récupère le gestionnaire `poi` **par `GeoLeaf.Sync`**, que le core
expose. C'est l'inversion qui permet à trois paquets de coopérer sans se connaître.

⚠️ **`README.md` n'est PAS dans `files[]`** — le manifeste n'y liste que `dist/`, `src/` et
`LICENSE`, et le répertoire `docs/` du paquet n'y est pas davantage. Même cas que
[`table`](CDC_table.md), et l'inverse de [`print`](CDC_print.md) et [`measure`](CDC_measure.md), qui
l'y déclarent explicitement. Vérifiable :
`node -e "console.log(require('./packages/plugins/offline-ui/package.json').files)"`.

---

## Écarts au CDC source

Le CDC `CDC_plugin-offline-ui.md` a été **consommé** en écrivant cette fiche, puis **supprimé** du
dossier de tri — ligne au §Journal des décisions de
la refonte documentaire V3.

| Énoncé du CDC                                      | Ce que dit le code                                                                                                                                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Le paquet s'appelle `storage`                      | **Renommé `offline-ui`.** Le nom d'origine survit dans quatre manifestes de plugins qui le déclarent en dépendance optionnelle — et dans le préfixe de ses propres clés i18n, lui **délibérément** |
| Le build Lite                                      | **Caduc** — ce build n'existe plus, et la documentation le décrit encore par endroits                                                                                                              |
| Le plugin monte un namespace                       | **Il n'en monte aucun.** L'exemption est nommée, motivée, et **vérifiée** par deux gardes                                                                                                          |
| Le contrat de stockage est importé du core         | **Remplacé par un adaptateur** — l'import créait une seconde copie jamais initialisée, qui rendait l'interface morte dans le paquet livré                                                          |
| Les surfaces (bouton, fenêtre, sélecteur, synchro) | ✅ **Vérifiées exactes**                                                                                                                                                                           |

Ce qui a été **retenu** du CDC et ne se lit pas dans le code : le motif du découpage moteur / interface
en deux paquets, l'historique du renommage, et les alternatives écartées de la table §Décisions.
