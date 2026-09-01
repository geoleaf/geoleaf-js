---
type: spec-plugin
title: position-share — la position du terrain qui remonte, et celle des autres qui s'affiche
plugin_id: position-share
package: "@geoleaf-plugins/position-share"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 7619149f6
date: 31 août 2026
---

# position-share — la position du terrain qui remonte, et celle des autres qui s'affiche

**Type :** plugin publié · **Paquet :** `@geoleaf-plugins/position-share` ·
**Code :** `packages/plugins/position-share/` · **Vérifié contre :** `7619149f6` (31/08/2026)

> **Trois règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.
> 3. **Un chemin cité sans racine se lit depuis le répertoire annoncé par « Code : » ci-dessus**,
>    ou depuis son `src/`, et à défaut depuis `packages/core/src/`. Un chemin qui commence par
>    `packages/`, `scripts/`, `profiles/`, `docs/`, `apps/` ou `e2e/` est relatif à la **racine du
>    dépôt**.

> ⚠️ **Cette fiche a été écrite AVANT le code**, comme la Gate 1 du dépôt l'exige — la conception
> est fixée d'abord. À sa première rédaction elle était donc une **spécification** et non un compte
> rendu : ce qui y était écrit n'avait jamais tourné.
>
> ✅ **Elle a depuis été relue contre le livré**, et `verifie_contre` porte le commit
> auquel cette relecture s'est faite. Ce que la relecture a corrigé : l'ordre réel des étapes
> d'`entry.ts`, l'ajout du câblage de boot que la spécification ne prévoyait pas comme une étape
> distincte, et la surface publique — huit méthodes, alors que la spécification ne décrivait que
> le point d'extension.

---

## Périmètre

### Ce que le plugin fait

Il **émet** la position GPS de l'utilisateur vers un backend, à cadence réglable, par un
**transport interchangeable** (HTTP ou WebSocket livrés, registre ouvert aux tiers). Et il
**affiche** optionnellement la position des autres utilisateurs, en déléguant entièrement ce
travail au plugin [`realtime-layer`](CDC_realtime-layer.md).

### Ce qu'il ne fait pas

- **Il n'acquiert pas la position lui-même.** Il lit un instantané par le seam public
  `GeoLeaf.Geolocation.getState()` — la veille GPS appartient à la capacité in-core, et
  `packages/core/src/capabilities/geolocation/public-api.ts` en est la seule porte.
- **Il n'ouvre aucune connexion WebSocket.** La connexion appartient à l'intégrateur, via le
  plugin [`websocket`](CDC_websocket.md). Le transport se contente d'un `send` sur un canal.
- **Il n'authentifie rien.** En HTTP c'est le plugin `connector` qui remplace `window.fetch` et
  injecte le porteur ; en WebSocket il n'y a **aucune** authentification livrée (voir §Décisions).
- **Il ne met aucun point en file d'attente.** Un envoi rejeté **jette** le point. Une position
  est périssable : la rejouer plus tard, c'est publier une donnée fausse.
- **Il ne dessine pas les autres utilisateurs.** L'upsert, l'identité et la péremption sont le
  métier de `realtime-layer` ; ce plugin ne fait que le démarrer et l'arrêter.
- **Il n'écrit aucune donnée personnelle sur le serveur de son propre chef** — l'émission est en
  opt-in dur, deux fois (voir §Configuration).

---

## Manifeste d'enregistrement

Ce que `src/entry.ts` déclare réellement. **Table gatée** par
`packages/core/__tests__/guards/doc-plugin-manifest.guard.test.js`.

| Champ        | Valeur                            |
| ------------ | --------------------------------- |
| `name`       | `position-share`                  |
| `label`      | `GeoLeaf Position Share`          |
| `requires`   | `[]`                              |
| `optional`   | `["realtime-layer", "websocket"]` |
| `namespace`  | `GeoLeaf.PositionShare`           |
| `paquet npm` | `@geoleaf-plugins/position-share` |

⚠️ **`requires` est vide, et c'est un choix.** Le plugin fonctionne seul dans sa configuration par
défaut : `transport: "http"` ne dépend d'aucun autre plugin, et `receive.enabled: false` n'appelle
jamais `realtime-layer`. Déclarer l'un des deux en `requires` bloquerait un démarrage qui n'a
aucune raison d'échouer.

⚠️ **`optional` déclare les deux dépendances CONDITIONNELLES**, chacune attachée à une clé de
configuration : `websocket` n'est nécessaire que si `transport: "websocket"`, et `realtime-layer`
que si `receive.enabled: true`. Comme ailleurs dans ce dépôt, `optional` n'a **aucun effet à
l'exécution** — il est stocké et jamais lu. La vérification réelle est faite sur place, au moment
de l'usage, et rend une erreur qui **nomme le plugin manquant** sans interrompre le reste.

