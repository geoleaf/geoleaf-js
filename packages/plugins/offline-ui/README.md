# @geoleaf-plugins/offline-ui

**GeoLeaf Offline UI Plugin** — l'interface hors-ligne : sélecteur de couches, bouton de cache, panneau de synchronisation. Le moteur (IndexedDB, cache, download, sync) vit dans `@geoleaf/core`, et la façade `GeoLeaf.Storage` lui appartient. Licence MIT.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![npm](https://img.shields.io/badge/npm-%40geoleaf--plugins%2Foffline--ui-cb3837.svg)](https://www.npmjs.com/package/@geoleaf-plugins/offline-ui)

---

## Fonctionnalités

- **Persistance IndexedDB** — Données POI, métadonnées couches, file de synchronisation, images, sauvegardes
- **Cache de profil** — Télécharge tuiles et ressources d'un profil pour un accès entièrement hors-ligne
- **File de synchronisation** — Enregistre les opérations CRUD en offline ; transmission automatique au retour du réseau
- **Gestion d'images offline** — Stockage local des images, upload différé quand la connectivité est rétablie
- **Détecteur offline** — Surveillance automatique de la connectivité avec indicateur visuel intégré
- **Bouton Cache** — Contrôle UI MapLibre natif pour lancer/suivre le téléchargement offline

---

## Installation

### Installer le package

```bash
npm install @geoleaf/core @geoleaf-plugins/offline-ui
```

> **Prérequis** : `@geoleaf/core` v3.x. ⚠️ Aucun `engines` n'est déclaré par les 15 paquets
> publiés — npm n'impose donc aucune version de Node ; la chaîne de dev du dépôt exige ≥ 22.13
> (B-98).
>
> ⚠️ Le core est déclaré en **`dependencies`** (range `*`), **pas** en `peerDependencies` — les
> 13 plugins font de même. Cette ligne annonçait `^2.0.0` « peer dependency » jusqu'au
> 31/07/2026 : faux sur les deux points, et la conséquence est réelle — npm peut installer une
> **seconde copie** du core au lieu de réutiliser la vôtre. Versions courantes :
> `npm run versions:check`.

---

## Utilisation

### ESM (bundler / Vite / webpack)

```typescript
import "@geoleaf/core";
import "@geoleaf-plugins/offline-ui";

// Le plugin se connecte automatiquement à GeoLeaf.Storage
await GeoLeaf.init({
    map: { target: "map" },
    data: { activeProfile: "tourism", profilesBasePath: "./profiles/" },
});

// Vérifier le statut offline
const isOffline = GeoLeaf.Storage.isOffline();

// Statistiques du cache
const stats = await GeoLeaf.Storage.getStats();
console.log(stats.tileCacheSize, stats.poiCount);
```

### ESM (CDN / script tag)

Charger **après** `@geoleaf/core` :

```html
<!-- MapLibre en tout premier — le core le lit sur `globalThis`, la v6 ne le pose plus seule -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.css" />
<script type="module">
    import * as maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.mjs";
    globalThis.maplibregl = maplibregl;
</script>

<!-- Core ensuite -->
<script type="module" src="geoleaf.esm.js"></script>

<!-- Plugin offline-ui ensuite -->
<script
    type="module"
    src="node_modules/@geoleaf-plugins/offline-ui/dist/geoleaf-offline-ui.plugin.js"
></script>
<script type="module">
    // `container` et `profileUrl` n'existent pas — options inventées, enseignées ici
    // jusqu'au 31/07/2026. La forme réelle est celle de l'exemple ESM ci-dessus.
    await GeoLeaf.init({
        map: { target: "map" },
        data: { activeProfile: "tourism", profilesBasePath: "./profiles/" },
    });
    console.log("Offline ready:", GeoLeaf.Storage.isOffline());
</script>
```

---

## API

### `GeoLeaf.Storage.init()`

Initialise le plugin (appelé automatiquement au chargement).

### `GeoLeaf.Storage.isOffline()` → `boolean`

Retourne `true` si l'application est actuellement hors-ligne.

### `GeoLeaf.Storage.getStats()` → `Promise<StorageStats>`

Retourne les statistiques du stockage complètes :

```typescript
{
  storage: { used: number; quota: number; percentage: number };
  layers: { count: number; byProfile: Record<string, number> };
  sync: { pending: number; failed: number };
  cache: { profiles: string[] };
  online: boolean;
}
```

### `GeoLeaf.Storage.CacheManager.cacheProfile(profileId, options?)` → `Promise<CacheResult>`

Lance le téléchargement d'un profil complet pour un accès hors ligne. Progrès accessibles via
l'événement `geoleaf:cache:progress`.

