---
type: spec-plugin
title: realtime-layer — les couches qui se mettent à jour toutes seules
plugin_id: realtime-layer
package: "@geoleaf-plugins/realtime-layer"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 81aa8d29
date: 28 juillet 2026
---

# realtime-layer — les couches qui se mettent à jour toutes seules

**Type :** plugin publié · **Paquet :** `@geoleaf-plugins/realtime-layer` ·
**Code :** `packages/plugins/realtime-layer/` · **Vérifié contre :** `81aa8d29` (28/07/2026)

> **Trois règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.
> 3. **Un chemin cité sans racine se lit depuis le répertoire annoncé par « Code : » ci-dessus**,
>    ou depuis son `src/`, et à défaut depuis `packages/core/src/`. Un chemin qui commence par
>    `packages/`, `scripts/`, `profiles/`, `docs/`, `apps/` ou `e2e/` est relatif à la **racine du
>    dépôt**. Les cas qui échappent aux deux sont racinés sur place.

> ⚠️ **Deux lignes ouvertes du registre traversent ce plugin**, et la fiche les nomme à leur place
> plutôt qu'en préambule : **B-55** — les trois tests
> GTFS-RT de bout en bout sont **désactivés**, donc le décodage protobuf n'a plus **aucune**
> couverture navigateur — et **B-64**, ouverte en écrivant cette fiche : la source de scrutation
> n'annule pas ses requêtes en vol à l'arrêt.

---

## Périmètre

### Ce que le plugin fait

