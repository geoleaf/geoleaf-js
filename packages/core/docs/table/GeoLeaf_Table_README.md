---
title: "GeoLeaf.Table — Table Module Documentation"
---

# GeoLeaf.Table — Table Module Documentation

::: warning
The data table is no longer part of `@geoleaf/core`: it is provided by the MIT plugin
`@geoleaf-plugins/table`. Install it with `npm install @geoleaf-plugins/table`, then load its
script **after** `geoleaf.esm.js` and **before** `GeoLeaf.boot()`.
:::

The **GeoLeaf.Table** module provides a tabular view of map data, complementing the display on the MapLibre GL JS map.

It can:

- **Display** the attributes of GeoJSON features in a table
- **Sort** data by column (ascending → descending → none cycle)
- **Select** features and synchronize with the map
- **Zoom** to the selected features
- **Highlight** the selection on the map
- **Export** the selection (through an event)

---

## 1. Functional role of the Table

GeoLeaf.Table has five main responsibilities:

1. **Display the data** of GeoJSON layers in tabular form
2. **Synchronize** the selection between table and map
3. **Allow multi-column sorting** with cycles (asc → desc → null)
4. **Handle multiple selection** with export and zoom
5. **Integrate** with the GeoJSON, Filters and Core modules

> Important: the Table module requires **GeoLeaf.GeoJSON** to be loaded and configured.

---

## 2. Public API of GeoLeaf.Table

### 2.1 `GeoLeaf.Table.init(options)`

Initializes the Table module with a map instance and options.

```js
GeoLeaf.Table.init(options);
```

**Parameters:**

- `options`: configuration object, **required**
    - `options.map`: MapLibre GL JS map instance **(required)**
    - `options.config`: `Object` — custom configuration (optional)
        - `enabled`: `boolean` — enable the module (default: `true`)
        - `defaultVisible`: `boolean` — visible on startup (default: `false`)
        - `pageSize`: `number` — rows per page (default: `50`)
        - `maxRowsPerLayer`: `number` — row limit (default: `1000`)
        - `enableExportButton`: `boolean` — export button (default: `true`)
        - `virtualScrolling`: `boolean` — virtual scrolling (default: `true`)
        - `defaultHeight`: `string` — default height (default: `'40%'`)
        - `minHeight`: `string` — minimum height (default: `'20%'`)
        - `maxHeight`: `string` — maximum height (default: `'60%'`)
        - `resizable`: `boolean` — resizable (default: `true`)

**Returns:** `void`

#### Minimal example

```js
const map = GeoLeaf.Core.getMap();

GeoLeaf.Table.init({ map });
```

#### Example with configuration

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

Shows the table.

```js
GeoLeaf.Table.show();
```

**Events emitted:** `geoleaf:table:opened`

#### Example

```js
document.getElementById("show-table-btn").addEventListener("click", () => {
    GeoLeaf.Table.show();
});
```

---

### 2.3 `GeoLeaf.Table.hide()`

Hides the table. Also turns off the active highlight.

```js
GeoLeaf.Table.hide();
```

**Events emitted:** `geoleaf:table:closed`

#### Example

```js
document.getElementById("hide-table-btn").addEventListener("click", () => {
    GeoLeaf.Table.hide();
});
```

---

### 2.4 `GeoLeaf.Table.toggle()`

Toggles table visibility (shows it if hidden, hides it if shown).

```js
GeoLeaf.Table.toggle();
```

#### Example

```js
document.getElementById("toggle-table-btn").addEventListener("click", () => {
    GeoLeaf.Table.toggle();
});
```

---

### 2.5 `GeoLeaf.Table.setLayer(layerId)`

Sets the GeoJSON layer to display in the table.

```js
GeoLeaf.Table.setLayer(layerId);
```

**Parameters:**

- `layerId`: `string` — ID of the GeoJSON layer (or `null` to clear)

**Events emitted:** `geoleaf:table:layerChanged` with `{ layerId }`

> Note: only layers declared in the GeoJSON configuration can be displayed. `setLayer` resets the selection and the sort.

#### Example

```js
document.getElementById("layer-select").addEventListener("change", (e) => {
    GeoLeaf.Table.setLayer(e.target.value);
});
```

