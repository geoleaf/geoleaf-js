---
type: spec-plugin
title: websocket — le transport temps réel, et sa reconnexion
plugin_id: websocket
package: "@geoleaf-plugins/websocket"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 81aa8d29
date: 28 juillet 2026
---

# websocket — le transport temps réel, et sa reconnexion

**Type :** plugin publié · **Paquet :** `@geoleaf-plugins/websocket` ·
**Code :** `packages/plugins/websocket/` · **Vérifié contre :** `81aa8d29` (28/07/2026)

> **Deux règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.

> ⚠️ **Ce plugin ne dessine rien et ne touche à aucune couche.** C'est un **transport** : il tient
> une connexion, la reconnecte, y multiplexe des canaux nommés, et met en file ce qu'on lui donne
> pendant les coupures. Son consommateur cartographique est
> [`realtime-layer`](CDC_realtime-layer.md), qui s'abonne à un canal — mais rien n'oblige à
> l'utiliser pour de la carte.

> ⚠️ **Il ne se configure PAS par un profil.** Contrairement à toutes les capacités in-core et à
> plusieurs plugins, sa configuration est passée **à la main** par l'intégrateur, en JavaScript, à
> `GeoLeaf.Ws.init(config)`. Il n'y a aucun bloc `modules.websocket`, aucun schéma de profil.

---

## Périmètre

### Ce que le plugin fait

Il ouvre et maintient une connexion WebSocket ; il la **reconnecte** avec un retrait exponentiel ;
il multiplexe des **canaux nommés** sur cette connexion unique ; il **met en file** les messages
sortants pendant une coupure et les rejoue à la reconnexion ; il surveille la connexion par
battements de cœur ; et il publie des **métriques**.

### Ce qu'il ne fait pas

- **Il n'a aucune interface, aucune CSS, aucun i18n.** Il n'affiche rien.
- **Il ne s'authentifie pas.** Le type de configuration prévoit une place pour l'authentification,
  mais **aucune logique n'est implémentée** dans le transport intégré — c'est une réservation
  d'extensibilité, pas une fonctionnalité.
- **Il ne se démarre pas tout seul.** Aucun démarrage automatique sur un événement de boot :
  l'intégrateur appelle `init()`, et ce doit être **avant** `GeoLeaf.boot()` si une couche temps
  réel en dépend.
- **Il ne connaît ni couche, ni carte, ni entité.** Il transporte des charges utiles opaques.

---

## Manifeste d'enregistrement

Ce que `src/entry.ts` déclare réellement. **Table gatée** par
`packages/core/__tests__/guards/doc-plugin-manifest.guard.test.js`.

| Champ        | Valeur                       |
| ------------ | ---------------------------- |
| `name`       | `websocket`                  |
| `label`      | `WebSocket Transport`        |
| `requires`   | `[]`                         |
| `optional`   | `[]`                         |
| `namespace`  | `GeoLeaf.Ws`                 |
| `paquet npm` | `@geoleaf-plugins/websocket` |

⚠️ **`optional` n'est pas écrit dans `entry.ts` — le champ est absent, pas vide.** Le test-garde
traite l'absence comme `[]`, ce qui est le bon défaut ; mais la ligne ci-dessus documente donc un
**défaut du garde**, pas une déclaration du plugin. Trois des quatre plugins du palier S écrivent la
clé explicitement.

⚠️ **Son `healthCheck` est le plus exigeant du dépôt** : il ne vérifie pas la présence du namespace
mais **l'état de la connexion**. Un plugin monté mais non connecté se déclare donc en mauvaise santé
— ce qui est correct pour un transport, et n'aurait pas de sens pour un plugin sans état.

### Les étapes d'`entry.ts`

Trois gestes — le squelette minimal du contrat, sans rien de plus :

| Étape                | Ce qu'elle fait ici                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| Ré-export            | `registerTransport` — le **point d'extension**, en valeur ; plus `JwtAuth` / `CredentialsAuth`, en type |
| Montage du namespace | `GeoLeaf.Ws = buildPublicApi()`                                                                         |
| Auto-enregistrement  | Le manifeste ci-dessus, avec le `healthCheck` sur l'état de connexion                                   |

**Ni i18n, ni cycle de vie automatique, ni créneau de barre d'outils, ni action.**

---

## Fonctionnalités

