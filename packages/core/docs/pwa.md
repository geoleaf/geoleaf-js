---
title: "PWA — Configuration et déploiement"
---

# PWA — Configuration et déploiement

GeoLeaf prend en charge l'installation en tant qu'**application web progressive (PWA)** sur Android et iOS, sans développement spécifique. Cette page documente la configuration, les prérequis de déploiement, et les comportements par plateforme.

---

## Prérequis de déploiement

| Critère                                    | Requis pour                                           |
| ------------------------------------------ | ----------------------------------------------------- |
| **HTTPS**                                  | Lighthouse PWA, Service Worker, `beforeinstallprompt` |
| **Service Worker actif**                   | Offline, Lighthouse PWA                               |
| **`manifest.json` valide**                 | Installabilité, Lighthouse PWA                        |
| **Icônes 192 et 512 px** (dont `maskable`) | Lighthouse PWA score 100                              |
| **`<link rel="manifest">`** dans le HTML   | Détection par le navigateur                           |
| **`theme-color` meta tag**                 | Couleur du Chrome navigateur                          |

> Le Service Worker (`sw-core.js`) et le manifest (`manifest.json`) sont automatiquement inclus dans les variantes deployées par `build-deploy.cjs`.

---

## Génération des icônes

Les icônes PWA doivent être générées à partir du logo source avant le premier déploiement :

```bash
node scripts/generate-pwa-icons.cjs
```

Produit 4 fichiers dans `apps/geoleaf-app/src/assets/icons/` :

| Fichier                 | Taille  | Usage                             |
| ----------------------- | ------- | --------------------------------- |
| `icon-192.png`          | 192×192 | Standard — Android, Windows       |
| `icon-512.png`          | 512×512 | Standard — splash screen          |
| `icon-192-maskable.png` | 192×192 | Maskable — Android adaptive icons |
| `icon-512-maskable.png` | 512×512 | Maskable — splash screen maskable |

> Prérequis : `sharp` installé dans `packages/core` (`npm install --prefix packages/core`).

---

## Configurer le branding PWA

Le manifest est généré dynamiquement par `build-deploy.cjs` en fusionnant :

1. Le template source `apps/geoleaf-app/manifest.json`
2. La section `pwa` de `profiles/geoleaf.config.json`

Les champs `pwa.*` de la config écrasent les valeurs du template :

```json
// profiles/geoleaf.config.json
{
    "pwa": {
        "name": "Mon Application",
        "short_name": "MonApp",
        "description": "Ma description",
        "theme_color": "#2d6a4f",
        "background_color": "#ffffff",
        "installPrompt": {
            "enabled": false
        }
    }
}
```

---

## Activer le prompt d'installation

Le prompt est **désactivé par défaut** (`enabled: false`). Pour l'activer :

```json
// profiles/geoleaf.config.json
{
    "pwa": {
        "installPrompt": {
            "enabled": true
        }
    }
}
```

`GeoLeaf.PWA.init()` est appelé automatiquement après le chargement de la config (dans `app/boot.ts`).

### Comportement par plateforme

| Plateforme                  | Comportement                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Android / Chrome / Edge** | Capture `beforeinstallprompt` → affiche une bannière custom avec bouton « Installer »                                                 |
| **iOS Safari**              | `beforeinstallprompt` n'existe pas → affiche une bannière manuelle expliquant comment ajouter à l'écran d'accueil via le menu Partage |
| **Autres navigateurs**      | `beforeinstallprompt` absent → aucune bannière                                                                                        |

#### Bannière Android

- Apparaît uniquement lorsque le navigateur juge l'app installable (HTTPS + SW + manifest valide)
- Persistance du refus : `localStorage['gl_pwa_install_dismissed']`
- Auto-masquage après installation (`appinstalled` event)

#### Bannière iOS

- Détecte `/(iPhone|iPad|iPod)/i` sur `navigator.userAgent`
- Non affichée si l'app est déjà en mode standalone (`navigator.standalone === true`)
- Apparaît 1,5 seconde après le chargement pour éviter de masquer le contenu initial
- Persistance du refus : `localStorage['gl_pwa_ios_dismissed']`

---

## Utilisation programmatique (ESM)

```typescript
import { PWA } from "@geoleaf/core";

// Initialisation manuelle (normalement appelé par boot.ts)
PWA.init({
    installPrompt: { enabled: true },
});
```

Via le namespace global (CDN/ESM) :

```javascript
GeoLeaf.PWA.init({ installPrompt: { enabled: true } });
```

---

## Validation Lighthouse

Pour obtenir un score PWA ≥ 90 (idéalement 100) :

```bash
npx lighthouse https://your-domain.com --preset=pwa --output=html --output-path=./lighthouse-report.html
```

Checklist :

- [ ] HTTPS actif sur le serveur
- [ ] `manifest.json` présent à la racine, champs `name`, `icons` 192+512, `start_url`, `display` renseignés
- [ ] Icônes avec `purpose: maskable` (générées par `generate-pwa-icons.cjs`)
- [ ] `<link rel="manifest">` dans le HTML
- [ ] `theme-color` meta tag présent
- [ ] Service Worker enregistré, `fetch` event handler actif
- [ ] `start_url` répond HTTP 200 (y compris offline)

---

## Architecture des fichiers

```
packages/core/
├── manifest.json               ← Template source (mergé par build-deploy.cjs)
├── init.js                     ← Enregistrement SW (navigator.serviceWorker.register)
├── sw-core.js                  ← Service Worker lite (cache statique + profils)
└── src/
    ├── assets/icons/
    │   ├── icon-192.png        ← Généré par generate-pwa-icons.cjs
    │   ├── icon-192-maskable.png
    │   ├── icon-512.png
    │   └── icon-512-maskable.png
    └── modules/
        ├── geoleaf.pwa.ts      ← Façade publique (GeoLeaf.PWA)
        └── pwa/
            ├── pwa-manager.ts  ← Orchestrateur + interface PWAConfig
            ├── install-prompt.ts ← Android banner
            ├── ios-banner.ts   ← iOS instructions banner
            └── index.ts        ← Exports du module

scripts/
└── generate-pwa-icons.cjs      ← Générateur d'icônes (sharp)
```

---

## Référence de l'interface `PWAConfig`

Voir {@link PWAConfig} pour la documentation complète des champs.
