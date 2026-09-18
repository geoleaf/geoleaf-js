---
type: spec-plugin
title: connector — l'authentification et l'injection de jeton
plugin_id: connector
package: "@geoleaf-plugins/connector"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 57c41ae0d
date: 18 septembre 2026
---

# connector — l'authentification et l'injection de jeton

**Type :** plugin publié · **Paquet :** `@geoleaf-plugins/connector` ·
**Code :** `packages/plugins/connector/` · **Vérifié contre :** voir `verifie_contre` en tête — une seconde empreinte vivait ici, que rien ne gardait ; cf. `__tests__/guards/spec-single-stamp.guard.test.ts`.

> ⚠️ **Ce que cette estampille couvre.** La **session en panne**, vérifiée le 18/09/2026 : les
> verdicts du renouvellement et l'effacement sur refus seul (CN-28, CN-33), le démarrage à
> renouvellement injoignable (CN-15, CN-16, CN-34), la relance (CN-35), le 401 sans session
> (CN-36), les en-têtes conservés et les archives PMTiles (CN-11, CN-37), le jeton de l'hôte sur
> l'ouvrier et les tuiles (CN-08, CN-09) — chacun adossé à un test vu rouge avant le correctif,
> les gardes neuves re-vues rouges par mutation, et prouvé sur le bundle livré ; et l'instance de
> `createConnector` (CN-26), dont le délégué partagé a été observé le même jour. Le **cycle de
> session** du 02/09/2026 (CN-28 à CN-31) et la reprise de la file (CN-32, 17/09/2026) avaient été
> vérifiés de même. Le reste de la fiche est repris de la vérification du **01/09/2026**
> (`1d0f5312`) et n'a **pas** été re-mesuré.

> **Trois règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.
> 3. **Un chemin cité sans racine se lit depuis le répertoire annoncé par « Code : » ci-dessus**,
>    ou depuis son `src/`, et à défaut depuis `packages/core/src/`. Un chemin qui commence par
>    `packages/`, `scripts/`, `profiles/`, `docs/`, `apps/` ou `e2e/` est relatif à la **racine du
>    dépôt**. Les cas qui échappent aux deux sont racinés sur place.

> ⚠️ **C'est le seul plugin du dépôt qui REMPLACE une fonction globale du navigateur.** Il
> substitue `window.fetch` pour injecter un en-tête d'autorisation sur les URL qui l'intéressent.
> Ce n'est pas un détail d'implémentation : c'est ce qui lui permet de couvrir **tout** ce que
> l'application demande, y compris ce que le core charge sans le savoir. Et c'est pour la même
> raison qu'il capture le `fetch` d'origine **à l'import**, avant que quiconque d'autre ne puisse
> l'avoir remplacé.

> ⚠️ **Il a TROIS chemins d'injection, parce qu'un seul ne suffit pas.** Une carte moderne charge
> par `fetch` (données, et archives PMTiles que la bibliothèque `pmtiles` lit par lui), par
> **ouvrier web** (analyse GeoJSON hors du fil principal) et par le moteur de tuiles
> (`setTransformRequest`). Le remplacement de `fetch` ne voit ni le deuxième ni le troisième. Les
> trois sont posés par le même appel de configuration — voir §Les trois chemins.

---

## Périmètre

### Ce que le plugin fait

Il **authentifie** l'utilisateur contre un point d'accès HTTP, **conserve** le jeton (en mémoire et
en base indexée du navigateur), le **renouvelle** silencieusement, et l'**injecte** sur les requêtes
qui visent l'URL de base configurée — par les trois chemins ci-dessus. Il offre en plus une fenêtre
de connexion et un bouton d'accès dans l'interface.

### Ce qu'il ne fait pas

- **Il ne charge aucune donnée.** Il ne fait qu'ajouter un en-tête à ce que d'autres demandent.
- **Il ne stocke jamais d'identifiants.** Seul le jeton est conservé ; le mot de passe est effacé
  de la mémoire immédiatement après usage.
- **Il n'implémente aucun protocole d'autorisation normalisé** — ni OAuth, ni OIDC. Le contrat est
  minimal : `POST { login, password }` → `{ token, expiresIn }`.
- **Il n'importe jamais `@geoleaf/core`.** Toutes ses interactions passent par le namespace global
  et par des événements — voir §Frontières.
- **Il ne se configure pas par un profil**, à une exception près : un **drapeau d'interface**
  suffit à faire apparaître le bouton, sans aucune authentification derrière.

---

## Manifeste d'enregistrement

Ce que `src/entry.ts` déclare réellement. **Table gatée** par
`packages/core/__tests__/guards/doc-plugin-manifest.guard.test.js`.

| Champ        | Valeur                               |
| ------------ | ------------------------------------ |
| `name`       | `connector`                          |
| `label`      | `Connector (Auth + Fetch intercept)` |
| `requires`   | `[]`                                 |
| `optional`   | `["offline-ui", "editor"]`           |
| `namespace`  | `GeoLeaf.Connector`                  |
| `paquet npm` | `@geoleaf-plugins/connector`         |