| ID    | Fonctionnalité                                     | Entrée                                     | Sortie observable                                                                                                       | Code                                     |
| ----- | -------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| WS-01 | Initialisation explicite                           | `GeoLeaf.Ws.init(config)`                  | Se connecte immédiatement ; la promesse se résout **à la connexion**, pas à l'appel                                     | `ws-lifecycle.ts` → `wsInit`             |
| WS-02 | TLS imposé en production                           | URL en `ws://` avec `NODE_ENV=production`  | La validation **jette** avant toute connexion, avec un code d'erreur structuré                                          | `config.ts` → `validateConfig`           |
| WS-03 | Cohérence du battement de cœur validée             | `timeoutMs >= intervalMs`                  | **Jette** — un délai d'attente plus long que l'intervalle déclarerait la connexion perdue en permanence                 | `config.ts` → `validateConfig`           |
| WS-04 | Machine à cinq états                               | Cycle de vie de la connexion               | `disconnected` → `connecting` → `connected`, puis `disconnected` → `reconnecting` → `connected`, ou `failed`            | `connection-manager.ts`                  |
| WS-05 | Retrait exponentiel plafonné                       | Coupure                                    | Délai = `initialDelayMs × 2^(tentative-1)`, plafonné à `maxDelayMs`                                                     | `connection-manager.ts`                  |
| WS-06 | Réessais infinis possibles                         | `maxRetries: 0`                            | Le plugin ne renonce **jamais** — la posture voulue pour une application hors-ligne d'abord                             | `connection-manager.ts`                  |
| WS-07 | Ré-abonnement automatique                          | Reconnexion réussie                        | **Tous** les canaux actifs sont ré-abonnés avant que quoi que ce soit d'autre ne parte                                  | `channel-manager.ts` → `resubscribeAll`  |
| WS-08 | Vidage de la file **après** le ré-abonnement       | Reconnexion réussie                        | Les messages en attente partent **dans l'ordre**, une fois les canaux rétablis                                          | `connection-manager.ts`, `send-queue.ts` |
| WS-09 | Un canal, un gestionnaire                          | Deuxième `subscribe` sur le même canal     | Le gestionnaire précédent est **remplacé** — pas de diffusion à plusieurs abonnés                                       | `channel-manager.ts` → `subscribe`       |
| WS-10 | Désabonnement idempotent                           | `subscribe()` rend une fonction            | L'appeler deux fois est sans effet ; `unsubscribe(canal)` sur un canal inconnu aussi                                    | `channel-manager.ts`                     |
| WS-11 | File d'envoi pendant la coupure                    | `send()` alors que la connexion est perdue | Le message est mis en file quand `queueOnDisconnect` le permet, sinon il est **abandonné**                              | `send-queue.ts`                          |
| WS-12 | Débordement de file : le plus **ancien** part      | File pleine                                | Le plus ancien message est jeté et un événement de débordement est émis — le plus récent est le plus pertinent          | `send-queue.ts`                          |
| WS-13 | Taille de file plancher                            | `maxQueueSize: 0`                          | Ramené à `1` — une file de taille nulle serait indiscernable d'une file désactivée                                      | `send-queue.ts`                          |
| WS-14 | Battements de cœur                                 | `heartbeat.enabled: true`                  | Un `ping` par intervalle ; sans réponse dans le délai, la connexion est déclarée perdue et la reconnexion s'enclenche   | `heartbeat-manager.ts`                   |
| WS-15 | Le transport est nommé dans l'événement de timeout | Transport personnalisé                     | L'événement porte la **clé configurée**, pas le nom du transport intégré — sinon un transport tiers serait mal étiqueté | `heartbeat-manager.ts`                   |
| WS-16 | Métriques instantanées                             | `getMetrics()`                             | Instantané **immuable** : connexion, reconnexions, messages, dernier ping, canaux actifs, longueur de file              | `metrics-collector.ts`                   |
| WS-17 | Métriques lisibles **avant** l'initialisation      | `getMetrics()` avant `init()`              | Rend un instantané neutre au lieu de jeter                                                                              | `public-api.ts`, `metrics-collector.ts`  |
| WS-18 | Reconnexion forcée                                 | `reconnect()`                              | Réinitialise le compteur de tentatives ; **sans effet** si la connexion est déjà établie                                | `ws-lifecycle.ts`                        |
| WS-19 | Démontage idempotent                               | `destroy()`                                | Déconnecte, vide les abonnements, remet les métriques à zéro — appelable plusieurs fois                                 | `ws-lifecycle.ts` → `wsDestroy`          |
| WS-20 | L'objet d'API survit aux cycles                    | `init()` → `destroy()` → `init()`          | Les collaborateurs sont **remplacés**, pas mutés : la référence rendue par `buildPublicApi()` reste valable             | `ws-lifecycle.ts`                        |
| WS-21 | Transport personnalisé                             | `registerTransport(clé, fabrique)`         | La clé devient utilisable dans `config.transport`                                                                       | `transports/transport-registry.ts`       |
| WS-22 | Douze événements de diagnostic                     | Cycle de vie de la connexion et des canaux | Émis sur le document — connexion, coupure, reconnexion, échec, abonnements, file, battement, métriques                  | `event-bus-bridge.ts`                    |