---

## Les étapes d'`entry.ts`

| Étape                     | Ce qu'elle fait ici                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Dictionnaires i18n        | `I18n.registerDict("position-share", …)` — **en premier**, sinon les libellés du boot ne résolvent pas                                |
| Montage du namespace      | `GeoLeaf.PositionShare = buildPublicApi()`                                                                                            |
| Auto-enregistrement       | Le manifeste ci-dessus, `healthCheck` sur la présence du namespace                                                                    |
| Ré-exports de types       | `IPositionTransport`, `PositionPayload`, et `registerTransport` en valeur                                                             |
| Créneau de barre d'outils | `profileKey: "modules.position-share.showButton"` — jamais `ui.showXxx`. **Déclaré seulement si `registry.isInitialized() !== true`** |
| Écouteur d'action         | `geoleaf:toolbar:action` → `toggle()`                                                                                                 |
| Câblage de boot           | `initLifecycle()` — diffère `auto` et la réception à `geoleaf:app:ready`, **avec repli tardif**                                       |

⚠️ **Le ré-export n'est pas cosmétique.** Un point d'extension que le consommateur ne peut pas
typer est un point d'extension qu'il n'utilisera pas : l'omission rend un `TS2305` chez lui, et
**rien ici** ne l'aurait montré.

🛑 **Le montage s'écrit `.PositionShare = buildPublicApi()` LITTÉRALEMENT, et ce n'est pas une
préférence de style.** Deux gardes reconnaissent cette forme **par expression régulière** —
`doc-plugin-manifest.guard.test.js` et `plugin-namespace-declared.guard.test.js` —, et **aucune des
deux** ne reconnaît la forme `const _api = buildPublicApi(); _host.X = _api;` que le scaffold émet.
Garder la façade dans une variable locale épargne une assertion chez l'écouteur, mais coûte les
deux gardes : c'est le mauvais échange. L'écouteur relit donc à travers une assertion étroite,
exactement comme `packages/plugins/table/src/entry.ts`.

---

## API publique — `GeoLeaf.PositionShare`

| Méthode                           | Rôle                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `getConfig()`                     | Le bloc `modules.position-share` résolu                                          |
| `getClientId()`                   | L'identifiant stable qui étiquette chaque échantillon                            |
| `clearClientId()`                 | Oublie l'identifiant (stockage + cache) — le droit à l'effacement (RGPD art. 17) |
| `start()` / `stop()`              | Démarre / arrête la boucle. `start` rend `false` si la config l'interdit         |
| `toggle()`                        | Bascule, et rend l'état après l'appel — ce que pilote la pastille                |
| `isEmitting()`                    | La boucle tourne-t-elle                                                          |
| `showOthers(visible)`             | Délègue à `RealtimeLayer.start` / `stop`                                         |
| `registerTransport(key, factory)` | Point d'extension — **avant** le premier envoi                                   |
| `listTransports()`                | Les clés enregistrées, pour le diagnostic                                        |

---

## Fonctionnalités

| Id        | Fonctionnalité             | Comportement                                                                              |
| --------- | -------------------------- | ----------------------------------------------------------------------------------------- |
| **PS-01** | Émission périodique        | Toutes les `intervalMs`, si la veille GPS est active et une position connue               |
| **PS-02** | Transport HTTP             | `POST` de la charge sur `endpoint`, sans en-tête d'authentification propre                |
| **PS-03** | Transport WebSocket        | `GeoLeaf.Ws.send(channel, payload)` — n'initialise **jamais** la connexion                |
| **PS-04** | Registre de transports     | `registerTransport(key, factory)` — ajouter un transport ne modifie aucun code            |
| **PS-05** | Garde de distance          | Sous `minDistanceM` de déplacement, le point n'est pas émis                               |
| **PS-06** | Trois modes                | `auto` (dès le boot) · `manual` (sur clic) · `off` (jamais)                               |
| **PS-07** | Identifiant client stable  | Frappé une fois, persisté, préfixe `loc:` ; **`clearClientId()` l'efface** (RGPD art. 17) |
| **PS-08** | Réception des autres       | `showOthers(true)` délègue à `RealtimeLayer.start(layerId)` ; `false` → `stop`            |
| **PS-09** | Pastille de barre d'outils | Visible si `showButton`, bascule l'émission en mode `manual`                              |
| **PS-10** | Indicateur d'émission      | L'utilisateur voit que sa position part — non négociable                                  |

