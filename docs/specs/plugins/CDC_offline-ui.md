---
type: spec-plugin
title: offline-ui — l'interface du hors-ligne, sur un moteur qu'elle ne contient pas
plugin_id: offline-ui
package: "@geoleaf-plugins/offline-ui"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: ada9449a
date: 8 août 2026
---

# offline-ui — l'interface du hors-ligne, sur un moteur qu'elle ne contient pas

**Type :** plugin publié · **Paquet :** `@geoleaf-plugins/offline-ui` ·
**Code :** `packages/plugins/offline-ui/` · **Vérifié contre :** `1a8f7137` (28/07/2026)

> **Deux règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.

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
déclarent un. ⚠️ Il citait `addpoi` jusqu'à la fusion du Sprint 5 : le gestionnaire `"poi"` n'a pas
changé d'identifiant, il a changé de **fournisseur**. Le plugin va bien chercher le gestionnaire
`poi` déposé par `editor`, et se passe de
lui quand il est absent. Les quatre autres pointaient vers `storage` — c'est-à-dire vers **ce
plugin-ci**, qu'ils désignaient tous du mauvais nom. Corrigés le 29/07/2026 (**B-66**), et la classe
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

| ID    | Fonctionnalité                                  | Entrée                            | Sortie observable                                                                                | Code                                                           |
| ----- | ----------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| OU-01 | Bouton de cache, deux surfaces                  | Barre mobile et bandeau de bureau | **Invisible par défaut** — il faut l'activer par profil                                          | `ui/cache-button/toolbar-registration.ts`                      |
| OU-02 | Fenêtre de gestion du cache                     | Clic sur le bouton                | État, quota, actions                                                                             | `ui/cache-button/modal-manager.ts`, `cache/cache-control-*.ts` |
| OU-03 | Sélecteur de couches à télécharger              | Profil actif                      | Une ligne par couche, avec son état de cache — quelle que soit sa PROVENANCE, voir sous la table | `cache/layer-selector/`                                        |
| OU-04 | Sélection persistée entre sessions              | Choix de l'utilisateur            | Relue au chargement suivant, par le cache du core                                                | `cache/layer-selector/selection-cache.ts`                      |
| OU-05 | Estimation d'une zone de tuiles vectorielles    | Emprise et niveaux                | Un volume annoncé avant de télécharger                                                           | `sync/vector-zone-estimate.ts`                                 |
| OU-06 | Suivi de progression                            | Signaux du core                   | Remplissage et vidage suivis séparément                                                          | `cache/cache-control-events.ts`                                |
| OU-07 | Annulation d'un téléchargement                  | Bouton d'annulation               | Relayée au gestionnaire du core                                                                  | `cache/cache-control-state.ts`                                 |
| OU-08 | Purge du cache d'un profil                      | Action de vidage                  | Avec confirmation, et progression                                                                | `cache/download-handler.ts`                                    |
| OU-09 | Panneau de synchronisation                      | File en attente                   | Liste, déclenchement, et résultat                                                                | `sync/sync-manager.ts`                                         |
| OU-10 | Rejeu par le gestionnaire d'un autre plugin     | `Sync.getHandler("poi")`          | Le plugin déclenche ce qu'[`editor`](CDC_editor.md) a déposé — sans jamais l'importer            | `core/sync-seam.ts`                                            |
| OU-11 | Export de la file en attente                    | Action d'export                   | Lue depuis la base du core, puis vidée entrée par entrée                                         | `ui/cache-button/export-logic.ts`                              |
| OU-12 | Détection de disponibilité sans attente infinie | Profil sans hors-ligne            | Rend `false` tout de suite — voir §La seule voie                                                 | `core/engine-ready.ts`                                         |