#### Layer configuration for Table

In `geoleaf.config.json`:

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

Refreshes the data displayed in the table.

```js
GeoLeaf.Table.refresh();
```

Retrieves the features of the current layer through `GeoLeaf.GeoJSON.getLayerData()`, reapplies the sort and re-renders the table.

#### Example

```js
// Refresh after a filter change
map.on("geoleaf:filters:changed", () => {
    GeoLeaf.Table.refresh();
});
```

---

### 2.7 `GeoLeaf.Table.sortByField(field)`

Changes the sort on a given column.

```js
GeoLeaf.Table.sortByField(field);
```

**Parameters:**

- `field`: `string` — field path (dot notation: `properties.name`)

**Behavior**: sort cycle on the same column:

1. First call: ascending sort
2. Second call: descending sort
3. Third call: no sort (original order)

**Events emitted:** `geoleaf:table:sortChanged` with `{ field, direction }`

#### Example

```js
document.querySelectorAll(".table-header").forEach((header) => {
    header.addEventListener("click", () => {
        GeoLeaf.Table.sortByField(header.dataset.field);
    });
});
```

---

### 2.8 `GeoLeaf.Table.setSelection(ids, add)`

Selects or deselects features.

```js
GeoLeaf.Table.setSelection(ids, add);
```

**Parameters:**

- `ids`: `Array<string>` — IDs of the features to select
- `add`: `boolean` — add to the existing selection (`true`) or replace it (`false`, default)

**Events emitted:** `geoleaf:table:selectionChanged` with `{ layerId, selectedIds }`

#### Example

```js
// Select specific features
GeoLeaf.Table.setSelection(["poi-1", "poi-5", "poi-12"]);

// Add to the existing selection
GeoLeaf.Table.setSelection(["poi-20"], true);
```

---

### 2.9 `GeoLeaf.Table.getSelectedIds()`

Returns the IDs of the selected features.

```js
const selectedIds = GeoLeaf.Table.getSelectedIds();
```

**Returns:** `Array<string>` — list of selected IDs

#### Example

```js
const selected = GeoLeaf.Table.getSelectedIds();
console.log(`${selected.length} selected features:`, selected);
```

---

### 2.10 `GeoLeaf.Table.clearSelection()`

Clears the whole selection.

```js
GeoLeaf.Table.clearSelection();
```

**Events emitted:** `geoleaf:table:selectionChanged` with `{ selectedIds: [] }`

#### Example

```js
document.getElementById("clear-selection-btn").addEventListener("click", () => {
    GeoLeaf.Table.clearSelection();
});
```

---

### 2.11 `GeoLeaf.Table.zoomToSelection()`

Zooms to the selected features on the map.

```js
GeoLeaf.Table.zoomToSelection();
```

**Events emitted:** `geoleaf:table:zoomToSelection` with `{ layerId, selectedIds }`

**Behavior:** computes the bounds of the selected features and adjusts the MapLibre GL JS map view.

#### Example

```js
document.getElementById("zoom-selection-btn").addEventListener("click", () => {
    const selected = GeoLeaf.Table.getSelectedIds();
    if (selected.length === 0) return;
    GeoLeaf.Table.zoomToSelection();
});
```

---

### 2.12 `GeoLeaf.Table.highlightSelection(active)`

Enables or disables the highlighting of the selected features on the map.

```js
GeoLeaf.Table.highlightSelection(active);
```

**Parameters:**

- `active`: `boolean` — enable (`true`) or disable (`false`)

**Events emitted:** `geoleaf:table:highlightSelection` with `{ layerId, selectedIds, active }`

#### Example

```js
let highlighted = false;

document.getElementById("highlight-btn").addEventListener("click", () => {
    highlighted = !highlighted;
    GeoLeaf.Table.highlightSelection(highlighted);
});
```

---

### 2.13 `GeoLeaf.Table.exportSelection()`

Emits an event to export the selection.

```js
GeoLeaf.Table.exportSelection();
```

**Events emitted:** `geoleaf:table:exportSelection` with `{ layerId, selectedIds, rows }`

