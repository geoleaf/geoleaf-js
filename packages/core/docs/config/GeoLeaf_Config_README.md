---
title: "GeoLeaf.Config – Documentation du module Config (Chargement JSON)"
---

# GeoLeaf.Config – Documentation du module Config (Chargement JSON)

Product Version: GeoLeaf Platform V3

**Version** : 3.0.0

**Fichiers (monorepo)** : `packages/core/src/modules/built-in/config/` (config-core, config-loaders, config-accessors, config-types, config-validation, loader, normalization, profile, taxonomy, storage)

**Dernière mise à jour** : mars 2026

---

Le module **GeoLeaf.Config** est responsable du chargement et de la validation de la **configuration JSON externe** utilisée par GeoLeaf.

Il fournit :

- le chargement d'un fichier JSON externe (via URL) ou d'un objet inline ;

- la validation et la normalisation du schéma (blocs `map`, `data`, `ui`, `basemaps`, `layers`, `poi`…) ;

- l'exposition des données au reste des modules via des accesseurs typés ;

- un événement interne indiquant que la configuration est prête ;

- l'appel automatique à un callback utilisateur (`onLoaded`) ;

- le support du mode `autoEvent` pour déclencher un événement DOM personnalisé ;

- la gestion multi-profils via `ProfileManager` (la taxonomie relève de la capacité `GeoLeaf.Taxonomy`).

Ce module pilote la **séquence d'initialisation complète** de GeoLeaf.

---

## 1. Rôle fonctionnel de GeoLeaf.Config

1. Charger une configuration JSON depuis :
    - un fichier distant (`url`),
    - un objet JS inline (`config`).

2. Valider et normaliser les blocs essentiels :
    - `map` (cible DOM, centre, zoom, bounds, options MapLibre),
    - `data` (profil actif, chemin des profils),
    - `ui` (thème, langue, contrôles),
    - `basemaps` (couches de fond raster ou vectorielles),
    - `layers` (couches GeoJSON/vecteur référencées),
    - `poi`, `poiConfig`, `categories`.

3. Exposer la configuration aux autres modules via :
    - `Config.getAll()` — config complète,
    - `Config.get(path, default)` — lecture par chemin pointé,
    - `Config.getSection(name)` — lecture d'un bloc entier,
    - `Config.getActiveProfile()` — profil actif (via `ProfileManager`),
    - `Config.getActiveProfileMapping()` — mapping du profil actif,
    - `Config.isProfilePoiMappingEnabled()` — mapping POI activé.

4. Déclencher un callback `onLoaded(config)` lorsque tout est prêt.

5. Émettre un événement DOM `"geoleaf:config:loaded"` si `autoEvent` est activé.

Ce module constitue le **point d'entrée** de toute la logique GeoLeaf.

---

## 2. API publique du module Config

- `GeoLeaf.Config.init(options)` — charge la config et initialise les sous-modules
- `GeoLeaf.Config.loadUrl(url, options?)` — charge un fichier JSON externe
- `GeoLeaf.Config.loadTaxonomy(url, options?)` — charge un mapping de catégories
- `GeoLeaf.Config.loadActiveProfileResources(options?)` — charge les ressources du profil actif
- `GeoLeaf.Config.getAll()` — retourne la configuration complète
- `GeoLeaf.Config.get(path, default?)` — lit un champ par chemin pointé
- `GeoLeaf.Config.set(path, value)` — modifie un champ
- `GeoLeaf.Config.getSection(name, default?)` — lit un bloc de configuration
- `GeoLeaf.Config.getActiveProfile()` — profil actif (objet complet)
- `GeoLeaf.Config.getActiveProfileId()` — identifiant du profil actif
- `GeoLeaf.Config.getActiveProfileMapping()` — mapping de taxonomie du profil actif
- `GeoLeaf.Config.isProfilePoiMappingEnabled()` — vrai si le mapping POI est activé
- La taxonomie (catégories / sous-catégories) est exposée par la capacité `GeoLeaf.Taxonomy` — voir `GeoLeaf.Taxonomy.getCategories(ref)`
- `GeoLeaf.Config.isLoaded()` — vrai si la config est prête
- `GeoLeaf.Config.getSource()` — source ayant produit la config (`"url"` ou `"inline"`)

