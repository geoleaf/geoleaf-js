---
title: "GeoLeaf.Baselayers — Documentation du module Baselayers"
---

# GeoLeaf.Baselayers — Documentation du module Baselayers

**Version :** 3.0.0
**Fichier (monorepo)** : `src/modules/built-in/basemaps/`
**Dernière mise à jour :** mars 2026

---

Le module **GeoLeaf.Baselayers** gère l'ensemble des **fonds de carte (basemaps)** dans GeoLeaf.
Il fournit :

- un **registre interne** des basemaps disponibles ;
- l'initialisation du fond par défaut ;
- le changement dynamique de basemap ;
- la création et la gestion de la couche MapLibre GL correspondante ;
- les liens avec l'UI (attributs `data-gl-baselayer="street|topo|satellite"`).

GeoLeaf.Baselayers ne gère **ni les POI**, **ni le thème UI**, **ni la légende**.
Il se concentre exclusivement sur la logique cartographique des tuiles.

---

## 1. Rôle fonctionnel de GeoLeaf.Baselayers

1. **Définir les basemaps disponibles** depuis `basemaps.json`
2. **Créer et attacher** la couche de tuiles MapLibre GL correspondant à la basemap active.
3. **Permettre de changer dynamiquement** la basemap active :
    - depuis le code
    - depuis l'UI (éléments HTML possédant `data-gl-baselayer="..."`)
4. Normaliser les options internes :
    - attribution,
    - maxZoom,
    - gestion d'erreurs,
    - logs explicites.

---

## 2. API publique de GeoLeaf.Baselayers

Le module expose :

- `GeoLeaf.Baselayers.init(options)`
- `GeoLeaf.Baselayers.registerBaseLayer(key, definition)` — ajoute un basemap au registre
- `GeoLeaf.Baselayers.registerBaseLayers(layers)` — ajoute plusieurs basemaps en une fois
- `GeoLeaf.Baselayers.setBaseLayer(key)` — active un basemap par clé
- `GeoLeaf.Baselayers.setActive(key)` — alias de `setBaseLayer()`
- `GeoLeaf.Baselayers.getActiveKey()` — retourne la clé du basemap actif
- `GeoLeaf.Baselayers.getActiveId()` — alias de `getActiveKey()`
- `GeoLeaf.Baselayers.getActiveLayer()` — retourne l'objet de configuration du basemap actif
- `GeoLeaf.Baselayers.getBaseLayers()` — retourne le registre complet
- `GeoLeaf.Baselayers.destroy()` — supprime l'UI et libère les ressources

---

## 3. `GeoLeaf.Baselayers.init(options)`

Initialise le module et active un fond de carte.

```js
GeoLeaf.Baselayers.init({
    map: map, // instance MapLibre GL
    defaultKey: "street-vector",
});
```

### 3.1 Paramètres

| Paramètre    | Type     | Obligatoire | Description                      |
| ------------ | -------- | ----------- | -------------------------------- |
| `map`        | `Map`    | oui         | Instance MapLibre GL existante   |
| `defaultKey` | `string` | non         | Identifiant du baselayer initial |

### 3.2 Comportement

- Vérifie que `map` est une instance valide.
- Charge le registre des basemaps depuis `basemaps.json`.
- Détermine le baselayer initial :
    - celui fourni via `defaultKey`, ou
    - la basemap marquée `defaultBasemap: true`.
- Monte la couche de tuiles sur la carte.

---

## 4. Configuration des basemaps (`basemaps.json`)

Les basemaps sont définies dans le fichier `profiles/{id}/basemaps.json` :

```json
{
    "basemaps": {
        "street-vector": {
            "id": "street-vector",
            "label": "Carte vectorielle",
            "type": "maplibre",
            "style": "https://tiles.openfreemap.org/styles/liberty",
            "url": "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            "attribution": "© OpenFreeMap © OpenMapTiles © OpenStreetMap",
            "minZoom": 5,
            "maxZoom": 19,
            "defaultBasemap": true,
            "offline": false
        },
        "street": {
            "id": "street",
            "label": "Street",
            "url": "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            "attribution": "&copy; OpenStreetMap contributors",
            "minZoom": 4,
            "maxZoom": 19,
            "offline": true,
            "offlineBounds": {
                "north": -22,
                "south": -56,
                "east": -53.5,
                "west": -73.5
            },
            "cacheMinZoom": 4,
            "cacheMaxZoom": 12
        }
    }
}
```

