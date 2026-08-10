---
title: "GeoLeaf.Table — Documentation du module Table"
---

# GeoLeaf.Table — Documentation du module Table

> ℹ️ Le tableau de données a été extrait du core vers le plugin MIT `@geoleaf-plugins/table`. Voir le README du plugin pour l'installation, la configuration (`modules.table.*`) et la migration.
>
> _Le contenu ci-dessous est conservé à titre de référence historique._

**Product Version**: GeoLeaf Platform V3 — **Version doc**: 3.0.0

**Fichier source** : `packages/core/src/modules/geoleaf.table.ts`
**Implémentation** : `packages/core/src/modules/optional/table/table-api.ts`
**Dernière mise à jour** : mars 2026

---

> **⚠️ Module extrait du core (v3.0.0)** — Le tableau de données n'est plus intégré à `@geoleaf/core` : il est fourni par le plugin MIT **`@geoleaf-plugins/table`** (npmjs.org). `npm install @geoleaf-plugins/table`, puis charger son script **après** `geoleaf.esm.js` et **avant** `GeoLeaf.boot()`.

---

Le module **GeoLeaf.Table** fournit une vue tabulaire des données cartographiques, complémentaire à l'affichage sur la carte MapLibre GL JS.

Il permet de :

- **Afficher** les attributs des entités GeoJSON dans un tableau
- **Trier** les données par colonne (cycle ascendant → descendant → aucun)
- **Sélectionner** des entités et synchroniser avec la carte
- **Zoomer** sur les entités sélectionnées
- **Surbriller** la sélection sur la carte
- **Exporter** la sélection (via événement)

---

## 1. Rôle fonctionnel du Table

GeoLeaf.Table a cinq responsabilités principales :

1. **Afficher les données** des couches GeoJSON sous forme tabulaire
2. **Synchroniser** la sélection entre table et carte
3. **Permettre le tri** multi-colonnes avec cycles (asc → desc → null)
4. **Gérer la sélection multiple** avec export et zoom
5. **S'intégrer** avec les modules GeoJSON, Filters et Core

> Important : Le module Table nécessite que **GeoLeaf.GeoJSON** soit chargé et configuré.

---

## 2. API publique de GeoLeaf.Table

### 2.1 `GeoLeaf.Table.init(options)`

Initialise le module Table avec une instance de carte et des options.

```js
GeoLeaf.Table.init(options);
```

**Paramètres :**

- `options` : objet de configuration **requis**
    - `options.map` : instance de carte MapLibre GL JS **(requis)**
    - `options.config` : `Object` — configuration personnalisée (optionnel)
        - `enabled` : `boolean` — activer le module (défaut : `true`)
        - `defaultVisible` : `boolean` — visible au démarrage (défaut : `false`)
        - `pageSize` : `number` — lignes par page (défaut : `50`)
        - `maxRowsPerLayer` : `number` — limite de lignes (défaut : `1000`)
        - `enableExportButton` : `boolean` — bouton export (défaut : `true`)
        - `virtualScrolling` : `boolean` — scroll virtuel (défaut : `true`)
        - `defaultHeight` : `string` — hauteur par défaut (défaut : `'40%'`)
        - `minHeight` : `string` — hauteur minimale (défaut : `'20%'`)
        - `maxHeight` : `string` — hauteur maximale (défaut : `'60%'`)
        - `resizable` : `boolean` — redimensionnable (défaut : `true`)

**Retour :** `void`

#### Exemple minimal

```js
const map = GeoLeaf.Core.getMap();

GeoLeaf.Table.init({ map });
```

#### Exemple avec configuration

```js
GeoLeaf.Table.init({
    map,
    config: {
        defaultVisible: true,
        pageSize: 100,
        maxRowsPerLayer: 2000,
        defaultHeight: "50%",
        resizable: true,
    },
});
```

---

### 2.2 `GeoLeaf.Table.show()`

Affiche le tableau.

```js
GeoLeaf.Table.show();
```

**Événements émis :** `geoleaf:table:opened`

#### Exemple

```js
document.getElementById("show-table-btn").addEventListener("click", () => {
    GeoLeaf.Table.show();
});
```

---

### 2.3 `GeoLeaf.Table.hide()`

Masque le tableau. Désactive également la surbrillance active.

```js
GeoLeaf.Table.hide();
```

**Événements émis :** `geoleaf:table:closed`

#### Exemple

