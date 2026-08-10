# @geoleaf-plugins/realtime-layer

Mise à jour **temps réel** d'une couche GeoJSON de [GeoLeaf JS](https://github.com/geoleaf/geoleaf-js) — par polling HTTP, WebSocket ou SSE, avec décodage enfichable et éviction des entités périmées.

Licence **MIT** ([`LICENSE`](LICENSE)).

---

## Installation

```bash
npm install @geoleaf-plugins/realtime-layer
```

> **Prérequis :** `@geoleaf/core` doit être chargé avant ce plugin.
> **Uniquement pour les sources `websocket` :** [`@geoleaf-plugins/websocket`](../websocket/README.md) doit être chargé **avant** celui-ci. C'est une dépendance _optionnelle_, déclarée comme telle au registre des plugins — les sources `polling` et `sse` n'en ont aucun besoin.

---

## Ce que le plugin fait tout seul

Le plugin **s'amorce depuis le profil**. À la réception de `geoleaf:app:ready`, il balaie les couches et démarre un flux pour chacune dont la configuration porte `data.realtime.enabled: true`. Rien à appeler dans le cas courant.

L'API publique existe pour les deux autres cas : démarrer une couche déclarée `enabled: false` (opt-in), et arrêter un flux.

```json
{
    "id": "bus-positions",
    "data": {
        "realtime": {
            "enabled": true,
            "source": "polling",
            "url": "https://exemple.test/gtfs-rt/vehicles",
            "decoder": "gtfs-rt",
            "intervalMs": 15000,
            "idField": "vehicle_id",
            "updateMode": "upsert",
            "staleTimeoutMs": 90000,
            "staleAction": "remove"
        }
    }
}
```

---

## API — `GeoLeaf.RealtimeLayer`

```js
import "@geoleaf-plugins/realtime-layer";

// Opt-in : une couche déclarée `enabled: false` ne démarre pas au boot
GeoLeaf.RealtimeLayer.start("bus-positions");

// État courant d'une couche
const status = GeoLeaf.RealtimeLayer.getStatus("bus-positions");

// Arrêt d'un flux, ou de tous
GeoLeaf.RealtimeLayer.stop("bus-positions");
GeoLeaf.RealtimeLayer.stopAll();
```

| Membre                               | Rôle                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `start(layerId)`                     | Démarre le flux d'une couche. Appelé automatiquement au boot si `enabled: true` |
| `stop(layerId)`                      | Arrête le flux d'une couche                                                     |
| `stopAll()`                          | Arrête tous les flux actifs                                                     |
| `getStatus(layerId)`                 | Rend `{ active, source, lastUpdateAt, staleCount }`                             |
| `registerDecoder(name, decoder)`     | Enregistre un décodeur — **avant `GeoLeaf.boot()`**                             |
| `registerStaleAction(name, handler)` | Enregistre une action de péremption — **avant `GeoLeaf.boot()`**                |
| `version`                            | Version du plugin                                                               |

> ⚠️ **`active: true` ne dit pas que des données arrivent.** Une source polling dont l'endpoint est injoignable reste active avec `lastUpdateAt` figé. Les deux champs se lisent ensemble.

> ⚠️ **`registerDecoder` et `registerStaleAction` doivent être appelés avant `GeoLeaf.boot()`** : le balayage du profil résout les noms de décodeur au démarrage, et un nom enregistré après ne sera jamais vu.

---

## Configuration — bloc `data.realtime` d'une couche

Validé au boot ; une couche dont le bloc est invalide est **sautée avec un message nommant la couche**, elle ne fait pas tomber le reste du profil.