### 4.1 Propriétés d'une basemap

| Propriété        | Type    | Obligatoire | Description                                          |
| ---------------- | ------- | ----------- | ---------------------------------------------------- |
| `id`             | string  | oui         | Identifiant unique                                   |
| `label`          | string  | oui         | Nom affiché dans l'UI                                |
| `type`           | string  | non         | `"raster"` (défaut) ou `"maplibre"` (vecteur)        |
| `url`            | string  | non         | URL template tuiles raster `{z}/{x}/{y}`             |
| `style`          | string  | non         | URL style JSON MapLibre GL (type maplibre)           |
| `fallbackUrl`    | string  | non         | URL raster de fallback pour type maplibre            |
| `tiles`          | array   | non         | Liste d'URLs de tuiles alternatives                  |
| `attribution`    | string  | non         | Texte d'attribution                                  |
| `minZoom`        | number  | non         | Zoom minimum                                         |
| `maxZoom`        | number  | non         | Zoom maximum                                         |
| `defaultBasemap` | boolean | non         | Fond de carte par défaut                             |
| `offline`        | boolean | non         | Mettre en cache pour usage hors-ligne                |
| `offlineBounds`  | object  | non         | Zone géographique à cacher (`north/south/east/west`) |
| `cacheMinZoom`   | number  | non         | Zoom minimum du cache offline                        |
| `cacheMaxZoom`   | number  | non         | Zoom maximum du cache offline                        |

> **Type maplibre** : Quand `type: "maplibre"`, la propriété `style` pointe vers un fichier de style MapLibre GL JSON. La propriété `url` (ou `fallbackUrl`) est utilisée comme fallback raster si le style MapLibre ne peut pas être chargé.

---

## 5. `GeoLeaf.Baselayers.registerBaseLayer(key, definition)`

Ajoute un fond de carte personnalisé au registre.

```js
GeoLeaf.Baselayers.registerBaseLayer("mytiles", {
    id: "mytiles",
    label: "Mes tuiles",
    url: "https://tiles.example.com/{z}/{x}/{y}.png",
    attribution: "© Example Tiles",
    maxZoom: 20,
});
```

### 5.1 Paramètres

| Paramètre    | Type   | Obligatoire | Description              |
| ------------ | ------ | ----------- | ------------------------ |
| `key`        | string | oui         | Identifiant unique       |
| `definition` | object | oui         | Définition de la basemap |

### 5.2 Règles

- Si la clé existe déjà, elle est écrasée.
- La définition doit contenir au minimum `url` ou `style`.

---

## 6. `GeoLeaf.Baselayers.setBaseLayer(key)`

Permet de changer dynamiquement le fond de carte.

```js
GeoLeaf.Baselayers.setBaseLayer("street");
```

### 6.1 Comportement

- Vérifie que la clé existe dans le registre.
- Démonte le fond actif (si existant).
- Crée une nouvelle instance MapLibre à partir de la définition.
- Attache la nouvelle couche à la carte.
- Met à jour `_activeKey`.

### 6.2 Gestion des erreurs

- Si la clé n'existe pas :
    - log `[GeoLeaf.Baselayers] baselayer introuvable : {key}`
    - aucun changement n'est appliqué.

---

## 7. Intégration avec l'UI (HTML)

Les basemaps peuvent être changés via le DOM
en utilisant des éléments comportant :

```html
<button data-gl-baselayer="street">Street</button>
<button data-gl-baselayer="satellite">Satellite</button>
```

---

## 8. Liens

- `profiles/schemas/basemaps.schema.json` — Schéma JSON des basemaps
- [PROFILES_GUIDE.md](../PROFILES_GUIDE.md) — Structure des profils
- [CONFIGURATION_GUIDE.md](../CONFIGURATION_GUIDE.md) — Fichier basemaps.json