```js
document.getElementById("hide-table-btn").addEventListener("click", () => {
    GeoLeaf.Table.hide();
});
```

---

### 2.4 `GeoLeaf.Table.toggle()`

Bascule la visibilité du tableau (affiche si caché, cache si affiché).

```js
GeoLeaf.Table.toggle();
```

#### Exemple

```js
document.getElementById("toggle-table-btn").addEventListener("click", () => {
    GeoLeaf.Table.toggle();
});
```

---

### 2.5 `GeoLeaf.Table.setLayer(layerId)`

Définit la couche GeoJSON à afficher dans le tableau.

```js
GeoLeaf.Table.setLayer(layerId);
```

**Paramètres :**

- `layerId` : `string` — ID de la couche GeoJSON (ou `null` pour vider)

**Événements émis :** `geoleaf:table:layerChanged` avec `{ layerId }`

> Note : Seules les couches déclarées dans la configuration GeoJSON peuvent être affichées. `setLayer` réinitialise la sélection et le tri.

#### Exemple

```js
document.getElementById("layer-select").addEventListener("change", (e) => {
    GeoLeaf.Table.setLayer(e.target.value);
});
```

#### Configuration de couche pour Table

Dans `geoleaf.config.json` :

```json
{
    "geojson": {
        "layers": [
            {
                "id": "restaurants",
                "url": "data/restaurants.geojson",
                "table": {
                    "enabled": true,
                    "columns": [
                        {
                            "field": "properties.name",
                            "label": "Nom",
                            "width": "30%",
                            "sortable": true
                        },
                        {
                            "field": "properties.category",
                            "label": "Catégorie",
                            "width": "20%",
                            "sortable": true
                        },
                        {
                            "field": "properties.rating",
                            "label": "Note",
                            "width": "15%",
                            "sortable": true
                        }
                    ],
                    "defaultSort": {
                        "field": "properties.name",
                        "direction": "asc"
                    }
                }
            }
        ]
    }
}
```

---

### 2.6 `GeoLeaf.Table.refresh()`

Rafraîchit les données affichées dans le tableau.

```js
GeoLeaf.Table.refresh();
```

Récupère les features de la couche courante via `GeoLeaf.GeoJSON.getLayerData()`, réapplique le tri et re-rend le tableau.

#### Exemple

```js
// Rafraîchir après un changement de filtre
map.on("geoleaf:filters:changed", () => {
    GeoLeaf.Table.refresh();
});
```

---

### 2.7 `GeoLeaf.Table.sortByField(field)`

Change le tri sur une colonne spécifique.

```js
GeoLeaf.Table.sortByField(field);
```

**Paramètres :**

- `field` : `string` — chemin du champ (notation point : `properties.name`)

**Comportement** : cycle de tri sur la même colonne :

1. Premier appel : tri ascendant
2. Deuxième appel : tri descendant
3. Troisième appel : pas de tri (ordre original)

**Événements émis :** `geoleaf:table:sortChanged` avec `{ field, direction }`

#### Exemple

```js
document.querySelectorAll(".table-header").forEach((header) => {
    header.addEventListener("click", () => {
        GeoLeaf.Table.sortByField(header.dataset.field);
    });
});
```

---

### 2.8 `GeoLeaf.Table.setSelection(ids, add)`

Sélectionne ou désélectionne des entités.

```js
GeoLeaf.Table.setSelection(ids, add);
```

**Paramètres :**

- `ids` : `Array<string>` — IDs des entités à sélectionner
- `add` : `boolean` — ajouter à la sélection existante (`true`) ou remplacer (`false`, défaut)

**Événements émis :** `geoleaf:table:selectionChanged` avec `{ layerId, selectedIds }`

#### Exemple

```js
// Sélectionner des entités spécifiques
GeoLeaf.Table.setSelection(["poi-1", "poi-5", "poi-12"]);

// Ajouter à la sélection existante
GeoLeaf.Table.setSelection(["poi-20"], true);
```

---

### 2.9 `GeoLeaf.Table.getSelectedIds()`

Retourne les IDs des entités sélectionnées.

```js
const selectedIds = GeoLeaf.Table.getSelectedIds();
```

**Retour :** `Array<string>` — liste des IDs sélectionnés

#### Exemple

```js
const selected = GeoLeaf.Table.getSelectedIds();
console.log(`${selected.length} entités sélectionnées :`, selected);
```

---

### 2.10 `GeoLeaf.Table.clearSelection()`

Efface toute la sélection.