> 🛑 **Cette entrée documentait `GeoLeaf.Storage.downloadProfileForOffline()` jusqu'au
> 03/08/2026. Cette méthode N'EXISTE PLUS** — elle n'avait aucun appelant dans tout le dépôt et
> a été retirée à la clôture du Sprint 3. ⚠️ Ce qu'elle apportait de réel, le **pré-contrôle de
> quota**, a été déplacé **dans** `cacheProfile()` **avant** sa suppression : un téléchargement
> qu'on sait trop gros n'est plus tenté. Le comportement documenté ici est donc le même, à un
> nom près — c'est l'ancien nom qui avait cessé d'être atteignable.

### `GeoLeaf.Storage.clearAll()` → `Promise<void>`

Supprime tout le cache et vide les tables `preferences` et `metadata`. ⚠️ Ni `features` ni `outbox` : une saisie de terrain n'est jamais détruite par cet appel.

> Pour supprimer un profil spécifique, utiliser `GeoLeaf.Storage.CacheManager.clearProfile(profileId)`.

---

## Événements DOM

| Événement                     | Détail                                         | Déclencheur                |
| ----------------------------- | ---------------------------------------------- | -------------------------- |
| `geoleaf:online`              | `{ timestamp }`                                | Retour de connectivité     |
| `geoleaf:offline`             | `{ timestamp }`                                | Perte de connectivité      |
| `geoleaf:cache:progress`      | `{ profileId, downloaded, total, percentage }` | Progression du cache       |
| `geoleaf:cache:completed`     | `{ profileId }`                                | Téléchargement terminé     |
| `geoleaf:cache:cleared`       | `{ profileId }`                                | Cache d'un profil supprimé |
| `geoleaf:poi:synced`          | `{ results }`                                  | File de sync envoyée       |
| `geoleaf:storage:initialized` | —                                              | Storage initialisé         |
| `geoleaf:storage:cleared`     | —                                              | Tout le stockage supprimé  |

```javascript
document.addEventListener("storage:online", () => {
    console.log("Connexion rétablie — synchronisation en cours");
});
```

---

## Sécurité

- Les données sensibles ne sont jamais persistées en localStorage — IndexedDB uniquement.
- Le cache de tuiles est protégé par le Service Worker scope ; inaccessible aux autres origines.
- Le plugin respecte la politique de sanitisation XSS de `@geoleaf/core` (`DOMSecurity`).

---

## Architecture

Ce paquet ne livre que l'**interface** hors-ligne. Le moteur — IndexedDB, cache, téléchargement,
synchronisation — vit dans `@geoleaf/core` (`capabilities/offline/`) depuis le S14 Phase B, et
`GeoLeaf.Storage` est une façade du **core**, pas de ce plugin.

```
src/
├── entry.ts       ← Point d'entrée — enregistre l'UI, l'i18n et la barre d'outils
├── cache/         ← Téléchargement + sélecteur de couches à mettre en cache
├── sync/          ← Zone de contrôle du cache (DOM, événements, état) et synchronisation
├── ui/            ← Bouton de cache, monté dans un emplacement de la barre d'outils du core
├── core/          ← Coutures vers le moteur hors-ligne du core (disponibilité, sync)
├── shared/        ← Vue plugin du contrat `StorageContract`
├── lang/          ← Dictionnaires i18n, 6 locales
└── css/           ← Feuilles de la modale, du contrôle et du panneau de synchronisation
```

> ⚠️ Ce bloc décrivait jusqu'au STRUCT S3 six fichiers de `src/` — `storage-db.ts`,
> `cache-manager.ts`, `offline-detector.ts`, `sync-handler.ts`, `image-manager.ts` — **dont aucun
> n'existait plus** : ils sont partis dans le core avec le moteur. Le README annonçait donc encore
> le paquet d'avant l'extraction.

---

## Documentation

| Guide                                          | Contenu                                      |
| ---------------------------------------------- | -------------------------------------------- |
| [Installation](./docs/INSTALLATION.md)         | Prérequis, registre GitHub, scripts NPM      |
| [Configuration](./docs/CONFIGURATION.md)       | Options du profil JSON, clés `storage.*`     |
| [API Reference](./docs/API_REFERENCE.md)       | API complète avec signatures TypeScript      |
| [Exemples](./docs/EXAMPLES.md)                 | Recettes prêtes à l'emploi                   |
| [Offline Detector](./docs/offline-detector.md) | Surveillance réseau et configuration avancée |

---

## Licence

MIT — voir `LICENSE` dans le package et [geoleaf.dev](https://geoleaf.dev).
