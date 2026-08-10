# @geoleaf-plugins/table

GeoLeaf plugin that adds a **data table panel** to an interactive map. The user opens a bottom-sheet panel, picks a layer, browses its features as a sortable, searchable table, selects rows (the selection is highlighted on the map and can be zoomed to), and exports the chosen rows — or the whole layer — to **GeoJSON, CSV, KML, GPX or Excel (XLSX)**. All in the browser.

- **MIT License** — public registry (npmjs.org)
- Requires `@geoleaf/core` loaded before this plugin
- ESM only — no CommonJS/UMD
- **Zero runtime npm dependencies** — Excel export uses an inlined, lazily-loaded OOXML writer (no SheetJS)

> **Extracted from `@geoleaf/core`.** The data table used to be part of the core and configured via the root `tableConfig` key and the `ui.showTable` flag. It is now this plugin, configured under `modules.table.*`. See [Migration from core](#migration-from-core) — this is a breaking change.

---

## Installation

```bash
npm install @geoleaf-plugins/table
```

Load in your HTML **after** `@geoleaf/core` and **before** `GeoLeaf.boot()`:

```html
<script
    type="module"
    src="node_modules/@geoleaf-plugins/table/dist/geoleaf-table.plugin.js"
></script>
```

The plugin mounts the `GeoLeaf.Table` namespace at load and, when enabled, injects its own UI: a **"Table" tab** in the desktop panel and a **table icon** in the mobile toolbar (both gated by `modules.table.showButton`).

---

## Quick start

Enable the table in the active profile under `modules.table` (file `config/plugins/table.json`, referenced by `Files.modules.table`):

```json
{
    "enabled": true,
    "showButton": true,
    "defaultVisible": false
}
```

Per layer, declare which columns the table shows under the layer's `config.table` (this binding stays on the layer):

```json
{
    "table": {
        "enabled": true,
        "title": "Communes",
        "columns": [
            { "field": "properties.name", "label": "Name", "sortable": true },
            { "field": "properties.population", "label": "Population", "type": "number" }
        ]
    }
}
```

You can also drive the table programmatically:

```html
<script type="module">
    GeoLeaf.Table.setLayer("communes");
    GeoLeaf.Table.show();
    GeoLeaf.Table.setSelection(["feat-1", "feat-2"]);
    GeoLeaf.Table.zoomToSelection();
    GeoLeaf.Table.exportSelection("csv", { csvSeparator: ";" });

    document.addEventListener("geoleaf:table:selectionChanged", (e) => {
        console.log("selection:", e.detail);
    });
</script>
```

---

## Configuration (`modules.table.*`)

| Key                  | Type      | Default | Description                                                      |
| -------------------- | --------- | ------- | ---------------------------------------------------------------- |
| `enabled`            | `boolean` | `true`  | Mounts the module on `geoleaf:map:ready` when `true`.            |
| `showButton`         | `boolean` | `true`  | Shows the desktop tab + mobile icon (read by the core registry). |
| `defaultVisible`     | `boolean` | `false` | Opens the panel at boot.                                         |
| `pageSize`           | `number`  | `50`    | Page size (⚠️ currently inert at runtime).                       |
| `maxRowsPerLayer`    | `number`  | `1000`  | Caps the number of rendered rows.                                |
| `enableExportButton` | `boolean` | `true`  | Shows the export buttons.                                        |
| `virtualScrolling`   | `boolean` | `true`  | Renders only visible rows (⚠️ does not paginate by `pageSize`).  |
| `defaultHeight`      | `string`  | `"40%"` | Initial bottom-sheet height.                                     |
| `minHeight`          | `string`  | `"20%"` | Minimum height (resize).                                         |
| `maxHeight`          | `string`  | `"60%"` | Maximum height (resize).                                         |
| `resizable`          | `boolean` | `true`  | Allows resizing via the drag handle.                             |

**Per-layer** (`layer.config.table`, stays on the layer): `enabled`, `title`, `columns` (`field`, `label`, `width`, `sortable`, `type`), `defaultSort` (`field`, `direction`).

---

## Public API (`GeoLeaf.Table`)

| Method                               | Description                                                   |
| ------------------------------------ | ------------------------------------------------------------- |
| `show()`                             | Shows the table panel.                                        |
| `hide()`                             | Hides the panel and clears the highlight overlay.             |
| `toggle()` / `open()`                | Toggles the panel (`open` is the toolbar action entry point). |
| `setLayer(layerId)`                  | Switches the active layer (`null`/`""` clears).               |
| `refresh()`                          | Reloads the current layer's features.                         |
| `sortByField(field)`                 | Cycles the sort for a field (none → asc → desc → none).       |
| `setSelection(ids, add?)`            | Selects rows by id (replace, or append when `add`).           |
| `getSelectedIds()`                   | Returns the selected feature ids.                             |
| `clearSelection()`                   | Clears the selection.                                         |
| `zoomToSelection()`                  | Fits the map to the selected features.                        |
| `highlightSelection(active)`         | Toggles the map highlight overlay.                            |
| `exportSelection(format?, options?)` | Exports the selected rows (default `geojson`).                |
| `exportLayer(format?, options?)`     | Exports all rows of the active layer.                         |

`format`: `"geojson" \| "csv" \| "kml" \| "gpx" \| "excel"`. `options`: `{ csvSeparator?: "," \| ";", csvIncludeGeometry?: boolean }`.

---

## Events

Dispatched on `document` (bubbling), and replicated on the map when it exposes `fire`:

| Event                              | Detail                       |
| ---------------------------------- | ---------------------------- |
| `geoleaf:table:opened`             | `{}`                         |
| `geoleaf:table:closed`             | `{}`                         |
| `geoleaf:table:layerChanged`       | `{ layerId }`                |
| `geoleaf:table:sortChanged`        | `SortState`                  |
| `geoleaf:table:selectionChanged`   | `{ ids, count, … }`          |
| `geoleaf:table:zoomToSelection`    | `{ … }`                      |
| `geoleaf:table:highlightSelection` | `{ active, … }`              |
| `geoleaf:table:exportSelection`    | `{ format, count, … }`       |
| `geoleaf:table:exportLayer`        | `{ layerId, format, count }` |

---

## Migration from core

Before the extraction (`@geoleaf/core` ≤ v3), the table was part of the core: `GeoLeaf.Table` was provided by the core and configured via the **root** `tableConfig` key plus the `ui.showTable` flag. Now the core no longer ships the table — this plugin does.

**There is no compatibility shim.** To migrate:

1. Move the global `tableConfig` block out of the profile root into `config/plugins/table.json`.
2. Declare it in the profile manifest under `Files.modules.table`.
3. Replace `ui.showTable` with `modules.table.showButton`.
4. Load this plugin's script on the page, after `@geoleaf/core`.

| Before (core)                                | After (plugin)                                        |
| -------------------------------------------- | ----------------------------------------------------- |
| `tableConfig` at the profile root            | `modules.table` (`config/plugins/table.json`)         |
| `ui.showTable: true`                         | `modules.table.showButton: true`                      |
| `GeoLeaf.Config.get("tableConfig")` → object | `GeoLeaf.Config.get("tableConfig")` → **`undefined`** |
| `GeoLeaf.Table` present with the core        | requires this plugin's script after `geoleaf.esm.js`  |

> **The per-layer binding is kept.** The `layer.config.table.*` block (columns, sort, title) stays on each GeoJSON layer — `layer-config.schema.json` is unchanged. Only the **global** config (`tableConfig` + `ui.showTable`) moves to `modules.table`.

---

## Limitations

- The panel mounts on the map returned by `GeoLeaf.Core.getMap()` — one map at a time (no per-`mapId` scoping yet).
- `pageSize` / `virtualScrolling` are exposed but currently inert as paginators (the virtual renderer windows by scroll, not by `pageSize`).
- The Excel writer is **write-only** (no read, no formulas) — sufficient for tabular export.

---

## Bundle budget

| Part          | Size (gzip)               |
| ------------- | ------------------------- |
| Plugin bundle | budget 50 KB (warn 38 KB) |

No third-party runtime dependency is bundled (the OOXML writer is inlined and lazily imported). `@geoleaf/core` is accessed via `globalThis.GeoLeaf`; `maplibre-gl` is a peer dependency provided by the host page.

---

## MIT License

Copyright © 2026 Mattieu Pottier. See [LICENSE](./LICENSE) for details.
