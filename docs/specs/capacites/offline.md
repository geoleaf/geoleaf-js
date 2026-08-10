---
type: spec-capacite
title: offline — le moteur hors ligne, et la façade que pilote son interface
capability_id: offline
package: "@geoleaf/core"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 5519b37e
date: 8 août 2026
---

# offline — le moteur hors ligne, et la façade que pilote son interface

**Type :** capacité in-core · **Code :** `packages/core/src/capabilities/offline/` ·
**Vérifié contre :** `5519b37e` (08/08/2026)

> ⚠️ **Ce que cette estampille couvre, et ce qu'elle ne couvre pas.** Les **cinq** énoncés
> drapeautés de la table §Fonctionnalités ont été re-vérifiés dans le code à ce commit — OF-04,
> OF-05, OF-07, OF-17, OF-18 — et **les cinq étaient périmés** (voir le bloc dédié). Le reste de la
> fiche est repris de la vérification du **28/07/2026** (`1a8f7137`) et n'a **pas** été re-mesuré.
> Une estampille qui prétendrait couvrir 780 lignes relues serait exactement le genre d'énoncé que
> ce champ existe pour empêcher.

> **Deux règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.

> ⚠️ **Ce système se lit en DEUX fiches, et la coupure suit une frontière de PAQUET, pas de
> commodité.** Celle-ci décrit le **moteur** — base locale, cache, téléchargement, synchronisation,
> éviction — et la façade `GeoLeaf.Storage` que pose `packages/core/src/kernel/storage/facade.ts`.
> Son **unique interface utilisateur** est publiée séparément :
> [`CDC_offline-ui.md`](../plugins/CDC_offline-ui.md).
>
> **Le core ne connaît pas ce plugin, et ne le connaîtra pas.** Mesuré : les seules mentions de
> `offline-ui` sous `capabilities/offline/` sont **trois commentaires**, zéro import, zéro
> référence d'exécution, zéro condition sur sa présence. C'est la règle `no-plugin-in-core`, tenue.

---

## Périmètre

### Ce que la capacité fait

Elle **télécharge un profil pour un usage hors réseau** — couches, tuiles, sprites, icônes — dans une
base locale du navigateur, en suit la progression, **évince** ce qui dépasse le budget, et **rejoue**
les objets créés hors ligne quand le réseau revient.

### Ce qu'elle ne fait pas

- **Elle n'a aucune interface.** Pas un bouton, pas une fenêtre. Tout est dans l'autre fiche.
- **Elle n'a ni `config.ts`, ni `public-api.ts`, ni `module.ts`** — trois absences du patron, toutes
  motivées. Voir §Une capacité sans trois de ses six fichiers.
- **Elle ne rejoue pas les objets elle-même.** Elle appelle un **gestionnaire déposé** par un plugin
  au travers d'un seam — c'est ce qui lui permet de rejouer des points sans connaître
  [`editor`](../plugins/CDC_editor.md).
- **Elle n'est pas chargée au démarrage.** Son moteur arrive par **import dynamique**, hors du
  chemin de boot.

---

## Une capacité sans trois de ses six fichiers

Le patron du dépôt compte six fichiers d'échafaudage. Celle-ci en a **trois**, et chaque absence a
son motif — inscrit dans le code, pas ici.

| Fichier                 | Présent | Ce qui tient sa place                                                                                                                |
| ----------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `offline-capability.ts` | ✅      | —                                                                                                                                    |
| `install.ts`            | ✅      | —                                                                                                                                    |
| `lifecycle.ts`          | ✅      | —                                                                                                                                    |
| `config.ts`             | ❌      | `config-seam.ts` — un **lecteur générique par chemin**, pas un porteur de défauts. La configuration est **poussée** par l'installeur |
| `public-api.ts`         | ❌      | La surface publique est `GeoLeaf.Storage`, posée par le **kernel**, pas par la capacité                                              |
| `module.ts`             | ❌      | Pas de `createModule` : la capacité s'exécute comme une **étape du cycle de vie partagé**                                            |

⚠️ **Le motif de l'absence de `config.ts` n'est PAS redupliqué ici.** Il vit dans
`NO_CONFIG_ACCESSOR` (`__tests__/capabilities/scaffold-taxonomy.test.js`), qui est la liste que la
gate d'échafaudage lit. Conséquence directe : le garde de cette fiche **saute** sa vérification du
défaut _appliqué_, faute de lecteur à interroger — seul le défaut _annoncé_ est confronté.

---

## Fonctionnalités