> Note: the Table module only emits the event. Implementing the export itself (CSV, JSON, GeoJSON, and so on) is up to the application.

#### Example

```js
document.getElementById("export-btn").addEventListener("click", () => {
    GeoLeaf.Table.exportSelection();
});

// Listen to the event to implement the export
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

## 3. Configuration in geoleaf.config.json

### 3.1 Global module configuration

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

### 3.2 Per-layer configuration

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

## 4. Events

The Table module emits the following events on the MapLibre GL JS map:

| Event                              | Detail                             | Description                 |
| ---------------------------------- | ---------------------------------- | --------------------------- |
| `geoleaf:table:opened`             | —                                  | Table shown                 |
| `geoleaf:table:closed`             | —                                  | Table hidden                |
| `geoleaf:table:layerChanged`       | `{ layerId }`                      | Displayed layer changed     |
| `geoleaf:table:sortChanged`        | `{ field, direction }`             | Sort changed                |
| `geoleaf:table:selectionChanged`   | `{ layerId, selectedIds }`         | Selection changed           |
| `geoleaf:table:zoomToSelection`    | `{ layerId, selectedIds }`         | Zoom to selection triggered |
| `geoleaf:table:highlightSelection` | `{ layerId, selectedIds, active }` | Highlight enabled/disabled  |
| `geoleaf:table:exportSelection`    | `{ layerId, selectedIds, rows }`   | Export requested            |

### Listening example

```js
const map = GeoLeaf.Core.getMap();

// Listen to selection changes
map.on("geoleaf:table:selectionChanged", (e) => {
    console.log(`${e.selectedIds.length} selected features`);
    highlightFeaturesOnMap(e.selectedIds);
});

// Listen to layer changes
map.on("geoleaf:table:layerChanged", (e) => {
    console.log(`Displayed layer: ${e.layerId}`);
    updateUIControls(e.layerId);
});
```

---

## 5. Integration with other modules

### 5.1 Integration with GeoJSON

The Table module displays the data of the GeoJSON layers loaded by the core:

```js
// GeoJSON layers are configured in geoleaf.config.json
// and loaded automatically by GeoLeaf.GeoJSON at startup.
// Display a layer in the table:
GeoLeaf.Table.setLayer("restaurants");
GeoLeaf.Table.show();
```

### 5.2 Integration with Filters

The table synchronizes with filters automatically by listening to events:

```js
// Apply a filter
GeoLeaf.Filter.applyFilter({ category: "restaurant" });

// The table updates itself automatically
// (it listens to the geoleaf:filters:changed event internally)
```

### 5.3 Two-way map ↔ table synchronization

In MapLibre GL JS, synchronization relies on GeoLeaf events:

```js
// Selection in the table → highlight on the map
map.on("geoleaf:table:selectionChanged", (e) => {
    const { selectedIds } = e;
    // Update the MapLibre style through setFeatureState or a paint expression
    // (the built-in highlighting uses highlightSelection())
    GeoLeaf.Table.highlightSelection(selectedIds.length > 0);
});

// Click on the map → selection in the table
map.on("click", (e) => {
    const features = map.queryRenderedFeatures(e.point);
    if (features.length > 0) {
        const featureId = features[0].id;
        GeoLeaf.Table.setSelection([String(featureId)], true);
    }
});
```

---

## 6. Practical use cases

### 6.1 Table with sorting

```js
GeoLeaf.Table.init({ map });
GeoLeaf.Table.setLayer("restaurants");
GeoLeaf.Table.show();