---

## Configuration

Bloc `modules.position-share` — **la seule branche du profil** que ce plugin lit (INV-CONFIG,
porté par `PC-14` dans `scripts/verify-plugin-contract.cjs` et rejeté au scaffold par
`scripts/create-plugin.cjs`). Défauts appliqués dans `src/config.ts`.

| Clé               | Type                          | Défaut      | Rôle                                                 |
| ----------------- | ----------------------------- | ----------- | ---------------------------------------------------- |
| `enabled`         | `boolean`                     | **`false`** | opt-in dur — une position est une donnée personnelle |
| `mode`            | `"auto" \| "manual" \| "off"` | `"off"`     | émission : dès le boot · sur clic · jamais           |
| `transport`       | `string`                      | `"http"`    | `"http"`, `"websocket"`, ou une clé enregistrée      |
| `endpoint`        | `string`                      | —           | URL du POST — obligatoire si `transport: "http"`     |
| `channel`         | `string`                      | —           | canal — obligatoire si `transport: "websocket"`      |
| `intervalMs`      | `number`                      | `30000`     | cadence d'émission                                   |
| `minDistanceM`    | `number`                      | `10`        | sous ce déplacement, on n'émet pas                   |
| `showButton`      | `boolean`                     | `true`      | pastille de barre d'outils (mode `manual`)           |
| `receive.enabled` | `boolean`                     | `false`     | afficher les autres                                  |
| `receive.layerId` | `string`                      | —           | couche cible, déléguée à `realtime-layer`            |

🛑 **`enabled` ET `mode` sont tous deux fermés par défaut, et la redondance est voulue.** Un
plugin chargé n'émet rien tant que les deux ne sont pas ouverts. Le scaffold pose `enabled: true`
comme défaut générique — **ce plugin le renverse**, parce que la donnée qu'il transporte est la
position d'une personne, et qu'un défaut ouvert transformerait une simple mise à jour de
dépendance en fuite de données.

---

## Contrat d'extension

```ts
export interface PositionPayload {
    clientId: string;
    lat: number;
    lng: number;
    accuracy?: number;
    timestamp: number;
}

export interface IPositionTransport {
    /** Rejette pour signaler l'échec : le point est alors JETÉ, jamais mis en file. */
    send(payload: PositionPayload): Promise<void>;
    close?(): void;
}

export function registerTransport(
    key: string,
    factory: (cfg: PluginConfig) => IPositionTransport
): void;
```

Patron **ADR-WS01 rejoué** : un seul paquet, les transports tiers injectés par le consommateur, et
**ajouter un transport ne modifie aucun code existant**. Le prix est le même que là-bas et il est
explicite : `registerTransport()` doit être appelé **avant** le premier envoi.

⚠️ **La clé de transport n'est PAS validée à la configuration.** La disponibilité d'un transport
est une question de **moment**, pas de forme : un transport tiers s'enregistre après le chargement
du profil. Valider tôt rejetterait une configuration correcte.

---

## Décisions de conception

### Pourquoi un plugin, et non une capacité in-core

La grille de placement de [`CDC_kernel.md`](../CDC_kernel.md) §Dépendances et frontières s'arrête
à la question 2 — **un tiers pourrait-il l'écrire sans aide ?** Oui : tout ce dont il a besoin est
déjà public. Et chaque hôte candidat porte une frontière que la feature casserait : la capacité
`geolocation` « ne mémorise rien » et le core ne peut pas dépendre d'un plugin
(`no-plugin-in-core`) alors que l'authentification vient du `connector` ; `websocket` « ne connaît
ni couche, ni carte, ni entité » ; `realtime-layer` est le sens **entrant**, on le réutilise tel
quel.

### Les trois contraintes qui ne se devinent pas

**1 — `mode: "auto"` bute sur une contrainte navigateur qu'aucun design ne supprime.** Émettre
suppose une veille GPS active, donc une permission accordée ; et la veille du core ne démarre que
sur **clic**. Le plugin la déclenche au boot en cliquant par programme le contrôle masqué
`.geoleaf-ctrl-geolocation a` — l'idiome déjà employé par
`packages/plugins/measure/src/tools/tool-gps.ts`. Permission refusée : le plugin n'émet **jamais**,
et le dit **une seule fois**.

**2 — L'authentification est asymétrique entre les deux transports, et le silence est le piège.**
En HTTP, le `connector` donne le porteur gratuitement — **mais seulement si l'`endpoint` est sur la
même origine que `connector.baseUrl`**. Ailleurs, la requête part **sans jeton, en silence**. En
WebSocket il n'y a **aucune** authentification : le champ `auth` du plugin `websocket` est une
réservation explicitement non livrée. C'est la place prévue d'un transport tiers enregistré sur
`GeoLeaf.Ws.registerTransport()`.

