# @geoleaf-plugins/websocket

Plugin de transport WebSocket pour [GeoLeaf JS](https://github.com/geoleaf/geoleaf-js). Fournit une connexion temps réel avec reconnexion automatique, buffering offline et métriques intégrées.

---

## Installation

```bash
npm install @geoleaf-plugins/websocket
```

> **Prérequis :** `@geoleaf/core` doit être chargé avant ce plugin.

---

## Démarrage rapide

```js
import "@geoleaf-plugins/websocket";

// Après GeoLeaf.boot() — GeoLeaf.Ws est disponible sur globalThis.GeoLeaf
await GeoLeaf.Ws.init({
    transport: "native-ws",
    url: "wss://api.example.com/ws",
    reconnect: { maxRetries: 10 },
    heartbeat: { enabled: true },
});

// S'abonner à un canal
const unsubscribe = GeoLeaf.Ws.subscribe("poi-updates", (payload) => {
    console.log("Mise à jour POI reçue :", payload);
});

// Envoyer un message
GeoLeaf.Ws.send("user-action", { type: "map-click", lngLat: [2.35, 48.85] });

// Arrêt propre
GeoLeaf.Ws.destroy();
```

---

## Configuration — `WsPluginConfig`

Passé à `GeoLeaf.Ws.init()`.

| Option                     | Type                         | Défaut      | Description                                                                                   |
| -------------------------- | ---------------------------- | ----------- | --------------------------------------------------------------------------------------------- |
| `transport`                | `string`                     | —           | Clé de transport. Intégré : `"native-ws"`. Voir [Transport custom](#transport-custom).        |
| `url`                      | `string`                     | —           | URL de l'endpoint WebSocket. Obligatoire. `wss://` requis en production.                      |
| `auth`                     | `JwtAuth \| CredentialsAuth` | `undefined` | Configuration d'authentification (réservée — non active en v1.0).                             |
| `reconnect.initialDelayMs` | `number`                     | `1000`      | Délai initial avant la première tentative (ms).                                               |
| `reconnect.maxDelayMs`     | `number`                     | `30000`     | Plafond du backoff exponentiel (ms).                                                          |
| `reconnect.maxRetries`     | `number`                     | `10`        | Nombre max de tentatives. `0` = infini (recommandé pour PWA offline-first).                   |
| `heartbeat.enabled`        | `boolean`                    | `false`     | Active le keep-alive ping/pong.                                                               |
| `heartbeat.intervalMs`     | `number`                     | `25000`     | Intervalle entre chaque ping (ms).                                                            |
| `heartbeat.timeoutMs`      | `number`                     | `5000`      | Délai d'attente du pong avant de déclarer la connexion perdue (ms). Doit être `< intervalMs`. |
| `queueOnDisconnect`        | `boolean`                    | `true`      | Bufferise les messages sortants pendant la déconnexion.                                       |
| `maxQueueSize`             | `number`                     | `100`       | Taille max du buffer. En cas de dépassement, le message le plus ancien est évincé.            |

### Exemple complet

```js
await GeoLeaf.Ws.init({
    transport: "native-ws",
    url: "wss://api.example.com/ws",
    reconnect: {
        initialDelayMs: 500,
        maxDelayMs: 60000,
        maxRetries: 0, // infini — PWA offline-first
    },
    heartbeat: {
        enabled: true,
        intervalMs: 30000,
        timeoutMs: 8000,
    },
    queueOnDisconnect: true,
    maxQueueSize: 50,
});
```

### Auth JWT (v1.0 — types définis, logique à implémenter côté transport custom)

```ts
import type { JwtAuth } from "@geoleaf-plugins/websocket";

const auth: JwtAuth = {
    type: "jwt",
    token: "eyJ...",
    headerName: "Authorization",
    refreshCallback: async () => fetchFreshToken(),
};
```

---

## API — `GeoLeaf.Ws`

| Méthode / propriété | Signature                                                  | Description                                                                                 |
| ------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `init`              | `(config: WsPluginConfig) => Promise<void>`                | Initialise et connecte. Résout quand la connexion est prête.                                |
| `destroy`           | `() => void`                                               | Déconnecte, purge les subscriptions et remet les métriques à zéro. Idempotent.              |
| `reconnect`         | `() => void`                                               | Force une reconnexion. Remet le compteur de tentatives à zéro. Sans effet si déjà connecté. |
| `state`             | `readonly TransportState`                                  | État courant de la connexion. Voir [États de connexion](#états-de-connexion).               |
| `subscribe`         | `(channel: string, handler: MessageHandler) => () => void` | S'abonne à un canal. Retourne une fonction de désinscription idempotente.                   |
| `unsubscribe`       | `(channel: string) => void`                                | Se désabonne d'un canal par nom. Sans effet si non abonné.                                  |
| `send`              | `(channel: string, payload: unknown) => void`              | Envoie un message. Bufferisé si déconnecté et `queueOnDisconnect: true`.                    |
| `getSubscriptions`  | `() => string[]`                                           | Liste des noms de canaux actifs.                                                            |
| `getMetrics`        | `() => WsMetrics`                                          | Snapshot des métriques. Utilisable avant `init()`.                                          |

### États de connexion

```
disconnected → connecting → connected
connected    → disconnected → reconnecting → connected
reconnecting → failed  (si maxRetries > 0 et épuisés)
```

| État           | Description                                             |
| -------------- | ------------------------------------------------------- |
| `disconnected` | Pas de connexion active.                                |
| `connecting`   | Tentative de connexion initiale en cours.               |
| `connected`    | Connexion établie et prête.                             |
| `reconnecting` | Connexion perdue, tentative de rétablissement en cours. |
| `failed`       | Toutes les tentatives épuisées ou erreur irrécupérable. |

---

## Pattern `queueOnDisconnect`

Quand `queueOnDisconnect: true` (défaut), les messages envoyés via `GeoLeaf.Ws.send()` pendant une déconnexion sont bufferisés en FIFO et réexpédiés automatiquement à la reconnexion.

### Cycle de vie offline / online

```
Connexion perdue
  → État : reconnecting
  → send() → message placé dans le buffer (geoleaf:ws:send-queued)

Reconnexion réussie
  → resubscribeAll() — tous les canaux sont réactivés
  → SendQueue.flush() — messages buffferisés réexpédiés en ordre FIFO
  → État : connected
```

### Overflow du buffer

Si le buffer atteint `maxQueueSize`, **le message le plus ancien est évincé** pour faire de la place au nouveau :

```js
// Écouter les débordements
document.addEventListener("geoleaf:ws:send-queued-overflow", (e) => {
    console.warn("Message évincé du buffer :", e.detail.channel, e.detail.droppedPayload);
});
```

### Désactiver le buffering

```js
await GeoLeaf.Ws.init({
    transport: "native-ws",
    url: "wss://api.example.com/ws",
    queueOnDisconnect: false, // messages perdus si déconnecté
});

// Détecter les messages abandonnés
document.addEventListener("geoleaf:ws:send-dropped", (e) => {
    console.warn("Message abandonné sur canal :", e.detail.channel);
});
```

---

## Métriques et monitoring

`GeoLeaf.Ws.getMetrics()` retourne un snapshot immutable `WsMetrics` à tout moment, y compris avant `init()`.

### Interface `WsMetrics`

| Champ              | Type             | Description                                                                      |
| ------------------ | ---------------- | -------------------------------------------------------------------------------- |
| `connectedAt`      | `string \| null` | Horodatage ISO 8601 de la dernière connexion réussie. `null` si jamais connecté. |
| `reconnectCount`   | `number`         | Nombre total de reconnexions réussies depuis `init()`.                           |
| `messagesSent`     | `number`         | Messages envoyés (y compris les messages réexpédiés depuis le buffer).           |
| `messagesReceived` | `number`         | Messages reçus sur les canaux abonnés.                                           |
| `lastPingMs`       | `number \| null` | Dernière latence ping aller-retour en ms. `null` si heartbeat désactivé.         |
| `activeChannels`   | `string[]`       | Noms des canaux actuellement abonnés.                                            |
| `queueLength`      | `number`         | Nombre de messages en attente dans le buffer.                                    |

### Exemples de monitoring

```js
// Dashboard de métriques
function logMetrics() {
    const m = GeoLeaf.Ws.getMetrics();
    console.table({
        "Connecté depuis": m.connectedAt ?? "—",
        Reconnexions: m.reconnectCount,
        "Msgs envoyés": m.messagesSent,
        "Msgs reçus": m.messagesReceived,
        "Latence ping": m.lastPingMs != null ? `${m.lastPingMs} ms` : "—",
        "Canaux actifs": m.activeChannels.join(", ") || "—",
        Buffer: m.queueLength,
    });
}

// Snapshot périodique
setInterval(logMetrics, 10_000);

// Réagir aux mises à jour de métriques
document.addEventListener("geoleaf:ws:metrics-updated", (e) => {
    const metrics = e.detail; // WsMetrics
    if (metrics.lastPingMs > 500) {
        console.warn("Latence élevée :", metrics.lastPingMs, "ms");
    }
});
```

### Alertes sur les événements de connexion

```js
document.addEventListener("geoleaf:ws:reconnecting", (e) => {
    const { attempt, nextDelayMs } = e.detail;
    console.warn(`Reconnexion #${attempt}, prochain essai dans ${nextDelayMs} ms`);
});

document.addEventListener("geoleaf:ws:failed", (e) => {
    const { error } = e.detail;
    console.error(`Connexion définitivement perdue [${error.code}] :`, error.message);
});
```

---

## Événements

Tous les événements sont émis via `document.dispatchEvent()` et se consomment avec `document.addEventListener()`.

> **Note :** Ces événements sont distincts du système `GeoLeaf.Events` — ils n'y transitent pas.

| Événement                         | Payload                       | Déclencheur                                              |
| --------------------------------- | ----------------------------- | -------------------------------------------------------- |
| `geoleaf:ws:connected`            | `{ transport, channels }`     | Connexion établie et prête.                              |
| `geoleaf:ws:disconnected`         | `{ transport, reason }`       | Connexion perdue.                                        |
| `geoleaf:ws:reconnecting`         | `{ attempt, nextDelayMs }`    | Tentative de reconnexion en cours.                       |
| `geoleaf:ws:failed`               | `{ transport, error }`        | Échec irrécupérable (maxRetries atteint ou erreur auth). |
| `geoleaf:ws:auth-required`        | `{ transport }`               | Session expirée, action utilisateur requise.             |
| `geoleaf:ws:channel-subscribed`   | `{ channel }`                 | Abonnement ajouté ou remplacé.                           |
| `geoleaf:ws:channel-unsubscribed` | `{ channel }`                 | Abonnement supprimé.                                     |
| `geoleaf:ws:send-queued`          | `{ channel, queueLength }`    | Message placé dans le buffer offline.                    |
| `geoleaf:ws:send-dropped`         | `{ channel }`                 | Message abandonné (`queueOnDisconnect: false`).          |
| `geoleaf:ws:send-queued-overflow` | `{ channel, droppedPayload }` | Message évincé du buffer (maxQueueSize atteint).         |
| `geoleaf:ws:heartbeat-timeout`    | `{ transport }`               | Timeout du pong — reconnexion déclenchée.                |
| `geoleaf:ws:metrics-updated`      | `WsMetrics`                   | Snapshot métriques mis à jour.                           |

### Exemple : écouter les messages entrants

Les messages d'un canal sont délivrés via le **callback** passé à `subscribe()` — il n'existe pas d'événement `document` dédié aux messages (voir le tableau d'événements ci-dessus) :

```js
GeoLeaf.Ws.subscribe("layer-updates", (payload) => {
    GeoLeaf.Layers.setData("my-layer", payload.geojson.features);
});
```

---

## Transport custom

Pour remplacer ou compléter `native-ws`, enregistrez votre propre implémentation de `IWsTransport` :

```js
import { registerTransport } from "@geoleaf-plugins/websocket";

registerTransport("my-transport", () => ({
    async connect(config) {
        /* ... */
    },
    disconnect(reason) {
        /* ... */
    },
    subscribe(channel, handler) {
        return () => {};
    },
    send(channel, payload) {
        /* ... */
    },
    async ping() {
        /* ... */
    },
    get state() {
        return "connected";
    },
    onConnected: null,
    onDisconnected: null,
    onError: null,
}));

await GeoLeaf.Ws.init({
    transport: "my-transport",
    url: "wss://api.example.com/ws",
});
```

> `registerTransport()` doit être appelé **avant** `GeoLeaf.Ws.init()`. Une clé inconnue au moment de `init()` lève une erreur `INVALID_TRANSPORT`.

---

## Tests consommateurs

Le package livre un `MockTransport` pour faciliter les tests unitaires dans les projets qui intègrent le plugin.

> ⚠️ **`./test-utils` n'est PAS un sous-chemin public à ce jour, et l'exemple ci-dessous ne
> résout donc pas en l'état.** Le fichier part bien dans le tarball (`files[]` porte
> `test-utils/`) et son en-tête l'annonce public, mais la carte `exports` ne le déclare pas :
> un `import` depuis ce chemin lève `ERR_PACKAGE_PATH_NOT_EXPORTED` (mesuré, pas déduit).
> Déclarer le sous-chemin est une décision de contrat de paquet — il pointerait du TypeScript
> **non compilé**, là où tous les autres sous-chemins du dépôt visent `dist/`. Ouvert en
> **B-97**. En attendant, copier `test-utils/mock-transport.ts` depuis le tarball.

```js
import { MockTransport } from "@geoleaf-plugins/websocket/test-utils"; // ⚠️ voir la note ci-dessus
import { registerTransport } from "@geoleaf-plugins/websocket";

// Enregistrer le mock avant init()
registerTransport("mock", () => new MockTransport());

await GeoLeaf.Ws.init({ transport: "mock", url: "wss://test" });

// Simuler la réception d'un message
const mock = MockTransport.lastInstance;
mock.simulateMessage("poi-updates", { id: 42, name: "Test" });

// Vérifier les messages envoyés
expect(mock.sentMessages).toContainEqual({
    channel: "user-action",
    payload: { type: "map-click" },
});
```

---

## Gestion d'erreurs

Les erreurs irrécupérables émettent `geoleaf:ws:failed` avec un objet `WsError` :

| Code                   | Description                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `CONNECTION_REFUSED`   | Backend inaccessible, URL invalide, ou `ws://` en production.                                 |
| `AUTH_FAILED`          | Handshake refusé (ex. close code 1008).                                                       |
| `AUTH_EXPIRED`         | Session ou token expiré en cours de connexion.                                                |
| `MAX_RETRIES_EXCEEDED` | Toutes les tentatives de reconnexion épuisées.                                                |
| `INVALID_TRANSPORT`    | Clé de transport inconnue dans `WsPluginConfig.transport`.                                    |
| `SEND_QUEUE_OVERFLOW`  | Dépassement de `maxQueueSize` (informationnel — émis comme événement `send-queued-overflow`). |

```js
document.addEventListener("geoleaf:ws:failed", (e) => {
    const { code, message, transport, attempt } = e.detail.error;

    switch (code) {
        case "AUTH_FAILED":
        case "AUTH_EXPIRED":
            // Demander un nouveau token, puis reconnecter
            refreshToken().then(() => GeoLeaf.Ws.reconnect());
            break;
        case "MAX_RETRIES_EXCEEDED":
            // Notifier l'utilisateur
            GeoLeaf.Notifications?.show("Connexion temps réel perdue.", "error");
            break;
        default:
            console.error(
                `[ws:${transport}] ${code}: ${message}`,
                attempt != null ? `(tentative ${attempt})` : ""
            );
    }
});
```