```callout info label="OU-03 — une couche vaut une couche, quelle que soit la PROVENANCE de sa config"
Une couche déclare sa configuration de **deux** façons : par un fichier (`configFile`) ou en ligne
(`inlineConfig`, ce que `expandLayerTemplates` produit pour chaque instance de `layerTemplates`).
**Le sélecteur doit être indifférent aux deux**, et c'est une propriété gardée —
`src/__tests__/templated-layer-selector.guard.test.ts`, qui compare systématiquement une couche
en ligne à une couche à fichier servant de témoin.

🛑 **Elle ne l'était pas, et le défaut a vécu jusqu'au 07/08/2026 (B-152).** Les trois sites du
sélecteur branchaient sur `configFile` seul : mesuré en navigateur sur `tourism`, les 42 couches
apparaissaient mais les **24 templatées** se rendaient avec leur identifiant technique à la place
du libellé, sans style et **sans sélecteur de style** — et leur état de cache était **toujours
faux**, `searchUrls` restant vide. Corrigé aux trois sites ensemble ; après correctif, 0 des 24.

⚠️ **La cause racine était dans le CORE, pas ici** : `inlineConfig` était la seule forme de config
dont le chemin de données ne se dérivait qu'avec `layerDataPath`, helper interne au core que ce
plugin n'a pas le droit d'importer. C'est `expandLayerTemplates` qui normalise désormais `dataFile`.
Un correctif purement local aurait dû redériver ce chemin ici — deuxième endroit libre de diverger.

✅ **Et la colonne géométrie est réparée du même jour (B-161), pour une cause DISTINCTE** — elle
affichait `-` sur 38 des 42 lignes, **dont 14 des 18 couches directes**, ce qui prouvait que
l'`inlineConfig` n'y était pour rien. Deux défauts empilés : `getLayerGeometryType` lisait
`geometryType` seul, alors que le schéma en fait un **alias de `geometry`** (ANO-007) que 18 des
24 configs ne déclarent pas ; et la table i18n de la cellule était keyée sur le vocabulaire
**GeoJSON** quand les configs portent le vocabulaire **profil**, donc elle ne traduisait jamais
rien. La résolution de l'alias vit maintenant en **un seul endroit** pour tout le dépôt —
`packages/core/src/kernel/config/layer-geometry.ts`, publié au `exports` du core.
```

Les tests qui couvrent ces lignes : `packages/plugins/offline-ui/src/__tests__/`, dont **quatre
d'intégration** qui vérifient la jonction avec le core, **plus une suite sur le paquet construit** —
ce que seuls ce plugin et [`editor`](CDC_editor.md) portent.

---

## Configuration

**Aucun bloc propre, aucun `config.ts`.** Le plugin lit des clés du **core**, au moment de s'en
servir : le gate du hors-ligne, celui de l'ouvrier de service, l'option de cache des tuiles, le
profil actif et son chemin de base, et les fonds de carte.

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

| Signal                         | Émetteur                                         |
| ------------------------------ | ------------------------------------------------ |
| `geoleaf:cache:completed`      | La capacité [`offline`](../capacites/offline.md) |
| `geoleaf:cache:cleared`        | idem                                             |
| `geoleaf:cache:progress`       | idem                                             |
| `geoleaf:cache:clear-progress` | idem                                             |
| `geoleaf:profile:loaded`       | Le core, hors de la capacité                     |
| `geoleaf:cache:cancelled`      | 🛑 **Personne** — ni le core, ni ce plugin       |
| `geoleaf:toolbar:action`       | Le kernel                                        |

⚠️ **Trois signaux émis par la capacité n'ont AUCUN écouteur ici** — la disponibilité de la base, le
dépassement de quota, et l'éviction par budget. Le dernier est le plus notable : un utilisateur dont
les couches sont évincées faute de place **n'en est pas informé**, alors que le moteur le signale.

🛑 **`geoleaf:cache:cancelled` — TRANCHÉ le 02/08/2026 : il l'écoute pour rien.** La fiche laissait
l'alternative ouverte (« le plugin l'émet lui-même, ou l'écoute pour rien ») ; la mesure la ferme.

| Rôle                        | Compte | Où                                                       |
| --------------------------- | ------ | -------------------------------------------------------- |
| Définition de la constante  | 1      | `cache/cache-control-types.ts:20`                        |
| Écouteurs                   | **2**  | `cache/cache-control-events.ts:69` **et** `:125`         |
| Émetteurs de **production** | **0**  | — ni le core, ni ce plugin, ni l'application             |
| `dispatchEvent` du dépôt    | 1      | `__tests__/cache-control-view.test.js:613` — **un test** |

⚠️ **Le seul émetteur du dépôt est un test.** C'est la forme la plus trompeuse du défaut : la suite
prouve qu'un écouteur réagit correctement à un signal que **rien n'envoie jamais**, et sort verte en
le prouvant. Un vert de test ne vaut pas chemin câblé.

