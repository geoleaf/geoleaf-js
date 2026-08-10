---
title: "GeoLeaf — Configuration des plugins dans un profil"
---

# GeoLeaf — Configuration des plugins dans un profil

**S'applique à :** `@geoleaf/core` v3.x
**Dernière vérification :** 29 juillet 2026

---

## Vue d'ensemble

Certaines clés de configuration dans `profile.json` et `ui.json` n'ont d'effet que lorsque le plugin correspondant est chargé. Sans le plugin, la clé est **lue sans erreur et ignorée silencieusement**. Cette conception permet de définir les configurations à l'avance et de charger les plugins optionnellement selon l'environnement.

| Clé de profil                    | Plugin requis                     | Effet quand le plugin est chargé                 |
| -------------------------------- | --------------------------------- | ------------------------------------------------ |
| `ui.showCacheButton`             | `@geoleaf-plugins/offline-ui`     | Affiche le bouton de gestion du cache offline    |
| `modules.editor.showAddPoi`      | `@geoleaf-plugins/editor`         | Affiche le bouton d'ajout de POI                 |
| `storage`                        | `@geoleaf-plugins/offline-ui`     | Configure le cache offline (tiles, profil)       |
| `layer.attributes.fields[].edit` | `@geoleaf-plugins/editor`         | Rend le champ saisissable, par couche            |
| _(aucune clé)_                   | `@geoleaf-plugins/connector`      | Intercepteur fetch — auto-activé à l'import      |
| _(aucune clé)_                   | `@geoleaf-plugins/file-import`    | Active l'API `GeoLeaf.FileImport.*`              |
| _(aucune clé)_                   | `@geoleaf-plugins/flatgeobuf`     | Active l'API `GeoLeaf.FlatGeobuf.*`              |
| _(aucune clé)_                   | `@geoleaf-plugins/cog`            | Active l'API `GeoLeaf.COG.*`                     |
| _(aucune clé)_                   | `@geoleaf-plugins/websocket`      | Flux temps réel POI via WebSocket (roadmap)      |
| _(aucune clé)_                   | `@geoleaf-plugins/realtime-layer` | Couches à rafraîchissement automatique (roadmap) |

> **Note :** tous les plugins `@geoleaf-plugins/*` sont MIT et publiés sur npmjs.org. `@geoleaf-plugins/connector`, `@geoleaf-plugins/file-import` et `@geoleaf-plugins/flatgeobuf` sont MIT et distribués via `npmjs.org`.

---

## Plugin Storage — `@geoleaf-plugins/offline-ui`

### Activer le bouton cache

Dans `ui.json` → section `ui` :

```json
{
    "ui": {
        "showCacheButton": true
    }
}
```

Sans ce flag à `true`, le bouton n'apparaît pas même si le plugin est chargé.

### Bloc `storage` dans `profile.json`

Configure le comportement du cache offline :

```json
{
    "storage": {
        "enableOfflineDetector": true,
        "cache": {
            "enableProfileCache": true,
            "enableTileCache": true
        }
    }
}
```

| Clé                        | Type    | Défaut  | Description                                                           |
| -------------------------- | ------- | ------- | --------------------------------------------------------------------- |
| `enableOfflineDetector`    | boolean | `false` | Surveille la connectivité réseau et affiche un indicateur offline     |
| `cache.enableProfileCache` | boolean | `true`  | Met en cache les fichiers du profil (JSON de config, taxonomie, etc.) |
| `cache.enableTileCache`    | boolean | `true`  | Met en cache les tuiles cartographiques (raster + vecteur)            |

### Cache par couche (dans `basemaps.json`)

La configuration du cache peut être affinée au niveau de chaque fond de carte :

```json
{
    "basemaps": {
        "osm": {
            "label": "OpenStreetMap",
            "type": "tile",
            "url": "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            "offline": true,
            "cacheMinZoom": 8,
            "cacheMaxZoom": 16,
            "offlineBounds": {
                "north": 48.9,
                "south": 48.8,
                "east": 2.4,
                "west": 2.3
            }
        }
    }
}
```

