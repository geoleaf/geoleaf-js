# GeoLeaf — Offline Detector

> **Version** : 2.0.0 — **Date** : 15 février 2026
> **Plugin** : Storage (`geoleaf-offline-ui.plugin.js`)

---

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [API publique](#2-api-publique)
3. [Configuration](#3-configuration)
4. [Événements](#4-événements)
5. [Badge UI](#5-badge-ui)
6. [Intégration avec SyncManager](#6-intégration-avec-syncmanager)
7. [Exemples](#7-exemples)
8. [Voir aussi](#8-voir-aussi)

---

## 1. Vue d'ensemble

Le module OfflineDetector surveille l'état de la connectivité réseau et émet des événements lorsque l'application passe en mode **online** ou **offline**. Il propose :

- Détection via l'API `navigator.onLine` + événements `online`/`offline`
- Vérification active via **ping** (requête HTTP légère vers une URL configurable)
- Affichage d'un **badge UI** sur la carte indiquant l'état de la connexion
- Émission d'événements personnalisés pour déclencher des actions (sync, notification…)

**Namespace** : `GeoLeaf.Storage.OfflineDetector`
**Fichier** : `packages/core/src/kernel/storage/offline-detector.ts`

---

## 2. API publique

### `OfflineDetector.init(options)`

Initialise le détecteur avec la configuration fournie.

```javascript
GeoLeaf.OfflineDetector.init({
    showBadge: true,
    badgePosition: "topleft",
    checkInterval: 30000, // vérification toutes les 30s
    pingUrl: "/api/health", // URL de ping (optionnel)
});
```

### `OfflineDetector.isOnline()`

Retourne l'état actuel de la connexion.

```javascript
if (GeoLeaf.OfflineDetector.isOnline()) {
    console.log("Application en ligne");
} else {
    console.log("Application hors-ligne");
}
```

### `OfflineDetector.destroy()`

Arrête la surveillance et supprime le badge UI. Nettoie les event listeners et le timer de vérification.

---

## 3. Configuration

| Option          | Type           | Défaut      | Description                                                                          |
| --------------- | -------------- | ----------- | ------------------------------------------------------------------------------------ |
| `showBadge`     | `boolean`      | `false`     | Affiche un badge de statut sur la carte                                              |
| `badgePosition` | `string`       | `'topleft'` | Position du badge (`'topleft'`, `'topright'`, `'bottomleft'`, `'bottomright'`)       |
| `checkInterval` | `number`       | `30000`     | Intervalle de vérification active en ms (0 = désactivé)                              |
| `pingUrl`       | `string\|null` | `null`      | URL pour vérification active. Si `null`, seule l'API `navigator.onLine` est utilisée |

### Activation via profil

L'OfflineDetector est activé via la config Storage dans le profil :

```json
{
    "storage": {
        "enableOfflineDetector": true
    }
}
```

Le code dans `app/init.ts` passe `enableOfflineDetector` à `Storage.init()` qui appelle `OfflineDetector.init()` en interne.

---

## 4. Événements

Le module émet des événements personnalisés sur `document` :

| Événement         | Déclenché quand                     | `event.detail`  |
| ----------------- | ----------------------------------- | --------------- |
| `geoleaf:offline` | L'application passe en mode offline | `{ timestamp }` |
| `geoleaf:online`  | L'application revient en ligne      | `{ timestamp }` |

### Écouter les changements

```javascript
document.addEventListener("geoleaf:offline", () => {
    console.log("Mode offline activé");
});

document.addEventListener("geoleaf:online", () => {
    console.log("Retour en ligne — synchronisation possible");
});
```

## 5. Badge UI

Quand `showBadge: true`, un contrôle MapLibre affiche un badge sur la carte :

- **🟢 Online** : badge vert discret
- **🔴 Offline** : badge rouge avec indication de mode offline

Le badge est ajouté comme un contrôle MapLibre standard et respecte le thème UI (light/dark).

---

## 6. Intégration avec SyncManager

L'OfflineDetector est utilisé par le `SyncManager` pour déclencher automatiquement la synchronisation quand la connexion revient :

```
Offline → Éditions enregistrées dans l'outbox (IndexedDB) par `Storage.applyEdit`
       → OfflineDetector émet 'geoleaf:online'
       → SyncManager.sync() déclenché automatiquement
       → Opérations envoyées au backend
       → Queue vidée
```

---

## 7. Exemples

### Notification à l'utilisateur

```javascript
document.addEventListener("geoleaf:offline", () => {
    GeoLeaf.UI.Notifications.warning(
        "Vous êtes hors-ligne. Les modifications seront synchronisées au retour de la connexion."
    );
});

document.addEventListener("geoleaf:online", () => {
    GeoLeaf.UI.Notifications.success("Connexion rétablie. Synchronisation en cours…");
});
```

### Adapter l'UI selon l'état

```javascript
// Utiliser les deux événements geoleaf:online / geoleaf:offline
document.addEventListener("geoleaf:offline", () => {
    const addPoiBtn = document.querySelector('[data-gl-role="add-poi"]');
    if (addPoiBtn) addPoiBtn.classList.add("gl-disabled");
});

document.addEventListener("geoleaf:online", () => {
    const addPoiBtn = document.querySelector('[data-gl-role="add-poi"]');
    if (addPoiBtn) addPoiBtn.classList.remove("gl-disabled");
});
```

---

## 8. Voir aussi

- [README.md](../README.md) — vue d'ensemble du plugin Storage
- [API_REFERENCE.md](API_REFERENCE.md) — référence complète `GeoLeaf.Storage`
- [CONFIGURATION.md](CONFIGURATION.md) — configuration dans `profile.json`
- [EXAMPLES.md](EXAMPLES.md) — exemples d'intégration