Les tests qui couvrent ces lignes : `packages/plugins/websocket/src/__tests__/` — l'emplacement
canonique imposé par le contrat de plugin.

---

## Configuration

**Elle est passée à l'appel, jamais lue dans un profil.** C'est la différence la plus visible avec
tous les autres sujets fichés jusqu'ici : aucun bloc `modules.*`, aucun schéma, aucune gate de
couverture de configuration.

| Clé                        | Type                   | Défaut  | Rôle                                                                                |
| -------------------------- | ---------------------- | ------- | ----------------------------------------------------------------------------------- |
| `transport`                | `string` — obligatoire | —       | `"native-ws"` ou une clé enregistrée à la main                                      |
| `url`                      | `string` — obligatoire | —       | Point d'accès. **Doit être `wss://` en production** — la validation le refuse sinon |
| `auth`                     | `object`               | —       | **Réservé** — le transport intégré ne l'utilise pas                                 |
| `reconnect.initialDelayMs` | `number`               | `1000`  | Délai avant la première tentative                                                   |
| `reconnect.maxDelayMs`     | `number`               | `30000` | Plafond du retrait exponentiel                                                      |
| `reconnect.maxRetries`     | `number`               | `10`    | **`0` signifie infini**, pas « aucun essai »                                        |
| `heartbeat.enabled`        | `boolean`              | `false` | Active la surveillance par ping                                                     |
| `heartbeat.intervalMs`     | `number`               | `25000` | Période entre deux pings                                                            |
| `heartbeat.timeoutMs`      | `number`               | `5000`  | Attente d'une réponse — **doit être strictement inférieur à l'intervalle**          |
| `queueOnDisconnect`        | `boolean`              | `true`  | Met en file les envois pendant une coupure                                          |
| `maxQueueSize`             | `number`               | `100`   | Taille de la file — ramenée à `1` au minimum                                        |

⚠️ **`maxRetries: 0` est un piège de lecture.** Zéro veut dire **infini**, pas « ne réessaie pas ».
C'est délibéré, et motivé : une application hors-ligne d'abord ne doit jamais renoncer à se
reconnecter.

⚠️ **Aucune de ces clés n'est gatée**, contrairement à la table du manifeste. Elles se relisent
contre `config.ts` à chaque modification — c'est la part humaine de la règle ⛔ de `CLAUDE.md`.

⚠️ **La validation ne vérifie PAS que le transport est enregistré.** C'est délibéré et documenté sur
place : cette responsabilité appartient au registre de transports, au moment de la création. Une
clé inconnue échoue donc plus tard, pas à la validation.

---

## Contrat exposé

### API publique — `GeoLeaf.Ws`

Construit par `public-api.ts` → `buildPublicApi()`, monté par `entry.ts`. La façade **ne fait que
déléguer** : tous les collaborateurs et la séquence de cycle de vie vivent dans `ws-lifecycle.ts`.

| Membre                           | Rend / fait                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `init(config)`                   | Valide, applique les défauts, connecte — la promesse se résout à la connexion |
| `destroy()`                      | Déconnecte, vide les abonnements, remet les métriques à zéro. Idempotent      |
| `reconnect()`                    | Force une reconnexion et réinitialise le compteur de tentatives               |
| `state`                          | **Accesseur en lecture** — l'état courant, jamais une copie figée             |
| `subscribe(canal, gestionnaire)` | Rend une fonction de désabonnement **idempotente**                            |
| `unsubscribe(canal)`             | Sans effet si le canal n'est pas abonné                                       |
| `send(canal, charge)`            | Envoie, ou met en file si la connexion est perdue                             |
| `getSubscriptions()`             | Les noms des canaux actifs                                                    |
| `getMetrics()`                   | Instantané — **sûr avant `init()`**                                           |