**3 — Le transport WebSocket n'appelle JAMAIS `GeoLeaf.Ws.init()`.** La connexion appartient à
l'intégrateur et sert peut-être déjà des couches temps réel ; `init` détruit avant de reconstruire.
Corollaire : la politique de file est **la sienne**, et son défaut `queueOnDisconnect: true`
**rejouerait des positions périmées** à la reconnexion.
✅ **Recommandation explicite : `queueOnDisconnect: false`** pour toute connexion qui porte ce
plugin. C'est le même raisonnement que le « aucune file côté plugin » ci-dessus, appliqué à la
couche que ce plugin ne possède pas.

**3 bis — Le créneau de barre d'outils ne se déclare que sur le chemin EAGER.** L'appel
`registry.register({ id, ui })` est honoré s'il court **avant** `GeoLeaf.boot()` — le cas de
l'intégrateur qui charge le bundle par une balise `<script>`, comme le README de ce paquet le
prescrit. Là, il est la **seule** déclaration du créneau : il n'y a pas d'`init.js` chez lui.
Après `init()` — le chemin paresseux de l'app, qui déclare le créneau elle-même avant le boot —
la barre d'outils est déjà construite : l'enregistrement serait stocké, jamais dessiné, et
journaliserait un avertissement dont le destinataire a déjà fait ailleurs ce qu'il recommande.
D'où la condition `registry.isInitialized() !== true`.
⚠️ **`!== true` et non `=== false`** : un hôte sans `isInitialized` rend `undefined`, et le
créneau EST déclaré. Échouer dans ce sens est le bon — un avertissement de trop coûte une ligne
de console, une déclaration manquante coûte le bouton.

**4 — Le plugin est chargé PARESSEUSEMENT, donc son écouteur de boot ne suffit pas.** L'app
l'enregistre par `registerLazy` : son import peut survenir longtemps après `geoleaf:app:ready`, et
un écouteur posé sur un signal déjà passé ne s'exécute **jamais**. Le mode `auto` et la réception
resteraient muets — sans erreur, sans trace, exactement comme un plugin dont personne n'a besoin.

🛑 **Cette contrainte ne figurait pas dans la spécification initiale : elle a été trouvée par
`lazy-plugin-boot-subscription.guard.test.ts`, qui a rougi sur le code livré.** Elle est la
troisième occurrence de la classe dans ce dépôt, après `realtime-layer` et `geocoding`.
✅ **Le remède est un repli explicite** : après avoir posé l'écouteur, `initLifecycle()` teste
`getNativeMap()` et exécute le même travail immédiatement si la carte existe déjà — une garde
interne empêchant que l'écouteur et le repli ne le fassent tous les deux. Le mécanisme est nommé
dans `SURVIVANTS_TARDIFS`, comme l'exige cette garde.

---

## Frontières

| Frontière                     | Ce qu'elle interdit                                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-plugin-in-core`           | Le core n'a **aucune** référence à ce paquet — seulement `PositionShare?: unknown` déclaré                                                      |
| `PCB-01`                      | Aucun import profond dans `packages/core/src/` — la garde de distance est réimplémentée sur place plutôt qu'importée du core                    |
| Aucun import statique du core | Le paquet n'importe **aucune valeur** de `@geoleaf/core` ; les types seuls sont permis                                                          |
| `PSF-01`                      | Ne jamais re-définir un symbole canonique de `@geoleaf/host-runtime` — les primitives HTTP viennent de `packages/libs/host-runtime/src/http.ts` |
| INV-CONFIG / `PC-14`          | Une seule branche de profil : `modules.position-share.*`                                                                                        |
| INV-FACADE                    | `src/public-api.ts` expose, il ne calcule pas                                                                                                   |

### Évolution non planifiée — rétention et purge côté client

L'identifiant client émis pour le partage n'a **aucune durée de vie** : rien ne le fait expirer
ni ne le purge côté navigateur. Constat versé ici le 25/08/2026 depuis le §Backlog de la roadmap
du plugin (chiffré ~2 h à l'époque), parce qu'une roadmap close part à l'archivage avec son
backlog — cette fiche est le domicile qui survit. Le geste, s'il est pris un jour : une politique
de rétention déclarée dans `modules.position-share.*` (jamais une constante en dur), et sa purge
exercée par un test. Rien ne presse : aucune donnée sensible ne transite par cet identifiant.