```js
GeoLeaf.Table.clearSelection();
```

**Événements émis :** `geoleaf:table:selectionChanged` avec `{ selectedIds: [] }`

#### Exemple

```js
document.getElementById("clear-selection-btn").addEventListener("click", () => {
    GeoLeaf.Table.clearSelection();
});
```

---

### 2.11 `GeoLeaf.Table.zoomToSelection()`

Zoom sur les entités sélectionnées dans la carte.

```js
GeoLeaf.Table.zoomToSelection();
```

**Événements émis :** `geoleaf:table:zoomToSelection` avec `{ layerId, selectedIds }`

**Comportement :** Calcule les bounds des entités sélectionnées et ajuste la vue de la carte MapLibre GL JS.

#### Exemple

```js
document.getElementById("zoom-selection-btn").addEventListener("click", () => {
    const selected = GeoLeaf.Table.getSelectedIds();
    if (selected.length === 0) return;
    GeoLeaf.Table.zoomToSelection();
});
```

---

### 2.12 `GeoLeaf.Table.highlightSelection(active)`

Active/désactive la surbrillance des entités sélectionnées sur la carte.

```js
GeoLeaf.Table.highlightSelection(active);
```

**Paramètres :**

- `active` : `boolean` — activer (`true`) ou désactiver (`false`)

**Événements émis :** `geoleaf:table:highlightSelection` avec `{ layerId, selectedIds, active }`

#### Exemple

```js
let highlighted = false;

document.getElementById("highlight-btn").addEventListener("click", () => {
    highlighted = !highlighted;
    GeoLeaf.Table.highlightSelection(highlighted);
});
```

---

### 2.13 `GeoLeaf.Table.exportSelection()`

Émet un événement pour exporter la sélection.

```js
GeoLeaf.Table.exportSelection();
```

**Événements émis :** `geoleaf:table:exportSelection` avec `{ layerId, selectedIds, rows }`

> Note : Le module Table émet uniquement l'événement. L'implémentation de l'export (CSV, JSON, GeoJSON, etc.) doit être gérée par l'application.

#### Exemple

```js
document.getElementById("export-btn").addEventListener("click", () => {
    GeoLeaf.Table.exportSelection();
});

// Écouter l'événement pour implémenter l'export
map.on("geoleaf:table:exportSelection", (e) => {
    const { rows } = e;
    const csv = convertToCSV(rows);
    downloadFile(csv, "export.csv", "text/csv");
});

function convertToCSV(rows) {
    const headers = Object.keys(rows[0].properties);
    const csvLines = [headers.join(",")];
    rows.forEach((row) => {
        const values = headers.map((h) => row.properties[h] ?? "");
        csvLines.push(values.join(","));
    });
    return csvLines.join("\n");
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
```

---

## 3. Configuration dans geoleaf.config.json

### 3.1 Configuration globale du module

```json
{
    "tableConfig": {
        "enabled": true,
        "defaultVisible": false,
        "pageSize": 50,
        "maxRowsPerLayer": 1000,
        "enableExportButton": true,
        "virtualScrolling": true,
        "defaultHeight": "40%",
        "minHeight": "20%",
        "maxHeight": "60%",
        "resizable": true
    }
}
```

### 3.2 Configuration par couche

```json
{
    "geojson": {
        "layers": [
            {
                "id": "restaurants",
                "url": "data/restaurants.geojson",
                "table": {
                    "enabled": true,
                    "columns": [
                        {
                            "field": "properties.name",
                            "label": "Nom",
                            "width": "30%",
                            "sortable": true
                        },
                        {
                            "field": "properties.category",
                            "label": "Catégorie",
                            "width": "20%",
                            "sortable": true
                        },
                        {
                            "field": "properties.address",
                            "label": "Adresse",
                            "width": "35%",
                            "sortable": false
                        },
                        {
                            "field": "properties.rating",
                            "label": "Note",
                            "width": "15%",
                            "sortable": true
                        }
                    ],
                    "defaultSort": {
                        "field": "properties.rating",
                        "direction": "desc"
                    },
                    "searchFields": ["properties.name", "properties.category"]
                }
            }
        ]
    }
}
```

---

## 4. Événements

Le module Table émet les événements suivants sur la carte MapLibre GL JS :