---

## 3. `GeoLeaf.Config.init(options)`

Initialise le module en précisant la source de la configuration.

```js
GeoLeaf.Config.init({
    url: "../data/geoleaf.config.json",
    autoEvent: true,
    onLoaded: (config) => {
        console.log("Config loaded:", config);
    },
});
```

### 3.1 Paramètres (`ConfigInitOptions`)

| Paramètre                  | Type                              | Description                                                      |
| -------------------------- | --------------------------------- | ---------------------------------------------------------------- |
| `config`                   | `GeoLeafConfig`                   | Configuration inline (prioritaire sur `url`)                     |
| `url`                      | `string`                          | URL du fichier JSON à charger via `fetch`                        |
| `headers`                  | `Record<string, string>`          | En-têtes HTTP personnalisés pour le `fetch`                      |
| `strictContentType`        | `boolean`                         | Rejette les réponses non-`application/json` (défaut: `true`)     |
| `autoEvent`                | `boolean`                         | Émet `"geoleaf:config:loaded"` après chargement (défaut: `true`) |
| `onLoaded`                 | `(config: GeoLeafConfig) => void` | Callback appelé après chargement réussi                          |
| `onError`                  | `(err: Error) => void`            | Callback appelé en cas d'erreur de chargement                    |
| `profileId`                | `string`                          | Identifiant du profil actif à activer                            |
| `mappingUrl`               | `string`                          | URL du fichier de mapping de catégories (taxonomie)              |
| `mappingHeaders`           | `Record<string, string>`          | En-têtes HTTP pour le fetch de la taxonomie                      |
| `mappingStrictContentType` | `boolean`                         | Validation content-type pour la taxonomie                        |

### 3.2 Comportement

- Si `config` est fourni → la configuration est utilisée immédiatement (chemin synchrone).
- Si `url` est fourni → appel `fetch` asynchrone.
- Si `mappingUrl` est fourni → chargement de la taxonomie en parallèle.
- Après chargement :
    - normalisation et stockage interne de la configuration,
    - initialisation de `StorageHelper`, `ProfileManager`,
    - appel du callback `onLoaded`,
    - émission de l'événement DOM (si `autoEvent = true`).
- Retourne une `Promise<GeoLeafConfig>`.

---

## 4. `GeoLeaf.Config.loadUrl(url, options?)`

Charge la configuration JSON depuis une URL.

```js
await GeoLeaf.Config.loadUrl("../data/config.json", {
    headers: { Authorization: "Bearer token" },
});
```

### 4.1 Comportement

- effectue un `fetch(url)` en mode asynchrone ;
- valide le content-type si `strictContentType` est activé ;
- parse le JSON et applique la configuration via `_applyConfig` ;
- déclenche automatiquement la suite (`_maybeFireLoadedEvent`).

### 4.2 Gestion d'erreurs

- JSON invalide → log contrôlé, retourne la config existante
- URL inaccessible → log d'erreur + retour propre (pas d'exception non gérée)

---

## 5. Accesseurs principaux

### `GeoLeaf.Config.getAll()`

Retourne la configuration complète actuellement chargée.

```js
const config = GeoLeaf.Config.getAll();
console.log(config.map.zoom);
```

### `GeoLeaf.Config.get(path, defaultValue?)`

Lit un champ par chemin pointé.

```js
const theme = GeoLeaf.Config.get("ui.theme", "light");
const zoom = GeoLeaf.Config.get("map.zoom", 10);
```

### `GeoLeaf.Config.getActiveProfile()`

Retourne l'objet profil actif (chargé par `ProfileManager`).

```js
const profile = GeoLeaf.Config.getActiveProfile();
if (profile?.panels?.detail?.layout) {
    // Utiliser le layout du panneau de détail
}
```

---

## 6. Structure JSON officielle supportée