⚠️ **`state` est un accesseur, pas une valeur.** C'est ce qui permet à l'objet rendu par
`buildPublicApi()` de rester juste après un cycle démontage → remontage : il relit l'état à chaque
lecture au lieu d'en avoir capturé un.

### Point d'extension

`registerTransport` est ré-exporté **en valeur** depuis l'entrée — c'est le seul export de valeur du
paquet en dehors des effets de bord. Un tiers peut donc fournir son propre transport (un canal
d'entreprise, un test, un simulateur) et le désigner par `config.transport`.

⚠️ **`JwtAuth` et `CredentialsAuth` s'y sont ajoutés le 31/07/2026, et c'était un défaut de CODE
révélé par une gate DOCUMENTAIRE.** Le `README.md` du paquet enseignait
`import type { JwtAuth } from "@geoleaf-plugins/websocket"` depuis la v1.0 ; l'entrée ne les
ré-exportait pas, donc l'import rendait **TS2305** chez le consommateur. Le README avait raison
sur l'intention — `TransportConfig.auth` est typé `JwtAuth | CredentialsAuth`, ces formes sont la
moitié **config** du même contrat de transport personnalisé que `registerTransport` sert. Les deux
sont exportés ensemble : n'en publier qu'un aurait reconstruit le même piège pour qui type un
objet d'authentification. Invisible jusque-là parce que le corpus des gates d'exemples s'arrêtait
à `packages/core/docs/`.

### Événements — douze, tous non typés

| Famille      | Événements                                                                                |
| ------------ | ----------------------------------------------------------------------------------------- |
| Connexion    | `geoleaf:ws:connected` · `:disconnected` · `:reconnecting` · `:failed` · `:auth-required` |
| Canaux       | `geoleaf:ws:channel-subscribed` · `:channel-unsubscribed`                                 |
| File d'envoi | `geoleaf:ws:send-queued` · `:send-dropped` · `:send-queued-overflow`                      |
| Surveillance | `geoleaf:ws:heartbeat-timeout` · `:metrics-updated`                                       |

⚠️ **Les douze sont dans la liste de référence des événements NON typés**
(`scripts/.baselines/event-map-coverage.json`) — le contrat d'événements du core ne les décrit pas.
C'est cohérent avec leur nature : ce sont des signaux de diagnostic d'un plugin, pas des points
d'extension du core. Le gisement complet des événements non typés est
**B-23**.

⚠️ **L'émission passe par le document, jamais par la façade d'événements du core.** C'est le patron
du dépôt pour les plugins : `GeoLeaf.events` est une surface d'**abonnement** pour les
consommateurs, pas un canal d'émission pour les producteurs.

### Stockage écrit

Aucun.

---

## Décisions de conception

| Décision                                                            | Pourquoi                                                                                                                                                                                                                                                                                                                                                                                     | Alternative écartée                                                                                                                                                                                                        |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Un registre de transports extensible, un seul paquet** (ADR-WS01) | Le plugin doit servir des dorsales variées sans se coupler à chacune. Le contrat `IWsTransport` est minimal et stable, le consommateur garde la main entière sur son transport (authentification, reconnexion interne, protocole), et **ajouter un transport ne modifie aucun code existant**. Le prix est explicite : le consommateur doit appeler `registerTransport()` **avant** `init()` | **Un paquet par dorsale** (`…-socketio`, `…-mqtt`) — prolifération de paquets pour chaque variante · **une classe abstraite et ses sous-classes** — impose l'héritage à qui n'en veut pas, et s'accommode mal de l'ESM pur |
| **Configuration à l'appel, pas dans un profil**                     | Une URL de service temps réel et une politique de reconnexion sont des paramètres de **déploiement applicatif**, pas de contenu cartographique. Les mettre dans un profil les ferait voyager avec la donnée                                                                                                                                                                                  | Un bloc `modules.websocket`                                                                                                                                                                                                |
| **Façade purement déléguante**                                      | La séparation façade / implémentation est une règle du dépôt. Elle a une conséquence concrète ici : les collaborateurs peuvent être remplacés à chaque `init()` sans invalider l'objet public                                                                                                                                                                                                | Tenir les singletons dans la façade                                                                                                                                                                                        |
| **`state` en accesseur**                                            | Corollaire du point précédent : une valeur capturée mentirait après un cycle de remontage                                                                                                                                                                                                                                                                                                    | Une propriété simple                                                                                                                                                                                                       |
| **Les collaborateurs sont REMPLACÉS, pas remis à zéro**             | Un objet neuf ne peut pas porter un reste de l'état précédent ; une remise à zéro manuelle, si                                                                                                                                                                                                                                                                                               | Réinitialiser les instances existantes                                                                                                                                                                                     |
| **Ré-abonnement AVANT le vidage de la file**                        | Un message vidé avant que son canal ne soit rétabli partirait dans le vide, sans erreur                                                                                                                                                                                                                                                                                                      | Vider la file d'abord                                                                                                                                                                                                      |
| **Un seul gestionnaire par canal**                                  | La diffusion à plusieurs abonnés demande une politique de désabonnement et d'ordre que rien ici ne réclame. Le remplacement est prévisible                                                                                                                                                                                                                                                   | Une liste de gestionnaires par canal                                                                                                                                                                                       |
| **Le débordement jette le plus ANCIEN**                             | Sur un flux temps réel, le message le plus récent est le plus pertinent. Jeter le nouveau conserverait un état périmé                                                                                                                                                                                                                                                                        | Refuser le nouveau message                                                                                                                                                                                                 |
| **`maxRetries: 0` = infini**                                        | Une application hors-ligne d'abord ne doit jamais renoncer. La valeur sentinelle évite un second drapeau qui pourrait contredire le compteur                                                                                                                                                                                                                                                 | Un drapeau `infiniteRetries` séparé                                                                                                                                                                                        |
| **Taille de file ramenée à 1 au minimum**                           | Une file de taille nulle serait indiscernable d'une file désactivée, alors que ce sont deux intentions différentes                                                                                                                                                                                                                                                                           | Honorer `0` littéralement                                                                                                                                                                                                  |
| **TLS imposé seulement en production**                              | Un développement local sur `ws://` doit rester possible ; une mise en production sur du non chiffré, non                                                                                                                                                                                                                                                                                     | Imposer `wss://` partout                                                                                                                                                                                                   |
| **La validation n'inspecte pas le registre de transports**          | La disponibilité d'un transport est une question de **moment**, pas de forme : il peut être enregistré après la validation et avant la création                                                                                                                                                                                                                                              | Valider la clé de transport à l'entrée                                                                                                                                                                                     |
| **Le nom du transport voyage dans l'événement de timeout**          | Sans lui, un transport tiers défaillant serait rapporté sous le nom du transport intégré — et le diagnostic partirait sur le mauvais code                                                                                                                                                                                                                                                    | Rapporter le nom du transport par défaut                                                                                                                                                                                   |
| **Le `healthCheck` teste l'ÉTAT, pas la présence**                  | Pour un transport, « monté » ne veut rien dire. « Connecté », si                                                                                                                                                                                                                                                                                                                             | Vérifier l'existence du namespace, comme les autres plugins                                                                                                                                                                |
| **Émission par le document**                                        | `GeoLeaf.events` est une façade d'abonnement en lecture seule pour les consommateurs ; un plugin qui émettrait par elle inverserait le sens du contrat                                                                                                                                                                                                                                       | Émettre par la façade d'événements du core                                                                                                                                                                                 |
| **Aucun démarrage automatique**                                     | Le plugin ne peut pas deviner l'URL ni la politique de reconnexion. Un démarrage automatique supposerait une configuration qu'il n'a pas                                                                                                                                                                                                                                                     | S'initialiser sur `geoleaf:app:ready`                                                                                                                                                                                      |

---

## Dépendances et frontières

### Conformité au contrat gelé

```bash
node scripts/verify-plugin-contract.cjs --plugin=websocket
```

### Dépendances

**Une seule, et elle est le core** — aucune dépendance externe. C'est le plugin le plus léger de ce
palier, et l'écart avec [`realtime-layer`](CDC_realtime-layer.md) tient entièrement à la
bibliothèque protobuf de ce dernier.

### Frontières

- **Aucun import de `@geoleaf/core` en code** : le plugin lit `globalThis.GeoLeaf` à l'import, et
  ne monte rien si le namespace est absent.
- **Aucun accès à la carte, aucune notion de couche.** Un canal transporte une charge utile opaque ;
  c'est [`realtime-layer`](CDC_realtime-layer.md) qui lui donne un sens cartographique.
- **La relation avec `realtime-layer` est à SENS UNIQUE et tardive** : c'est l'autre plugin qui lit
  `GeoLeaf.Ws` au démarrage de sa source. Ce plugin ne connaît pas son consommateur, et son
  manifeste ne le mentionne pas.

### Ce que la fiche a re-mesuré — B-24

**B-24** ouvre sur `HeartbeatConfig`, déclaré **deux fois**
dans ce paquet. Le pré-vol confirme la duplication et **requalifie le risque** :

| Ce que B-24 énonce                                                                                       | Ce que la mesure donne                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deux déclarations divergentes du même nom, dans le même paquet                                           | ✅ **Exact** — la publiée rend deux champs facultatifs, la locale les exige                                                                                           |
| « Un appelant qui suit la surface publiée satisfait le type exporté et pas celui qu'`attach()` utilise » | ❌ **Ce cas n'existe pas.** `HeartbeatManager` n'est ré-exporté ni par l'entrée ni par la carte d'exports du paquet : `attach()` est **inatteignable de l'extérieur** |
| Le risque porte sur un contrat public                                                                    | ❌ Son **unique** appelant est interne et lui passe toujours la configuration **résolue**, où les trois champs sont présents par construction                         |

**Ce qui reste vrai** : deux descriptions du même objet tenues à la main, qu'aucune gate ne relie —
troisième occurrence du motif dans ce dépôt. C'est un défaut de **maintenance**, pas de contrat.

---

## Écarts au CDC source

Le CDC `CDC_plugin-websocket.md` a été **consommé** en écrivant cette fiche. ⚠️ **Il n'a PAS été
retiré du dossier de tri** — même motif que les CDC précédents, tracé au §Journal des décisions de
`roadmap_documentation-v3.md`.

⚠️ **Comme celui de [`realtime-layer`](CDC_realtime-layer.md), ce CDC porte sa propre table de
vérifications croisées** — dix affirmations adossées à un fichier. Neuf tiennent. Voici l'écart, et
il est **livré aux intégrateurs**.

| Énoncé du CDC                                                                             | Ce que dit le code                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Croisée n° 8 — « `MockTransport` exporté via `./test-utils` dans `package.json#exports` » | ❌ **La sous-voie n'existe plus.** La carte d'exports ne déclare que `.` et `./package.json` — et une carte d'exports **bloque** toute sous-voie non listée. `import … from "@geoleaf-plugins/websocket/test-utils"` échoue          |
| §2.19 — le double simulé est offert aux consommateurs                                     | Le fichier est **bien livré** (`test-utils/` est dans `files[]`, donc dans l'archive npm) et son propre en-tête documente le chemin d'import qui ne résout pas. Ligne **B-65** du registre                                           |
| Croisée n° 3 — « `init()` sur plugin initialisé → `public-api.ts` »                       | Le **comportement** tient (`wsInit` appelle `wsDestroy` avant de reconstruire) ; **le fichier a changé** : la logique est passée dans `ws-lifecycle.ts`, la façade ne fait plus que déléguer                                         |
| §2.19 — « 9 suites Vitest »                                                               | ✅ **Vérifié exact** — mais le décompte de tests, lui, ne se recopie pas                                                                                                                                                             |
| Croisées n° 1, 2, 4, 5, 6, 7, 9, 10                                                       | ✅ **Vérifiées exactes** — validation TLS et battement de cœur, cinq états, remplacement de gestionnaire, file d'envoi, ré-abonnement avant vidage, formule de retrait, et le code de fermeture 1008 traité en échec non réessayable |

⚠️ **Pourquoi rien ne rougit sur l'écart de sous-voie** : les tests du paquet importent le double par
un **chemin relatif** (`../../test-utils/…`), pas par le nom du paquet. Ils ne peuvent donc pas voir
que la porte d'entrée publique est fermée. C'est très exactement le motif « une garde qui ne regarde
pas le chemin réel ne garde rien ».

Ce qui a été **retenu** du CDC et ne se lit pas dans le code : le motif de la machine à cinq états
et de son ordre de reprise, la posture « hors-ligne d'abord » qui justifie les réessais infinis, les
quatre scénarios d'usage (positions de navires, coupure réseau transparente, file hors-ligne d'un
traceur, transport tiers), la décision d'architecture sur le registre de transports extensible, et
les alternatives écartées de la table §Décisions.

⚠️ **Le champ `auth` est la trace d'une fonctionnalité annoncée et non livrée**, et le CDC le dit
franchement : les types existent comme **contrat pour un transport tiers**, l'authentification réelle
repose sur les mécanismes du navigateur (cookies de session, en-têtes envoyés à la poignée de main).
Cette fiche le répète à sa place plutôt que de le laisser passer pour une capacité — c'est
exactement la classe du `delayField` réservé de [`realtime-layer`](CDC_realtime-layer.md).
