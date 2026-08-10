---
title: "GeoLeaf Notifications — API publique"
---

# GeoLeaf Notifications — API publique

> **Module :** `@geoleaf/core` — disponible dès le boot
> **Namespace :** `GeoLeaf.notify()` (shortcut) + `GeoLeaf.Notifications.*` (namespace complet)
> **Export ESM :** `import { Notifications } from "@geoleaf/core"`
> **Version :** 3.0.0 — Mars 2026

---

## Sommaire

1. [Vue d'ensemble](#vue-densemble)
2. [Utilisation CDN / ESM](#utilisation-cdn--esm)
3. [Utilisation ESM (bundler)](#utilisation-esm-bundler)
4. [API référence](#api-référence)
5. [Types](#types)
6. [Options détaillées](#options-détaillées)
7. [Architecture interne — Queue prioritaire](#architecture-interne--queue-prioritaire)
8. [Structure DOM et classes CSS](#structure-dom-et-classes-css)
9. [Intégration Telemetry](#intégration-telemetry)
10. [Exemples d'intégration](#exemples-dintégration)
11. [Accessibilité](#accessibilité)
12. [Responsive (mobile)](#responsive-mobile)
13. [Debugging](#debugging)
14. [Notes de sécurité](#notes-de-sécurité)

---

## Vue d'ensemble

GeoLeaf embarque un système de notifications toast interne (`NotificationSystem`) utilisé par le core pour informer l'utilisateur (chargement de données, erreurs réseau, etc.).

Depuis la version 2.0.0, ce système est exposé publiquement pour les **intégrateurs** :

| Point d'accès                                   | Usage                              |
| ----------------------------------------------- | ---------------------------------- |
| `GeoLeaf.notify(msg, type, opts)`               | Shortcut top-level, usage simple   |
| `GeoLeaf.Notifications.success(msg)`            | Namespace complet, méthodes typées |
| `import { Notifications } from "@geoleaf/core"` | Import ESM pour bundlers tiers     |

**Caractéristiques principales :**

- Queue prioritaire : errors > warnings > info/success
- 3 toasts temporaires + 2 persistants visibles simultanément
- Animations fluides avec réorganisation automatique par priorité
- Accessibilité : `aria-live="assertive"` pour les erreurs
- Support `prefers-reduced-motion`

---

## Utilisation CDN / ESM

```html
<script type="module" src="geoleaf.esm.js"></script>
<script>
    // After GeoLeaf.boot() / geoleaf:app:ready event

    // Top-level shortcut
    GeoLeaf.notify("Bienvenue sur la carte !", "info");

    // Full namespace
    GeoLeaf.Notifications.success("Données chargées avec succès");
    GeoLeaf.Notifications.warning("Connexion instable", { duration: 6000 });
    GeoLeaf.Notifications.error("Impossible de charger la couche", {
        persistent: true,
        dismissible: true,
    });
</script>
```

### Écouter l'événement `geoleaf:app:ready`

```js
document.addEventListener("geoleaf:app:ready", () => {
    GeoLeaf.notify("Carte prête", "success", 2000);
});
```

---

## Utilisation ESM (bundler)

```ts
import { Notifications } from "@geoleaf/core";
// ⚠️ Le chemin `contracts/notification.contract` N'EXISTE PAS — vérifié contre la carte
// `exports` du paquet. Le fichier de contrat s'appelle `notify.contract.ts` et n'est pas
// publié ; les deux types vivent dans la capacité, atteignable par le joker `capabilities/*`.
import type { NotifyType, NotifyOptions } from "@geoleaf/core/capabilities/toast-renderer/types.js";

// Simple notification
Notifications.info("Nouvelle mise à jour disponible");

// With options
Notifications.error("Échec de la synchronisation", {
    duration: 8000,
    dismissible: true,
});

// Generic signature
// ⚠️ `notify()` a DEUX formes, et elles ne se mélangent pas :
//   notify(message, type, duration)  — positionnelle, le 3e argument est un NOMBRE
//   notify(message, options)         — objet, le type voyage DANS les options
// Passer des options en 3e position ne compile pas. Pour combiner un type et des options,
// fusionner les deux dans le second argument :
function notifyUser(message: string, type: NotifyType, opts?: NotifyOptions) {
    Notifications.notify(message, { ...opts, type });
}

// Check system status
const status = Notifications.getStatus();
console.log(`${status.activeToasts} toast(s) actif(s)`);
```

---

## API référence

### `GeoLeaf.notify(message, type, options?)` _(shortcut top-level)_

Affiche une notification toast. Disponible directement sur le namespace `GeoLeaf`.

```js
GeoLeaf.notify(message, type, duration?)
GeoLeaf.notify(message, type, options?)
GeoLeaf.notify(message, options?)
```

| Paramètre  | Type            | Défaut         | Description                     |
| ---------- | --------------- | -------------- | ------------------------------- |
| `message`  | `string`        | —              | Texte affiché dans le toast     |
| `type`     | `NotifyType`    | `"info"`       | Type de notification            |
| `duration` | `number`        | _(selon type)_ | Durée d'affichage en ms         |
| `options`  | `NotifyOptions` | —              | Objet options (voir ci-dessous) |

---

### `GeoLeaf.Notifications.*` / `Notifications.*`

#### `.notify(message, typeOrOptions?, duration?)`

Méthode générique. Supporte la double signature positionnelle et objet.

#### `.success(message, options?)`

Toast vert — confirmation d'action réussie. Durée par défaut : **3 000 ms**.

#### `.error(message, options?)`

Toast rouge — erreur critique. Durée par défaut : **5 000 ms**. Priorité maximale dans la queue.

#### `.warning(message, options?)`

Toast orange — alerte non bloquante. Durée par défaut : **4 000 ms**.

#### `.info(message, options?)`

Toast bleu/neutre — information. Durée par défaut : **3 000 ms**.

#### `.dismiss(toastEl)`

Ferme un toast spécifique à partir de son élément DOM.

#### `.clearAll()`

Supprime immédiatement tous les toasts visibles et vide la queue.

#### `.getStatus()` → `NotifyStatus`

Retourne un snapshot de l'état courant du système.

```js
const s = GeoLeaf.Notifications.getStatus();
// {
//   enabled: true,
//   initialized: true,
//   activeToasts: 1,
//   temporaryToasts: 1,
//   persistentToasts: 0,
//   queued: 0,
//   maxVisible: 3,
//   maxPersistent: 2,
//   position: "bottom-center"
// }
```

---

## Types

### `NotifyType`

```ts
type NotifyType = "info" | "success" | "warning" | "error";
```

### `NotifyOptions`

```ts
interface NotifyOptions {
    type?: NotifyType; // type override (useful with notify())
    duration?: number; // display duration in ms (ignored if persistent: true)
    persistent?: boolean; // true → no auto-dismiss (default: false)
    dismissible?: boolean; // true → close button (default: true)
}
```

### `NotifyStatus`

```ts
interface NotifyStatus {
    enabled: boolean;
    initialized: boolean;
    activeToasts: number;
    temporaryToasts: number;
    persistentToasts: number;
    queued: number;
    maxVisible: number;
    maxPersistent: number;
    position: string;
}
```

---

## Options détaillées

### `duration`

Temps avant fermeture automatique du toast, en millisecondes.

```js
GeoLeaf.Notifications.info("Message", { duration: 8000 }); // 8 seconds
```

Durées par défaut :

| Type      | Durée par défaut |
| --------- | ---------------- |
| `info`    | 3 000 ms         |
| `success` | 3 000 ms         |
| `warning` | 4 000 ms         |
| `error`   | 5 000 ms         |

### `persistent`

Un toast persistant ne se ferme pas automatiquement. Il reste visible jusqu'à un `dismiss()` ou `clearAll()` explicite.

```js
GeoLeaf.Notifications.error("Perte de connexion au serveur", { persistent: true });

// Later, when connection is restored:
GeoLeaf.Notifications.clearAll();
GeoLeaf.Notifications.success("Connexion rétablie");
```

### `dismissible`

Affiche un bouton × permettant à l'utilisateur de fermer le toast manuellement.

```js
GeoLeaf.Notifications.warning("Mise à jour disponible", {
    persistent: true,
    dismissible: true, // user can dismiss
});
```

---

## Architecture interne — Queue prioritaire

### Priorités

| Type               | Priorité    |
| ------------------ | ----------- |
| `error`            | 3 (haute)   |
| `warning`          | 2 (moyenne) |
| `success` / `info` | 1 (basse)   |

### Comportement de la queue

- **Limite** : 15 notifications max en attente
- **Éviction** : les moins prioritaires sont abandonnées si la queue est pleine
- **Compteurs** : 3 toasts temporaires max + 2 toasts persistants max visibles simultanément

### Flux d'affichage

1. Toast ajouté avec priorité selon type
2. Queue triée par priorité (desc) puis timestamp (asc)
3. Toasts affichés selon disponibilité des slots
4. **Réorganisation** : si un `error` arrive alors que la queue est pleine, un toast `info`/`success` est retiré avec animation `slideUp`
5. **Éviction** : si 15 toasts sont en attente, le moins prioritaire est abandonné

### Exemple de comportement

```js
// Initial state: 3 info toasts visible + 5 queued
GeoLeaf.Notifications.info("Info 1");
GeoLeaf.Notifications.info("Info 2");
GeoLeaf.Notifications.info("Info 3");
// ... 5 more queued

// A priority error arrives
GeoLeaf.Notifications.error("Erreur critique !");

// Result:
// - 1 info toast removed with slideUp animation
// - Error displayed immediately
// - 2 info toasts remain visible
```

---

## Structure DOM et classes CSS

### Structure DOM générée

```html
<div id="gl-notifications" class="gl-notifications gl-notifications--bottom-center">
    <div class="gl-toast gl-toast--success gl-toast--visible" role="alert" aria-live="polite">
        <span class="gl-toast__message">Message de succès</span>
        <button class="gl-toast__close" aria-label="Fermer">×</button>
    </div>
</div>
```

### Container HTML requis

```html
<div id="gl-notifications" class="gl-notifications gl-notifications--bottom-center"></div>
```

### Classes principales

| Classe                             | Description                               |
| ---------------------------------- | ----------------------------------------- |
| `.gl-notifications`                | Conteneur fixe                            |
| `.gl-notifications--bottom-center` | Variante position                         |
| `.gl-toast`                        | Toast individuel                          |
| `.gl-toast--visible`               | État visible (opacity: 1)                 |
| `.gl-toast--removing`              | Animation de sortie                       |
| `.gl-toast--sliding-up`            | Animation réorganisation (toast évincé)   |
| `.gl-toast--sliding-down`          | Animation réorganisation (toast descendu) |
| `.gl-toast--success`               | Type succès (vert)                        |
| `.gl-toast--error`                 | Type error (rouge)                        |
| `.gl-toast--warning`               | Type warning (orange)                     |
| `.gl-toast--info`                  | Type info (bleu)                          |
| `.gl-toast__message`               | Contenu du message                        |
| `.gl-toast__close`                 | Bouton fermeture                          |

### Positions disponibles

- `bottom-center` (défaut, recommandé)
- `top-right`
- `bottom-right`
- `top-center`

### Animations CSS

```css
/* Slide-up animation (toast evicted by higher priority) */
@keyframes slideUp {
    from {
        transform: translateY(0);
        opacity: 1;
    }
    to {
        transform: translateY(-100%);
        opacity: 0;
    }
}

/* Slide-down animation (toast moved down in stack) */
@keyframes slideDown {
    from {
        transform: translateY(-20px);
        opacity: 0.5;
    }
    to {
        transform: translateY(0);
        opacity: 1;
    }
}
```

---

## Intégration Telemetry

Le système enregistre automatiquement des métriques via `GeoLeaf.Storage.Telemetry` lorsque ce module est disponible.

| Métrique                        | Description                           | Type    |
| ------------------------------- | ------------------------------------- | ------- |
| `notification.shown.success`    | Toasts succès affichés                | Counter |
| `notification.shown.error`      | Toasts error affichés                 | Counter |
| `notification.shown.warning`    | Toasts warning affichés               | Counter |
| `notification.shown.info`       | Toasts info affichés                  | Counter |
| `notification.dismissed.manual` | Fermeture manuelle (clic ×)           | Counter |
| `notification.dismissed.auto`   | Fermeture automatique (timeout)       | Counter |
| `notification.queued`           | Ajouts à la queue                     | Counter |
| `notification.dropped`          | Notifications évincées (queue pleine) | Counter |

**Buffer de démarrage** : si `Telemetry` n'est pas encore chargé, les métriques sont bufferisées pendant 30 secondes, puis :

- Flush automatique si `Telemetry` devient disponible
- Abandon après 30 s si `Telemetry` ne charge pas (évite les fuites mémoire)

---

## Exemples d'intégration

### Hook sur événement de chargement couche

```js
document.addEventListener("geoleaf:layer:toggle", (e) => {
    const { layerId, visible } = e.detail;
    if (visible) {
        GeoLeaf.notify(`Couche "${layerId}" activée`, "info", 2000);
    }
});
```

### Hook sur erreur de chargement couche

```js
document.addEventListener("geoleaf:layer:error", (e) => {
    GeoLeaf.Notifications.error(`Impossible de charger la couche "${e.detail.layerId}"`, {
        persistent: true,
        dismissible: true,
    });
});
```

### Notification après ajout POI (plugin AddPOI)

```js
document.addEventListener("geoleaf:poi:added", (e) => {
    GeoLeaf.Notifications.success(`POI "${e.detail.name}" ajouté avec succès`);
});
```

### Cache offline (plugin Storage)

```js
// Download success
GeoLeaf.Notifications.success(`Profil téléchargé : ${sizeMB} MB`, 4000);

// Storage error
GeoLeaf.Notifications.error("Stockage offline non disponible", 5000);

// Download stopped
GeoLeaf.Notifications.warning("Téléchargement arrêté", 3000);
```

### Synchronisation POI

```js
// Start info (persistent)
GeoLeaf.Notifications.info("Synchronisation en cours...", {
    persistent: true,
    dismissible: false,
});

// Conditional success/warning
if (results.failed > 0) {
    GeoLeaf.Notifications.warning(
        `Sync terminée : ${results.synced} réussies, ${results.failed} échecs`,
        5000
    );
} else {
    GeoLeaf.Notifications.success(`Sync terminée : ${results.synced} réussies`, 5000);
}
```

### Vérification système avant notification

```js
const status = GeoLeaf.Notifications.getStatus();

if (status.initialized && status.enabled) {
    GeoLeaf.Notifications.info("Système de notifications opérationnel");
} else {
    console.warn("[GeoLeaf] Notifications non disponibles", status);
}
```

---

## Accessibilité

- `role="alert"` sur chaque toast
- `aria-live="assertive"` pour errors et toasts prioritaires
- `aria-live="polite"` pour success/warning/info
- `aria-label` sur le bouton de fermeture
- Support `prefers-reduced-motion` (transitions désactivées si demandé)
- Focus management (`:focus-within`)

```css
@media (prefers-reduced-motion: reduce) {
    .gl-toast,
    .gl-notifications {
        transition: none !important;
    }
}
```

---

## Responsive (mobile)

Sur mobile (< 768 px) les toasts occupent toute la largeur de l'écran :

```css
@media (max-width: 768px) {
    .gl-notifications--bottom-center {
        left: 10px;
        right: 10px;
        transform: none;
    }
}
```

---

## Debugging

```js
// Check current state
console.log(GeoLeaf.Notifications.getStatus());

// Test queue behavior
for (let i = 0; i < 20; i++) {
    GeoLeaf.Notifications.info(`Test ${i}`);
}
// Expected: 3 visible, 12 queued, 5 dropped

// Check Telemetry metrics
if (GeoLeaf.Storage?.Telemetry) {
    const report = GeoLeaf.Storage.Telemetry.getMetricsReport();
    console.log("Notification metrics:", report);
}
```

---

## Notes de sécurité

> Les messages passés à `GeoLeaf.notify()` sont traités comme du **texte brut** — ils sont insérés via `textContent`, pas `innerHTML`.
>
> ⚠️ Si vous construisez un message à partir de données utilisateur ou d'une source externe, ne jamais y injecter de HTML. Le système GeoLeaf protège contre les injections XSS à son niveau, mais la responsabilité de la composition du message revient à l'intégrateur.

```js
// ✅ Correct — static text or trusted source
GeoLeaf.notify("Connexion rétablie", "success");

// ✅ Correct — internal GeoLeaf data
GeoLeaf.notify(`POI "${poi.name}" chargé`, "success");

// ⚠️ Avoid — raw HTML from user input
GeoLeaf.notify(`<b>${userInput}</b>`, "info"); // do not do this
```

---

**Documentation liée :**

- [GeoLeaf_UI_README.md](../ui/GeoLeaf_UI_README.md) — Module UI principal
- [EVENTS_API.md](../EVENTS_API.md) — Événements système