✅ **`"storage"` ne désignait plus aucun plugin** — renommé `offline-ui`. Corrigé le 29/07/2026
ici et sur les quatre autres manifestes fautifs. Le champ `optional` reste **stocké et
jamais lu** par le registre (seul `requires` gouverne l'activation) : documenter est sa seule
fonction, ce qui est exactement pourquoi rien ne rougissait. **Une gate le lit désormais** — tout
identifiant cité doit correspondre à un plugin réellement enregistré.

⚠️ **Son `healthCheck` est un accesseur, pas un booléen capturé** : il interroge l'état de
configuration au moment de l'appel. Un connecteur monté mais non configuré se déclare donc en
mauvaise santé — même posture que [`websocket`](CDC_websocket.md), et pour la même raison : ces deux
plugins ont un **état**.

### Les étapes d'`entry.ts`

Cinq gestes — plus qu'un plugin de transport, moins qu'un plugin d'interface complet :

| Étape                                | Ce qu'elle fait ici                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| 1 — dictionnaires i18n **d'abord**   | Six langues, enregistrées **avant** tout rendu, sans quoi les libellés de la fenêtre de connexion ne résoudraient pas |
| 2 — ré-exports de valeur             | `createConnector` et son type — l'API de l'intégrateur avancé, publiée et **délibérément conservée**                  |
| 3 — montage du namespace             | `GeoLeaf.Connector = buildPublicApi()`                                                                                |
| 4 — amorçage automatique d'interface | Sur `geoleaf:profile:loaded` **et** `geoleaf:map:ready`, plus un repli immédiat                                       |
| 5 — auto-enregistrement              | Le manifeste ci-dessus                                                                                                |

⚠️ **Les clés i18n sont PLATES et pointées** (`"connector.modal.title"`). Le résolveur de libellés
indexe la table fusionnée directement et **ne découpe jamais sur le point** : un dictionnaire
imbriqué ne résoudrait rien. Les entrées françaises reproduisent exactement les chaînes autrefois
écrites en dur, de sorte qu'un hôte qui ne fusionne pas ces dictionnaires rend à l'identique.

---

## Fonctionnalités

| ID    | Fonctionnalité                                                  | Entrée                                                                                                            | Sortie observable                                                                                                                                                                                                                  | Code                                                                                                  |
| ----- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| CN-01 | Configuration explicite                                         | `GeoLeaf.Connector.configure(config)`                                                                             | Valide, désinstalle l'instance précédente, pose les trois chemins d'injection, résout un jeton                                                                                                                                     | `connector-api.ts` → `configure`                                                                      |
| CN-02 | Deux modes d'obtention du jeton, **exclusifs**                  | `getToken` **ou** `auth`                                                                                          | Rappel fourni par l'intégrateur, ou gestion autonome par le plugin. Déclarer les deux fait échouer la validation                                                                                                                   | `config.ts` → `validateConfig`                                                                        |
| CN-03 | HTTPS imposé hors développement local                           | `baseUrl` en `http://`                                                                                            | Refusé, sauf sur `localhost` / `127.0.0.1` où un avertissement console suffit                                                                                                                                                      | `config.ts`                                                                                           |
| CN-04 | Les URL externes sont validées aussi                            | `signupUrl`, `forgotPasswordUrl`                                                                                  | Mêmes règles que `baseUrl` — un lien de la fenêtre de connexion est une sortie vers un tiers                                                                                                                                       | `config.ts` → `_validateExternalUrl`                                                                  |
| CN-05 | Variante d'icône corrigée en silence                            | `iconVariant` inconnue                                                                                            | Ramenée à la valeur par défaut — **sans erreur ni avertissement** : une icône n'est pas une question de sécurité                                                                                                                   | `config.ts` → `_normalizeIconVariant`                                                                 |
| CN-06 | Injection sur `window.fetch`                                    | Requête de même origine et sous le chemin `baseUrl`                                                               | En-tête d'autorisation ajouté ; **tout le reste passe directement** au `fetch` d'origine                                                                                                                                           | `fetch-interceptor.ts`                                                                                |
| CN-07 | `fetch` d'origine capturé **à l'import**                        | Chargement du script                                                                                              | La référence est prise avant tout autre remplacement — un second intercepteur ne peut pas s'insérer entre les deux                                                                                                                 | `fetch-interceptor.ts`                                                                                |
| CN-08 | Injection dans l'ouvrier web                                    | Chargement GeoJSON par ouvrier                                                                                    | Un crochet global est posé ; le gestionnaire d'ouvriers du core le lit **sans jamais importer ce plugin**. Jeton du magasin (`auth`) ou de l'hôte (`getToken`) ; une promesse seulement à un core qui l'annonce (`acceptsPromise`) | `fetch-interceptor.ts`, `host-token.ts`, `packages/core/src/kernel/geojson/worker-manager.ts` du core |
| CN-09 | Injection sur les tuiles                                        | Tuiles vectorielles (MVT)                                                                                         | `setTransformRequest` posé sur la carte native : cache mémoire en `auth`, jeton de l'hôte tiré à chaque tuile en `getToken` — une promesse de la requête seulement si MapLibre ≥ 5.21                                              | `maplibre-bridge.ts`, `host-token.ts`                                                                 |
| CN-10 | Trois moments d'installation du pont cartographique             | Carte prête ou non au moment de la configuration                                                                  | Immédiat, ou différé sur `geoleaf:map:ready`, **plus** une réinstallation sur changement de fond de carte                                                                                                                          | `maplibre-bridge.ts`                                                                                  |
| CN-11 | Routage par format                                              | URL de tuile vs URL de données                                                                                    | Les tuiles vectorielles (`mvt`) vont au pont cartographique ; le reste — archives PMTiles comprises, que la bibliothèque `pmtiles` lit par ce `fetch` — au remplacement de `fetch`                                                 | `format-detector.ts`                                                                                  |
| CN-12 | Persistance du jeton                                            | Authentification réussie                                                                                          | Base indexée du navigateur, plus un cache mémoire pour la lecture synchrone                                                                                                                                                        | `token-store.ts`                                                                                      |
| CN-13 | Renouvellement **proactif**                                     | Jeton à moins de cinq minutes de son expiration                                                                   | Renouvellement lancé sans bloquer la requête en cours                                                                                                                                                                              | `token-store.ts`                                                                                      |
| CN-14 | Une seule promesse de renouvellement en vol                     | Requêtes concurrentes sur une expiration                                                                          | Les appels rejoignent la **même** promesse — un seul aller-retour réseau                                                                                                                                                           | `token-store.ts`                                                                                      |
| CN-15 | Fenêtre de connexion                                            | Aucune session stockée, ou un refus, et `auth.ui: true`                                                           | Fenêtre modale ; la promesse de configuration se résout à l'authentification                                                                                                                                                       | `login-ui.ts`                                                                                         |
| CN-16 | Absence de session sans interface : échec franc                 | Aucune session stockée, ou un refus, `auth.ui` absent ou faux                                                     | La configuration **jette** — pas de chemin silencieux vers une application non authentifiée. ⚠️ Une session stockée dont le renouvellement est injoignable n'est PAS une absence (CN-34)                                           | `connector-api.ts`                                                                                    |
| CN-17 | Mot de passe effacé immédiatement                               | Envoi du formulaire                                                                                               | La variable est vidée après usage, et le champ de saisie vidé à chaque erreur                                                                                                                                                      | `auth-client.ts`, `login-ui.ts`                                                                       |
| CN-18 | Aucun `innerHTML` dans les surfaces de saisie                   | Construction de la fenêtre et du bouton                                                                           | Uniquement `createElement` / `createElementNS` / `textContent`                                                                                                                                                                     | `login-ui.ts`, `credential-button.ts`                                                                 |
| CN-19 | Feuille de style ADOPTÉE, jamais un `<style>`                   | Première ouverture                                                                                                | `new CSSStyleSheet().replaceSync()` + `adoptedStyleSheets` — sûre sous CSP stricte ; aucune donnée utilisateur interpolée                                                                                                          | `login-ui.ts`, `credential-button.ts`                                                                 |
| CN-20 | Bouton d'accès injecté aux deux endroits                        | Bandeau d'onglets de bureau, barre d'outils mobile                                                                | Un observateur de mutations attend que le core ait construit ces conteneurs                                                                                                                                                        | `credential-button.ts`                                                                                |
| CN-21 | L'observateur se déconnecte tout seul                           | Cibles jamais construites                                                                                         | Abandon après un délai — pas d'observateur qui vit jusqu'à la fin de la session                                                                                                                                                    | `credential-button.ts`                                                                                |
| CN-22 | Amorçage **interface seule**                                    | `ui.showCredentialButton: true` dans le profil                                                                    | Le bouton apparaît **sans aucune authentification** ; le clic ne fait qu'émettre un événement                                                                                                                                      | `entry.ts` → `_autoBootstrapUiOnly`                                                                   |
| CN-23 | La configuration explicite reprend la main                      | `configure()` après un amorçage interface seule                                                                   | Le bouton autonome est retiré, puis réinstallé avec la vraie authentification derrière                                                                                                                                             | `connector-api.ts`, `credential-button.ts`                                                            |
| CN-24 | Trois déclencheurs pour l'amorçage, un seul effet               | Deux événements + un repli immédiat                                                                               | Idempotent : un verrou garantit un seul amorçage, quel que soit l'ordre de chargement du script                                                                                                                                    | `entry.ts`                                                                                            |
| CN-25 | Jeton non conforme signalé                                      | Jeton sans point (donc non JWT)                                                                                   | Avertissement console **non bloquant** — utile en démonstration, visible en production                                                                                                                                             | `fetch-interceptor.ts`                                                                                |
| CN-26 | Instance isolée pour intégrateur avancé                         | `createConnector(config)`                                                                                         | Une instance **hors du singleton** ; son `destroy()` neutralise ses lectures de jeton. ⚠️ Elle **partage** le délégué de renouvellement de la page (§Export ESM nommé)                                                             | `connector-api.ts`                                                                                    |
| CN-27 | Événements de cycle de vie                                      | Authentification, renouvellement, fin de session, clic, erreur, liens                                             | Émis sur le document ; **deux sont annulables** — les demandes d'inscription et de mot de passe oublié                                                                                                                             | `login-ui.ts`, `credential-button.ts`, `fetch-interceptor.ts`, `token-store.ts`, `connector-api.ts`   |
| CN-28 | Le renouvellement est ATTEIGNABLE après péremption              | 401 sur une requête interceptée, mode `auth.endpoint`                                                             | Le renouvellement est tenté **avant** tout effacement, et le jeton n'est effacé que sur un **refus** explicite (CN-33)                                                                                                             | `fetch-interceptor.ts`, `token-store.ts`                                                              |
| CN-29 | Le point de renouvellement n'est pas intercepté                 | Requête vers `auth.endpoint`                                                                                      | Hors périmètre : l'intercepter attendrait sa propre promesse (interblocage) et écraserait l'en-tête qu'il porte                                                                                                                    | `fetch-interceptor.ts`                                                                                |
| CN-30 | Fin de session explicite                                        | `logout()`                                                                                                        | Relance désarmée, jeton effacé (mémoire et base indexée), `geoleaf:connector:signed-out` émis ; **no-op** en mode `getToken`                                                                                                       | `connector-api.ts`                                                                                    |
| CN-31 | Reconnexion guidée, une seule fenêtre                           | `auth-error` et `auth.ui: true`                                                                                   | La fenêtre de connexion se rouvre ; un verrou garantit **une** fenêtre même sur une file entière en échec                                                                                                                          | `connector-api.ts`                                                                                    |
| CN-32 | La file écartée par une session morte repart                    | `authenticated` ou `token-refreshed`                                                                              | `Storage.requeueAll("authRequired")` puis `Storage.pushOutbox()` — deux gestes PUBLICS, aucun import du cœur ; sans capacité hors ligne, rien ne se passe                                                                          | `session-resume.ts`                                                                                   |
| CN-33 | Une panne du renouvellement garde la session                    | 401 en mode `auth.endpoint`, renouvellement sans conclusion (réseau, délai, 408/429/500/502/503/504, corps coupé) | Jeton gardé, 401 rendu, ni `auth-error` ni fenêtre. Seul un refus (tout autre non-2xx, 2xx inexploitable) efface — et seulement le jeton refusé ; une tentative par durée d'échange pendant une panne                              | `auth-client.ts`, `token-store.ts`, `fetch-interceptor.ts`                                            |
| CN-34 | Un démarrage à renouvellement injoignable n'est pas une absence | `configure()`, jeton stocké expiré, renouvellement sans conclusion                                                | `configure()` se résout, avec ou sans `auth.ui` ; la relance est armée                                                                                                                                                             | `connector-api.ts`                                                                                    |
| CN-35 | La relance du renouvellement                                    | Un renouvellement « indisponible », puis `online`, retour au premier plan ou `geoleaf:offline:outbox-queued`      | Nouvelle tentative, après le renouvellement en vol ; succès → `token-refreshed` → CN-32 ; refus → session terminée ; aucun minuteur                                                                                                | `renewal-retry.ts`                                                                                    |
| CN-36 | Aucune session : le 401 du serveur                              | 401 sans jeton stocké, mode `auth.endpoint`                                                                       | Réponse rendue telle quelle, sans renouvellement ni `auth-error` — une session qui n'existe pas ne meurt pas                                                                                                                       | `fetch-interceptor.ts`                                                                                |
| CN-37 | Les en-têtes de la requête conservés                            | Injection du jeton ; rejeu du 401                                                                                 | Sémantique de `fetch` : `init.headers` s'il est donné, sinon ceux de la `Request` ; `Range`, `Content-Type`, `Prefer` survivent ; une `Request` à corps est clonée avant son premier envoi                                         | `fetch-interceptor.ts`                                                                                |

🛑 **CN-32 EXISTE PARCE QUE LE CŒUR NE PEUT PAS VOIR UNE SESSION REVENIR, et son contrat le dit.**
Son drain s'arrête au premier 401 et met la saisie de tête à l'écart sous `authRequired` — un motif
que le contrat déclare rejouable, en ajoutant que « la levée de la cause est une nouvelle connexion,
que rien dans le cœur ne peut observer ». Mesuré le 17/09/2026 : aucun écouteur d'`authenticated`
ni de `token-refreshed`, aucun appelant de `requeueAll` hors de la façade — une tournée restait en
quarantaine jusqu'à ce que quelqu'un ouvre une console. Le geste vit donc ici, et il est PUBLIC :
une application qui se connecte par ses propres moyens fait exactement les deux mêmes appels.

⚠️ **L'écouteur est tenu sur le global**, comme celui de CN-31 et pour la même raison : un écouteur
tenu par le module ne se retire que pour l'instance qui l'a posé, et une seconde copie du plugin —
ou un module ré-importé — laisserait le sien derrière. Mesuré : dix-huit drains pour un événement.

⚠️ **Les deux appels au point d'accès d'authentification sont BORNÉS DANS LE TEMPS**, et cela ne se
lit nulle part ailleurs dans cette fiche. `AuthClient.login` et `AuthClient.refresh` ne passent pas
par `fetch` nu mais par `fetchWithTimeout` (`@geoleaf/host-runtime`, `AbortController`), qui jette
un `HttpFetchError` de genre `timeout`. Le motif : un backend qui accepte la connexion sans jamais
répondre laisse la fenêtre de connexion figée sur son libellé de chargement, **sans erreur, sans
message et sans fin** — un échec sans symptôme, donc un échec qu'on impute à autre chose. Le délai
se lit dans `auth-client.ts` ; il ne se recopie pas ici. ⚠️ **Le renouvellement est borné sur
l'échange ENTIER, corps compris** : `fetchWithTimeout` arrête son horloge aux en-têtes, et un corps
qui calait figeait la promesse de renouvellement partagée — donc toute requête qui la rejoignait.
La connexion, elle, n'est encore bornée que jusqu'aux en-têtes.

### 🛑 Seul un refus termine une session — et ce que « refus » veut dire

Le renouvellement rendait `null` pour tout échec — réseau coupé, 503, refus —, et l'intercepteur
effaçait la session sur tout `null` : une minute d'indisponibilité du serveur d'authentification
déconnectait le terminal. Il rend désormais un verdict :

| Réponse du point de renouvellement                                         | Verdict       | La session                    |
| -------------------------------------------------------------------------- | ------------- | ----------------------------- |
| 2xx lisible `{ token, expiresIn }`                                         | `renewed`     | renouvelée, `token-refreshed` |
| Réseau coupé, délai dépassé, corps coupé ou calé                           | `unavailable` | gardée, relancée (CN-35)      |
| 408, 429, 500, 502, 503, 504 — la liste du drain du cœur                   | `unavailable` | gardée, relancée              |
| Tout autre non-2xx (401, 403, 404, 501…)                                   | `refused`     | effacée, `auth-error`         |
| 2xx reçu en entier mais inexploitable (HTML, autre JSON, `expiresIn` faux) | `refused`     | effacée, `auth-error`         |

⚠️ **« Illisible » s'entend EN TRANSIT.** Sous HTTPS, un 2xx ne peut venir que du serveur ou de son
proxy — un portail captif casse TLS et tombe en erreur réseau. Un 2xx inexploitable est donc une
configuration fausse, que l'attente ne répare pas : gardée, la session verrouillerait l'appareil
sans fenêtre de connexion. ⚠️ **La liste des statuts passagers est écrite deux fois** — ici et dans
le drain du cœur, qui s'importent l'un l'autre nulle part — et une garde du cœur
(`renewal-transient-statuses.guard.test.ts`) rougit le jour où elles divergent.

Trois propriétés tiennent autour du verdict : un jeton renouvelé ne s'enregistre, et un refus
n'efface, **que si le jeton en place est celui présenté** — une connexion ou une déconnexion faite
pendant le vol l'emporte ; pendant une panne, **une seule tentative par durée d'échange** — la
déduplication ne fusionnait que les tentatives simultanées ; et **sans session stockée, un 401 est
rendu tel quel**, sans `auth-error` (CN-36).

### La relance — les moments que le cœur laisse sans personne

Sur un 401 dont le renouvellement n'a pas conclu, le drain du cœur s'arrête sur `authRequired`, et
ses déclencheurs se taisent jusqu'au retour de la session, qu'il ne peut pas provoquer.
`renewal-retry.ts` en reprend trois pour retenter le renouvellement : `online`, le retour au
premier plan, et `geoleaf:offline:outbox-queued` — une saisie qui entre en file. Chacun attend
d'abord le renouvellement en vol (parti avant l'événement, son verdict décrit le monde d'avant),
puis retente une fois, hors pause. Un succès émet `token-refreshed`, et CN-32 remet la file en
route. ⚠️ **Aucun minuteur, et ce qu'il laisse découvert s'écrit** : en ligne, au premier plan et
sans nouvelle saisie, rien ne retente — rien ne s'ajoute alors à la file, et sa tête attend le
prochain de ces trois moments.

**Effets visibles pendant l'attente**, qui ne sont pas des défauts : le bouton d'accès se dit « non
authentifié » et ouvre la fenêtre si on le touche, et la fenêtre des opérations en attente de
l'éditeur montre le motif « session expirée ».

Les tests qui couvrent ces lignes : `packages/plugins/connector/src/__tests__/` — l'emplacement
canonique imposé par le contrat de plugin —, plus `e2e/11-connector.spec.js` côté navigateur.

---

## Les trois chemins d'injection

C'est la section à lire avant de modifier quoi que ce soit dans ce plugin. Une carte authentifiée
charge par **trois** voies distinctes, et couvrir une seule laisse deux trous silencieux.

| Chemin                      | Ce qu'il couvre                                       | Comment le jeton y arrive                                                             | Contrainte                                                                          |
| --------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **`window.fetch` remplacé** | Données GeoJSON, appels applicatifs, archives PMTiles | En-tête ajouté sur les URL retenues par `isSameOrigin`, les autres en-têtes conservés | Doit capturer le `fetch` d'origine **à l'import**                                   |
| **Crochet d'ouvrier web**   | Analyse GeoJSON hors du fil principal                 | Une fonction posée sur l'objet global, que le core appelle avec ses capacités         | Synchrone, ou une promesse si le core l'annonce (`acceptsPromise`, core ≥ 3.4.0)    |
| **`setTransformRequest`**   | Tuiles vectorielles                                   | Le moteur cartographique demande la requête de chaque tuile                           | Synchrone, ou une promesse si MapLibre ≥ 5.21 ; à réinstaller au changement de fond |

⚠️ **Les deux derniers ÉTAIENT synchrones, et c'est ce qui a imposé le cache mémoire.** La base
indexée est asynchrone ; elle ne pouvait donc pas être lue depuis ces chemins — d'où le **cache
mémoire préchauffé à la configuration**, sans lequel les tuiles et l'ouvrier partiraient sans
en-tête, un 401 par tuile. La contrainte est tombée des deux côtés — MapLibre attend la
transformation depuis la 5.21, le core la réponse du crochet depuis 3.4.0 — mais **seulement pour
qui l'annonce**. En mode `auth.endpoint`, le cache mémoire reste le chemin. En mode `getToken`, le
fournisseur de l'hôte est tiré à chaque requête (`host-token.ts`) : synchrone s'il l'est, et une
promesse n'est rendue qu'à un moteur ou un core qui l'attend — un MapLibre plus ancien prenait la
valeur rendue POUR la requête, un core plus ancien la passerait à `postMessage`. Jusque-là, les
deux chemins lisaient le magasin, que l'hôte ne remplit jamais : le jeton de l'hôte n'atteignait ni
l'ouvrier ni les tuiles.

⚠️ **Les archives PMTiles sont sur le premier chemin, pas sur le troisième.** La bibliothèque
`pmtiles` lit l'archive par le `fetch` global ; le pont ne voit que l'URL `pmtiles://…`, d'origine
`"null"`, et le protocole ignore les en-têtes d'une requête. Longtemps exclues de l'intercepteur
« parce que le pont s'en charge », elles ne recevaient le jeton dans aucun mode. Leur `Range`
voyage dans un objet `Headers` : l'injection construit donc les en-têtes avec la sémantique de
`fetch`, jamais en les étalant comme un objet (CN-37).

⚠️ **Le crochet d'ouvrier est une inversion de dépendance assumée.** Le core ne connaît pas ce
plugin ; il lit un nom convenu sur l'objet global. C'est le seul moyen de faire traverser une
politique d'authentification jusque dans un ouvrier, sans que le core n'importe jamais le plugin.

⚠️ **Les trois chemins partagent une SEULE garde d'origine — `isSameOrigin` (`@geoleaf/host-runtime`).**
Aucun n'attache le jeton sur un simple préfixe : `url.startsWith(baseUrl)` laissait fuir le `Bearer`
vers un hôte-suffixe (`baseUrl.attaquant.tld`), car un préfixe de chaîne ignore la frontière d'hôte.
Le pont cartographique (tuiles) a porté ce défaut jusqu'à ce que la garde — déjà appliquée au `fetch`
et à l'ouvrier — y soit factorisée. **Couvrir les trois chemins ne suffit pas si l'un d'eux valide
l'URL autrement que les deux autres** : c'est la surface la plus exposée (URLs de tuiles/style) qui
portait alors le contrôle le plus faible.

---

## Le bootstrap dev, et où il a le droit d'être servi

Cette section n'existait pas jusqu'au 09/08/2026, et son absence est exactement ce qui a coûté le
défaut : la fiche décrivait `getToken` et `auth.endpoint` sans jamais dire **comment un jeton arrive
concrètement dans un navigateur en développement**. Le mécanisme vivait dans trois fichiers qui ne se
citaient pas.

Le bootstrap se nomme `connector.local.js` et vit à côté de son gabarit,
`apps/geoleaf-app/connector.local.example.js`. ⚠️ **Ce n'est pas un fichier du dépôt** : il n'est
suivi par aucun des deux, il se crée sur le poste en copiant le gabarit, et le chercher dans un
clone est vain — c'est précisément ce que sa nature de porteur de jeton impose.

Il pose `window.GEOLEAF_DEV_CONNECTOR = { baseUrl, getToken }` — un JWT de poste à privilège
d'écriture. Il est chargé par une balise `<script type="module">` d'`apps/geoleaf-app/index.html`,
placée **avant** celle d'`apps/geoleaf-app/init.js` (deux modules non-`async` s'exécutent dans
l'ordre du document), et `apps/geoleaf-app/init.js` se contente de tester le global avant d'appeler
`GeoLeaf.Connector.configure(...)` — c'est du mode `getToken`.

| Variante          | Livrée ? | Fichier | Balise dans `apps/geoleaf-app/index.html` |
| ----------------- | -------- | ------- | ----------------------------------------- |
| `deploy-core`     | **oui**  | absent  | retirée                                   |
| `deploy-full`     | **oui**  | absent  | retirée                                   |
| `deploy-coverage` | non      | absent  | retirée (copie du core)                   |
| `deploy-local`    | non      | présent | conservée                                 |

Le retrait se fait par la paire de marqueurs `GEOLEAF-DEPLOY:DEV-CONNECTOR` (`scripts/build-deploy.cjs`,
`stripDevConnectorScript`), pas par expression régulière — les regexes de gating de ce fichier sont
`/gm` sans `/s`, donc incapables de couvrir un bloc multi-ligne. `APP-11`
(`scripts/verify-app-template.cjs`) tient la présence des marqueurs et la forme mono-ligne de la balise.

🛑 **Ce que la garde `localhost` d'`apps/geoleaf-app/init.js` ne faisait pas, et qu'on lui a fait dire pendant deux
sprints.** Elle empêchait le bootstrap de **s'exécuter** sur une origine déployée. Elle n'empêchait
pas de **lire** un fichier servi statiquement : jusqu'au 09/08/2026 le fichier réel était recopié
dans les trois premières variantes — plus dans leurs `.gz` et `.br` —, et un `curl` sur la racine du
déployé rendait le jeton en clair, garde ou pas. `.gitignore` ne couvrait rien de tout cela : il
couvre le canal _git_, et `deploy/` est un canal distinct. `gitleaks` non plus, qui scanne des plages
de commits. La garde a été **retirée avec l'import** : elle codait en dur un nom de vhost de dev dans
une source applicative, et elle ne gardait plus rien que le build ne garde mieux.

⚠️ **La cause première n'était ni le contenu du fichier ni la garde, mais un `import()` OBLIGATOIRE
d'un fichier OPTIONNEL.** `apps/geoleaf-app/init.js` importait `./connector.local.js` inconditionnellement, ce qui
forçait le fichier à exister dans toute variante — d'où un talon inerte, une entrée dans le
`required` du build, et une exemption nommée dans `scripts/verify-app-template.cjs`. Un premier correctif
n'a traité que le contenu (un talon au lieu du jeton) ; c'est le passage à une **balise gatée** qui a
supprimé l'obligation, et avec elle les trois pièces de machinerie.

Le partage est désormais : **`scripts/build-deploy.cjs`** empêche la diffusion (drapeau
`includeDevConnector` + retrait de la balise, vrais pour `deploy-local` seule),
**`scripts/verify-deploy-no-secrets.cjs`** tient l'invariant côté artefact — vue rougir sur le défaut réel,
`.gz` et `.br` compris, avant d'être crue.

⚠️ **Un `.env` ne règle pas ce problème** — il n'est ni lisible par un navigateur, ni un endroit où
cacher quelque chose qu'on injecte au build : injecté, le secret ressort dans un fichier servi. Le
seul chemin propre est le mode `auth.endpoint` ci-dessous, qui échange des identifiants contre un
jeton émis à l'utilisateur authentifié.

---

## Configuration

Passée à l'appel de `configure()`, **jamais lue dans un profil** — à une exception, traitée plus bas.

| Clé                                 | Type                   | Défaut   | Rôle                                                                                                                                   |
| ----------------------------------- | ---------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `baseUrl`                           | `string` — obligatoire | —        | Origine et chemin de l'injection. **HTTPS requis hors développement local**                                                            |
| `getToken`                          | `function`             | —        | Fournisseur de jeton — **exclusif** avec `auth`. Appelé à **chaque** requête interceptée, chaque tuile, chaque chargement de l'ouvrier |
| `auth.endpoint`                     | `string`               | —        | Point d'accès d'authentification                                                                                                       |
| `auth.ui`                           | `boolean`              | `false`  | Ouvre la fenêtre de connexion quand aucune session n'est stockée ou qu'elle est refusée — pas quand son renouvellement est injoignable |
| `auth.signupUrl`                    | `string`               | —        | Lien d'inscription dans la fenêtre — HTTPS requis en production                                                                        |
| `auth.forgotPasswordUrl`            | `string`               | —        | Lien de mot de passe oublié — mêmes règles                                                                                             |
| `auth.credentialButton.enabled`     | `boolean`              | `false`  | Injecte le bouton d'accès                                                                                                              |
| `auth.credentialButton.iconVariant` | `"lock"` / `"user"`    | `"lock"` | Variante d'icône ; une valeur inconnue est **corrigée en silence**                                                                     |

⚠️ **`getToken` est appelé à chaque requête interceptée, à chaque tuile et à chaque chargement de
l'ouvrier**, et la mise en cache est à la charge de l'appelant. C'est écrit dans le type ; le plugin
ne s'en occupe **que** dans le mode `auth`. Un fournisseur qui jette ou rejette fait échouer la
requête de la page ; tuiles et chargements de l'ouvrier partent sans jeton jusqu'à ce qu'il
réponde de nouveau.

#### `getToken` est LA surface supportée — et `setToken` ne sera pas écrit

Promu le 13/08/2026, sur une demande aval de `Connector.setToken` **et** `onTokenExpiring`.
**Les deux sont refusés, et le refus est arbitré** (décision ⑧ du contrat inverse) : le rouvrir
demande un argument neuf, pas une demande de plus.

**Le motif est une propriété de sécurité, pas une préférence d'API.** `getToken` est un **PULL** :
le plugin le rappelle à chaque requête interceptée (`fetch-interceptor.ts`, `_resolveToken`) et
de nouveau sur le chemin de reprise après un 401. L'hôte rend donc toujours le jeton courant **à
cet instant** — il n'a jamais à prévoir la péremption, et **aucune copie du secret ne réside dans
le plugin**.

`setToken` serait le **PUSH symétrique** : un jeton confié au namespace global, persisté, puis
rejoué sur l'en-tête `Authorization` de toutes les requêtes correspondantes jusqu'à remplacement.
La direction du contrôle s'inverse — le plugin détiendrait une copie d'un secret dont seul l'hôte
connaît la validité. Et `onTokenExpiring` n'existerait que pour rattraper cette inversion, en
demandant à l'hôte de **prédire** ce que le PULL lit déjà au bon moment.

⚠️ À rapprocher du corollaire général du dépôt : **un jeton que le navigateur doit présenter
s'obtient à l'exécution, ou ne transite jamais par le client** — un `.env` injecté au build finit
dans un fichier servi.

⚠️ **Aucune de ces clés n'est gatée** par le test-garde de cette fiche, qui ne couvre que le
manifeste. Elles se relisent contre `config.ts` — part humaine de la règle documentaire du dépôt.

### La seule clé de profil : `ui.showCredentialButton`

C'est l'exception, et elle est délibérée : un profil peut faire apparaître le bouton **sans aucune
configuration d'authentification**. Le clic n'émet alors qu'un événement, à charge pour
l'application hôte de décider quoi en faire.

⚠️ **Cette clé se lit par `GeoLeaf.Config.getActiveProfile()`, et seulement après le chargement du
profil.** C'est pourquoi l'amorçage écoute `geoleaf:profile:loaded` et non l'événement de
chargement de configuration, qui part **avant** — le drapeau ne serait pas encore lisible. Le
commentaire du code nomme les deux et dit lequel est écarté, et pourquoi.

---

## Contrat exposé

### API publique — `GeoLeaf.Connector`

Construit par `public-api.ts` → `buildPublicApi()`, monté par `entry.ts`.

| Membre              | Rend / fait                                                           |
| ------------------- | --------------------------------------------------------------------- |
| `configure(config)` | Le point d'entrée : valide, pose les trois chemins, résout un jeton   |
| `openLoginModal()`  | Ouvre la fenêtre à la demande ; **rejette** si l'utilisateur la ferme |
| `logout()`          | Termine la session : le jeton stocké est effacé, l'hôte est prévenu   |

#### `logout()` — la fin de session, qui n'existait pas

_Ajouté le 02/09/2026._

🛑 **Il n'y avait AUCUN geste pour terminer une session.** La façade ne portait que `configure` et
`openLoginModal` ; `TokenStore.clear` n'avait qu'un appelant — le chemin du 401 — alors que l'en-tête
du magasin écrit lui-même que « la déconnexion doit l'effacer ici, et pas seulement en mémoire ». Un
appareil rendu, prêté ou perdu gardait un jeton porteur valide jusqu'à sa péremption, sans qu'aucun
geste local puisse le révoquer.

⚠️ **En mode `getToken`, il n'efface RIEN, et ce n'est pas un manque.** C'est l'hôte qui détient le
jeton et le plugin n'en garde aucune copie — la propriété que la décision ⑧ défend en refusant
`setToken`. Vider un magasin qu'il ne possède pas serait du théâtre, et appeler cela une déconnexion
nommerait mal ce qui s'est passé.

⚠️ **Il ne purge PAS les données de terrain mises en cache** : c'est une décision distincte, avec sa
propre confirmation à obtenir — une file d'écriture peut porter des saisies qu'aucun serveur n'a
encore reçues. Elle est nommée ici plutôt qu'à moitié faite.

⚠️ **La façade ne porte que trois membres, et son propre en-tête dit pourquoi elle existe.** La gate
de pureté des façades énumère ses sujets **par existence de fichier** : un paquet sans
`src/public-api.ts` lui échappe entièrement. Ce plugin montait son namespace par un objet écrit dans
`entry.ts` — donc hors du champ de la gate. **Créer le fichier est ce qui fait entrer le paquet dans
le contrôle** ; il n'y a rien à inscrire dans le script, sa seule liste est le système de fichiers,
et c'est ce qui la rend incorruptible.

⚠️ **Et c'est pour la même gate que le corps de `openLoginModal` n'est PAS dans la façade** : elle
n'accepte qu'un délégué mince — un appel de transfert unique. Deux instructions suffisent à la faire
rougir. Le corps vit donc dans `connector-api.ts`, avec l'état qu'il lit.

### Export ESM nommé — `createConnector`

Destiné à l'intégrateur avancé : il crée une instance **hors du singleton** — ni interception de
`fetch`, ni crochet d'ouvrier, ni pont de tuiles. Son `destroy()` neutralise ses lectures de jeton ;
il ne restaure **pas** `window.fetch` et ne vide ni le cache mémoire ni la base indexée — ces
gestes appartiennent à la désinstallation du singleton.

🛑 **Ce que l'instance ne possède PAS : le renouvellement.** Le magasin de jetons tient **un**
délégué pour toute la page, quelle que soit l'API. Une instance créée avec `auth.endpoint` installe
le sien à la place de celui de `configure()` — la session du singleton se renouvelle alors auprès
du point de renouvellement de l'instance —, et `destroy()` retire le délégué **quel qu'en soit
l'auteur** : jusqu'au `configure()` suivant, un 401 en mode `auth.endpoint` ne trouve plus rien
pour renouveler, et la session prend fin. C'est un défaut ouvert ; ce paragraphe dit ce que fait
le code, pas ce qu'il devrait faire.

⚠️ **Il est conservé délibérément**, alors qu'il n'a pas de consommateur dans ce dépôt : il est
documenté pour l'intégrateur et publié par les types du paquet. Le retirer serait une **purge d'API
publique**, et le commentaire de `entry.ts` le dit sur place.

### Événements — tous préfixés `geoleaf:connector:` depuis le 13/08/2026

| Événement                                     | Émis par                                                  | Détail                       | Particularité                                                                        |
| --------------------------------------------- | --------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------ |
| `geoleaf:connector:authenticated`             | Fenêtre de connexion                                      | `{ baseUrl }`                | —                                                                                    |
| `geoleaf:connector:token-refreshed`           | Délégué de renouvellement                                 | `{ baseUrl }`                | Relance aussi la file (CN-32) et désarme la relance (CN-35)                          |
| `geoleaf:connector:credential-button-clicked` | Bouton d'accès                                            | `{ baseUrl, authenticated }` | Le seul signal du mode interface seule                                               |
| `geoleaf:connector:auth-error`                | Magasin de jetons (refus), intercepteur (mode `getToken`) | `{ baseUrl, error }`         | La session est MORTE : un refus. Une panne n'émet rien, une session absente non plus |
| `geoleaf:connector:signed-out`                | `logout()`                                                | `{ baseUrl }`                | La session a été FERMÉE ; ne rouvre aucune fenêtre                                   |
| `geoleaf:connector:signup-requested`          | Fenêtre de connexion                                      | `{ url }`                    | **Annulable**                                                                        |
| `geoleaf:connector:forgot-password-requested` | Fenêtre de connexion                                      | `{ url }`                    | **Annulable**                                                                        |

✅ **Tous sont typés** dans `contracts/event-bus.contract.ts` du core (seam `connector`).

⚠️ **Cette section disait « six, tous hors du préfixe `geoleaf:` » et en tirait la bonne
conclusion** : ils étaient **invisibles** à la carte d'événements du dépôt, qui n'est ancrée que
sur ce préfixe — ni typés, ni en liste de référence, ni comptés. Ce n'était pas une exemption
accordée mais une **cécité que personne n'avait choisie**. Le contrat inverse
les a préfixés : EM-01 en a réclamé **six d'un coup** dans la seconde qui a suivi, ce qui est la
seule démonstration possible que la cécité était réelle et non supposée.

🛑 **Ils restent émis en `CustomEvent` BRUT, et deux d'entre eux ne peuvent pas faire
autrement.** `signup-requested` et `forgot-password-requested` sont `cancelable`, et leurs
émetteurs lisent le retour de `dispatchEvent` pour appeler `preventDefault()` sur le lien. Le bus
assaini du core construit ses événements sans `cancelable` et rend `void` : les y faire passer
**tuerait l'annulation en silence** — mesuré, le test qui garde ce contrat rougit sur cette seule
mutation. Le typage porte sur la charge, pas sur le transporteur.

⚠️ **Le namespace `geoleaf:connector:*` est PARTAGÉ avec un plugin propriétaire aval**, maintenu
côté consommateur, qui émet `ready`, `bbox-loading`, `bbox-loaded`, `data-version-changed`,
`error` et `auth-required`. Vérifié le 13/08/2026 : aucun recouvrement. Un nom ajouté ici se
confronte à cette liste — rien, d'aucun côté, n'empêche mécaniquement la collision.

⚠️ **Les deux événements annulables sont un contrat réel** : une application hôte qui préfère ouvrir
sa propre page d'inscription annule l'événement et empêche la navigation.

### Événements consommés

`geoleaf:profile:loaded` (amorçage), `geoleaf:map:ready` (pont cartographique et repli d'amorçage),
`geoleaf:basemap:change` (réinstallation du pont).

### Stockage écrit

| Emplacement                                             | Contenu                                   |
| ------------------------------------------------------- | ----------------------------------------- |
| Base indexée `geoleaf-connector`, magasin `auth-tokens` | Jeton et date d'expiration, par `baseUrl` |
| Cache mémoire                                           | Le même, pour la lecture **synchrone**    |

**Jamais d'identifiants**, jamais de mot de passe, et le jeton n'est jamais journalisé.

---

## Décisions de conception

| Décision                                                     | Pourquoi                                                                                                                                                                                                          | Alternative écartée                                           |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Remplacer `window.fetch` plutôt qu'envelopper les appels** | Le core charge des données sans connaître ce plugin. Envelopper appel par appel supposerait de tous les connaître, et laisserait passer tout ce qui est ajouté ensuite                                            | Un client HTTP dédié que l'application devrait utiliser       |
| **Capturer le `fetch` d'origine à l'IMPORT**                 | Si un autre intercepteur s'installe entre le chargement et la configuration, le capturer plus tard le mettrait dans la chaîne — et le désinstaller casserait l'autre                                              | Capturer à `configure()`                                      |
| **Trois chemins d'injection, pas un**                        | Le remplacement de `fetch` ne voit **ni** l'ouvrier web **ni** le moteur de tuiles. Ne couvrir que lui produirait deux trous silencieux, visibles seulement en 401 par tuile                                      | Ne remplacer que `fetch`                                      |
| **Cache mémoire préchauffé à la configuration**              | Les deux chemins non-`fetch` étaient **synchrones** ; la base indexée ne l'est pas. Sans préchauffage, la première tuile part sans en-tête. Toujours le chemin du mode `auth`                                     | Lire la base indexée à la demande                             |
| **Seul un refus termine une session**                        | Une panne du point de renouvellement n'est pas une réponse sur le jeton ; l'effacer déconnectait le terminal pour une minute d'indisponibilité                                                                    | Effacer sur tout échec du renouvellement                      |
| **« Illisible » s'entend en transit**                        | Sous HTTPS, un 2xx inexploitable vient du serveur ou de son proxy : une configuration fausse, que l'attente ne répare pas — la garder verrouillerait l'appareil sans fenêtre                                      | Tenir tout corps illisible pour passager                      |
| **Relance aux moments que le cœur n'écoute plus**            | Pendant l'arrêt du drain, `online`, le premier plan et les mises en file n'avaient personne ; les reprendre suffit, sans intervalle à inventer                                                                    | Un minuteur de relance                                        |
| **Une promesse seulement à qui l'annonce**                   | MapLibre < 5.21 prend la valeur rendue pour la requête ; un core ancien la passerait à `postMessage`. Le jeton synchrone, lui, atteint tous les chemins                                                           | Toujours rendre une promesse                                  |
| **Un verdict ne s'applique qu'au jeton présenté**            | Un renouvellement en vol pendant une déconnexion ressusciterait la session ; un refus pendant une connexion effacerait le jeton neuf                                                                              | Écrire ou effacer sans condition                              |
| **Le crochet d'ouvrier vit sur l'objet global**              | C'est le seul moyen de faire traverser la politique d'authentification jusque dans un ouvrier **sans que le core importe le plugin**                                                                              | Un import du plugin par le core — interdit par l'architecture |
| **L'état vit avec ses lecteurs, pas dans la façade**         | La configuration courante est lue par trois choses à trois instants : l'ouverture de la fenêtre, le crochet d'ouvrier et le contrôle de santé. Séparer l'écrivain de l'un d'eux produit une panne **silencieuse** | Tenir l'état dans `entry.ts`                                  |
| **Un `public-api.ts` existe pour ENTRER dans la gate**       | La gate de pureté des façades énumère ses sujets par existence de fichier ; un paquet sans ce fichier lui échappe. Le créer est le geste qui rend le plugin contrôlable                                           | Continuer à monter le namespace par un objet dans l'entrée    |
| **Réinstallation sur changement de fond de carte**           | Changer de style remplace la carte native, et avec elle le crochet de transformation. Sans réinstallation, les tuiles du nouveau fond partiraient sans en-tête                                                    | Poser le crochet une seule fois                               |
| **Absence de jeton sans interface : échec franc**            | Une application qui croit être authentifiée et ne l'est pas produit des erreurs partout, loin de la cause. Échouer à la configuration nomme le problème là où il est                                              | Continuer sans jeton et laisser les 401 arriver               |
| **Variante d'icône corrigée en silence**                     | Une icône inconnue n'est ni une question de sécurité ni une erreur de configuration grave. Refuser toute la configuration pour cela serait disproportionné                                                        | Jeter, ou avertir                                             |
| **HTTPS toléré sur le développement local seulement**        | Un développement local sur `http://` doit rester possible ; une mise en production sur du non chiffré transporterait le jeton en clair                                                                            | Imposer HTTPS partout                                         |
| **Le mot de passe est effacé après usage**                   | Une chaîne laissée en mémoire est lisible dans un cliché de tas. L'effacement ne coûte rien et retire une surface                                                                                                 | Laisser le ramasse-miettes s'en charger                       |
| **Zéro `innerHTML` dans les surfaces de saisie**             | Une fenêtre d'authentification est la dernière surface où accepter du HTML interprété. La construction nœud par nœud rend l'injection structurellement impossible                                                 | Un gabarit HTML                                               |
| **Renouvellement proactif et non bloquant**                  | Renouveler au moment d'une requête ajoute la latence de l'authentification à celle de la donnée. Le faire en avance la rend invisible                                                                             | Renouveler à la première expiration constatée                 |
| **Une seule promesse de renouvellement par URL de base**     | Sans cela, une salve de requêtes sur une expiration déclencherait autant d'authentifications concurrentes                                                                                                         | Un renouvellement par appelant                                |
| **L'amorçage écoute `profile:loaded`, pas `config:loaded`**  | Le drapeau vit dans le profil, chargé **après** la configuration. Écouter le mauvais événement lirait une valeur qui n'existe pas encore                                                                          | Écouter le chargement de configuration                        |
| **Trois déclencheurs d'amorçage, avec verrou**               | Le script peut être chargé avant, entre ou après les deux événements. Trois entrées et un verrou couvrent les trois cas sans jamais amorcer deux fois                                                             | Un seul déclencheur                                           |
| **L'observateur de mutations abandonne après un délai**      | Une page hôte peut ne jamais construire les conteneurs attendus. Un observateur éternel serait une fuite proportionnelle à la durée de la session                                                                 | Observer indéfiniment                                         |
| **`createConnector` conservé sans consommateur interne**     | Il est publié par les types du paquet et documenté pour l'intégrateur : le retirer serait une **purge d'API publique**, pas un nettoyage                                                                          | Le supprimer comme code mort                                  |

---

## Dépendances et frontières

### Conformité au contrat gelé

```bash
node scripts/verify-plugin-contract.cjs --plugin=connector
```

### Dépendances

**Aucune dépendance externe** : le core est la seule dépendance interne, déclarée en
`peerDependencies` (bascule du 25/08/2026 — un conflit de version échoue bruyamment à
l'installation au lieu d'installer deux copies du core en silence), et il n'est pas empaqueté. La persistance est écrite à la main sur la base indexée du navigateur — pas de
bibliothèque d'encapsulation.

Les utilitaires partagés viennent de `@geoleaf/host-runtime`, le socle commun aux plugins — et la
liste a cessé d'être anecdotique : elle porte désormais la **garde d'origine** commune aux trois
chemins d'injection (`isSameOrigin`), la **borne de temps** des appels d'authentification
(`fetchWithTimeout`), l'**injection de feuille sûre sous CSP** (`adoptStylesheet`) et la résolution
de libellés (`tLabel`), en plus de `bearer` et `jsonHeaders`. ⚠️ **Trois propriétés de sécurité de ce
plugin vivent donc dans un AUTRE paquet** : les y modifier se relit comme du code de sécurité ici.
La liste exacte se dérive, elle ne se recopie pas :

```bash
grep -rn "@geoleaf/host-runtime" packages/plugins/connector/src/
```

### Frontières

- **Zéro import de `@geoleaf/core`.** Trois mécanismes unidirectionnels le remplacent : lecture du
  profil actif par `GeoLeaf.Config.getActiveProfile()`, résolution de la carte par
  `GeoLeaf.Core.getMap().getNativeMap()`, et le crochet d'ouvrier posé sur l'objet global.
- **Aucune référence à un autre plugin dans les sources** — c'est la moitié gatée de la règle,
  vérifiée par `scripts/verify-core-standalone.cjs`.

⚠️ **La direction inverse EST gatée à présent, contrairement à ce que dit le CDC source.** Celui-ci
signale à deux endroits que « core ⊄ connector » repose sur la revue et non sur un automatisme.
Mesuré : l'expression de la gate couvre `@geoleaf-plugins` **en entier**, donc
`@geoleaf-plugins/connector` avec. Le trou décrit datait du nom de paquet précédent ; il est refermé
par l'élargissement de l'expression, pas par un geste visant ce plugin.

```bash
grep -n "PLUGIN_REF_RE" scripts/verify-core-standalone.cjs
```

### Une frontière de sécurité, pas seulement d'architecture

Ce plugin manipule un jeton d'authentification et remplace une fonction globale du navigateur. Deux
conséquences pratiques :

- **Toute modification de `fetch-interceptor.ts`, `token-store.ts` ou `auth-client.ts` se relit
  comme du code de sécurité**, pas comme du code de plomberie.
- **La règle « jamais d'`innerHTML` » n'a pas d'exception ici**, y compris pour du contenu qui
  semble statique : la fenêtre de connexion est la surface où une injection coûterait le plus.

---

## Écarts au CDC source

Le CDC `CDC_plugin-connector.md` a été **consommé** en écrivant cette fiche. ⚠️ **Il n'a PAS été
retiré du dossier de tri** — même motif que les CDC précédents, tracé au §Journal des décisions de
la refonte documentaire V3.

| Énoncé du CDC                                                                                                | Ce que dit le code                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §11 — `configure`, `openLoginModal` et `createConnector` situés dans `entry.ts`, avec leurs plages de lignes | **Les trois ont déménagé** dans `connector-api.ts`, et pour un motif structurel : faire entrer le paquet dans la gate de pureté des façades. Les plages de lignes ne désignent plus rien                                                            |
| §23 et §25 — « la direction core ⊄ connector n'est **pas** gatée, revue manuelle »                           | **Périmé** : l'expression de `scripts/verify-core-standalone.cjs` couvre `@geoleaf-plugins` en entier. Le trou décrit visait l'ancien nom de paquet                                                                                                 |
| §24 — les six événements                                                                                     | ✅ **Vérifiés exacts**, y compris les deux annulables                                                                                                                                                                                               |
| §25 — les huit mitigations de sécurité                                                                       | ✅ **Vérifiées exactes** sur les points lisibles dans le code : effacement du mot de passe, HTTPS en production, zéro `innerHTML`, feuille par `textContent`, jeton non journalisé, avertissement sur jeton non conforme, observateur qui abandonne |
| §26 — chemin sans interception « à coût nul »                                                                | ✅ **Exact** — une comparaison de préfixe, puis passage direct au `fetch` d'origine                                                                                                                                                                 |
| Manifeste — `optional: ["storage", "addpoi"]`                                                                | ⚠️ `storage` **ne désigne plus aucun plugin**. Le CDC ne pouvait pas le savoir : le renommage est postérieur. Constat versé                                                                                                                         |

Ce qui a été **retenu** du CDC et ne se lit pas dans le code : le positionnement produit et les
publics visés, le parcours utilisateur du premier démarrage, le motif du mode « interface seule »,
les formats géospatiaux visés par le routage, la stratégie de résolution en trois temps du pont
cartographique, et les alternatives écartées de la table §Décisions.
