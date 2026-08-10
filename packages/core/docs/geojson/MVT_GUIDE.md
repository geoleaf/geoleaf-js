---
title: "Guide : Tuiles Vectorielles MVT / PBF"
---

# Guide : Tuiles Vectorielles MVT / PBF

Product Version: GeoLeaf Platform V3
**Date de création** : 20 mars 2026
**Mise a jour** : 22 mars 2026 — Migration MapLibre GL JS v2.0.0
**Reference** : Roadmap phase 1.6 — Sprint 8

---

## Vue d'ensemble

Les **tuiles vectorielles** (MVT — Mapbox Vector Tiles, format PBF — Protocol Buffers) permettent
de charger des couches géographiques complexes sans transférer ni parser un fichier GeoJSON complet.

Les tuiles sont pré-découpées en carreaux (`{z}/{x}/{y}.pbf`) et chargées à la demande selon
le niveau de zoom et l'emprise visible. Seules les tuiles nécessaires à l'affichage courant sont
téléchargées — la carte reste fluide même pour des jeux de données très denses.

**Quand utiliser MVT vs GeoJSON ?**

| Critere                          | GeoJSON classique       | MVT / PBF                               |
| -------------------------------- | ----------------------- | --------------------------------------- |
| Volume features                  | < 5 000 features        | >= 5 000 features (lignes/polygones)    |
| Interactivite (popups, tooltips) | Complete                | Complete (`interactive: true`)          |
| Clustering POI                   | Supporte (supercluster) | Non supporte                            |
| Styles dynamiques (styleRules)   | Complet                 | Complet (MapLibre Style Spec)           |
| Expressions de style GL          | Non supporte            | Supporte (`match`, `interpolate`, etc.) |
| Prerequis build                  | Aucun                   | Pre-generer les tuiles                  |

---

## Prerequis

### MapLibre GL JS (source vectorielle native)

Depuis GeoLeaf v2.0.0, les tuiles vectorielles sont gerees nativement par MapLibre GL JS
via `map.addSource()` + `map.addLayer()`. Aucune dependance supplementaire n'est necessaire.

MapLibre GL JS est la seule peer dependency requise :

```bash
npm install maplibre-gl
```

### Tuiles pre-generees

Le mode MVT **requiert** que les tuiles PBF aient ete generees avant le deploiement.
Voir la section « Génération des tuiles » ci-dessous.

---

## Configuration d'une couche en mode MVT

Ajoutez un bloc `data.vectorTiles` dans le fichier de configuration de la couche
(`layers/{layerId}/{layerId}_config.json`) :

```json
{
    "id": "reseau_ferroviaire",
    "label": "Réseau ferroviaire",
    "geometry": "line",
    "data": {
        "directory": "data",
        "file": "reseau_ferroviaire.geojson",
        "vectorTiles": {
            "enabled": true,
            "tilesDirectory": "tiles",
            "layerName": "reseau_ferroviaire",
            "minZoom": 0,
            "maxNativeZoom": 14,
            "maxZoom": 18,
            "interactive": false
        }
    }
}
```

### Paramètres `data.vectorTiles`

| #   | Paramètre        | Type      | Défaut    | Obligatoire | Description                                                                                                                                                        |
| --- | ---------------- | --------- | --------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `enabled`        | `boolean` | `false`   | ✅          | Active le mode MVT pour cette couche. Si `false` ou absent, GeoLeaf charge le fichier GeoJSON classique.                                                           |
| 2   | `tilesDirectory` | `string`  | `"tiles"` |             | Sous-dossier relatif au répertoire de la couche contenant les tuiles PBF générées.                                                                                 |
| 3   | `layerName`      | `string`  | `{id}`    |             | Nom de la couche à l'intérieur du fichier PBF. Un même fichier peut contenir plusieurs couches — ce paramètre indique laquelle extraire. Défaut : id de la couche. |
| 4   | `minZoom`        | `number`  | `0`       |             | Niveau de zoom minimum auquel les tuiles sont disponibles. En dessous, la couche n'est pas affichée.                                                               |
| 5   | `maxNativeZoom`  | `number`  | `14`      |             | Zoom maximum pour lequel des tuiles natives existent. Au-delà, les tuiles du dernier niveau sont étirées (over-zoom).                                              |
| 6   | `maxZoom`        | `number`  | `18`      |             | Zoom maximum total d'affichage de la couche, même en mode over-zoom. Au-delà, la couche disparaît.                                                                 |
| 7   | `interactive`    | `boolean` | `true`    |             | Active les interactions (clic → popup, survol → tooltip) sur les features des tuiles. Désactiver améliore les performances pour les couches purement visuelles.    |

### URL custom

Par défaut, GeoLeaf construit l'URL des tuiles depuis le chemin du profil :