Il fait vivre une couche GeoJSON déjà chargée : il ouvre une **source** (scrutation HTTP, WebSocket
ou flux d'événements serveur), **décode** ce qui arrive, et **applique** les mises à jour sur la
couche par l'API publique du core. Il gère aussi la **péremption** des entités qui cessent d'être
rafraîchies.

### Ce qu'il ne fait pas

- **Il ne charge pas la couche.** La géométrie doit préexister : le plugin ne fait que la mettre à
  jour. C'est particulièrement contraignant pour GTFS-RT, dont le flux ne porte **aucune
  coordonnée**.
- **Il n'a aucune configuration globale.** Tout se déclare **par couche**, sous `data.realtime` —
  domaine de la donnée, donc du core. Aucune clé `realtimeLayer` nulle part.
- **Il ne parle jamais au moteur cartographique.** Toutes les écritures passent par
  `GeoLeaf.GeoJSON.*` ; aucun accès aux internes du core.
- **Il ne gère pas la reconnexion des flux d'événements serveur** — c'est le navigateur qui le fait,
  et l'intégrateur n'a pas la main sur le délai.
- **Il n'ouvre aucune connexion WebSocket lui-même** : il s'abonne à un canal du plugin
  [`websocket`](CDC_websocket.md), qui possède la connexion.

---

## Manifeste d'enregistrement

Ce que `src/entry.ts` déclare réellement. **Table gatée** par
`packages/core/__tests__/guards/doc-plugin-manifest.guard.test.js`.

| Champ        | Valeur                            |
| ------------ | --------------------------------- |
| `name`       | `realtime-layer`                  |
| `label`      | `GeoLeaf Realtime Layer`          |
| `requires`   | `[]`                              |
| `optional`   | `["websocket"]`                   |
| `namespace`  | `GeoLeaf.RealtimeLayer`           |
| `paquet npm` | `@geoleaf-plugins/realtime-layer` |

⚠️ **`optional: ["websocket"]` n'est pas décoratif** : c'est la seule déclaration formelle du fait
qu'une couche `source: "websocket"` ne fonctionne pas sans l'autre plugin. Il n'y a **pas** de
vérification à l'exécution qui bloquerait le démarrage — la source journalise une erreur explicite
et **ne démarre pas**, les autres couches continuant normalement.

⚠️ **Le `label` est un vrai nom lisible ici**, contrairement à celui de
[`geocoding`](CDC_geocoding.md) relevé au registre.

### Les étapes d'`entry.ts`

`entry.ts` est court — quatre gestes, pas les six du plugin d'interface complet :

| Étape                 | Ce qu'elle fait ici                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| Ré-exports de types   | `IDecoder`, `DecodedUpdate`, `IRealtimeSource`, `StaleActionHandler` — les **points d'extension** |
| Montage du namespace  | `GeoLeaf.RealtimeLayer = buildPublicApi()`                                                        |
| Auto-enregistrement   | Le manifeste ci-dessus, avec un `healthCheck` qui vérifie la présence du namespace                |
| Démarrage automatique | Écoute `geoleaf:app:ready` → balaye le profil et démarre les couches déclarées                    |

**Ni i18n, ni CSS, ni créneau de barre d'outils, ni action** : ce plugin n'a aucune interface.

⚠️ **L'ordre de chargement des scripts est porteur** : le core, puis `websocket` s'il y a des
couches qui en dépendent, puis ce plugin, puis les extensions qui enregistrent leurs décodeurs, puis
`GeoLeaf.boot()`. Un décodeur enregistré **après** le boot n'est pas vu par le balayage initial.

---

## Fonctionnalités

| ID    | Fonctionnalité                                 | Entrée                                           | Sortie observable                                                                                                               | Code                                                  |
| ----- | ---------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| RT-01 | Démarrage automatique au profil                | `geoleaf:app:ready`                              | Toute couche portant `data.realtime.enabled: true` démarre ; les autres sont ignorées **sans bruit**                            | `entry.ts`, `realtime-runtime.ts` → `bootFromProfile` |
| RT-02 | Deux emplacements de configuration acceptés    | `config.data.realtime` ou `config.realtime`      | Le canonique gagne ; la forme plate reste acceptée pour les tests et les configurations anciennes                               | `realtime-runtime.ts` → `_extractRealtime`            |
| RT-03 | Validation qui **jette avec le nom de couche** | Bloc `data.realtime` malformé                    | La couche est sautée, un message nommant la couche et la clé fautive est journalisé — les autres couches démarrent              | `config.ts` → `validateRealtimeConfig`                |
| RT-04 | Résolution des URL relatives au profil         | `url: "data/…"`                                  | Résolue contre le chemin de base des profils — sinon elle serait résolue contre la page et échouerait en déploiement            | `url-resolver.ts`, `realtime-runtime.ts`              |
| RT-05 | Scrutation HTTP                                | `source: "polling"`                              | Requête **immédiate** au démarrage, puis toutes les `intervalMs`                                                                | `sources/polling-source.ts`                           |
| RT-06 | Scrutation suspendue en arrière-plan           | Onglet masqué                                    | Aucune requête tant que l'onglet est caché ; **une requête immédiate** au retour au premier plan                                | `sources/polling-source.ts`                           |
| RT-07 | URL de repli, servie **une fois par panne**    | `fallbackUrl` déclarée, primaire en échec        | L'instantané statique est émis **une seule fois** ; la scrutation continue sur la primaire et y revient au premier succès       | `sources/polling-source.ts`                           |
| RT-08 | Flux d'événements serveur                      | `source: "sse"`                                  | `EventSource` natif ; la reconnexion est celle du navigateur. Environnement sans `EventSource` → erreur explicite, pas de crash | `sources/sse-source.ts`                               |
| RT-09 | Abonnement WebSocket                           | `source: "websocket"`, `channel`                 | `GeoLeaf.Ws.subscribe(channel, …)`. Plugin absent → **erreur explicite nommant la cause**, et la couche ne démarre pas          | `sources/websocket-source.ts`                         |
| RT-10 | Décodage GeoJSON                               | Collection, tableau ou entité unique             | Normalisés en une liste de mises à jour                                                                                         | `decoders/json-decoder.ts`                            |
| RT-11 | Décodage GTFS-RT, **chargé à la demande**      | `decoder: "gtfs-rt"`                             | Le décodeur et son graphe protobuf sont chargés par `import()` dynamique, **au premier usage**                                  | `realtime-runtime.ts` → `_loadGtfsRtDecoder`          |
| RT-12 | Décodeur inconnu signalé                       | `decoder: "maison"` sans enregistrement          | Message nommant la couche, le décodeur et **le geste à faire** — la couche ne démarre pas                                       | `realtime-runtime.ts` → `_startEntry`                 |
| RT-13 | Trois modes d'application                      | `updateMode`                                     | `replace` remplace la collection · `upsert` ajoute ou met à jour · `merge` ne fusionne que les propriétés                       | `layer-updater.ts`                                    |
| RT-14 | Écriture par l'API publique **seule**          | Toute mise à jour                                | `GeoLeaf.GeoJSON.getLayerData` / `updateLayerData` — aucun accès aux internes du core                                           | `layer-updater.ts`                                    |
| RT-15 | Redirection vers une autre couche              | `mapping.targetLayerId`                          | Les entités atterrissent sur la couche cible, pas sur celle qui porte la configuration                                          | `config.ts` → `resolveTargetLayerId`                  |
| RT-16 | Suivi de fraîcheur                             | `staleTimeoutMs` déclaré                         | Vérification périodique ; une entité non rafraîchie subit l'action configurée                                                   | `stale-tracking.ts`                                   |
| RT-17 | Deux actions de péremption intégrées           | `staleAction`                                    | `remove` retire l'entité · `dim` lui pose `_stale: true`, **à charge pour la couche d'avoir une règle de style dessus**         | `stale-tracking.ts`                                   |
| RT-18 | Identité d'entité résolue **au même endroit**  | `idField`, sinon `id`, `_id`, `_realtimeId`      | L'écriture et l'éviction utilisent le **même** résolveur, dans le même ordre                                                    | `feature-index.ts`                                    |
| RT-19 | `replace` ne touche pas le suivi               | `updateMode: "replace"`                          | Aucun horodatage par entité — le remplacement complet rend le suivi par entité sans objet                                       | `layer-updater.ts`                                    |
| RT-20 | Arrêt par couche et arrêt global               | `stop(layerId)` / `stopAll()`                    | La source s'arrête et le suivi de fraîcheur est relâché **sous la clé de la couche cible**                                      | `realtime-runtime.ts`                                 |
| RT-21 | État interrogeable                             | `getStatus(layerId)`                             | `{ active, source, lastUpdateAt, staleCount }` — `{ active: false, source: "none" }` pour une couche inactive                   | `realtime-runtime.ts` → `getStatus`                   |
| RT-22 | Décodeur tiers                                 | `registerDecoder(nom, décodeur)`                 | Le nom devient utilisable dans `data.realtime.decoder` — **avant le boot**                                                      | `realtime-runtime.ts`                                 |
| RT-23 | Action de péremption tierce                    | `registerStaleAction(nom, gestionnaire)`         | Le nom devient utilisable dans `staleAction`                                                                                    | `stale-tracking.ts`                                   |
| RT-24 | Démarrage manuel                               | `start(layerId)` sur une couche `enabled: false` | Démarre à la demande ; **sans effet** si la couche tourne déjà                                                                  | `realtime-runtime.ts` → `start`                       |

Les tests qui couvrent ces lignes : `packages/plugins/realtime-layer/src/__tests__/` — l'emplacement
canonique imposé par le contrat de plugin. Le décompte se mesure :

```bash
ls packages/plugins/realtime-layer/src/__tests__/ | wc -l
```

⚠️ **Et cette couverture a un trou nommé.** Les trois scénarios GTFS-RT de bout en bout de
`e2e/08-realtime.spec.js` sont **désactivés** : le décodage protobuf n'a donc **plus aucune
couverture navigateur**, seulement des tests unitaires sur fixture. C'est
**B-55**, et le fichier de test le dit sur place :
« un test ignoré ne garde rien ».

---

## Configuration

**Il n'y a aucun bloc de configuration global pour ce plugin.** Tout se déclare **par couche**, sous
`data.realtime` du fichier de configuration de la couche — c'est le domaine de la donnée, qui
appartient au core.

C'est une décision explicite, du même patron que `cog`, `file-import` et `flatgeobuf` : aucune clé
`realtimeLayer` dans les clés racine héritées, aucun accesseur de configuration côté plugin.

### Le bloc `data.realtime`

| Clé              | Type                                  | Défaut     | Rôle                                                                            |
| ---------------- | ------------------------------------- | ---------- | ------------------------------------------------------------------------------- |
| `enabled`        | `boolean` — **obligatoire**           | —          | Doit être un **booléen** ; toute autre valeur fait jeter la validation          |
| `source`         | `"polling"` / `"websocket"` / `"sse"` | —          | **Obligatoire**, et la liste est fermée                                         |
| `decoder`        | `string` — **obligatoire**            | —          | `"json"`, `"gtfs-rt"`, ou un nom enregistré à la main                           |
| `updateMode`     | `"upsert"` / `"replace"` / `"merge"`  | `"upsert"` | Liste fermée                                                                    |
| `idField`        | `string`                              | —          | Propriété servant de clé — nécessaire pour `upsert` et `merge`                  |
| `staleTimeoutMs` | `number`                              | —          | **Absent : aucun suivi de fraîcheur n'est armé**                                |
| `staleAction`    | `string`                              | `"remove"` | `"remove"`, `"dim"`, ou un nom enregistré                                       |
| `url`            | `string`                              | —          | **Obligatoire** pour `polling` et `sse`                                         |
| `intervalMs`     | `number`                              | `30000`    | Scrutation seulement                                                            |
| `fallbackUrl`    | `string`                              | —          | Instantané de secours, scrutation seulement                                     |
| `channel`        | `string`                              | —          | **Obligatoire** pour `websocket`                                                |
| `mapping`        | `object`                              | —          | Indications pour le décodeur GTFS-RT : `idField`, `delayField`, `targetLayerId` |

⚠️ **`mapping.delayField` est déclaré à trois endroits et lu nulle part** — champ réservé. Le CDC
source le signalait déjà ; c'est toujours vrai.

⚠️ **Aucune de ces clés n'est gatée par le test-garde de cette fiche**, qui ne couvre que le
manifeste d'enregistrement. Ce tableau se relit contre `config.ts` à chaque modification — c'est la
part humaine de la règle documentaire du dépôt.

⚠️ **La validation est stricte et bruyante, par choix** : elle **jette** avec le nom de la couche et
la clé fautive, et l'orchestrateur attrape, journalise, puis **saute cette couche seulement**. Une
configuration fausse ne fait donc pas tomber les autres couches temps réel, mais elle ne passe pas
non plus en silence.

---

## Contrat exposé

### API publique — `GeoLeaf.RealtimeLayer`

Construit par `public-api.ts` → `buildPublicApi()`, monté par `entry.ts`.

| Membre                                   | Rend / fait                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `start(layerId)`                         | Démarre une couche — utile pour une couche déclarée `enabled: false` (opt-in) |
| `stop(layerId)` · `stopAll()`            | Arrêtent la source et relâchent le suivi de fraîcheur                         |
| `getStatus(layerId)`                     | `{ active, source, lastUpdateAt, staleCount }`                                |
| `registerDecoder(nom, décodeur)`         | Ajoute un décodeur — **avant `GeoLeaf.boot()`**                               |
| `registerStaleAction(nom, gestionnaire)` | Ajoute une action de péremption — **avant `GeoLeaf.boot()`**                  |
| `version`                                | Version du plugin, injectée à la construction                                 |

### Deux contrats d'extension, exportés en types

C'est ce qui distingue ce plugin des autres du palier : il est conçu pour être **étendu par un
tiers**, et il exporte pour cela des interfaces depuis son entrée.

| Interface exportée           | Ce qu'un tiers en fait                                          |
| ---------------------------- | --------------------------------------------------------------- |
| `IDecoder` · `DecodedUpdate` | Écrire un décodeur pour un format propriétaire                  |
| `IRealtimeSource`            | Décrire une source — le contrat que les trois intégrées suivent |
| `StaleActionHandler`         | Écrire une action de péremption                                 |

### Événements

| Signal              | Sens       | Détail                                             |
| ------------------- | ---------- | -------------------------------------------------- |
| `geoleaf:app:ready` | **écouté** | Le déclencheur du balayage initial du profil       |
| `visibilitychange`  | **écouté** | Par chaque source de scrutation, pour se suspendre |

**Le plugin n'émet aucun événement GeoLeaf.** Sa communication avec le plugin `websocket` passe par
le namespace public `GeoLeaf.Ws.subscribe()`, jamais par le bus d'événements.

### Stockage écrit

Aucun.

---

## Décisions de conception

| Décision                                                        | Pourquoi                                                                                                                                                                                                                                | Alternative écartée                              |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Configuration par couche, pas de bloc global**                | Le temps réel est une propriété **de la donnée**, pas de l'application. Un bloc global obligerait à répéter l'identifiant de couche et à maintenir deux endroits                                                                        | Un bloc `modules.realtimeLayer`                  |
| **Écriture par l'API publique du core uniquement**              | C'est ce qui permet au plugin d'être versionné indépendamment : il ne dépend que d'un contrat publié, pas d'internes                                                                                                                    | Accéder au gestionnaire de couches du core       |
| **Le décodeur GTFS-RT est chargé DYNAMIQUEMENT**                | Son graphe protobuf sonde WebAssembly à l'initialisation du module — une violation CSP bénigne mais bien réelle sous une politique stricte. Un import statique la déclencherait **à chaque page**, y compris celles sans couche GTFS-RT | L'import statique, qui a été la forme précédente |
| **Tout ce qui suit le décodage est keyé sur la couche CIBLE**   | Écritures et cycle de péremption doivent voir la même couche. Les keyer différemment rendait l'éviction **silencieusement inopérante** dès qu'un mapping redirigeait                                                                    | Keyer le suivi sur la couche de configuration    |
| **Un seul résolveur d'identité, partagé**                       | L'écrivain range l'identifiant sous `idField ?? "_realtimeId"` ; si l'éviction résolvait autrement, une entité deviendrait injoignable et la péremption un no-op **muet**                                                               | Une résolution par consommateur                  |
| **`replace` ne pose pas d'horodatage**                          | Remplacer toute la collection rend le suivi par entité sans objet — le maintenir donnerait un décompte de péremption qui ne veut rien dire                                                                                              | Horodater dans les trois modes                   |
| **Scrutation suspendue sur onglet masqué**                      | Un onglet en arrière-plan n'a pas besoin de données fraîches, et le trafic coûte à l'utilisateur comme au fournisseur                                                                                                                   | Scruter en continu                               |
| **Requête immédiate au démarrage et au retour au premier plan** | Sans elle, la couche resterait figée jusqu'à `intervalMs` — soit une demi-minute par défaut au moment précis où l'utilisateur regarde                                                                                                   | N'attendre que le premier intervalle             |
| **Repli servi UNE FOIS par fenêtre de panne**                   | Ré-émettre le même instantané statique à chaque tour ferait clignoter la couche et écraserait tout, sans jamais rien apporter de neuf                                                                                                   | Servir le repli à chaque tour d'échec            |
| **Un plugin WebSocket absent journalise, il ne jette pas**      | Une couche temps réel indisponible ne doit pas faire tomber les autres, ni le boot. Le message nomme la cause **et le geste** (charger le plugin, appeler son initialisation avant le boot)                                             | Jeter au démarrage                               |
| **Validation stricte, échec par couche**                        | Sauter une couche mal configurée en la nommant est plus utile qu'un démarrage partiel silencieux, et plus sûr qu'un échec global                                                                                                        | Corriger silencieusement les valeurs manquantes  |
| **Deux emplacements de configuration acceptés**                 | Le canonique est `data.realtime` ; la forme plate reste tolérée pour ne pas casser les configurations et les tests antérieurs                                                                                                           | N'accepter que le canonique                      |
| **Points d'extension exportés en TYPES depuis l'entrée**        | Un plugin tiers doit pouvoir écrire un décodeur conforme **à la compilation**, pas seulement espérer à l'exécution                                                                                                                      | Documenter la forme sans l'exporter              |

---

## Dépendances et frontières

### Conformité au contrat gelé

`scripts/verify-plugin-contract.cjs` — le plugin est conforme, comme les douze autres :

```bash
node scripts/verify-plugin-contract.cjs --plugin=realtime-layer
```

### Dépendances

| Dépendance                   | Nature                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `@geoleaf/core`              | Le namespace `GeoLeaf.GeoJSON` et l'événement de fin de boot                  |
| `gtfs-realtime-bindings`     | **Seule dépendance externe** — tirée seulement quand un décodeur GTFS-RT sert |
| `@geoleaf-plugins/websocket` | **Facultative**, déclarée au manifeste, atteinte par le namespace public      |

⚠️ **La dépendance externe est la seule du lot des plugins de ce palier**, et elle porte le poids.
Elle a aussi une histoire de sécurité : sa montée de version majeure a levé une série d'alertes sur
son propre graphe protobuf. Le poids réel se mesure, il ne se recopie pas :

```bash
npm run size:plugins
```

### Frontières

- **Aucun import de `@geoleaf/core` en code** : le plugin lit `globalThis.GeoLeaf` tardivement, à
  travers des interfaces structurelles locales. C'est ce qui lui permet de dégrader proprement quand
  une surface manque.
- **Aucun accès au moteur cartographique.** Le plugin ne connaît que des collections d'entités.
- **Communication inter-plugins par le namespace public**, jamais par import : `GeoLeaf.Ws` est lu
  au démarrage de la source, pas à l'import du module.

### La croisée avec le chargement initial de la couche — et B-58

Le plugin ne charge pas la couche : c'est le chargeur du core qui le fait, **avant** que le temps
réel ne démarre. Or **B-58** porte sur ce chargement :
lorsqu'une couche déclare `data.mapping`, le chargeur du core désactive son ouvrier et émet un
`fetch` sur le fil principal **sans signal d'annulation ni délai de garde**, ce qui bloque toute la
chaîne d'initialisation derrière lui.

⚠️ **Ce n'est pas le même `mapping`.** Celui de B-58 est `data.mapping` — la transformation de
données du core. Celui de ce plugin est `data.realtime.mapping` — les indications du décodeur
GTFS-RT. **Les deux clés portent le même mot et ne désignent pas la même chose** ; les confondre
enverrait le correctif de B-58 dans le mauvais fichier.

Ce qui est réellement partagé, c'est le **symptôme** : une source lente ou injoignable retarde
l'application, et c'est ce plugin qui rend le retard visible, puisque ses couches sont celles qui
pointent vers des services externes.

### Ce que la fiche a trouvé et versé au registre — B-64

`PollingSource.stop()` **arrête le minuteur et détache l'écouteur de visibilité, mais n'annule pas
la requête en vol** : `_fetchOne` émet un `fetch` sans signal d'annulation, et son gestionnaire
n'est jamais remis à zéro. Une requête partie juste avant l'arrêt aboutit donc, et **applique sa
mise à jour sur une couche qu'on venait d'arrêter**. Ligne **B-64** du registre, avec sa mesure.

---

## Écarts au CDC source

Le CDC `CDC_plugin-realtime-layer.md` a été **consommé** en écrivant cette fiche. ⚠️ **Il n'a PAS
été retiré du dossier de tri** — même motif que les CDC précédents, tracé au §Journal des décisions
de `roadmap_documentation-v3.md`.

⚠️ **C'est un CDC exceptionnellement bien vérifié** : il porte sa propre table de « vérifications
croisées », dix affirmations chacune adossée à un fichier. Neuf tiennent encore. Les écarts sont
donc concentrés, et tous du **mode d'échec n° 6** — la contrainte qui motivait l'énoncé est tombée.

| Énoncé du CDC                                                                   | Ce que dit le code                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §8 PC-04 + croisée n° 7 — « `gtfs-realtime-bindings` importé **statiquement** » | Vrai **dans le module décodeur**, faux pour le chemin de boot : `realtime-runtime.ts` charge le décodeur par `import()` **dynamique**, et son commentaire donne le motif — la sonde WebAssembly et la violation CSP qu'elle provoque                                                                                                                                                                         |
| §7 « budget bundle : inliné statiquement depuis S10 — ~81 KB gz »               | **Périmé par le point précédent** : ce n'est plus un coût de boot mais un fragment différé. Le chiffre ne se recopie pas — `npm run size:plugins`                                                                                                                                                                                                                                                            |
| §5 « 11 suites Vitest (112 tests) »                                             | **13 fichiers** sur le disque. Chiffre recopié, donc divergé — la fiche cite la commande à sa place                                                                                                                                                                                                                                                                                                          |
| §7 « Fetch immédiat — polling-source.ts:48 »                                    | Le comportement est exact ; **la ligne ne l'est plus**. Même défaut que les citations de ligne des déclarations de capacités (B-63)                                                                                                                                                                                                                                                                          |
| §6 « SSE sans reconnexion gérée »                                               | ✅ **Vérifié exact** — et l'environnement sans `EventSource` est traité en plus, par une erreur explicite                                                                                                                                                                                                                                                                                                    |
| Croisée n° 7 — « `mapping.delayField` jamais lu (champ réservé) »               | ✅ **Vérifié exact sur le fond, corrigé sur le compte (11/08/2026)** — **zéro lecture**, ce qui est l'énoncé qui compte. La case disait « **trois** déclarations » : il y en a **deux** en source (`config.ts`, `decoders/gtfs-rt-decoder.ts`), les deux autres occurrences étant des **usages de test**. Un compte faux dans une case « Vérifié exact » coûte plus qu'un chiffre nu : il porte une garantie |
| Croisée n° 4 — repli servi une fois par fenêtre de panne                        | ✅ **Vérifié exact**                                                                                                                                                                                                                                                                                                                                                                                         |
| Croisée n° 6 — les trois défauts (`30000`, `"upsert"`, `"remove"`)              | ✅ **Vérifiés exacts**                                                                                                                                                                                                                                                                                                                                                                                       |
| §5 — les tests comme preuve de couverture                                       | ⚠️ **À nuancer, et le CDC ne pouvait pas le savoir** : les trois scénarios GTFS-RT de bout en bout sont désactivés depuis (B-55). La couverture unitaire est intacte, la couverture navigateur du protobuf est **nulle**                                                                                                                                                                                     |

Ce qui a été **retenu** du CDC et ne se lit pas dans le code : les quatre scénarios d'usage réels
(retards ferroviaires en GTFS-RT, navires en WebSocket, capteurs en flux d'événements, vélos en
libre-service), le motif de l'ordre de chargement des scripts, la règle de versionnement du contrat
d'extension, et les alternatives écartées de la table §Décisions.