| Clé              | Type                                        | Défaut     | Rôle                                                                     |
| ---------------- | ------------------------------------------- | ---------- | ------------------------------------------------------------------------ |
| `enabled`        | `boolean`                                   | —          | **Obligatoire.** Démarrage automatique au boot                           |
| `source`         | `"polling" \| "websocket" \| "sse"`         | —          | **Obligatoire.** Transport                                               |
| `decoder`        | `string`                                    | —          | **Obligatoire.** Intégrés : `"json"`, `"gtfs-rt"`, plus ceux enregistrés |
| `updateMode`     | `"upsert" \| "replace" \| "merge"`          | `"upsert"` | Comment appliquer les entités décodées sur la couche                     |
| `idField`        | `string`                                    | —          | Propriété GeoJSON servant de clé — requise pour `upsert` et `merge`      |
| `staleTimeoutMs` | `number`                                    | —          | Délai après lequel une entité non rafraîchie est périmée                 |
| `staleAction`    | `string`                                    | `"remove"` | Intégrées : `"remove"`, `"dim"`, plus celles enregistrées                |
| `url`            | `string`                                    | —          | **Obligatoire** pour `polling` et `sse`                                  |
| `intervalMs`     | `number`                                    | `30000`    | Période de polling — `polling` seulement                                 |
| `fallbackUrl`    | `string`                                    | —          | Instantané servi pendant une panne de `url` — `polling` seulement        |
| `channel`        | `string`                                    | —          | **Obligatoire** pour `websocket` — passé à `GeoLeaf.Ws.subscribe()`      |
| `mapping`        | `{ idField?, delayField?, targetLayerId? }` | —          | Indices pour le décodeur GTFS-RT                                         |

### `fallbackUrl` — ce qu'il fait exactement

Quand `url` rend une réponse non-2xx ou lève une erreur réseau, le plugin sert **une fois** l'instantané de `fallbackUrl` pour la fenêtre de panne, **continue** d'interroger `url` toutes les `intervalMs`, et y revient au premier succès. L'instantané est typiquement un fichier statique servi depuis la même origine que le profil.

### `mapping.targetLayerId` — la couche qui reçoit vraiment

Un bloc `realtime` attaché à une couche peut alimenter **une autre** couche. Tout ce qui suit le décodage — écriture des entités **et** cycle de péremption complet — porte sur cette cible, jamais sur la couche qui porte la configuration. Sans `targetLayerId`, les deux coïncident.

---

## Étendre le plugin

**Deux points d'extension enregistrables** — un décodeur, une action de péremption. L'entrée ré-exporte les types qui les décrivent : `IDecoder` et `DecodedUpdate`, `StaleActionHandler`, plus `IRealtimeSource`.

⚠️ **`IRealtimeSource` est exporté sans point d'enregistrement.** Les trois transports (`polling`, `websocket`, `sse`) sont câblés dans la fabrique du plugin ; le type sert à en implémenter un dans un fork ou un plugin dérivé, pas à en brancher un depuis un profil. Écrit ici pour qu'un type exporté ne se lise pas comme une API disponible.

```js
import "@geoleaf-plugins/realtime-layer";

// Avant GeoLeaf.boot()
// decode() rend un TABLEAU de mises à jour, une par entité.
GeoLeaf.RealtimeLayer.registerDecoder("mon-format", {
    decode(raw) {
        return [
            { id: "v-42", properties: { delay: 120 } },
            { id: "v-43", geometry: { type: "Point", coordinates: [2.35, 48.85] } },
            { id: "v-44", action: "delete" },
        ];
    },
});

// (layerId, featureId, feature) => void — appelée UNE fois par entité par péremption,
// pas en boucle tant qu'elle le reste.
GeoLeaf.RealtimeLayer.registerStaleAction("signaler", (layerId, featureId, feature) => {
    console.warn(`[realtime] ${layerId} : ${featureId} est périmée`, feature);
});
```

---

## Ordre de chargement

1. `@geoleaf/core`
2. `@geoleaf-plugins/websocket` — **seulement** si un profil déclare `source: "websocket"`
3. `@geoleaf-plugins/realtime-layer`
4. `GeoLeaf.boot()` — après tout `registerDecoder` / `registerStaleAction`

---

© 2026 Mattieu Pottier — MIT