Voici la structure complète (tous les blocs sont optionnels sauf `map`) :

```json
{
    "map": {
        "target": "geoleaf-map",
        "bounds": [
            [43.0, -0.5],
            [46.0, 3.5]
        ],
        "zoom": 10,
        "maxZoom": 19,
        "minZoom": 6
    },
    "data": {
        "activeProfile": "mon-profil",
        "profilesBasePath": "profiles"
    },
    "ui": {
        "theme": "auto",
        "language": "fr",
        "showLayerManager": true,
        "showFilterPanel": true,
        "permalink": {
            "enabled": true,
            "mode": "hash"
        }
    },
    "basemaps": {
        "osm": {
            "type": "tile",
            "label": "OpenStreetMap",
            "url": "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            "defaultBasemap": true
        }
    },
    "layers": [],
    "logging": {
        "level": "info"
    },
    "security": {
        "httpsOnly": false
    }
}
```

---

## 7. Séquence complète d'initialisation

1. `GeoLeaf.Config.init({ url })`
2. `fetch()` du fichier JSON
3. Validation et normalisation du JSON
4. `StorageHelper.init(config)` — accès lecture/écriture à la config
5. `ProfileManager.init(config)` — chargement du profil actif
6. Appel du callback `onLoaded(config)`
7. Émission de `geoleaf:config:loaded` (si `autoEvent = true`)
8. La façade `geoleaf.boot.ts` enchaîne :
    - `GeoLeaf.Core.init(config.map)` → crée la carte MapLibre GL
    - initialisation de l'UI, des couches, des POI, des plugins

---

## 8. Résumé rapide de l'API Config

| Méthode                        | Rôle                                         |
| ------------------------------ | -------------------------------------------- |
| `init(options)`                | Démarre le chargement du JSON ou data inline |
| `loadUrl(url, options?)`       | Charge un fichier JSON externe               |
| `loadTaxonomy(url, options?)`  | Charge un mapping de catégories              |
| `loadActiveProfileResources()` | Charge les ressources du profil actif        |
| `getAll()`                     | Retourne la configuration complète           |
| `get(path, default?)`          | Lit un champ par chemin pointé               |
| `set(path, value)`             | Modifie un champ                             |
| `getSection(name, default?)`   | Lit un bloc de configuration                 |
| `getActiveProfile()`           | Profil actif (via ProfileManager)            |
| `getActiveProfileId()`         | Identifiant du profil actif                  |
| `getActiveProfileMapping()`    | Mapping de taxonomie du profil actif         |
| `isProfilePoiMappingEnabled()` | `true` si le mapping POI est activé          |
| `isLoaded()`                   | Vrai si la config est initialisée            |
| `getSource()`                  | Source de la config (`"url"` ou `"inline"`)  |

---

## 9. Types TypeScript

Les types sont définis dans `config-types.ts` :

- `GeoLeafConfig` — objet racine (map, data, ui, basemaps, layers…)
- `MapConfig` — section `map` (target, bounds, center, zoom, mapOptions…)
- `DataConfig` — section `data` (activeProfile, profilesBasePath)
- `UIConfig` — section `ui` (theme, language, contrôles, permalink)
- `ConfigInitOptions` — options de `Config.init()`
- `BasemapConfig` — définition d'un fond de carte
- `LayerConfig` — référence à une couche GeoJSON
- `LayerFileConfig` — structure d'un fichier de config de couche
- `PermalinkConfig` — deep-linking URL

---

## 10. Bonnes pratiques

- Toujours initialiser **Config** avant tous les autres modules.
- Préférer une configuration JSON unique et centralisée par déploiement.
- Utiliser `autoEvent: true` (défaut) pour intégrer GeoLeaf dans des frameworks externes.
- Toujours valider vos fichiers JSON avant utilisation (pas de commentaires JSON5).
- Utiliser les accesseurs typés (`get`, `getSection`, `getActiveProfile`) plutôt que d'accéder directement à `_config`.
- Le bloc `map.target` est obligatoire (identifiant HTML de l'élément conteneur).