⚠️ **Et l'écouteur est posé DEUX FOIS** sur le même `document`, par deux mécanismes différents
(`events.on(…)` et `document.addEventListener(…)`) — un doublon structurel qui aurait produit un
double appel si le signal existait.

**Le geste** : l'annulation existe et fonctionne (`cancelDownload()` traverse bien la chaîne
jusqu'au `Downloader`), c'est sa **notification** qui manque. Soit le moteur émet le signal, soit
les deux écouteurs partent — mais l'état actuel, où l'on paie deux abonnements pour un silence,
n'est pas tenable. Tranché au Sprint 3, avec les autres signaux sans écouteur.

⚠️ **Les trois signaux du sens inverse restent ouverts** — disponibilité de la base, dépassement de
quota, éviction par budget : la capacité les émet, ce plugin ne les écoute pas. Le troisième est le
plus notable, et c'est un défaut **produit** : un utilisateur dont les couches sont évincées faute
de place n'en est **pas informé**, alors que le moteur le signale.

Les quatre constats sont **de la même famille que B-69** — un vocabulaire déclaré d'un côté et non
honoré de l'autre — et versés en **B-72** du
registre.

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

| Dépendance                 | Nature        | Note                                                                                                                                                                          |
| -------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@geoleaf/core`            | production    | —                                                                                                                                                                             |
| `@geoleaf/field-renderer`  | production    | Pour le dialogue de confirmation et le piège de focus                                                                                                                         |
| **aucune** dépendance pair | —             | Il ne touche pas la carte, donc pas de peer `maplibre-gl`. ⚠️ **Pas le seul** : 7 des 13 plugins n'en déclarent aucune (corrigé le 30/07/2026 — se compte, ne se recopie pas) |
| `@geoleaf/host-runtime`    | développement | Utilisé, lui — journalisation, lecture de configuration, accès au namespace                                                                                                   |

### Les arêtes statiques vers le core — et une seule vers la capacité

Le plugin importe deux modules du core par sous-chemin publié : la résolution des couches d'un
profil, et **le calcul de tuiles de la capacité `offline` elle-même**. Cette dernière est **la seule**
arête statique du plugin vers le moteur, et elle porte sur de l'arithmétique **sans état** — c'est ce
qui la rend sans conséquence, motif déjà inscrit dans la ligne de base de
`scripts/verify-plugin-core-boundary.cjs`.

### Frontière avec `editor` — médiée par le core

Le plugin ne l'importe pas. Il récupère le gestionnaire `poi` **par `GeoLeaf.Sync`**, que le core
expose. C'est l'inversion qui permet à trois paquets de coopérer sans se connaître.

⚠️ **`README.md` est dans `files[]`**, comme un répertoire `docs/`.

---

## Écarts au CDC source

Le CDC `CDC_plugin-offline-ui.md` a été **consommé** en écrivant cette fiche, puis **supprimé** du
dossier de tri — ligne au §Journal des décisions de
`roadmap_documentation-v3.md`.

| Énoncé du CDC                                      | Ce que dit le code                                                                                                                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Le paquet s'appelle `storage`                      | **Renommé `offline-ui`.** Le nom d'origine survit dans quatre manifestes de plugins qui le déclarent en dépendance optionnelle (**B-66**) — et dans le préfixe de ses propres clés i18n, lui **délibérément** |
| Le build Lite                                      | **Caduc** — ce build n'existe plus, et la documentation le décrit encore par endroits (**B-07**)                                                                                                              |
| Le plugin monte un namespace                       | **Il n'en monte aucun.** L'exemption est nommée, motivée, et **vérifiée** par deux gardes                                                                                                                     |
| Le contrat de stockage est importé du core         | **Remplacé par un adaptateur** — l'import créait une seconde copie jamais initialisée, qui rendait l'interface morte dans le paquet livré                                                                     |
| Les surfaces (bouton, fenêtre, sélecteur, synchro) | ✅ **Vérifiées exactes**                                                                                                                                                                                      |

Ce qui a été **retenu** du CDC et ne se lit pas dans le code : le motif du découpage moteur / interface
en deux paquets, l'historique du renommage, et les alternatives écartées de la table §Décisions.