// Trigger a sort programmatically
GeoLeaf.Table.sortByField("properties.rating");
```

### 6.2 Multi-format export

```js
map.on("geoleaf:table:exportSelection", (e) => {
    const { rows, layerId } = e;
    const format = prompt("Export format (csv/json/geojson):", "csv");

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

### 6.3 Configuration for large tables

```js
GeoLeaf.Table.init({
    map,
    config: {
        maxRowsPerLayer: 5000,
        virtualScrolling: true,
        pageSize: 100,
    },
});

// Debounce frequent refreshes
let refreshTimeout;
map.on("geoleaf:filters:changed", () => {
    clearTimeout(refreshTimeout);
    refreshTimeout = setTimeout(() => GeoLeaf.Table.refresh(), 300);
});
```

---

## 7. Internal architecture

### 7.1 Component modules

```
GeoLeaf.Table (public API — table-api.ts)
    ├── table-state.ts      (shared state: _map, _config, _currentLayerId, _selectedIds, etc.)
    ├── table-layer.ts      (feature retrieval, layer handling, attachMapEvents)
    ├── table-highlight.ts  (MapLibre highlighting, bounds computation)
    ├── table-selection.ts  (setSelection, clearSelection, zoomToSelection, exportSelection)
    ├── sort.ts             (sortInPlace, nextSortState — sort cycle)
    ├── export.ts           (resolveFeatureId)
    ├── panel.ts            (TablePanel — DOM container creation)
    └── renderer.ts         (TableRenderer — HTML table rendering)
```

### 7.2 Data flow

```
1. Initialization
   GeoLeaf.Table.init({ map, config })
   └── Merges config from GeoLeaf.Config.get('tableConfig') + options
   └── Creates the DOM container through TablePanel.create()
   └── Attaches map event listeners

2. Layer change
   GeoLeaf.Table.setLayer('restaurants')
   └── Resets selection, highlight and sort
   └── Applies defaultSort from the layer config
   └── Calls refresh()

3. Refresh
   GeoLeaf.Table.refresh()
   └── Retrieves features through GeoLeaf.GeoJSON.getLayerData()
   └── Builds _featureIdMap
   └── Applies the sort if defined (sortInPlace)
   └── Calls TableRenderer.render()

4. Sorting
   GeoLeaf.Table.sortByField('properties.name')
   └── nextSortState() → cycle asc → desc → null
   └── Calls refresh()
   └── Emits: geoleaf:table:sortChanged

5. Selection
   GeoLeaf.Table.setSelection(['id1', 'id2'])
   └── Updates _selectedIds (Set)
   └── Calls TableRenderer.updateSelection()
   └── Emits: geoleaf:table:selectionChanged
```

---

## 8. Best practices

### Do

- Limit the number of rows through `maxRowsPerLayer` (default: 1000)
- Enable virtual scrolling for large tables: `virtualScrolling: true`
- Declare only the relevant columns in `columns`
- Use `defaultSort` for a better initial experience
- Debounce frequent calls to `refresh()`

### Avoid

- Displaying every property without narrowing the columns
- Loading more than 5000 rows without pagination or virtual scrolling
- Calling `refresh()` too often without a debounce

---

## 9. Performance

### Built-in optimizations

- **Automatic capping**: `maxRowsPerLayer` prevents overload
- **Virtual scrolling**: only the visible rows are rendered
- **Data caching**: `_cachedData` avoids repeated queries
- **Optimized sorting**: uses `localeCompare` for strings

### Recommendations for very large tables (10k+ rows)

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

## 10. Troubleshooting

### Issue: "Container not initialized"

**Cause**: `TablePanel` not loaded, or the module was not initialized.
**Solution**: check that `GeoLeaf.Table.init()` is called before `show()`.

### Issue: empty columns

**Cause**: `field` does not match the GeoJSON structure.
**Solution**: check the property paths (dot notation).

```js
// GeoJSON structure
{ "properties": { "name": "Restaurant X", "info": { "category": "Italian" } } }

// Correct column configuration
{ "columns": [
    { "field": "properties.name", "label": "Nom" },           // OK
    { "field": "properties.info.category", "label": "Cat" },  // OK
    { "field": "category", "label": "Cat" }                   // Incorrect
] }
```

### Issue: sorting does not work

**Cause**: the column is not marked `sortable: true`.
**Solution**:

```json
{ "columns": [{ "field": "properties.name", "label": "Nom", "sortable": true }] }
```

---

## 11. See also

- **GeoJSON**: [docs/geojson/GEOJSON_LAYERS_GUIDE.md](../geojson/GEOJSON_LAYERS_GUIDE.md)
- **Filter**: [docs/API_REFERENCE.md](../API_REFERENCE.md#filter--the-filter-panel-singular)
- **UI**: [docs/ui/GeoLeaf_UI_README.md](../ui/GeoLeaf_UI_README.md)
