---
title: "GeoLeaf — Support PWA (Progressive Web App)"
---

# GeoLeaf — Support PWA (Progressive Web App)

**Version :** 3.0.0
**Dernière mise à jour :** mars 2026

---

## Vue d'ensemble

GeoLeaf intègre un support PWA de base dans ses builds de déploiement (`deploy/`) :

| Fonctionnalité                      | Implémentation                                                     |
| ----------------------------------- | ------------------------------------------------------------------ |
| Manifest Web App                    | Généré par `build-deploy.cjs` depuis `geoleaf.config.json → pwa.*` |
| Service Worker                      | `sw-core.js` livré dans chaque variante deploy                     |
| Invite d'installation (Android/iOS) | Configurable via `pwa.installPrompt.enabled`                       |
| Icônes                              | `src/assets/icons/icon-192.png`, `icon-512.png`, `fav.png`         |

> **Important :** Le support PWA est fonctionnel uniquement dans les builds de déploiement générés par `npm run build:deploy`. Il n'est pas actif en mode développement (`packages/core/` servi directement).

---

## Configuration

Les paramètres PWA se définissent dans `geoleaf.config.json` (à la racine des profiles) :

```jsonc
{
    "pwa": {
        // Nom complet de l'application (affiché au moment de l'installation)
        "name": "Mon Application Carto",

        // Nom court (affiché sur l'écran d'accueil)
        "short_name": "MonCarto",

        // Description (optionnelle, pour les stores d'apps)
        "description": "Application cartographique interactive",

        // Couleur de la barre de statut (doit correspondre au thème principal)
        "theme_color": "#2d6a4f",

        // Couleur de fond du splash screen
        "background_color": "#ffffff",

        // Invite d'installation
        "installPrompt": {
            // true  → affiche la bannière d'installation sur Android/iOS
            // false → pas de bannière (par défaut)
            "enabled": false,
        },
    },
}
```

Ces valeurs sont fusionnées dans `manifest.json` par le script de build. Aucune modification manuelle du `manifest.json` n'est nécessaire.

---

## Comment ça fonctionne

### 1. Manifest (`manifest.json`)

Au moment du build (`npm run build:deploy`), le script `scripts/build-deploy.cjs` lit les valeurs `pwa.*` de `geoleaf.config.json` et génère un `manifest.json` dans chaque variante deploy :

```json
{
    "name": "Mon Application Carto",
    "short_name": "MonCarto",
    "description": "Application cartographique interactive",
    "theme_color": "#2d6a4f",
    "background_color": "#ffffff",
    "display": "standalone",
    "start_url": ".",
    "icons": [
        { "src": "src/assets/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
        { "src": "src/assets/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
    ]
}
```

Le `manifest.json` est référencé dans le `<head>` de chaque page HTML :

```html
<link rel="manifest" href="manifest.json" />
<meta name="theme-color" content="#2d6a4f" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
```

### 2. Service Worker (`sw-core.js`)

L'enregistrement du Service Worker est effectué dans `init.js` :

```js
if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
        navigator.serviceWorker
            .register("./sw-core.js")
            .catch((err) => console.warn("[GeoLeaf] SW registration failed:", err));
    });
}
```

Le fichier `sw-core.js` est livré avec chaque variante deploy. Il gère la mise en cache des assets statiques pour le mode offline.

### 3. Invite d'installation

Lorsque `pwa.installPrompt.enabled: true` est configuré, GeoLeaf intercepte l'événement `beforeinstallprompt` et affiche une bannière invitant l'utilisateur à installer l'application.

---

## Icônes

Les icônes doivent être présentes dans `src/assets/icons/` de votre projet :

| Fichier                 | Taille  | Usage                                   |
| ----------------------- | ------- | --------------------------------------- |
| `icon-192.png`          | 192×192 | Icône standard — Android, Windows       |
| `icon-192-maskable.png` | 192×192 | Icône maskable — Android adaptive icons |
| `icon-512.png`          | 512×512 | Icône haute résolution — splash screen  |
| `icon-512-maskable.png` | 512×512 | Icône maskable haute résolution         |
| `fav.png`               | —       | Favicon navigateur                      |

> Ces fichiers sont générés automatiquement par `node scripts/generate-pwa-icons.cjs`. Voir [pwa.md](../pwa.md) pour les détails de génération.

---

## Limitation : développement local

Le Service Worker et le manifest ne sont pas actifs dans l'environnement de développement (`packages/core/` servi directement). Pour tester la PWA :

```bash
# Générer les builds deploy
npm run build:deploy

# Servir une variante deploy (ex. deploy-core)
npx serve deploy/deploy-core -p 8766
```

Le Service Worker exige HTTPS en production (ou `localhost` pour les tests).

---

## Personnaliser les icônes

Remplacez les fichiers dans `packages/core/src/assets/icons/` par vos propres icônes. Les chemins sont référencés directement dans `index.html` et dans le manifest généré — aucune configuration supplémentaire n'est nécessaire.

---

## Voir aussi

- DEVELOPER_GUIDE.md — workflow de build et deploy
- [usage-cdn.md](../usage-cdn.md) — intégration CDN sans PWA