```
{profilesBasePath}/{profileId}/{layerDirectory}/{tilesDirectory}/{z}/{x}/{y}.pbf
```

Pour pointer vers un serveur de tuiles externe, ajoutez un champ `url` :

```json
"vectorTiles": {
  "enabled": true,
  "layerName": "my_layer",
  "url": "https://tiles.example.com/my_layer/{z}/{x}/{y}.pbf"
}
```

---

## Génération des tuiles

Le script `scripts/generate-vector-tiles.cjs` génère les fichiers PBF depuis les GeoJSON
du profil. Il supporte deux backends :

| Backend           | Qualité  | Plateforme            | Prérequis                                                  |
| ----------------- | -------- | --------------------- | ---------------------------------------------------------- |
| **tippecanoe**    | Optimale | macOS, Linux, WSL     | Installer [tippecanoe](https://github.com/felt/tippecanoe) |
| **Node.js natif** | Bonne    | Windows, macOS, Linux | `geojson-vt` + `vt-pbf` (npm)                              |

> Le backend est **auto-détecté** au lancement. Si tippecanoe est disponible (y compris via WSL
> sur Windows), il est utilisé en priorité. Sinon, le backend Node.js prend le relais.

### Options CLI

```bash
node scripts/generate-vector-tiles.cjs [options]
```

| Option             | Défaut     | Description                                          |
| ------------------ | ---------- | ---------------------------------------------------- |
| `--profile <id>`   | `tourism`  | Profil à traiter                                     |
| `--layer <id>`     | _(toutes)_ | Traiter une seule couche VT-enabled                  |
| `--backend <name>` | `auto`     | Forcer `tippecanoe` ou `node`                        |
| `--min-zoom <n>`   | `0`        | Zoom minimum de génération                           |
| `--max-zoom <n>`   | `14`       | Zoom maximum de génération (natif)                   |
| `--dry-run`        |            | Affiche ce qui serait généré sans écrire de fichiers |
| `--force`          |            | Écrase les tuiles existantes                         |

### Exemples

```bash
# Générer toutes les couches VT du profil tourism (auto-detect backend)
node scripts/generate-vector-tiles.cjs --profile tourism

# Générer une seule couche, forcer Node.js natif, en dry-run
node scripts/generate-vector-tiles.cjs --profile tourism --layer reseau_ferroviaire --backend node --dry-run

# Régénérer complètement avec tippecanoe (écrase l'existant)
node scripts/generate-vector-tiles.cjs --profile tourism --backend tippecanoe --force --max-zoom 16
```

### Installation des dépendances Node.js (backend natif)

```bash
npm install --save-dev geojson-vt vt-pbf
```

### Structure de sortie

```
profiles/
└── tourism/
    └── layers/
        └── reseau_ferroviaire/
            ├── data/
            │   └── reseau_ferroviaire.geojson      ← source
            └── tiles/                              ← tuiles générées
                ├── 0/
                │   └── 0/
                │       └── 0.pbf
                ├── 8/
                │   └── 142/
                │       └── 97.pbf
                └── 14/
                    └── ...
```

---

## Flow complet

```
GeoJSON source
     |
     v
scripts/generate-vector-tiles.cjs
     |  |-- tippecanoe -> .mbtiles -> tile-join -> {z}/{x}/{y}.pbf
     |  +-- Node.js    -> geojson-vt + vt-pbf   -> {z}/{x}/{y}.pbf
     v
layers/{id}/tiles/{z}/{x}/{y}.pbf
     |
     v
{layerId}_config.json
  data.vectorTiles.enabled: true
  data.vectorTiles.tilesDirectory: "tiles"
  data.vectorTiles.layerName: "{id}"
     |
     v
GeoLeaf.loadConfig() au boot
  -> VectorTiles.shouldUseVectorTiles(def) -> true
  -> VectorTiles.loadVectorTileLayer()
  -> map.addSource(id, { type: 'vector', tiles: [url] })
  -> map.addLayer({ id, type, source, 'source-layer', paint })
     |
     v
Carte MapLibre GL JS — rendu WebGL par tuile a la demande
```

---

## Styles et interactions

### Style de la couche

GeoLeaf convertit automatiquement le style GeoLeaf (fichier `styles/default.json`) en
proprietes de style MapLibre (paint/layout) via `VectorTiles.convertStyleToMapLibre()`.

**Proprietes de style supportees en mode MVT (MapLibre Style Spec) :**

| Propriete GeoLeaf | Propriete MapLibre paint | Type de couche |
| ----------------- | ------------------------ | -------------- |
| `fillColor`       | `fill-color`             | `fill`         |
| `fillOpacity`     | `fill-opacity`           | `fill`         |
| `color`           | `line-color`             | `line`         |
| `weight`          | `line-width`             | `line`         |
| `opacity`         | `line-opacity`           | `line`         |

**Les `styleRules` sont supportees** — GeoLeaf les convertit en expressions MapLibre
(`match`, `case`) pour un rendu GPU natif. Exemple de style avec regles thematiques :

```json
{
    "defaultStyle": { "color": "#3388ff", "weight": 2, "fillColor": "#3388ff", "fillOpacity": 0.4 },
    "styleRules": [
        {
            "condition": { "field": "type", "value": "TGV" },
            "style": { "color": "#e63946", "weight": 3 }
        },
        {
            "condition": { "field": "type", "value": "TER" },
            "style": { "color": "#457b9d", "weight": 2 }
        }
    ]
}
```

GeoLeaf genere l'equivalent MapLibre Style Spec suivant :

```javascript
// Generated source + layers by VectorTiles.loadVectorTileLayer()
map.addSource("reseau_ferroviaire", {
    type: "vector",
    tiles: ["https://example.com/tiles/{z}/{x}/{y}.pbf"],
    minzoom: 0,
    maxzoom: 14,
});

map.addLayer({
    id: "reseau_ferroviaire-line",
    type: "line",
    source: "reseau_ferroviaire",
    "source-layer": "reseau_ferroviaire",
    paint: {
        "line-color": [
            "match",
            ["get", "type"],
            "TGV",
            "#e63946",
            "TER",
            "#457b9d",
            "#3388ff", // default
        ],
        "line-width": [
            "match",
            ["get", "type"],
            "TGV",
            3,
            "TER",
            2,
            2, // default
        ],
    },
});
```

### Interactions

Activees par defaut (`interactive: true`) — GeoLeaf ecoute les evenements `click`
et `mouseenter`/`mouseleave` sur les features des tuiles via `map.on('click', layerId, ...)` :

- **Clic** -> popup construit depuis `PopupTooltip._buildPopupContent()` (meme template que GeoJSON)
- **Survol** -> tooltip si `def.tooltip.enabled === true`, avec changement de curseur

Pour les couches purement visuelles (ex. fonds cartographiques, reseaux denses), desactiver
les interactions ameliore les performances :

```json
"vectorTiles": {
  "enabled": true,
  "layerName": "roads",
  "interactive": false
}
```

---

## Limitations et points d'attention

> Ces limitations sont inherentes au mode tuiles vectorielles pre-generees.
> Elles sont documentees ici pour guider le choix entre MVT et GeoJSON classique.

### 1 — Performance au-dela de 50 000 features

Pour les couches tres denses (> 50 000 features au niveau de zoom maxNativeZoom), tippecanoe
applique automatiquement une simplification et un ecretage (**`--drop-densest-as-needed`**).
Avec le backend Node.js natif (`geojson-vt`), aucun ecretage automatique n'est applique —
les tuiles peuvent devenir lourdes.

**Recommandation :** utiliser tippecanoe avec `--maximum-zoom` adapte et verifier
la taille des tuiles au zoom max (`ls -la tiles/14/*/*`).

### 2 — Expressions de style GL supportees

Depuis la migration MapLibre GL JS, les expressions de style (`interpolate`, `match`,
`step`, `case`) sont **pleinement supportees**. GeoLeaf convertit automatiquement
les `styleRules` en expressions MapLibre natives.

Si vos styles proviennent d'un editeur GL (QGIS, Mapbox Studio), ils peuvent etre
utilises directement dans la MapLibre Style Specification.

### 3 — Clustering non supporte en mode MVT

Le clustering (supercluster, integre dans MapLibre) est une fonctionnalite du pipeline
GeoJSON/POI. Les couches MVT ne supportent pas le clustering — elles sont destinees
aux **lignes** et **polygones** denses, pas aux nuages de points POI.

Pour les couches POI denses, utiliser GeoJSON + clustering natif MapLibre, ou MVT
avec `interactive: false` pour un affichage purement visuel.

### 4 — Interactions

En mode `interactive: true`, les popups et tooltips MVT sont construits depuis les
proprietes de la feature interrogee via `map.queryRenderedFeatures()`. Les fonctionnalites
suivantes sont disponibles :

- Popup construit depuis le meme template que GeoJSON
- Tooltip au survol avec changement de curseur
- Panneau lateral (`openSidePanel`) supporte via `queryRenderedFeatures`

> L'evenement `geoleaf:geojson:visibility-changed` avec comptage de features n'est
> pas disponible en mode MVT (les features sont streames par tuile).

---

## Voir aussi

- [GEOJSON_LAYERS_GUIDE.md](GEOJSON_LAYERS_GUIDE.md) — Guide couches GeoJSON classiques
- GUIDE_CONFIGURATIONS_CORE.md — Référence complète de tous les paramètres
- `generate-vector-tiles.cjs` — Script de génération
- `vector-tiles.ts` — Implémentation