| Événement                          | Détail                             | Description                     |
| ---------------------------------- | ---------------------------------- | ------------------------------- |
| `geoleaf:table:opened`             | —                                  | Tableau affiché                 |
| `geoleaf:table:closed`             | —                                  | Tableau masqué                  |
| `geoleaf:table:layerChanged`       | `{ layerId }`                      | Couche affichée modifiée        |
| `geoleaf:table:sortChanged`        | `{ field, direction }`             | Tri modifié                     |
| `geoleaf:table:selectionChanged`   | `{ layerId, selectedIds }`         | Sélection modifiée              |
| `geoleaf:table:zoomToSelection`    | `{ layerId, selectedIds }`         | Zoom sur sélection déclenché    |
| `geoleaf:table:highlightSelection` | `{ layerId, selectedIds, active }` | Surbrillance activée/désactivée |
| `geoleaf:table:exportSelection`    | `{ layerId, selectedIds, rows }`   | Export demandé                  |

### Exemple d'écoute

```js
const map = GeoLeaf.Core.getMap();

// Écouter les changements de sélection
map.on("geoleaf:table:selectionChanged", (e) => {
    console.log(`${e.selectedIds.length} entités sélectionnées`);
    highlightFeaturesOnMap(e.selectedIds);
});

// Écouter les changements de couche
map.on("geoleaf:table:layerChanged", (e) => {
    console.log(`Couche affichée : ${e.layerId}`);
    updateUIControls(e.layerId);
});
```

---

## 5. Intégration avec d'autres modules

### 5.1 Intégration avec GeoJSON

Le module Table affiche les données des couches GeoJSON chargées par le core :

```js
// Les couches GeoJSON sont configurées dans geoleaf.config.json
// et chargées automatiquement par GeoLeaf.GeoJSON au démarrage.
// Afficher une couche dans le tableau :
GeoLeaf.Table.setLayer("restaurants");
GeoLeaf.Table.show();
```

### 5.2 Intégration avec Filters

Le tableau se synchronise automatiquement avec les filtres via l'écoute des événements :

```js
// Appliquer un filtre
GeoLeaf.Filter.applyFilter({ category: "restaurant" });

// Le tableau se met à jour automatiquement
// (écoute l'événement geoleaf:filters:changed en interne)
```

### 5.3 Synchronisation bidirectionnelle carte ↔ table

Dans MapLibre GL JS, la synchronisation s'appuie sur les événements GeoLeaf :

```js
// Sélection dans le tableau → surbrillance sur carte
map.on("geoleaf:table:selectionChanged", (e) => {
    const { selectedIds } = e;
    // Mettre à jour le style MapLibre via setFeatureState ou paint expression
    // (la mise en surbrillance intégrée utilise highlightSelection())
    GeoLeaf.Table.highlightSelection(selectedIds.length > 0);
});

// Clic sur carte → sélection dans table
map.on("click", (e) => {
    const features = map.queryRenderedFeatures(e.point);
    if (features.length > 0) {
        const featureId = features[0].id;
        GeoLeaf.Table.setSelection([String(featureId)], true);
    }
});
```

---

## 6. Cas d'usage pratiques

### 6.1 Tableau avec tri

```js
GeoLeaf.Table.init({ map });
GeoLeaf.Table.setLayer("restaurants");
GeoLeaf.Table.show();

// Déclencher un tri programmatique
GeoLeaf.Table.sortByField("properties.rating");
```

### 6.2 Export multi-formats

```js
map.on("geoleaf:table:exportSelection", (e) => {
    const { rows, layerId } = e;
    const format = prompt("Format d'export (csv/json/geojson):", "csv");

    switch (format) {
        case "csv":
            exportCSV(rows, `${layerId}.csv`);
            break;
        case "json":
            exportJSON(rows, `${layerId}.json`);
            break;
        case "geojson":
            exportGeoJSON(rows, `${layerId}.geojson`);
            break;
    }
});
```

### 6.3 Configuration pour grandes tables

```js
GeoLeaf.Table.init({
    map,
    config: {
        maxRowsPerLayer: 5000,
        virtualScrolling: true,
        pageSize: 100,
    },
});

// Debounce sur les refresh fréquents
let refreshTimeout;
map.on("geoleaf:filters:changed", () => {
    clearTimeout(refreshTimeout);
    refreshTimeout = setTimeout(() => GeoLeaf.Table.refresh(), 300);
});
```

---

## 7. Architecture interne

### 7.1 Modules composants