| ID    | Fonctionnalité                                  | Entrée                                    | Sortie observable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Code                                                                                |
| ----- | ----------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| OF-01 | Chargement **dynamique** du moteur              | Gate ouvert                               | Le moteur arrive par `import()`, hors du chemin de démarrage — c'est ce qui rend la capacité gratuite quand elle est éteinte                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `offline-capability.ts` → `loader`, `offline-engine-entry.ts`                       |
| OF-02 | Étape de cycle de vie partagé, **rang libre**   | Configuration fusionnée                   | 🛑 Cette ligne disait « **après `pwa`** / Position au manifeste / L'ordre est un contrat » jusqu'au 08/08/2026 — **réfuté** par `shared-lifecycle-order.test.ts` (7.4). Le gate qui tient la dépendance est `modules.pwa.enabled`, lu dans le sac fusionné : disponible quel que soit le rang. Le sous-motif produit (« sans l'ouvrier de service, le cache n'aurait rien pour servir ») est vrai au niveau **produit** et ne justifie pas la position — l'enregistrement du SW est de toute façon différé de 3 s                                                                                                                                                                                                                                                                                                                                                                                                         | `install.ts` → `sharedLifecycle`                                                    |
| OF-03 | Double gate : la capacité **et** `pwa`          | Configuration fusionnée                   | Les deux doivent être actives. La dépendance est vérifiée **à la main**, pas par le registre — voir §Dépendances                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `install.ts`, `lifecycle.ts`                                                        |
| OF-04 | Téléchargement d'un profil complet              | `cacheProfile(profileId)`                 | ✅ **RÉSOLU (tâche 4.2, complétée par 8.9).** Tuiles, sprites, glyphes, icônes **et GeoJSON de couche** en base locale. Le chemin de donnée est résolu par `layerDataPath()`, qui accepte la forme **brute** (`data.directory` + `data.file`, celle des configs sur le disque) comme la forme **normalisée** (`dataFile`, produite par `profile-loader.ts`) — la dérivation est centralisée là et non refaite sur place, précisément pour n'avoir pas deux endroits libres de diverger. ⚠️ Cette ligne a dit « **PAS les couches** […] jamais mis en cache » jusqu'au 08/08/2026 : vrai à sa date, périmé à la clôture de `collecte-terrain-offline`. La tâche **8.9** a ajouté la branche manquante — une instance de `layerTemplates` porte sa config **en ligne**, n'a donc aucun `configFile`, et traversait l'énumérateur sans produire une seule ressource                                                          | `cache/cache-manager.ts`, `cache/downloader.ts`, `utils/general/layer-data-path.ts` |
| OF-05 | Énumération des ressources avant téléchargement | Profil                                    | ✅ **RÉSOLU (tâche 4.2).** La liste est calculée d'abord et **inclut les couches** : le volume annoncé et la barre de progression portent la donnée métier. ⚠️ Cette ligne a dit le contraire — « exclut les couches », volume « systématiquement sous-évalué » — jusqu'au 08/08/2026, par simple dérivation d'OF-04 : elle était fausse **parce que** celle du dessus l'était, pas pour une cause propre                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `cache/resource-enumerator.ts`, `cache/calculator.ts`                               |
| OF-06 | Progression, en deux régimes                    | Téléchargement, purge                     | Deux signaux distincts — un pour le remplissage, un pour le vidage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `cache/progress-tracker.ts`, `db/layers.ts`                                         |
| OF-07 | Annulation d'un téléchargement en cours         | `cancelDownload()`                        | ✅ **RÉSOLU (clôture de S3c).** Le téléchargement s'arrête **et** l'interface en est informée : l'émetteur de production vit dans `cache-manager.ts`, aux côtés du commentaire qui raconte son ajout. ⚠️ Cette ligne a dit « **deux écouteurs et zéro émetteur de production** — le seul `dispatchEvent` du dépôt est dans un **test** » jusqu'au 08/08/2026, alors que le §Annulation de cette même fiche décrivait déjà l'ajout : **la fiche se contredisait elle-même**, et c'est la table qui avait tort                                                                                                                                                                                                                                                                                                                                                                                                              | `cache/cache-manager.ts`, `cache/fetch-manager.ts`                                  |
| OF-08 | Reprise sur erreur réseau                       | Échec ponctuel                            | Nouvelle tentative avec temporisation croissante plutôt qu'abandon                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `cache/retry-handler.ts`                                                            |
| OF-09 | Garde d'URL                                     | Ressource à récupérer                     | Les URL sont filtrées avant d'être demandées                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `cache/url-guard.ts`                                                                |
| OF-10 | Budget d'octets, avec **éviction**              | `maxCacheBytes`                           | Après chaque téléchargement, les enregistrements les moins récemment mis en cache sont évincés jusqu'à tenir dans le budget                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `cache/cache-manager.ts`                                                            |
| OF-11 | Budget désactivable                             | `maxCacheBytes: 0`                        | Aucune éviction — c'est la valeur qui **éteint** le mécanisme, pas un budget nul                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `cache/cache-manager.ts`                                                            |
| OF-12 | Sélection de couches persistée                  | Choix de l'utilisateur                    | La sélection survit d'une session à l'autre                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `cache/storage.ts`                                                                  |
| OF-13 | Résolution du style et des tuiles               | Style du fond                             | Les tuiles nécessaires sont déduites du style, pas déclarées à la main                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `cache/style-resolver.ts`, `cache/tile-math.ts`                                     |
| OF-14 | Base locale en modules enregistrés              | —                                         | Images, couches, préférences — et depuis la **v4** (tâche 3.4) `features` (une entité par enregistrement) et `outbox` (la file d'écritures qui remplacera `sync_queue`) : **sept modules**, un registre **interne** (plus de global)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `db/db-modules-registry.ts`                                                         |
| OF-15 | Signal de dépassement de quota navigateur       | Écriture refusée                          | Un signal dédié, distinct d'une erreur générique                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `db/layers.ts`                                                                      |
| OF-16 | File de synchronisation                         | Objets créés hors réseau                  | ✅ **RÉSOLU le 02/08/2026 (tâche 3.3).** La charge utile atterrit. Le défaut n'était pas dans `db/sync.ts` — ses `?? null` sont des filets — mais dans la **façade** `indexeddb.ts`, qui remappait `operation.data` vers `poiData` alors qu'aucun des trois appelants n'utilisait cette forme, et qui n'avait **aucun slot pour `payload`**, lu par `editor-sync-replay`. La façade est devenue un passe-plat ; les trois appels étaient corrects tels quels. ⚠️ La ligne de roadmap disait d'aligner le PLUGIN sur l'implémentation : la mesure l'a inversée                                                                                                                                                                                                                                                                                                                                                             | `db/sync.ts`                                                                        |
| OF-17 | Rejeu par gestionnaire **déposé**               | `Sync.registerHandler(id, handler)`       | ✅ **RÉSOLU — et l'énoncé était faux par son MOTIF, pas par son fait.** Il reste exact que `getHandler` n'a aucun appelant in-core et que son seul lecteur est `offline-ui` ; ce qu'on en déduisait ne l'est pas. **Le drain est AUTONOME et vit dans `editor`** : `initSyncReplay()` pose un écouteur `online` qui appelle `flushNow` → `drainOutbox` → `Storage.pushOutbox`, plus une passe opportuniste au montage pour une file laissée par une session antérieure. Le seam `Sync` ne porte que le **bouton de rejeu manuel** d'`offline-ui`. ⚠️ Cette ligne a dit « le moteur ne rejoue pas » et « le rejeu exige qu'un plugin d'UI soit chargé » jusqu'au 08/08/2026 : **le rejeu n'exige rien de tel** — il exige le plugin qui a créé les entités, ce qui est acquis par construction. Le drain lui-même est in-core (`write/push-engine.ts`, tâche 4.5) et le verrou `_flushing` garantit un seul point d'entrée | `kernel/shared/sync-handler-seam.ts`, `api/geoleaf.sync.ts`, `write/push-engine.ts` |
| OF-18 | Restauration des objets locaux au démarrage     | Couches chargées **et** application prête | ✅ **RÉSOLU (3.3 puis 4.7).** La cause principale est tombée avec OF-16 : `poiData` n'est plus `null`. Et **4.7 a supprimé le filtre par vocabulaire de producteur** — le module lit l'`outbox`, qui ne parle qu'un seul vocabulaire entity-generic : « il n'y a plus rien à filtrer, ni personne à écarter ». Une géométrie tracée hors réseau avec l'éditeur est donc réaffichée. La charge utile vient du magasin `features`, plus de l'entrée. ⚠️ Cette ligne a annoncé « PARTIELLEMENT résolu » avec `POI_KINDS` écartant l'éditeur comme « étranger » jusqu'au 08/08/2026 — **`POI_KINDS` n'existe plus**, il ne survit que dans un commentaire. ⚠️ Le nom `poi-restore` est un abus depuis 4.7 : il restaure des **entités**, quel que soit le plugin qui les a saisies                                                                                                                                            | `poi-restore/poi-restore-boot.ts`, `poi-restore/poi-restore.ts`                     |
| OF-19 | Signal de disponibilité                         | Base ouverte                              | `_markReady()` débloque l'attente côté interface — c'est le rendez-vous des deux paquets                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `lifecycle.ts`                                                                      |
| OF-20 | Démontage                                       | Fin de cycle partagé                      | Exécuté **avant** celui de `pwa`, en ordre inverse du montage. ⚠️ Le **mécanisme** est réel (`s15-modules-storage-init.test.js` l'asserte) ; sa **conséquence** ne l'est pas — SLO-06 mesure le démontage invariant sous les deux ordres. Symétrie, pas dépendance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `install.ts` → `sharedTeardown`                                                     |

Les tests qui couvrent ces lignes vivent sous `packages/core/__tests__/`, et le périmètre exact se
mesure — il ne se recopie pas.

### 🛑 Six sorties observables étaient FAUSSES — corrigées le 02/08/2026

Elles ne l'étaient pas « un peu » : chacune décrivait un comportement que le code **n'a pas**, et
les six se tiennent par **deux causes** seulement.

| Énoncé        | Ce qu'il annonçait                            | La cause réelle                                                                       |
| ------------- | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| OF-04 · OF-05 | les couches sont téléchargées, volume annoncé | une clé lue qui n'existe dans **aucune** des 48 configs — ✅ **levée par 4.2**        |
| OF-16 · OF-18 | file conservée, objets restaurés              | la charge utile est écrasée par `?? null` à l'écriture — ✅ **levée par 3.3 et 4.7**  |
| OF-07         | l'interface est informée de l'annulation      | un événement à **deux écouteurs et zéro émetteur** de production — ✅ **levée à S3c** |
| OF-17         | le **moteur** rejoue                          | `getHandler` n'a aucun appelant dans le core — ✅ **levée : le MOTIF est tombé**      |

⚠️ **Ce que cet épisode enseigne, et qui dépasse cette fiche** : les six énoncés étaient dans la
colonne « Sortie observable », c'est-à-dire **exactement** la colonne qu'aucune gate ne vérifie. Les
tables **gatées** de ce dépôt (`## Configuration` d'une capacité, `## Manifeste` d'un plugin) sont
justes ; c'est la prose adjacente qui dérive. _Généré ≠ vrai ; généré = structurellement vrai._

**Aucune de ces six lignes ne se corrige par de la documentation seule.** Chacune pointe une tâche
de la roadmap `collecte-terrain-offline` — 4.2 pour la clé d'énumération, 3.3 pour la charge utile,
4.7 pour la restauration, 3.10 pour le rejeu. La fiche dit désormais **ce qui est**, et nomme ce qui
la rendra à nouveau positive.

🛑 **ET C'EST ARRIVÉ POUR LES SIX, SANS QUE CETTE FICHE LE DISE PENDANT DIX JOURS.** Relevé le
08/08/2026 en pré-volant les cinq énoncés encore drapeautés : **les cinq étaient périmés.** 3.3
avait soldé OF-16, **4.2 a soldé OF-04 et OF-05**, **4.7 a soldé OF-18** — le filtre par
vocabulaire de producteur est supprimé, pas contourné —, **S3c a soldé OF-07**, dont l'émetteur
existe, et **OF-17 est tombée par son MOTIF** (voir ci-dessous). Le bloc est intégralement levé.

**Le coût est réel** : ces lignes ont servi à annoncer un bloquant fonctionnel qui n'existait plus.
**Le mode d'échec est le n° 4 du pré-vol** (`CLAUDE.md`) — « le travail a été fait entre-temps »,
celui qui **ne se voit pas au grep** : `resource-enumerator.ts` contient toujours la chaîne
`dataFile`, et `poi-restore.ts` toujours le mot `foreign`, mais dans des **commentaires qui
racontent la correction**. Il se voit en relisant le JOURNAL, ou en ouvrant le fichier.

🛑 **OF-17 EST TOMBÉE AUTREMENT, ET C'EST LE MODE N° 6 — le plus discret.** Son FAIT est resté
vrai : `getHandler` n'a toujours aucun appelant in-core. C'est son MOTIF qui est mort — on en
déduisait « donc le rejeu exige un plugin d'UI », or `editor` draine tout seul sur l'événement
`online`. Un pré-vol qui ne cherche que la cible la déclare vivante et **conclut à l'envers** :
c'est arrivé ici même, une première fois, avant que le motif soit vérifié. `CLAUDE.md` le dit en
une ligne — « **re-vérifier le motif, pas seulement la cible** » — et c'est le seul des six modes
qu'un grep ne peut pas trancher, puisque le grep confirme l'énoncé.

⚠️ **Et OF-07 était réfutée PAR CETTE FICHE ELLE-MÊME** : le §Annulation décrit l'ajout de
l'émetteur pendant que la table le déclarait absent. Une fiche peut donc se contredire d'une
section à l'autre sans qu'aucune gate ne s'en aperçoive — la prose n'est comparée à rien, pas même
à elle-même.

La leçon du bloc ci-dessus se redouble donc : la colonne « Sortie observable » ne dérive pas
seulement quand le code change — **elle dérive aussi, et plus discrètement, quand le code est
réparé.** Un 🛑 ne se périme pas tout seul : rien ne le rouvre, et il survit à sa cause.

---

## Le schéma v4, et ce que le Service Worker en fait

_Posé par la tranche S3b du Sprint 3 (02/08/2026). Tout ce qui suit est gaté par
`__tests__/capabilities/offline/schema-v4.test.js` et `__tests__/storage/sw-core.test.js`._

**Six stores.** Quatre hérités — `layers`, `preferences`, `metadata`, `local_images` — plus les
deux de la v4 :

⚠️ **Il y en avait HUIT jusqu'au 04/08/2026.** `sync_queue` et `sync_backups` sont retirés à la
tâche **4.11** ; le décompte est gardé dans les deux sens — `indexeddb-init.test.js` compte ce qui
existe, `schema-v4.test.js` refuse ce qui reviendrait.

| Store      | Clé                       | Ce qu'il porte                                              |
| ---------- | ------------------------- | ----------------------------------------------------------- |
| `features` | `[layerId, localId]`      | Une **entité** par enregistrement (contrat `FeatureRecord`) |
| `outbox`   | `seq` (**autoIncrement**) | La file d'écritures (contrat `OutboxEntry`)                 |

🛑 **`features` n'est pas « protégé » de l'éviction, il lui est INATTEIGNABLE.** `db/eviction.ts`
ne connaît qu'un seul nom de store (`layers`). La règle dure du contrat — « ce qui porte du
travail non synchronisé n'est jamais évincé » — tient donc **sans dépendre d'aucun champ
correctement écrit**, ce qui est la forme la plus solide disponible. Une garde rougit le jour où
l'éviction apprend un second nom.

🛑 **B-03 est corrigé DANS LA CLÉ, et le correctif est un RETRAIT — sur les DEUX files.** En
`autoIncrement` (outbox), le générateur vit dans la base et sa monotonie est celle de l'ordre de
validation des transactions, la seule horloge que deux onglets partagent. L'index `id` y est
`unique`, ce qui fait _lever_ une collision qui, sur `keyPath: "id"`, faisait disparaître une
saisie en silence. **Il n'y a donc plus de tri à corriger : il y a un tri supprimé.**

⚠️ **Mais l'outbox n'a AUCUN producteur avant le Sprint 4, et c'est ce qui a fait durer le
défaut** : `sync_queue` — le chemin vivant — a continué de frapper `sync_<ms>_<random>` jusqu'à
la tâche **3.10**. À milliseconde égale c'était donc le hasard qui ordonnait, et le tri par
horodatage — stable depuis ES2019 — ne faisait que **transporter** cet ordre. La clé y est
désormais `sync_<ms>_<seq zéro-paddé>_<tag de session>` :

- **changement de FORMAT de valeur, pas de forme du store** — `keyPath` reste `"id"`, donc aucun
  bump de version et aucune migration (A16) ;
- la part aléatoire **n'a pas disparu, elle a changé de rôle** : placée _après_ le compteur, elle
  ne décide plus de l'ordre mais départage toujours deux onglets écrivant dans la même
  milliseconde. Un compteur nu les aurait laissés frapper le même id ;
- l'écriture passe de `put()` à **`add()`** : une collision **lève** au lieu d'écraser une
  capture en silence.

🛑 **`sync_queue` EST RETIRÉ (tâche 4.11), et le chemin par lequel il l'a été mérite d'être lu.**
Cette ligne a dit « il SURVIT à la v4, et pas au titre du legacy : il est encore le chemin vivant »
— et c'était vrai à la date où elle a été écrite. Le Sprint 4 a déplacé ses quatre usages
(`addpoi` 4.4b, `editor` 4.9, `poi-restore` 4.7, `offline-ui` 4.10), et il n'est resté que la
restauration de sauvegarde.

⚠️ **Elle annonçait aussi « son retrait la tâche 4.9 », et 4.9 ne l'a jamais porté.** Le commentaire
du schéma le lui attribuait, la ligne de roadmap ne le listait pas : deux documents, deux vérités,
aucun lecteur commun. C'est **B-124** qui a établi l'écart à la vérification de clôture du Sprint 4,
et **4.11** qui l'exécute — avec la chaîne de sauvegarde, son dernier usage.

### Ce que la file offre au rejeu — et ce qu'elle met de côté

_Tâche 3.10. Gaté par `__tests__/capabilities/offline/sync-queue-order.test.js`,
`__tests__/guards/sync-facade-surface.guard.test.js` et `e2e/28-offline-queue.spec.js`._

`getPendingSyncQueue()` rend les entrées **`pending` ET `failed`**. Elle n'interrogeait que
`index("status").getAll("pending")` : une saisie qui échouait une fois ne revenait **jamais**
dans la file. Sur un appareil de terrain c'est le mode de perte le plus probable de la chaîne —
une capture n'a ni copie serveur ni export, donc une entrée que la file cesse d'offrir est du
travail perdu, en silence.

⚠️ **Les deux lectures d'index sont FUSIONNÉES, pas concaténées ni re-triées.** Chacune revient
déjà en ordre de clé primaire, et la clé est monotone : la fusion n'interleave que. Un tri sur
un autre champ serait une seconde autorité d'ordre, c'est-à-dire la forme même de B-03.

| Budget                        | Où il vit                                | Ce qui se passe au bout                                                                        |
| ----------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `MAX_REPLAY_ATTEMPTS` (**3**) | `write/push-engine.ts`, constante unique | l'entrée passe `quarantined` — **retirée du rejeu, jamais du store**, et **comptée** au résumé |

⚠️ **Les deux colonnes de droite ont été fausses jusqu'au 09/08/2026, et par deux mécanismes
différents.** La première situait le budget dans `db/sync.ts` et son application dans
`updateSyncQueueStatus` — tous deux partis avec le magasin v3 à la **tâche 4.11**, soit dans le
paragraphe 🛑 qui ouvre cette même section. La seconde annonçait `rejectedByServer` comme motif
unique, ce qui n'a plus été vrai dès **B-125** (`retryBudgetExhausted`) puis **B-199**. Deux
énoncés dont la cible avait été supprimée ou réécrite sous eux — le mode d'échec n°3 du pré-vol,
dans une fiche qui décrit le module.

🛑 **Le plafond est appliqué au POINT DE SORTIE D'ÉCHEC** — `markFailure`, dans `push-engine.ts`
(B-125) : les quatre chemins d'échec du drain écrivaient chacun leur `failed` sans toucher
`attempts`. Un compteur que personne n'incrémente ne plafonne rien, et un plafond réparti sur
quatre sites se serait désynchronisé au premier cinquième chemin.

#### La classe du statut HTTP décide du sort de la saisie (B-199)

_Gaté par `__tests__/capabilities/offline/push-engine.test.js` §①quater._

| Réponse                               | Budget             | Motif au plafond         | Rejouable par l'opérateur |
| ------------------------------------- | ------------------ | ------------------------ | ------------------------- |
| réseau muet                           | consommé           | `retryBudgetExhausted`   | ✅                        |
| 408, 429, 500, 502, 503, 504          | consommé           | `retryBudgetExhausted`   | ✅                        |
| **501**                               | **court-circuité** | `notImplementedByServer` | ✅                        |
| autres 4xx (400, 401, 403, 405, 422…) | consommé           | `rejectedByServer`       | ❌                        |
| 404 sur `update`/`delete`             | court-circuité     | `deletedOnServer`        | ❌                        |
| couche sans cible d'écriture          | court-circuité     | `layerNoLongerWritable`  | ✅                        |

🛑 **Cette table n'existait pas, et son absence n'était pas une lacune de documentation : le code
n'avait qu'UNE branche.** Tout ce qui n'était ni 409 ni 404 sortait en `rejectedByServer` — motif
que le contrat définit comme « replay cannot fix » et que `REQUEUEABLE` exclut. Une maintenance
serveur épuisait donc le budget d'une saisie de terrain puis la rendait **non rejouable**, sa
seule sortie restante étant `discardQuarantined`, c'est-à-dire la destruction. Le drain se
déclenche au retour du réseau **et sur le bouton « Réessayer »**, et `attempts` est persistant en
base : trois clics d'opérateur pendant une fenêtre de maintenance suffisaient.

⚠️ **Ce que la table ne dit pas et qu'aucune gate ne dira** : le statut HTTP n'est **pas
persisté** sur l'entrée. Après quarantaine, `Log.warn` mis à part, rien ne permet de savoir si
c'était un 501, un 503 ou un 403 — seul le motif subsiste, et un motif est une classe, pas une
observation. Suivi au backlog en **B-200** ; le champ toucherait le magasin, donc la décision A16.

⚠️ **Coalescence et idempotence ne sont PAS ici, et c'est délibéré.** Elles exigent un `localId`
**indexé** que `sync_queue` n'a pas ; les poser dessus imposerait d'inférer une identité
d'entité **par vocabulaire d'opération** — le code que le contrat existe pour retirer. Elles
appartiennent à 4.4/4.5, avec les producteurs de l'outbox.

⚠️ **Aucune migration de données** — décision **A16** : l'application n'a pas d'utilisateurs.
Cette décision se périme au premier déploiement terrain et doit être relue à ce moment-là.

### Côté Service Worker

- **Il ne porte AUCUNE version** (décision T2′, tâche 3.1). `indexedDB.open("geoleaf-db")` sans
  second argument : la désynchronisation devient **inexprimable**, pas seulement difficile. Le
  contrôle de version est remplacé par une **détection de capacité**. Vérifié au passage en v4 :
  le worker a suivi **sans qu'une ligne change**.
- **Il ne retient aucune connexion** (`withIndexedDB`, fermeture en `finally`). Une connexion
  vivante est la seule chose qui bloque une montée de schéma — et ce risque **n'existait pas**
  avant que 3.1 ne fasse aboutir l'ouverture.
- **Le cache de tuiles survit au déploiement** (tâche 3.5) : `geoleaf-data-tiles`, sans version
  dans le nom. `activate` ne purge que les caches **versionnés** d'une autre version — ce qui
  survit, survit **par son nom**, pas par une liste d'exceptions.
- **Il route sur les origines DÉCLARÉES** (tâche 3.9), plus par sous-chaîne de hostname, ni par
  reniflage de chemin, ni sur une blacklist `/api/`. Les heuristiques restantes sont un chemin
  d'**amorçage** explicite, jamais emprunté par un profil qui déclare.
- **Une réponse opaque n'entre pas en cache, et on le DIT** (tâche 3.11). La décision est
  inchangée — une opaque est invérifiable et coûte au quota bien plus que sa taille —, mais une
  origine déclarée `cacheable: true` qui répond en opaque est désormais journalisée.

## Configuration

Bloc `modules.offline` d'un profil. Conformité de cette table au code gardée par
`__tests__/guards/doc-capability-config.guard.test.js`.

| Paramètre     | Type      | Défaut  | Où c'est lu                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------- | --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dataOrigins` | array     | `[]`    | `capabilities/offline/install.ts` → `lifecycle.ts` → `data-origins.ts` (normalisation), publié dans le store `preferences` et **relu par le Service Worker**. Remplace le routage par devinette : sous-chaînes de hostname, reniflage de chemin, domaine en dur et exclusion `/api/`. La forme d'un élément est `DataOriginDeclaration` (`contracts/sync.contract.ts`) — figée là, jamais dupliquée ici |
| `enabled`     | `boolean` | `false` | `install.ts` → étape de cycle de vie partagé. **Opt-in**, et conditionné à `modules.pwa.enabled`                                                                                                                                                                                                                                                                                                        |
| `cache`       | `object`  | —       | Passé tel quel au cycle de vie. Le schéma n'annonce **aucun** défaut à ce niveau — voir ci-dessous                                                                                                                                                                                                                                                                                                      |

⚠️ **`enableWhenAbsent: false` — c'est un VRAI opt-in**, et le seul de ce lot. Le contraste avec
[`legend`](legend.md), [`filter`](filter.md) et [`permalink`](permalink.md) est délibéré : celles-là
sont opt-out parce qu'un opt-in lirait `undefined` au démarrage et disparaîtrait en silence. Ici,
**disparaître en silence est le comportement voulu** — une capacité qui remplit la base locale du
navigateur ne doit pas s'activer par accident.

### Les sous-clés de `cache`

⚠️ **Cette table n'est PAS gatée**, et c'est structurel : le garde ne lit que les clés de **premier
niveau** du `configSchema`. `cache.enableTileCache` y serait rejeté comme « paramètre documenté
absent du configSchema ». L'en-tête dit `Sous-clé` et non `Paramètre` pour cette raison exacte —
c'est ce mot qui décide quelle table est lue.

| Sous-clé             | Type      | Défaut | Effet                                                                      |
| -------------------- | --------- | ------ | -------------------------------------------------------------------------- |
| `enableProfileCache` | `boolean` | `true` | Mettre en cache les couches du profil                                      |
| `enableTileCache`    | `boolean` | `true` | Mettre en cache les tuiles                                                 |
| `maxCacheBytes`      | `number`  | 250 Mo | Budget d'octets. **`0` désactive l'éviction**, il ne la rend pas immédiate |

⚠️ **Le défaut de `maxCacheBytes` est une duplication DÉLIBÉRÉE** d'une constante de
`cache/cache-manager.ts`, qui n'est pas exportée — précisément pour que le gestionnaire de cache
reste hors de la clôture de démarrage. L'égalité des deux valeurs est **épinglée** par
`__tests__/capabilities/config-schema-coverage.test.js`. C'est pour cela que la valeur est écrite
ici en prose et non en littéral : le chiffre a un propriétaire, et ce n'est pas ce document.

---

## Contrat exposé

### `GeoLeaf.Storage` — posée par le KERNEL, pas par la capacité

C'est le point le plus important de cette fiche, et le moins évident : la façade que tout le monde
appelle est montée par `packages/core/src/kernel/storage/facade.ts`, **qui s'auto-monte**. La
capacité, elle, y **injecte** ses modules quand son moteur arrive.

| Membre                             | Ce que c'est                                                |
| ---------------------------------- | ----------------------------------------------------------- |
| `DB`                               | La base locale et ses cinq modules                          |
| `CacheManager`                     | Téléchargement, état, quota, annulation                     |
| `Cache`                            | Persistance de la sélection, et le sélecteur de couches     |
| `isAvailable()`                    | Le moteur est-il injecté                                    |
| `isPluginLoaded()` · `whenReady()` | **Délégués au contrat partagé** — voir ci-dessous           |
| `pullLayer(layerId, options?)`     | **Rapatriement borné** (tâche 4.1) — voir ci-dessous        |
| `getSyncReport()`                  | **Rapport par couche** (tâche 4.8) — voir ci-dessous        |
| `getStats()`                       | Décomptes agrégés — compte les magasins **v4** depuis B-121 |

#### `pullLayer()` — le premier ÉCRIVAIN du store `features`

Posé par la tâche 4.1, le 04/08/2026. Le store `features` existait depuis 3.4 et avait reçu son
lecteur en 4.3 : `DBFeatures.put` comptait **zéro appelant** dans les sources.

Il applique `PullGranularity = "bboxCapped"` du contrat de synchronisation — emprise plus plafond —
et **n'écrit aucun code de transport** : `fetchOgcApiFeatures` portait déjà la pagination par lien
`next`, le `bbox`, `maxFeatures` et l'`AbortSignal`. Trois propriétés qui ne se lisent pas dans le
code et qui sont chacune tenues par un test **vu rougir** :

- **Le plafond est DUR.** `ogc-api-loader` coupe _après_ avoir accumulé une page entière et ne
  tronque jamais. Mesuré en navigateur : `maxFeatures: 15` contre des pages de 10 fait rendre **20**
  entités au chargeur ; l'orchestrateur en écrit **15** et pose `capped: true`.
- **Une saisie locale n'est jamais écrasée.** La décision vit dans `db/features.ts`
  (`putManyPreservingLocal`), dans **une** transaction : un enregistrement dont `syncState` n'est pas
  `synced` est sauté et compté `preserved`. Lire l'état dans l'orchestrateur puis écrire aurait laissé
  une fenêtre où l'écriture optimiste de 4.4 se glisse — la propriété n'aurait tenu que par le timing.
- **L'invariant S6 tient.** Les enregistrements sortent en `syncState: "synced"`, et rien n'est écrit
  dans l'`outbox` : le rapatriement ne confère jamais l'éditabilité.

⚠️ **L'attente du moteur est BORNÉE à 3 s**, comme la lecture de 4.3 — `whenReady()` ne résout jamais
quand `modules.offline` est désactivé. Mais contrairement à la lecture, il n'y a **aucun repli
réseau** : un rapatriement sans moteur _se dit_ (`refused: "engineUnavailable"`) plutôt que de rendre
un zéro que rien ne distingue d'une couche vide.

#### `getSyncReport()` — rendre observable le cas qui ne l'était pas

Posé par la tâche 4.8, le 04/08/2026. Il implémente `LayerSyncReport` / `LayerOfflineStatus` du
contrat de synchronisation, qui les déclaraient depuis l'Étape 1bis **sans aucun implémenteur**.

🛑 **Le cas qu'il existe pour rendre visible, et que rien ne pouvait montrer** : une couche
déclarée hors-ligne mais **jamais rapatriée**. Le contrat le dit sans détour — elle « ressemble
exactement à une couche rapatriée, jusqu'à l'instant où le réseau tombe ». C'est le seul défaut de
cette famille qui ne se voit pas en marchant : tout fonctionne, jusqu'au terrain.

⚠️ **Et il ne se dérive PAS du décompte d'entités.** Une couche rapatriée dont la source a rendu
zéro entité compte 0, exactement comme une couche jamais rapatriée. Les deux situations sont
opposées et le magasin ne les distingue pas. Il a donc fallu un **marqueur persisté** :
`report/pull-state.ts`, clé unique `offline.pullState` du store `preferences` — même patron que
`offline.dataOrigins`, aucun store neuf, aucun bump de schéma.

⚠️ **`updatedAt` du `FeatureRecord` ne pouvait pas en tenir lieu** : la tâche 4.1 l'a délibérément
gardé **local**, donc une saisie hors réseau le fait avancer sans qu'aucun rapatriement n'ait eu
lieu. Il daterait l'édition, pas le rapatriement.

| Statut                | Dérivé de                                                        |
| --------------------- | ---------------------------------------------------------------- |
| `notDeclared`         | la couche ne porte pas `offline.enabled`                         |
| `declaredNeverPulled` | déclarée, **aucune entrée** dans `offline.pullState`             |
| `pullFailed`          | dernière tentative en `outcome: "failed"`                        |
| `pulledStale`         | `outcome: "ok"` **et** `now - at > offline.maxAgeMs` **déclaré** |
| `pulled`              | `outcome: "ok"`, sinon                                           |

⚠️ **`pulledStale` ne se devine pas.** Sans `offline.maxAgeMs` déclaré, une couche rapatriée reste
`pulled` indéfiniment. Un seuil par défaut ferait lever des alertes de péremption qu'aucun
intégrateur n'a demandées et qu'aucun ne pourrait faire taire — un statut qu'on ne peut pas
calculer ne s'invente pas.

L'échec se persiste au même titre que le succès : sans cela, une couche dont la source est tombée
retomberait sur `declaredNeverPulled`, c'est-à-dire le **même** statut qu'une couche qu'on n'a
jamais tentée. « On a essayé et la source a dit non » est actionnable ; « on n'a jamais essayé »
ne l'est pas.

#### `getStats()` — et ce qu'il ne voyait pas (B-121)

`db/preferences.ts` ouvrait sa transaction sur `["layers", "sync_queue"]` — les deux magasins
**v3**. Tant que `features` n'avait aucun écrivain, ce zéro était **vrai** ; il est devenu faux le
jour où 4.1 a écrit 27 entités, et `offline-ui` affichait ce zéro. La transaction porte désormais
les trois magasins qui portent de la donnée, et `getStats()` expose `features.count` et
`outbox.count`.

⚠️ `layersCount` **reste** : le défaut était l'omission, pas sa présence.

🛑 **`syncQueueCount` part avec le magasin (4.11)**, et le bloc `sync: { pending, failed }` de
`Storage.getStats()` avec lui : sa seule source était ce compteur, donc il rapportait **0 en toutes
circonstances** depuis 4.4b, et `failed` n'était jamais assigné. La ventilation par état est
`getSyncCounts()`, qui rend `pendingCount` et `quarantinedCount` par couche.

⚠️ **La source de rapatriement se déclare dans `offline.source`, JAMAIS dans `data.ogcApi`** — et
c'est mesuré : l'early-exit `data.ogcApi` de `loader/single-layer.ts` rend la main **avant** la
branche de lecture locale, donc court-circuiterait en silence le store que ce rapatriement remplit.
`data.*` est la source d'**affichage**, `offline.source` la source de **rapatriement** ; après un
pull, la source d'affichage EST le store local. Le court-circuit a été fermé au passage (la branche
OGC lit le store d'abord quand la couche le déclare, et n'arme pas `autoRefresh`, qui refetcherait
le réseau au premier `moveend`).

**Mesures navigateur** (`scripts/probe-offline-pull.mjs`, contre le pygeoapi de `docker/backend/`) :
store vide → **27 écrites**, toutes avec `serverId`, `VersionMarker` et `synced` ; emprise
discriminante → **11** ; plafond à 15 sur des pages de 10 → chargeur **20**, store **15**.

⚠️ **Les deux derniers ont été ajoutés pour une raison précise, et elle vaut d'être connue.** Le
plugin d'interface importait auparavant le contrat partagé **directement**. Or un plugin chargé comme
module a **son propre graphe** : la copie qu'il embarquait n'était jamais initialisée, donc
`isAvailable()` rendait `false` pour toujours et l'attente ne se résolvait jamais — **toute
l'interface hors ligne était morte dans le paquet livré**. Déléguer depuis la façade a permis au
plugin de ne plus importer que le namespace.

### `GeoLeaf.Sync` — le seul namespace que l'installeur monte

`install.ts` → `registerGlobals(gl)` ne pose **qu'un** membre : `Sync`. Il expose
`registerHandler` / `getHandler` / `getHandlers`.

⚠️ **La façade `geoleaf.sync.ts` s'auto-monte AUSSI**, à l'import. L'import statique de l'installeur
est donc ce qui garde ce module dans la clôture livrée ; la réaffectation est idempotente.

⚠️ **La capacité n'importe PAS le seam de gestionnaire.** Seule la façade le fait. Le moteur, lui,
n'a aucun consommateur de ce seam — c'est le plugin d'interface qui va chercher le gestionnaire pour
le rejouer.

**Il n'y a pas de façade `geoleaf.offline.ts`.**

### Événements — sept émis, et aucun n'est typé

| Signal                           | Émis par                   |
| -------------------------------- | -------------------------- |
| `geoleaf:storage:quota-exceeded` | Écriture refusée           |
| `geoleaf:cache:progress`         | Progression du remplissage |
| `geoleaf:cache:completed`        | Fin de téléchargement      |
| `geoleaf:cache:cleared`          | Cache vidé                 |
| `geoleaf:cache:clear-progress`   | Progression du vidage      |
| `geoleaf:cache:evicted`          | Éviction par budget        |
| `geoleaf:cache:cancelled`        | Téléchargement interrompu  |

🛑 **`geoleaf:cache:cancelled` A ÉTÉ AJOUTÉ à la clôture de S3c, et ce n'était pas un ajout de
confort.** Il avait **deux écouteurs et zéro émetteur** — le pré-vol E3.5 avait relevé le même
chiffre et conclu « l'interface l'écoute pour rien ». Vrai sur la mesure, **faux sur le geste** :
ce que fait l'écouteur (`handleCancelled`, `offline-ui`) est de remettre la barre de progression
à zéro et de réactiver le bouton. Sans émission, un utilisateur qui annule un téléchargement
voyait « ⏹️ Stopping… » **indéfiniment**, bouton désactivé, sans autre issue qu'un rechargement.
**L'écouteur avait raison ; c'est l'émetteur qui manquait.**

✅ **B-72 EST SOLDÉE le 03/08/2026 — les trois orphelins sont traités, et pas de la même façon.**
Ce n'était pas du code mort, c'était de l'**observabilité manquante** : ce sont exactement les
signaux dont 3.4 et 3.13 ont besoin pour être observables.

| Signal                   | Geste                            | Motif                                                                                                                                                                                                                                                                                        |
| ------------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage:quota-exceeded` | **notification d'ERREUR**        | le navigateur a REFUSÉ une écriture : la prochaine saisie peut ne pas tenir. Le plus grave des trois sur un appareil de terrain                                                                                                                                                              |
| `cache:evicted`          | **notification d'AVERTISSEMENT** | des données que l'utilisateur avait **demandé** à télécharger ne sont plus là. ⚠️ Jamais du travail non synchronisé — la règle dure l'interdit et `features` est inatteignable à l'éviction — mais il doit le savoir **avant** de partir hors réseau                                         |
| `storage:ready`          | 🗑 **SUPPRIMÉ**                  | aucune charge utile, émis à **chaque** ouverture de base. Un écouteur qui n'aurait fait que journaliser aurait fermé le compteur **à la lettre** sans rien apporter. ⚠️ Et il ne disait pas ce qui compte : sur iOS l'état à observer est « la base a été **purgée** », pas « elle s'ouvre » |

L'écoute vit dans `offline-ui/core/engine-signals.ts`, câblée à l'import de l'entrée — **pas** au
cycle de vie de la modale : ces signaux partent au téléchargement et à l'écriture, c'est-à-dire
quand le panneau de cache est **fermé**. ⚠️ Une éviction à **zéro** entrée ne notifie rien : « 0
élément supprimé » apprend à l'utilisateur à ne plus lire les notifications. 3 mutations vues
rouges. **Le compteur C2 du périmètre hors-ligne est à zéro.**

⚠️ **Aucun des sept n'est déclaré** dans `contracts/event-bus.contract.ts` — mesuré, zéro occurrence
de ce vocabulaire dans le fichier. Ils vivent dans la baseline non typée
(`scripts/.baselines/event-map-coverage.json`), que `scripts/check-event-map-coverage.cjs` tient
sous cliquet. **Ce n'est donc pas une découverte** : c'est un gisement suivi, et cette fiche s'y
réfère plutôt que d'ouvrir une ligne.

**Écoutés** : `geoleaf:layers:initial-loaded` et `geoleaf:app:ready`, tous deux par l'amorce de
restauration, et tous deux détachés ensuite.

### Stockage écrit

**C'est la seule capacité du dépôt qui écrit une base de données.** Couches, images, sauvegardes,
préférences, file de synchronisation.

---

## Décisions de conception

| Décision                                                     | Pourquoi                                                                                                                                                                                                                                                                                                                                                                                       | Alternative écartée                               |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Opt-in, contrairement aux autres capacités**               | Remplir la base locale d'un navigateur est un effet lourd et visible pour l'utilisateur. S'activer par défaut serait une décision prise à sa place                                                                                                                                                                                                                                             | Opt-out, comme les voisines                       |
| **Moteur chargé par `import()`**                             | La capacité pèse un ordre de grandeur au-dessus de ses voisines. L'embarquer au démarrage l'aurait fait payer à **tous** les profils, dont ceux qui l'éteignent                                                                                                                                                                                                                                | Un embarquement statique                          |
| **Étape de cycle partagé plutôt qu'un module**               | Un module du registre s'exécute dans un tri topologique ; ici la contrainte est un **rang** vis-à-vis de `pwa`, que l'étape partagée exprime directement                                                                                                                                                                                                                                       | Un `ICoreModule`                                  |
| **Un ordre LIBRE, et un gate par configuration**             | 🛑 Cette ligne retenait « Après `pwa`, et le démontage AVANT » avec pour motif « le cache n'a d'intérêt que s'il y a un ouvrier de service pour le servir » — jusqu'au 08/08/2026. Réfuté par `shared-lifecycle-order.test.ts` (7.4) : l'inversion ne change rien d'observable, et l'enregistrement du SW est différé de 3 s de toute façon. L'alternative écartée est devenue le choix retenu | ~~Un ordre libre~~ · **Un couplage par position** |
| **La façade est posée par le KERNEL**                        | Elle doit exister **avant** que le moteur n'arrive, puisque le moteur arrive tard et par import dynamique. Une façade posée par la capacité n'existerait pas quand l'interface la cherche                                                                                                                                                                                                      | Monter `Storage` dans l'installeur                |
| **`isPluginLoaded` / `whenReady` délégués depuis la façade** | Pour que le plugin d'interface cesse d'importer le contrat partagé : sa copie, dans son propre graphe de modules, n'était jamais initialisée — l'interface entière était morte dans le paquet livré                                                                                                                                                                                            | Laisser le plugin importer le contrat             |
| **Le rejeu passe par un gestionnaire DÉPOSÉ**                | Le moteur est in-core et ne peut pas importer un plugin. L'inversion par seam est ce qui rend `no-plugin-in-core` tenable sans renoncer au rejeu                                                                                                                                                                                                                                               | Un import du plugin par le moteur                 |
| **Le budget d'octets vaut `0` pour DÉSACTIVER**              | Un budget nul signifierait « tout évincer immédiatement », ce qui n'a pas d'usage. La valeur sert de commutateur                                                                                                                                                                                                                                                                               | Une clé booléenne séparée                         |
| **Le défaut de budget est dupliqué, et épinglé**             | La constante n'est pas exportée pour garder le gestionnaire hors de la clôture de démarrage. La copie est donc **inévitable** — elle est tenue par un test                                                                                                                                                                                                                                     | Exporter la constante                             |
| **La dépendance à `pwa` est vérifiée À LA MAIN**             | Le champ `dependencies` de la déclaration est de l'**introspection**, que le registre n'applique pas. La garde réelle est une condition explicite                                                                                                                                                                                                                                              | Se fier au champ déclaratif                       |

---

## Arbitrage du stockage — figé le 02/08/2026

Quatre décisions prises avec Mattieu à l'Étape 3 de `roadmap_collecte-terrain-offline`. Elles
répondent aussi à la ligne **B.3** de `roadmap_socle-init`.

### Un seul magasin, et un plafond réparti par CLASSE

**Cible : IndexedDB seul**, pour les tuiles **comme** pour la donnée de couche, **et le Service
Worker le lit**. Le Cache API disparaît du chemin nominal.

⚠️ **L'ORDRE n'est pas négociable, et il est l'inverse de l'intuition** : le Cache API est ce qui
fait fonctionner le hors-ligne **aujourd'hui**, précisément parce que l'autre chemin était mort sur
l'écart de version. **Réparer → voir l'IndexedDB servir réellement → PUIS supprimer.** Supprimer
avant de réparer casserait le seul hors-ligne qui marche ; borner avant d'arbitrer serait un
correctif sans objet.

#### 🛑 A7 est REQUALIFIÉE au Sprint 4 — mesuré le 03/08/2026, elle n'était pas exécutable

L'ordre ci-dessus a été suivi, et c'est la troisième étape qui a buté. Sonde rejouable, aucun
serveur lancé :

```bash
E2E_TARGET=nginx node scripts/probe-tile-cache-arbitration.mjs
```

| Chemin                               | Écrivain                              | Contenu mesuré après affichage **et** téléchargement | Sert hors ligne ?                                                            |
| ------------------------------------ | ------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| Cache API (`geoleaf-data-tiles`)     | le SW, **opportunistiquement**        | **24 tuiles**                                        | ✅ **prouvé** — 22 984 o, `image/png`, statut 200, pas d'en-tête placeholder |
| IndexedDB (`layers`, `resourceType`) | `Downloader` via `ResourceEnumerator` | **0 tuile** (36 `config`, 1 `icon`)                  | oui, mais seulement sur une tuile **semée à la main** (tâche 3.2)            |

**Supprimer la branche Cache API aujourd'hui retirerait le seul cache de tuiles qui fonctionne, au
profit d'un chemin sans écrivain.** Et il n'en a pas pour **trois causes indépendantes, dont deux
ne sont pas du code** :

1. `selection.includeTiles` ne venait que d'une sélection **persistée par l'interface** — corrigé
   ici (voir ci-dessous), c'était la seule des trois qui relevait du code ;
2. ~~`_addBasemapResources` filtre sur `basemap.offline === true`, et **plus aucun profil livré
   ne le pose**~~ — ✅ **LEVÉE le 10/08/2026, pour la seconde fois, et les trois dates se lisent
   ensemble.** ① **07/08** : la cause est levée (Sprint 8, tâche 8.1) par
   `reunion-eclairage/ign-plan-3d`, le seul fond **vectoriel** que le dépôt ait jamais porté.
   ② **10/08 matin** : le Sprint 7 du passage public retire ce profil — il était **client** — et
   la cause revient avec lui ; la garde
   `packages/core/__tests__/capabilities/offline/offline-basemap-declared.guard.test.ts` passe à
   **2/4 en disant vrai** (**B-213**). ③ **10/08 soir** : le profil est **restauré**, neutralisé
   de toute mention de son exploitant et requalifié en démonstration — décision produit de
   Mattieu, motivée par le sélecteur de profil autant que par le hors-ligne. Garde **4/4**.

    🛑 **Ce qui n'a PAS changé, et qui reste le fait à retenir** : basculer un raster de `tourism`
    à `offline: true` n'aurait pas été un correctif. La non-opacité de la réponse est une propriété
    du **format** — un fond vectoriel est parsé par MapLibre, donc requêté en mode `cors` —, pas du
    serveur, et aucun `Access-Control-Allow-Origin: *` mesuré ne l'établit. La capacité tient donc
    à **un seul fond dans un seul profil** : le retirer la referme, et c'est la garde ci-dessus,
    qui **dérive son périmètre du disque**, qui le dira ;

3. ~~les tuiles **vectorielles** exigent en plus une `vectorZone` **dessinée par
   l'utilisateur**, qu'aucun profil ne peut déclarer.~~ — 🛑 **ÉNONCÉ FAUX, corrigé le
   07/08/2026.** La `vectorZone` n'a jamais été une clé de profil : c'est une zone **dessinée
   dans l'interface**, et `offline-ui/src/cache/cache-control-zone.ts:257` la produit et la
   persiste depuis toujours (bbox → `persistZone` → `Storage.saveLayerSelection` → relue par
   `_addVectorBasemapResources`). « Qu'aucun profil ne peut déclarer » décrivait donc une
   impossibilité qui n'en était pas une, et faisait passer A7′ pour bloquée par deux verrous
   quand elle n'en avait qu'un.

⚠️ **Sans zone dessinée, le comportement est une dégradation CHOISIE, pas un trou** : le style,
les glyphes et le sprite sont tout de même mis en cache, seules les tuiles vectorielles sont
sautées (`Log.warn` à l'appui).

🛑 **Et le fond hors-ligne doit être VECTORIEL, pour une raison structurelle** : MapLibre parse
le PBF, donc la requête est nécessairement en mode `cors` et la réponse porte `status: 200` —
elle passe la garde du Service Worker, qui refuse toute réponse opaque (`status: 0`). Un fond
**raster** cross-origin n'offre pas cette garantie : le serveur a beau servir `ACAO: *` (mesuré
le 06/08 sur les 3 origines), c'est le **mode de la requête** qui décide, et il n'est pas
établi. Basculer un raster à `offline: true` ressemblerait à un correctif sans en être un —
c'est ce que la garde vérifie, et elle a été vue rougir exactement sur cette mutation.

⚠️ **Et une conséquence produit qu'A7 ne disait pas** : A7 supprime le cache **opportuniste**.
Aujourd'hui, se promener sur la carte rend ces tuiles disponibles hors réseau ; sous A7, une tuile
n'est hors ligne que si elle a été **explicitement téléchargée**, sur un fond déclaré
`offline: true`, avec une zone dessinée.

🛑 **La troisième voie est nommée pour être ÉCARTÉE** : faire écrire le Service Worker dans
IndexedDB au vol unifierait le magasin _et_ garderait l'opportunisme — mais elle contredit **T2′**,
qui rend le worker structurellement non-provisionneur, et rouvrirait le **défaut (A)** : un worker
qui ouvre en écriture retient des connexions, et toute montée de schéma expire puis tombe en
`_isStub`. C'est le risque n° 1 du sprint, réglé à la tâche 3.1.

**Arbitrage arrêté avec Mattieu le 03/08/2026** : A7 part au **Sprint 4**, où `4.1` (rapatriement
borné) donne au magasin par entité son premier écrivain réel. La branche Cache API **reste**, et
les deux budgets se posent alors comme un plafond conscient contre le même quota d'origine.

#### `enableTileCache` est enfin LU par le moteur (tâche 3.13)

C'était la seule des trois causes qui relevait du code, et elle est soldée. Le drapeau était
**écrit à quatre endroits du core** — `cache-manager.ts`, `downloader.ts` (deux fois),
`lifecycle.ts` — et **lu à aucun** ; ses deux seuls lecteurs vivaient dans `offline-ui`. Les quatre
écritures sont retirées, et `ResourceEnumerator._tilesRequested()` est désormais son **lecteur
unique**, côté moteur.

⚠️ **C'est un VETO, pas un défaut.** À `false`, il l'emporte sur toute sélection — fût-elle
persistée avant que le profil ne change d'avis. À `true`, la sélection de l'utilisateur décide ; en
son absence, on suit la déclaration. C'est ce qui donne enfin un moyen d'expression à un hôte qui
appelle `CacheManager.cacheProfile()` **sans interface**.

⚠️ **Et la conséquence écrite à l'inventaire des suppressions était INVERSÉE.** Elle annonçait « un
hôte sans l'UI télécharge les tuiles même avec le drapeau à `false` ». Mesuré en navigateur : sans
sélection persistée, `selection` valait `null`, donc `includeTiles` était indéfini, donc **aucune
tuile n'était énumérée** — l'inverse exactement. Mode d'échec n° 2, porté sur l'effet.

Le plafond est un **budget total déclaré**, explicitement sous le quota d'origine, **scindé en deux
classes d'éviction** :

| Classe  | Contenu                                           | Règle                                             |
| ------- | ------------------------------------------------- | ------------------------------------------------- |
| `lru`   | tuiles, glyphes, sprites — **re-téléchargeables** | évincés du moins récent au plus récent, sans avis |
| `never` | entités portant du travail local non synchronisé  | **jamais évincés**, quel que soit le budget       |

⚠️ **Sans les classes, un plafond global évincerait une capture terrain pour faire de la place à une
tuile qu'on peut re-télécharger.** C'est ce qui rend la règle dure opérante plutôt que décorative.

#### Les DEUX budgets, et leur total contre le même quota — posé le 07/08/2026 (tâche 1.2)

Ce paragraphe promettait que « les deux budgets se posent alors comme un plafond conscient contre le
même quota d'origine ». Il est posé. **Le second n'existait pas** : `CACHE_TILES` n'était borné par
rien, alors qu'A7′ a été close (tâche 8.1) **sans retirer la branche Cache API** — le worker écrit
donc toujours opportunistement, à côté d'un IndexedDB borné, contre le même quota.

| Budget                                         | Magasin                          | Unité       | Défaut | Qui évince                                        |
| ---------------------------------------------- | -------------------------------- | ----------- | ------ | ------------------------------------------------- |
| `modules.offline.cache.maxCacheBytes`          | IndexedDB (`layers`)             | **octets**  | 250 Mo | `evictToQuota`, après un téléchargement de profil |
| `modules.offline.cache.maxTileCacheEntries` 🆕 | Cache API (`geoleaf-data-tiles`) | **entrées** | 2 000  | le Service Worker, après une écriture de tuile    |

**Total conscient** : 250 Mo + ≈ 38 Mo ≈ **288 Mo**, à comparer aux deux quotas relevés — **~800 Mo**
en headless sur profil neuf, **~10 Go** en Chrome réel. Le pire cas mesuré laisse une marge d'un
facteur ~2,8.

🛑 **La conversion entrées → octets a été MESURÉE, parce qu'une première rédaction l'avait
extrapolée d'un chiffre ambigu.** Le relevé du 03/08 dit « 24 tuiles » puis « 22 984 o » : lu comme
un total, la tuile pèse ~1 Ko et 2 000 entrées ne font que 2 Mo ; lu comme une entrée, elles en font 46. **Un facteur 24 sur le plafond annoncé, tenu par une virgule.** Mesuré le 07/08 sur le déployé,
échantillon complet de 24 tuiles PNG :

| min     | médiane  | moyenne  | max      | somme des 24 |
| ------- | -------- | -------- | -------- | ------------ |
| 4 020 o | 17 555 o | 19 781 o | 39 734 o | 474 745 o    |

C'était donc bien **une** tuile — mais ~19,8 Ko et non 23. **⚠️ Et la dispersion est le vrai
enseignement** : un facteur **10** entre la plus petite et la plus grosse. Un budget en entrées ne se
convertit en octets qu'approximativement, et c'est précisément pourquoi l'échappatoire sur le quota
d'origine n'est pas un ornement. ⚠️ **Ne pas recopier ces nombres ailleurs** : les défauts se lisent
dans `offline-capability.ts`, l'occupation réelle par `navigator.storage.estimate()`.

⚠️ **Le second budget compte des ENTRÉES et non des octets, et ce n'est pas une approximation
paresseuse** : la Cache API n'expose la taille d'aucune entrée, et `estimate()` mesure **toute
l'origine**, pas un magasin. Le compte est le seul bornage portable. L'occupation réelle sert
d'**échappatoire** : au-delà de 80 % du quota d'origine, la taille devient bien plus agressive
(cible 400 entrées) et **remonte à l'utilisateur** via `geoleaf:cache:evicted`. Le trim de routine,
lui, reste silencieux — il tourne à chaque panoramique soutenu, et un avis par déplacement de carte
apprend à ne plus les lire.

✅ **La classe `never` est respectée PAR CONSTRUCTION du côté Cache API** : ce magasin n'a **qu'un
écrivain**, l'étape opportuniste de `tileCacheStrategy`. Ce que l'utilisateur a explicitement demandé
à télécharger part en IndexedDB via le `Downloader`, jamais ici — donc une éviction de tuiles ne peut
pas emporter une zone préparée pour le terrain. Épinglé par une garde de source
(`__tests__/storage/sw-core-tile-budget.test.ts`), sans quoi ce serait un raisonnement et non une
vérification.

🛑 **Et le trim a été VU s'exécuter**, sur le bundle déployé dans un vrai Chromium, pas seulement
contre une Cache API simulée :

```bash
E2E_TARGET=nginx node scripts/probe-tile-cache-trim.mjs
```

Relevé du 07/08/2026 : cache semé à **2 100** entrées, une navigation, **2 100 → 1 623** (marge basse
1 600 + les 23 tuiles du panoramique). Sonde vue **rouge** sur la mutation qui retire l'appel au trim
— elle rend alors **2 100 → 2 124**, c'est-à-dire les **24 tuiles** que le relevé du 03/08 comptait
déjà. Une éviction jamais vue s'exécuter ne borne rien.

⚠️ **`freedBytes` est absent du détail émis côté Cache API**, et c'est délibéré : la taille d'une
entrée n'y est pas lisible. `offline-ui` omet déjà la taille quand elle manque ; fabriquer un nombre
pour homogénéiser les deux producteurs afficherait une quantité fausse.

⚠️ **Le régime est MESURÉ, pas supposé — et il l'a été DEUX FOIS le 02/08, avec deux verdicts
opposés. Le désaccord est le résultat, pas un incident.**

| Contexte                                     | `persisted()` | Quota   |
| -------------------------------------------- | ------------- | ------- |
| Chromium headless, profil neuf               | **refusé**    | ~800 Mo |
| Chrome réel, **même origine**, onglet simple | **accordé**   | ~10 Go  |

⚠️ **Le second relevé n'était PAS dans une PWA installée** (`display-mode` non standalone) : Chrome
a accordé la persistance sur le seul **engagement** avec l'origine. Il l'accorde sans demander dès
que le site est installé, épinglé, autorisé aux notifications **ou** suffisamment visité — et une
origine de développement ouverte tous les jours coche la dernière condition.

**Ce que cela décide** : la persistance est **obtenable mais jamais garantie**, et elle dépend de la
relation de l'utilisateur avec l'ORIGINE — **pas d'une propriété de l'application**. Un appareil de
terrain qui ouvre une origine de production pour la première fois démarre en `bestEffort`. Le moteur
ne doit donc **jamais la supposer** : le plafond par classe reste le défaut, et la valeur se relit
**par appareil** (`await navigator.storage.persisted()`), elle ne se déduit pas.

💡 **Un levier existe, et il est de configuration** : `modules.pwa.installPrompt.enabled` vaut
`false`. L'installation est l'un des signaux les plus forts pour Chrome — l'activer est le moyen le
moins cher de faire passer un appareil de terrain de `bestEffort` à `persistent`. C'est une décision
**produit**, pas du code.

### Le routage du Service Worker passe aux ORIGINES DÉCLARÉES

Le SW décide aujourd'hui par **quatre** critères, dont aucun n'est relisable et dont deux sont
exploitables :

| Critère actuel                      | Où                                            | Défaut                                                    |
| ----------------------------------- | --------------------------------------------- | --------------------------------------------------------- |
| sous-chaîne de nom d'hôte           | `_isVectorTileProvider` / `_isRasterProvider` | `includes("tile")` matche `mon-site-hostile.tilerie.com`  |
| domaine fournisseur **codé en dur** | `isTileRequest` (`data.geopf.fr`)             | invisible à toute configuration                           |
| reniflage de chemin                 | `isProfileResource`                           | `pathname.includes("/profiles/")`                         |
| blacklist `/api/`                   | `CACHE_BLACKLIST`                             | exclut **le chemin le plus courant d'une API de données** |

⚠️ **Les quatre sont cités par NOM DE FONCTION et pas par numéro de ligne, à dessein.** Cette table
a porté quatre numéros faux pendant quelques heures le 02/08 : l'agrandissement de l'en-tête du même
fichier, le même jour, a décalé tout le contenu d'une vingtaine de lignes. Un nom de symbole ne
dérive pas ; un numéro de ligne dérive au premier commentaire ajouté au-dessus.

Les quatre sont remplacés par une **origine déclarée** (`scheme://hôte[:port]` — jamais une
sous-chaîne, jamais un nom d'hôte nu), portant ses rôles et son caractère cachable. Contrat :
`packages/core/src/contracts/sync.contract.ts`, type `DataOriginDeclaration`.

⚠️ **La blacklist `/api/` disparaît avec les trois autres, et ce n'est pas un relâchement** : une
API authentifiée se déclare `cacheable: false`, ce qui produit **le bon comportement pour la bonne
raison** au lieu de l'obtenir par accident, via un motif d'URL qui ne dit rien de l'origine réelle.

### La zone dessinée alimente le raster — avec sa limite ÉCRITE

Oui : le calcul de tuiles est déjà partagé entre les chemins raster et vecteur, et l'énumérateur
traite les fonds sélectionnés.

🛑 **Mais un fournisseur tiers cross-origin qui répond en OPAQUE reste non cachable**, et cela doit
être écrit plutôt que découvert à la coupure. Les quatre stratégies gardent sur
`networkResponse.status === 200` ; une réponse opaque porte `status === 0` et échoue le test **en
silence**. Ne pas mettre une opaque en cache est le **bon** réflexe — on ne peut pas en valider le
contenu. **Ne pas le dire ne l'est pas.**

**Conséquence à porter au produit, pas au code** : un fond de carte réellement disponible hors
réseau exige une origine qui répond **en CORS**. C'est une contrainte de **choix de fournisseur**.

### ~~Le moteur rejoue lui-même~~ — 🛑 PRESCRIPTION RÉFUTÉE le 08/08/2026

Cette section demandait de faire itérer les gestionnaires **par le moteur**, au motif écrit
qu'« aujourd'hui une campagne qui ne charge pas `offline-ui` **ne resynchronise jamais**, sans que
rien ne le signale ». **Ce motif est faux, et il l'était déjà quand la section a été écrite.**

Mesuré : le drain est **autonome** et vit dans le plugin qui crée les entités. `initSyncReplay()`
pose un écouteur `online` qui appelle `flushNow` → `drainOutbox` → `Storage.pushOutbox`, et tente
une passe opportuniste au montage pour une file laissée par une session antérieure. Le seam `Sync`
ne porte que le **bouton de rejeu manuel** d'`offline-ui`. Une campagne sans `offline-ui`
resynchronise donc normalement ; elle perd le bouton, pas le rejeu.

⚠️ **Et exécuter la prescription telle quelle créerait le défaut qu'elle croit corriger** : un
drain moteur s'ajouterait au drain du plugin, or le verrou `_flushing` « ne garde que ce qui passe
par ici » — le commentaire de `drainOutbox` nomme précisément ce risque de **deux drains qui se
recouvrent**, et c'est pourquoi le corps a été extrait à la tâche 5.1-b. Un seul point d'entrée,
un seul verrou.

**Ce qui survit de la section** : le registre de gestionnaires **reste** — c'est l'inversion qui
tient `no-plugin-in-core`. Et retirer `getHandlers` (le getter **pluriel**, seul symbole sans
appelant) imposerait de modifier `scripts/lib/namespace-surface.mjs` dans le même commit, sinon la
gate de surface rougit. Cet arbitrage n'est pas tranché ici : il vit au registre, en **B-156**.

---

## Dépendances et frontières

### `dependencies: ["pwa"]` est déclaratif, pas exécutoire

⚠️ **Le registre de capacités n'applique PAS ce champ** au runtime. Il sert l'introspection. La
dépendance réelle est tenue par **un seul** geste : la **condition explicite** dans le cycle de vie
(`cfg.pwaEnabled === true`). Le savoir évite de croire qu'un champ garde ce qu'il décrit.

🛑 Ce paragraphe annonçait « **deux** gestes distincts : la **position** au manifeste, et une
condition explicite » jusqu'au 08/08/2026. La position n'en était pas un — `shared-lifecycle-order.test.ts`
(socle-init 7.4) l'a mesuré. Ce fichier se contredisait d'ailleurs déjà : §Décisions écrivait au
même moment que la dépendance est « vérifiée À LA MAIN », au singulier.

✅ **Et le champ a désormais un lecteur, au BUILD** : `scripts/gen-entry.cjs` refuse d'émettre une
entrée dont le graphe est incomplet (`--caps=offline` sans `pwa` échoue en nommant l'arête), et les
règles `DEP-01..04` de `generated-entries.guard.test.ts` traversent cette arête à chaque run.

### Frontière `capabilities/` → `kernel/` (règle ESLint R.8)

Trois arêtes, **toutes par un baril de médiation**, aucun import profond :

| Arête                                        | Baril                     | Ce qu'elle sert                        |
| -------------------------------------------- | ------------------------- | -------------------------------------- |
| cycle de vie → `StorageContract`             | `kernel/shared/index.js`  | signaler la disponibilité              |
| restauration POI → `StorageContract`         | `kernel/shared/index.js`  | lire la base                           |
| `pull/layer-pull.ts` → `fetchOgcApiFeatures` | `kernel/geojson/index.js` | le transport OGC du rapatriement (4.1) |

⚠️ **La troisième a ÉLARGI `kernel/geojson/index.js`, et c'est le geste que la règle DÉSIGNE** — pas
un contournement : la médiation reste visible dans le baril et y est motivée sur place. Coût bundle
**nul**, et c'est ce qui rend le geste sûr : `loader/single-layer.ts` importe déjà
`fetchOgcApiFeatures` statiquement, donc `ogc-api-loader.js` était dans la clôture eager du chunk
geojson bien avant 4.1.

⚠️ **La configuration de couche ne passe PAS par `getAllLayerConfigs()`.** Ce baril l'expose, mais
`loader/profile.ts` le remplit avec une **projection en liste blanche** qui ne porte ni `offline`, ni
`data`, ni `write` : le rapatriement y aurait lu `undefined` pour toute couche et rapporté « rien à
faire » **en silence**. Il lit `Config.getActiveProfile().layers` par `config-seam.ts`, qui répond
aussi pour une couche **non chargée** — `sites_rosario` n'appartient à aucun thème. ⚠️ Et ce n'est pas
non plus `Config.Profile.getActiveProfileLayersConfig()` : le module `Config` porte bien cette
méthode, mais le sous-objet `Profile` **n'est pas monté sur le namespace global**. La première
rédaction de 4.1 l'utilisait, avec un test unitaire **vert** parce qu'il moquait la forme espérée —
c'est la sonde navigateur qui l'a attrapée.

### Frontière avec le moteur cartographique

Aucune. Le calcul des tuiles est de l'arithmétique pure, et c'est ce qui permet à
[`offline-ui`](../plugins/CDC_offline-ui.md) de la consommer par sous-chemin publié — la seule arête
statique du plugin vers cette capacité, et elle porte sur une fonction sans état.

### Frontière avec `offline-ui` — dans un seul sens

Le moteur **écrit** dans `GeoLeaf.Storage` et **signale** sa disponibilité. Il ne sait pas si
quelqu'un écoute. Les vingt-deux sites d'appel sont **tous** dans l'autre paquet, et la fiche qui les
décrit est [`CDC_offline-ui.md`](../plugins/CDC_offline-ui.md).

---

## Écarts au CDC source

Le CDC `CDC_capacite-offline.md` a été **consommé** en écrivant cette fiche, puis **supprimé** du
dossier de tri — ligne au §Journal des décisions de
`roadmap_documentation-v3.md`.

| Énoncé du CDC                                                 | Ce que dit le code                                                                                                                |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| La capacité expose une API publique propre                    | **Il n'y a pas de `public-api.ts`.** La surface est `GeoLeaf.Storage`, posée par le **kernel** ; l'installeur ne monte que `Sync` |
| Le gate `modules.offline.enabled` en opt-in, dépendance `pwa` | ✅ **Vérifié exact**, y compris le fait que la dépendance est appliquée à la main et non par le registre                          |
| Le chargement dynamique du moteur                             | ✅ **Vérifié exact** — `loader` sur la déclaration, composition dans un point d'entrée dédié                                      |
| Le budget d'octets et l'éviction                              | ✅ **Vérifiés exacts**, `0` comme commutateur compris                                                                             |
| Le rejeu par gestionnaire déposé                              | ✅ **Vérifié exact** — c'est l'inversion qui tient `no-plugin-in-core`                                                            |

Ce qui a été **retenu** du CDC et ne se lit pas dans le code : le motif du choix in-core pour un
moteur de cette taille, la raison de l'opt-in, et les alternatives écartées de la table §Décisions.
