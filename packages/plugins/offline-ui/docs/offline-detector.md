# GeoLeaf — Détecteur de connectivité

> **Ce module appartient au core** (`@geoleaf/core`), pas à ce greffon : il est décrit ici parce
> que la fenêtre hors-ligne vit à côté de lui. `@geoleaf-plugins/offline-ui` ne l'initialise pas
> et ne dépend pas de ses événements.

---

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [API publique](#2-api-publique)
3. [Configuration](#3-configuration)
4. [Événements](#4-événements)
5. [Badge](#5-badge)
6. [Ce qui ne dépend PAS du détecteur](#6-ce-qui-ne-dépend-pas-du-détecteur)
7. [Exemples](#7-exemples)
8. [Voir aussi](#8-voir-aussi)

---

## 1. Vue d'ensemble

Le détecteur surveille l'état de la connectivité et émet un événement quand l'application passe
**en ligne** ou **hors ligne**. Il propose :

- la détection par `navigator.onLine` et les événements `online` / `offline` du navigateur ;
- une vérification active par **ping** — une requête HTTP légère vers une URL configurable ;
- un **badge** sur la carte, qui dit l'état de la connexion ;
- deux événements personnalisés, pour déclencher une notification ou adapter une interface.

**Espace de noms** : `GeoLeaf.Storage.OfflineDetector`
**Fichier** : `packages/core/src/kernel/storage/offline-detector.ts`

---

## 2. API publique

### `OfflineDetector.isOnline()`

Rend l'état courant de la connexion. C'est le membre qu'une application appelle.

```javascript
if (GeoLeaf.Storage?.OfflineDetector?.isOnline()) {
    console.log("Application en ligne");
} else {
    console.log("Application hors ligne");
}
```

### `OfflineDetector.init(options)` et `OfflineDetector.destroy()`

`init` démarre la surveillance avec les options de la table ci-dessous ; `destroy` l'arrête, retire
le badge et rend ses écouteurs et son minuteur. **Le core appelle `init` lui-même** au démarrage,
quand le profil active le détecteur : une application n'a pas à le faire.

---

## 3. Configuration

| Option          | Type             | Défaut      | Description                                                             |
| --------------- | ---------------- | ----------- | ----------------------------------------------------------------------- |
| `showBadge`     | `boolean`        | `false`     | Affiche un badge d'état sur la carte                                    |
| `badgePosition` | `string`         | `"topleft"` | Coin du badge                                                           |
| `checkInterval` | `number`         | `30000`     | Intervalle de la vérification active, en millisecondes                  |
| `pingUrl`       | `string \| null` | `null`      | URL de la vérification active. À `null`, seul `navigator.onLine` est lu |

⚠️ Sans `pingUrl`, aucun minuteur ne tourne : la vérification périodique ne ferait que relire
`navigator.onLine`, que les événements du navigateur tiennent déjà à jour.

### Activation par le profil

Le détecteur s'active par la configuration PWA, pas par un appel :

```json
{
    "modules": {
        "pwa": {
            "offlineDetector": { "enabled": true, "badgePosition": "topleft" }
        }
    }
}
```

Activé de cette façon, le badge est affiché. Les clés `storage.*` qui portaient ce réglage
n'existent plus — voir [CONFIGURATION.md](CONFIGURATION.md).

---

## 4. Événements

Le détecteur émet sur `document` :

| Événement         | Déclenché quand                | `event.detail`  |
| ----------------- | ------------------------------ | --------------- |
| `geoleaf:offline` | L'application passe hors ligne | `{ timestamp }` |
| `geoleaf:online`  | L'application revient en ligne | `{ timestamp }` |

```javascript
document.addEventListener("geoleaf:offline", () => {
    console.log("Hors ligne");
});

document.addEventListener("geoleaf:online", () => {
    console.log("Retour en ligne");
});
```

## 5. Badge

Avec `showBadge: true`, un contrôle de carte affiche l'état : il apparaît au passage hors ligne et
se retire au retour en ligne. Il suit le thème de l'interface.

---

## 6. Ce qui ne dépend PAS du détecteur

🛑 **L'envoi des saisies au retour du réseau ne passe pas par lui.** Le core arme lui-même le
vidage de la file d'écriture, sur les événements `online` du navigateur : un profil qui coupe le
détecteur — donc le badge — garde l'envoi automatique. Une version précédente de cette page
décrivait un `SyncManager` déclenché par `geoleaf:online` ; ce n'est pas le chemin.

De même, la fenêtre hors-ligne de ce greffon écoute `online` et `offline` du navigateur, pas
`geoleaf:online` / `geoleaf:offline` : elle ne devient pas aveugle parce qu'un profil a coupé un
badge.

Le cycle d'écriture — ce qu'une couche déclare, comment une saisie est enregistrée, quand la file
se vide — est décrit par le core : [cycle d'écriture hors-ligne](../../../core/docs/OFFLINE_WRITE_CYCLE.md).

---

## 7. Exemples

### Prévenir l'utilisateur

```javascript
document.addEventListener("geoleaf:offline", () => {
    GeoLeaf.UI.Notifications.warning(
        "Vous êtes hors ligne. Vos saisies partiront au retour de la connexion."
    );
});

document.addEventListener("geoleaf:online", () => {
    GeoLeaf.UI.Notifications.success("Connexion rétablie.");
});
```

### Adapter une interface

```javascript
function setReachable(reachable) {
    for (const el of document.querySelectorAll("[data-needs-network]")) {
        el.toggleAttribute("disabled", !reachable);
    }
}

document.addEventListener("geoleaf:offline", () => setReachable(false));
document.addEventListener("geoleaf:online", () => setReachable(true));
```

---

## 8. Voir aussi

- [README.md](../README.md) — le greffon de l'interface hors-ligne
- [API_REFERENCE.md](API_REFERENCE.md) — ce que la fenêtre appelle, et les événements qu'elle suit
- [CONFIGURATION.md](CONFIGURATION.md) — les clés de profil
- [EXAMPLES.md](EXAMPLES.md) — recettes