```
GeoLeaf.Table (API publique — table-api.ts)
    ├── table-state.ts      (état partagé : _map, _config, _currentLayerId, _selectedIds, etc.)
    ├── table-layer.ts      (récupération features, gestion couches, attachMapEvents)
    ├── table-highlight.ts  (surbrillance MapLibre, calcul bounds)
    ├── table-selection.ts  (setSelection, clearSelection, zoomToSelection, exportSelection)
    ├── sort.ts             (sortInPlace, nextSortState — cycle tri)
    ├── export.ts           (resolveFeatureId)
    ├── panel.ts            (TablePanel — création conteneur DOM)
    └── renderer.ts         (TableRenderer — rendu tableau HTML)
```

### 7.2 Flux de données

```
1. Initialisation
   GeoLeaf.Table.init({ map, config })
   └── Fusionne config depuis GeoLeaf.Config.get('tableConfig') + options
   └── Crée conteneur DOM via TablePanel.create()
   └── Attache listeners événements carte

2. Changement de couche
   GeoLeaf.Table.setLayer('restaurants')
   └── Réinitialise sélection, highlight et tri
   └── Applique defaultSort depuis config de couche
   └── Appelle refresh()

3. Rafraîchissement
   GeoLeaf.Table.refresh()
   └── Récupère features via GeoLeaf.GeoJSON.getLayerData()
   └── Construit _featureIdMap
   └── Applique tri si défini (sortInPlace)
   └── Appelle TableRenderer.render()

4. Tri
   GeoLeaf.Table.sortByField('properties.name')
   └── nextSortState() → cycle asc → desc → null
   └── Appelle refresh()
   └── Émet: geoleaf:table:sortChanged

5. Sélection
   GeoLeaf.Table.setSelection(['id1', 'id2'])
   └── Met à jour _selectedIds (Set)
   └── Appelle TableRenderer.updateSelection()
   └── Émet: geoleaf:table:selectionChanged
```

---

## 8. Bonnes pratiques

### À faire

- Limiter le nombre de lignes via `maxRowsPerLayer` (défaut : 1000)
- Activer le scroll virtuel pour les grandes tables : `virtualScrolling: true`
- Définir uniquement les colonnes pertinentes dans `columns`
- Utiliser `defaultSort` pour une meilleure UX initiale
- Utiliser un debounce sur les appels fréquents à `refresh()`

### À éviter

- Afficher toutes les propriétés sans filtrer les colonnes
- Charger plus de 5000 lignes sans pagination ni scroll virtuel
- Appeler `refresh()` trop fréquemment sans debounce

---

## 9. Performance

### Optimisations intégrées

- **Limitation automatique** : `maxRowsPerLayer` empêche les surcharges
- **Scroll virtuel** : affiche uniquement les lignes visibles
- **Cache des données** : `_cachedData` évite les requêtes répétées
- **Tri optimisé** : utilise `localeCompare` pour les strings

### Recommandations pour très grandes tables (10k+ lignes)

```js
GeoLeaf.Table.init({
    map,
    config: {
        maxRowsPerLayer: 5000,
        virtualScrolling: true,
        pageSize: 100,
    },
});
```

---

## 10. Dépannage

### Problème : "Container not initialized"

**Cause** : `TablePanel` non chargé ou module non initialisé.
**Solution** : Vérifier que `GeoLeaf.Table.init()` est appelé avant `show()`.

### Problème : Colonnes vides

**Cause** : `field` ne correspond pas à la structure GeoJSON.
**Solution** : Vérifier les chemins de propriétés (notation point).

```js
// Structure GeoJSON
{ "properties": { "name": "Restaurant X", "info": { "category": "Italian" } } }

// Configuration colonnes correcte
{ "columns": [
    { "field": "properties.name", "label": "Nom" },           // OK
    { "field": "properties.info.category", "label": "Cat" },  // OK
    { "field": "category", "label": "Cat" }                   // Incorrect
] }
```

### Problème : Tri ne fonctionne pas

**Cause** : Colonne non marquée `sortable: true`.
**Solution** :

```json
{ "columns": [{ "field": "properties.name", "label": "Nom", "sortable": true }] }
```

---

## 11. Voir aussi

- **GeoJSON** : [docs/geojson/GEOJSON_LAYERS_GUIDE.md](../geojson/GEOJSON_LAYERS_GUIDE.md)
- **Filter** : [docs/API_REFERENCE.md](../API_REFERENCE.md#filter--the-filter-panel-singular)
- **UI** : [docs/ui/GeoLeaf_UI_README.md](../ui/GeoLeaf_UI_README.md)