| Clé             | Description                                                               |
| --------------- | ------------------------------------------------------------------------- |
| `offline`       | Autorise la mise en cache offline pour ce fond de carte                   |
| `cacheMinZoom`  | Niveau de zoom minimum à précharger                                       |
| `cacheMaxZoom`  | Niveau de zoom maximum à précharger                                       |
| `offlineBounds` | Emprise géographique à mettre en cache (`north`, `south`, `east`, `west`) |

---

## Plugin Editor — `@geoleaf-plugins/editor`

### Activer le bouton d'ajout

Dans `config/plugins/editor.json` → bloc `modules.editor` :

```json
{
    "editor": {
        "showAddPoi": true
    }
}
```

⚠️ La clé vivait sous `ui.showAddPoi` jusqu'au Sprint 5 ; elle a été retirée du schéma `ui`
(`additionalProperties: false`, donc l'écrire y fait désormais échouer `validate:profiles`) et
son défaut a changé — `false` (opt-in) devient `true` (opt-out).

### ~~Bloc `poiAddConfig` dans `profile.json`~~ — RETIRÉ (Sprint 5, 05/08/2026)

🛑 **Ce bloc n'existe plus, et le recopier fait ÉCHOUER `npm run validate:profiles`.** Il
configurait le formulaire d'ajout de POI du plugin `addpoi`, fusionné dans
`@geoleaf-plugins/editor`. `profile.schema.json` est `additionalProperties: false` et ne
déclare que dix clés racine (`$schema`, `id`, `label`, `displayLabel`, `icon`, `description`,
`version`, `Files`, `map`, `modules`) : une clé racine inconnue est **refusée**, pas ignorée.

| Ancien                         | Nouveau                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------- |
| `poiAddConfig.enabled`         | plus de clé — le plugin se charge **paresseusement** quand le bouton est actionné |
| `poiAddConfig.defaultPosition` | `modules.editor.poiAddDefaultPosition` (dans `config/plugins/editor.json`)        |

### Installation

```bash
npm install @geoleaf-plugins/connector
```

### Utilisation

```js
import "@geoleaf/core";
import "@geoleaf-plugins/connector"; // intercepteur actif immédiatement

// Configurer l'authentification pour une source
GeoLeaf.Connector.configure({
    baseUrl: "https://api.example.com",
    auth: {
        type: "bearer",
        token: () => localStorage.getItem("access_token"),
    },
});
```

### Paramètres de configuration

| Paramètre         | Type      | Description                                                          |
| ----------------- | --------- | -------------------------------------------------------------------- |
| `baseUrl`         | string    | URL de base à intercepter                                            |
| `auth.type`       | string    | `"bearer"` / `"apikey"` / `"cookie"`                                 |
| `auth.token`      | string/fn | Token statique ou fonction retournant le token dynamiquement         |
| `auth.headerName` | string    | Nom du header (défaut : `"Authorization"` pour bearer, configurable) |

> L'option `auth.token` accepte une valeur statique ou une fonction synchrone/asynchrone — utile pour les tokens à renouvellement automatique.

---

## Plugin File Import — `@geoleaf-plugins/file-import`

**Licence :** MIT | **Registre :** `npmjs.org` | **Statut :** Disponible (~70 KB gzip)

Permet l'import de fichiers géographiques côté client (GPX, KML/KMZ, CSV, TopoJSON) et leur conversion en GeoJSON. Les données importées peuvent être affichées directement comme couche sur la carte.

### Installation

```bash
npm install @geoleaf-plugins/file-import
```

### API principale

```js
import "@geoleaf/core";
import "@geoleaf-plugins/file-import";

// Convertir un fichier File en GeoJSON
const geojson = await GeoLeaf.FileImport.convert(file, {
    type: "auto", // détection automatique — ou "gpx", "kml", "csv", "topojson"
});

// Importer et afficher comme couche sur la carte
const layer = await GeoLeaf.FileImport.importAsLayer(file, {
    layerId: "imported-data",
    style: { color: "#e74c3c", weight: 2 },
});
```

### Formats supportés

| Format   | Extension            | Notes                               |
| -------- | -------------------- | ----------------------------------- |
| GPX      | `.gpx`               | Tracks, routes, waypoints → GeoJSON |
| KML/KMZ  | `.kml`, `.kmz`       | KMZ décompressé automatiquement     |
| CSV      | `.csv`               | Colonnes lat/lon configurables      |
| TopoJSON | `.json`, `.topojson` | Conversion automatique → GeoJSON    |

### Options `importAsLayer`

| Option    | Type   | Défaut   | Description                                       |
| --------- | ------ | -------- | ------------------------------------------------- |
| `layerId` | string | généré   | Identifiant de la couche résultante               |
| `style`   | object | défaut   | Style MapLibre GL JS appliqué à la couche         |
| `type`    | string | `"auto"` | Force le format (`"gpx"`, `"kml"`, `"csv"`, etc.) |

---

## Plugin FlatGeobuf — `@geoleaf-plugins/flatgeobuf`

**Licence :** MIT | **Registre :** `npmjs.org` | **Statut :** Disponible (~20 KB gzip)

Chargement streaming de fichiers FlatGeobuf avec filtrage spatial par bounding-box (HTTP Range + index R-tree). Idéal pour des jeux de données volumineux sans serveur intermédiaire.

### Installation

```bash
npm install @geoleaf-plugins/flatgeobuf
```

### Configuration déclarative dans un layer config

Chaque couche FlatGeobuf est déclarée dans un fichier `<layer>_config.json` avec `"plugin": "flatgeobuf"`. L'entrée dans `layers.json` est identique aux autres couches.

**Schéma du bloc `data` :**

| Clé           | Type                       | Défaut    | Description                                                                       |
| ------------- | -------------------------- | --------- | --------------------------------------------------------------------------------- |
| `url`         | string                     | —         | URL du fichier `.fgb` (relative à la racine du profil ou absolue)                 |
| `bbox`        | `[W, S, E, N]` (4 nombres) | absent    | Filtre spatial : seules les features dans la bbox sont transférées via HTTP Range |
| `limit`       | number                     | `100 000` | Nombre maximum de features à charger (protection anti-DoS)                        |
| `autoRefresh` | boolean                    | `false`   | Recharge les features à chaque déplacement de la carte (`moveend`)                |
| `debounceMs`  | number                     | `300`     | Délai de debounce de l'auto-refresh en ms                                         |

**Exemple — couche avec bbox + auto-refresh (zones_desserte) :**

```json
{
    "id": "zones_desserte",
    "label": "Zones de desserte SNCF",
    "plugin": "flatgeobuf",
    "zIndex": 30,
    "geometry": "polygon",
    "data": {
        "url": "data/zones_desserte_sncf.fgb",
        "bbox": [2.225, 41.362, 8.227, 51.089],
        "limit": 1000,
        "autoRefresh": true,
        "debounceMs": 500
    },
    "styles": {
        "directory": "styles",
        "default": "defaut.json",
        "available": [{ "id": "defaut", "label": "défaut", "file": "defaut.json" }]
    },
    "tooltip": { "mode": "hover", "fields": [{ "field": "properties.nom", "label": "Zone" }] },
    "table": { "enabled": false },
    "clustering": { "enabled": false }
}
```

**Exemple — couche fichier local sans bbox (eco_regions_fgb) :**

```json
{
    "id": "eco_regions_fgb",
    "label": "Éco-régions (FlatGeobuf)",
    "plugin": "flatgeobuf",
    "zIndex": 51,
    "geometry": "polygon",
    "data": {
        "url": "layers/eco_regions_fgb/data/eco_regions.fgb",
        "limit": 50000,
        "autoRefresh": false
    }
}
```

### Chargement depuis le code d'initialisation

```js
import "@geoleaf/core";
import "@geoleaf-plugins/flatgeobuf";

// Lire la config depuis le profil, puis charger la couche :
const layerId = await GeoLeaf.FlatGeobuf.loadLayerFromConfig(layerConfig);
// Si layerConfig.data.bbox est défini → loadBboxAsLayer (HTTP Range)
// Sinon → loadAsLayer (fichier complet)
```

### API bas niveau

```js
// Chargement complet → GeoJSON FeatureCollection
const result = await GeoLeaf.FlatGeobuf.load("https://example.com/data.fgb");

// Chargement par bbox (HTTP Range — seules les features dans la bbox sont téléchargées)
const result = await GeoLeaf.FlatGeobuf.loadBbox("https://example.com/data.fgb", {
    minX: 2.2,
    minY: 48.8,
    maxX: 2.5,
    maxY: 49.0,
});

// Ajouter directement comme couche sur la carte
const layerId = await GeoLeaf.FlatGeobuf.loadAsLayer("https://example.com/data.fgb", {
    layerId: "ma-couche",
    layerName: "Mes données",
    visible: true,
});
```

> **Prérequis serveur :** Le serveur hébergeant les fichiers `.fgb` doit supporter les requêtes HTTP Range (header `Content-Range`) pour que le filtrage bbox fonctionne. Nginx, Apache, Amazon S3 et GitHub Pages supportent cela par défaut.

---

## Plugin COG — `@geoleaf-plugins/cog`

**Licence :** MIT | **Registre :** npmjs.org | **Statut :** Disponible (~156 KB gzip)

Lecture et affichage de Cloud Optimized GeoTIFF (COG) directement dans MapLibre GL JS. Supporte les images multi-bandes, les colorMaps LUT et l'injection de source raster personnalisée.

### Installation

```bash
# npmjs.org — accès public
npm install @geoleaf-plugins/cog
```

### API principale

```js
import "@geoleaf/core";
import "@geoleaf-plugins/cog";

// Ajouter une couche COG sur la carte
await GeoLeaf.COG.addLayer("https://example.com/ortho.tif", {
    layerId: "ortho",
    bands: [1, 2, 3],
    colorMap: "viridis",
    opacity: 0.85,
});

// Supprimer la couche
GeoLeaf.COG.removeLayer("ortho");
```

### Options `addLayer`

| Option     | Type     | Défaut    | Description                                 |
| ---------- | -------- | --------- | ------------------------------------------- |
| `layerId`  | string   | généré    | Identifiant de la couche MapLibre           |
| `bands`    | number[] | `[1,2,3]` | Bandes raster à afficher (RGB)              |
| `colorMap` | string   | `null`    | LUT : `"viridis"`, `"gray"`, `"rdbu"`, etc. |
| `opacity`  | number   | `1`       | Opacité de la couche (0–1)                  |
| `nodata`   | number   | `null`    | Valeur nodata à masquer                     |

---

## Plugin WebSocket — `@geoleaf-plugins/websocket`

> **Statut : Roadmap Q3 2026** — Plugin MIT prévu pour le suivi POI en temps réel.

Ce plugin permettra la mise à jour en temps réel des POI via WebSocket — positions live, alertes géographiques, flux IoT. La documentation de configuration sera disponible à la release.

---

## Plugin Realtime Layer — `@geoleaf-plugins/realtime-layer`

> **Statut : disponible** — Plugin MIT pour les couches à rafraîchissement automatique.

Ce plugin active des couches à rafraîchissement automatique via polling HTTP, WebSocket ou Server-Sent Events. La configuration vit dans le bloc `data.realtime` de chaque `<layer>_config.json`.

### Clés supportées (bloc `data.realtime`)

| Clé              | Type                                | Obligatoire                    | Description                                                                                                                                                                                         |
| ---------------- | ----------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`        | `boolean`                           | oui                            | Active la couche RT au boot. Si `false`, le bloc reste descriptif.                                                                                                                                  |
| `source`         | `"polling" \| "websocket" \| "sse"` | oui                            | Type de transport.                                                                                                                                                                                  |
| `decoder`        | `"json" \| "gtfs-rt" \| <custom>`   | oui                            | Décodeur appliqué au payload reçu. Custom via `registerDecoder()`.                                                                                                                                  |
| `url`            | `string`                            | si `source` = polling/sse      | URL de l'endpoint distant.                                                                                                                                                                          |
| `intervalMs`     | `number`                            | non (défaut 30 000)            | Période de polling. Polling uniquement.                                                                                                                                                             |
| `fallbackUrl`    | `string`                            | non                            | URL de repli servie quand `url` renvoie HTTP non-2xx ou échoue (réseau). Polling uniquement. Le snapshot est émis une seule fois par panne ; retour automatique au primaire dès son premier succès. |
| `channel`        | `string`                            | si `source` = websocket        | Canal consommé via `GeoLeaf.Ws.subscribe()`.                                                                                                                                                        |
| `updateMode`     | `"upsert" \| "replace" \| "merge"`  | non (défaut `"upsert"`)        | Stratégie d'application des updates.                                                                                                                                                                |
| `idField`        | `string`                            | requis pour `upsert` / `merge` | Propriété utilisée comme identifiant stable des features.                                                                                                                                           |
| `staleTimeoutMs` | `number`                            | non                            | Durée après laquelle une feature non rafraîchie devient « stale ».                                                                                                                                  |
| `staleAction`    | `"remove" \| "dim" \| <custom>`     | non (défaut `"remove"`)        | Action appliquée aux features stale. Custom via `registerStaleAction()`.                                                                                                                            |
| `mapping`        | `object`                            | non                            | Hints pour le décodeur GTFS-RT (`idField`, `delayField`, `targetLayerId`).                                                                                                                          |

### Exemple — polling GeoJSON avec fallback CDN (USGS)

```json
{
    "id": "epicentres_seismes",
    "data": {
        "dataUrl": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson",
        "realtime": {
            "enabled": true,
            "source": "polling",
            "url": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson",
            "intervalMs": 60000,
            "decoder": "json",
            "updateMode": "upsert",
            "idField": "id",
            "fallbackUrl": "data/epicentres_seismes_snapshot.geojson"
        }
    }
}
```

### Exemple — GTFS-RT SNCF avec fallback protobuf

```json
{
    "id": "gares_voyageurs",
    "data": {
        "dataUrl": "https://ressources.data.sncf.com/.../geojson",
        "realtime": {
            "enabled": true,
            "source": "polling",
            "url": "https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-trip-updates",
            "intervalMs": 120000,
            "decoder": "gtfs-rt",
            "updateMode": "merge",
            "idField": "code_uic",
            "mapping": {
                "idField": "stop_id",
                "delayField": "delay",
                "targetLayerId": "gares_voyageurs"
            },
            "staleTimeoutMs": 300000,
            "staleAction": "dim",
            "fallbackUrl": "data/gares_voyageurs_gtfsrt_snapshot.pb"
        }
    }
}
```

### API publique

```ts
GeoLeaf.RealtimeLayer.start(layerId: string): void;
GeoLeaf.RealtimeLayer.stop(layerId: string): void;
GeoLeaf.RealtimeLayer.stopAll(): void;
GeoLeaf.RealtimeLayer.getStatus(layerId: string): { active, source, lastUpdateAt, staleCount };
GeoLeaf.RealtimeLayer.registerDecoder(name: string, decoder: IDecoder): void;
GeoLeaf.RealtimeLayer.registerStaleAction(name: string, handler: StaleActionHandler): void;
```

Les couches avec `data.realtime.enabled: true` sont démarrées automatiquement sur l'event `geoleaf:app:ready`.

---

## Exemple : profil avec les deux plugins activés

### `profile.json`

```json
{
    "id": "mon-profil",
    "label": "Mon Profil",
    "version": "1.0.0",

    "map": {
        "center": [48.8566, 2.3522],
        "zoom": 12
    },

    "Files": {
        "layersFile": "config/core/layers.json",
        "basemapsFile": "config/core/basemaps.json",
        "uiFile": "config/core/ui.json",
        "modules": {
            "cluster": "config/plugins/cluster.json"
        }
    },

    "storage": {
        "enableOfflineDetector": true,
        "cache": {
            "enableProfileCache": true,
            "enableTileCache": true
        }
    }
}
```

⚠️ Cet exemple portait un bloc racine `poiAddConfig`, retiré au Sprint 5 : il ferait échouer
la validation de profil. Son remplaçant vit sous `modules.editor` (voir ci-dessus).

### `ui.json`

```json
{
    "ui": {
        "theme": "auto",
        "language": "fr",
        "showLayerManager": true,
        "showFilterPanel": true,
        "showLegend": true,
        "enableGeolocation": true,
        "showCacheButton": true,
        "permalink": {
            "enabled": true,
            "mode": "hash"
        }
    },
    "search": {
        "title": "Filtrer",
        "searchPlaceholder": "Rechercher...",
        "filters": [
            {
                "id": "searchText",
                "type": "search",
                "label": "Recherche textuelle",
                "placeholder": "Nom...",
                "searchFields": ["properties.name"]
            }
        ]
    }
}
```

### Chargement des plugins (ESM)

```js
import "@geoleaf/core";
import "@geoleaf-plugins/connector"; // optionnel — si API auth requise
import "@geoleaf-plugins/offline-ui"; // débloque showCacheButton + storage.*
import "@geoleaf-plugins/editor"; // débloque modules.editor.* (édition + capture de POI)

GeoLeaf.init({
    map: { target: "map" },
    data: {
        activeProfile: "mon-profil",
        profilesBasePath: "./profiles/",
    },
});
GeoLeaf.boot();
```

> **Ordre d'import :** les plugins doivent être importés **après** `@geoleaf/core`. Voir [PLUGIN_DEVELOPMENT_GUIDE.md](PLUGIN_DEVELOPMENT_GUIDE.md) → section "Ordre de chargement".

---

## Table — `modules.table` (plugin `@geoleaf-plugins/table`)

> ℹ️ Le tableau de données a été extrait du core vers le plugin MIT `@geoleaf-plugins/table`. Voir le README du plugin pour l'installation, la configuration (`modules.table.*`) et la migration.

La table est désormais le plugin MIT `@geoleaf-plugins/table`. Sa configuration vit sous `modules.table.*` (fichier `config/plugins/table.json` + `Files.modules.table`), et non plus sous la clé racine `tableConfig`. Les clés ci-dessous décrivent le comportement de la table, notamment les formats d'export disponibles. L'API `GeoLeaf.Table.*` reste valide une fois le plugin chargé.

### Clés `modules.table`

| Clé                  | Type                                          | Défaut           | Description                                                                                                    |
| -------------------- | --------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `enabled`            | `boolean`                                     | `true`           | Active ou désactive entièrement le module table.                                                               |
| `defaultVisible`     | `boolean`                                     | `false`          | Ouvre le panneau table au chargement du profil.                                                                |
| `pageSize`           | `number`                                      | `50`             | Nombre de lignes par page (pagination virtuelle).                                                              |
| `maxRowsPerLayer`    | `number`                                      | `5000`           | Limite de features chargées dans la table par couche. N'affecte pas `Table.exportLayer()`.                     |
| `enableExportButton` | `boolean`                                     | `true`           | Affiche les boutons export (sélection + couche) dans la toolbar.                                               |
| `exportFormats`      | `('geojson'\|'csv'\|'kml'\|'gpx'\|'excel')[]` | tous les formats | Restreint les formats affichés dans les dropdowns export. Si absent, tous les formats sont disponibles.        |
| `csvSeparator`       | `',' \| ';'`                                  | `','`            | Séparateur utilisé lors de l'export CSV. Utile pour la compatibilité Excel dans les locales qui utilisent `;`. |
| `csvIncludeGeometry` | `boolean`                                     | `false`          | Inclut une colonne `__geometry` (WKT/GeoJSON) dans l'export CSV.                                               |
| `resizable`          | `boolean`                                     | `true`           | Autorise le redimensionnement vertical du panneau table.                                                       |
| `defaultHeight`      | `string`                                      | `'320px'`        | Hauteur initiale du panneau.                                                                                   |
| `minHeight`          | `string`                                      | `'180px'`        | Hauteur minimale lors du redimensionnement.                                                                    |
| `maxHeight`          | `string`                                      | `'80vh'`         | Hauteur maximale lors du redimensionnement.                                                                    |

### Exemple — restreindre les formats et forcer le séparateur `;`

```json
{
    "modules": {
        "table": {
            "exportFormats": ["geojson", "csv", "excel"],
            "csvSeparator": ";",
            "csvIncludeGeometry": false,
            "maxRowsPerLayer": 10000
        }
    }
}
```

### Formats d'export disponibles

| Format        | Clé       | Poids additionnel | Notes                                                                                     |
| ------------- | --------- | ----------------- | ----------------------------------------------------------------------------------------- |
| GeoJSON       | `geojson` | 0 (déjà présent)  | Format par défaut.                                                                        |
| CSV           | `csv`     | ~0 KB             | UTF-8 BOM, séparateur configurable, colonne `__geometry` optionnelle.                     |
| KML           | `kml`     | ~0 KB             | XML natif sans dépendance externe. Propriétés en CDATA. Compatible Google Earth / QGIS.   |
| GPX           | `gpx`     | ~0 KB             | XML natif. `<wpt>` pour Points, `<trk>` pour LineStrings, `<rte>` pour Polygons.          |
| Excel (.xlsx) | `excel`   | ~150 KB gzip      | Chargé en lazy (SheetJS) uniquement au premier clic — aucun impact sur le bundle initial. |

### API publique étendue

```ts
// Exporter la sélection courante
GeoLeaf.Table.exportSelection(); // GeoJSON (défaut)
GeoLeaf.Table.exportSelection("csv"); // CSV
GeoLeaf.Table.exportSelection("csv", { csvSeparator: ";" }); // CSV avec séparateur custom

// Exporter toute la couche active (sans limite maxRowsPerLayer)
GeoLeaf.Table.exportLayer(); // GeoJSON (défaut)
GeoLeaf.Table.exportLayer("kml");
GeoLeaf.Table.exportLayer("excel");
```

### Événements émis

| Événement               | Payload                                  | Déclencheur               |
| ----------------------- | ---------------------------------------- | ------------------------- |
| `table:exportSelection` | `{ layerId, format, selectedIds, rows }` | `Table.exportSelection()` |
| `table:exportLayer`     | `{ layerId, format, count }`             | `Table.exportLayer()`     |

---

## Règle fondamentale : dégradation silencieuse

⚠️ **Cette phrase affirmait que `storage`, `poiAddConfig`, `showCacheButton` et `showAddPoi` sont « toujours valides dans le schéma » — c'est FAUX depuis le Sprint 5 pour trois d'entre elles.** `poiAddConfig` et `ui.showAddPoi` ont été retirés du schéma avec la fusion du plugin `addpoi` ; les objets à forme fixe sont `additionalProperties: false`, donc les écrire fait **échouer** `npm run validate:profiles` au lieu d'être ignoré. Seule `ui.showCacheButton` reste déclarée. Le principe ci-dessous ne vaut que pour les clés **effectivement déclarées** au schéma : Les plugins sans clé de profil (`connector`, `file-import`, `flatgeobuf`, `cog`) ne nécessitent aucune configuration JSON — ils s'activent dès l'import. Si le plugin correspondant n'est pas chargé :

- Aucune erreur n'est levée
- La clé est lue et ignorée
- Le bouton ou la fonctionnalité n'apparaît pas

Ce comportement est intentionnel : il permet de maintenir un profil unique pour différents environnements (avec ou sans plugins commerciaux).

---

## Vérifier l'état des plugins au runtime

```js
// Liste des plugins chargés
GeoLeaf.plugins.getLoadedPlugins();
// → ["core", "connector", "storage", "addpoi", "file-import", "flatgeobuf", "cog"]

// Vérifier un plugin spécifique
GeoLeaf.plugins.isLoaded("storage"); // → true / false
GeoLeaf.plugins.isLoaded("file-import"); // → true / false
GeoLeaf.plugins.isLoaded("flatgeobuf"); // → true / false
GeoLeaf.plugins.isLoaded("cog"); // → true / false
```

---

## Voir aussi

- [PLUGIN_DEVELOPMENT_GUIDE.md](PLUGIN_DEVELOPMENT_GUIDE.md) — développer un plugin custom
- `CONNECTOR_GUIDE.md` — authentification HTTP avec `@geoleaf-plugins/connector`. Le guide est
  livré **par le paquet du plugin** (`docs/CONNECTOR_GUIDE.md` de `@geoleaf-plugins/connector`),
  pas par celui du core : c'est le plugin qu'il documente
- [PROFILES_GUIDE.md](PROFILES_GUIDE.md) — structure complète d'un profil
- [PROFILE_JSON_REFERENCE.md](PROFILE_JSON_REFERENCE.md) — configuration du clustering (`modules.cluster`) ; la clé `poiConfig` a été supprimée en v3
- [ui/PERMALINK.md](ui/PERMALINK.md) — configuration du permalink
- [GETTING_STARTED.html](https://geoleaf.dev/docs/GETTING_STARTED.html) — guide de démarrage rapide
