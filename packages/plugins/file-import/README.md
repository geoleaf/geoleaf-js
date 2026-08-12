# @geoleaf-plugins/file-import

GeoLeaf plugin that converts common geospatial file formats — **GPX, KML, KMZ, CSV, TSV, TopoJSON** — to GeoJSON entirely in the browser, with an optional helper to add the result as a map layer. No server, no SIG software.

- **MIT License** — public registry (npmjs.org)
- Requires `@geoleaf/core` loaded before this plugin
- ESM only — no CommonJS/UMD
- **No runtime configuration** (Plugin Contract v1, INV-CONFIG without object)

---

> [!IMPORTANT]
> **Not on the registry at this version.** The GeoLeaf 3.x line is not published yet, so the
> install command below either fails with `E404` or resolves to an older release than the one
> this page describes. Measure rather than assume — no version number is copied into this page:
>
> ```bash
> npm view @geoleaf-plugins/file-import version  # what the registry serves
> npm run versions:check                         # what this repository declares
> ```
>
> Until those agree, build from source.

## Installation

```bash
npm install @geoleaf-plugins/file-import
```

Load in your HTML **after** `@geoleaf/core` and **before** `GeoLeaf.boot()`:

```html
<script
    type="module"
    src="node_modules/@geoleaf-plugins/file-import/dist/geoleaf-file-import.plugin.js"
></script>
```

The plugin is **API-only**: it mounts the `GeoLeaf.FileImport` namespace at load and exposes no UI. The host application provides the file picker (an `<input type="file">` or a drag-and-drop zone) and calls the API.

---

## Quick start

```html
<input type="file" id="import" accept=".gpx,.kml,.kmz,.csv,.tsv,.topojson" />
<script type="module">
    document.getElementById("import").addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Parcours 1 — convert and add as a map layer
        await GeoLeaf.FileImport.importAsLayer(file, { layerName: file.name });

        // Parcours 2 — convert only, handle the GeoJSON yourself
        const { data, warnings } = await GeoLeaf.FileImport.convert(file);
        console.log(`${data.features.length} features`, warnings);
    });
</script>
```

---

## Supported formats

| Extension   | Format                               | Library            | Geometry produced                               |
| ----------- | ------------------------------------ | ------------------ | ----------------------------------------------- |
| `.gpx`      | GPS Exchange Format (GPX 1.0/1.1)    | native `DOMParser` | Points (waypoints), LineStrings (tracks/routes) |
| `.kml`      | Keyhole Markup Language (KML 2.2)    | `@tmcw/togeojson`  | Points, LineStrings, Polygons                   |
| `.kmz`      | Zipped KML (ZIP containing a `.kml`) | `fflate` + KML     | Same as KML                                     |
| `.csv`      | Comma- (or auto-delimiter) separated | `papaparse`        | Points (lat/lng columns or WKT `POINT`)         |
| `.tsv`      | Tab-separated values                 | `papaparse`        | Points                                          |
| `.topojson` | TopoJSON (shared topology)           | `topojson-client`  | Points, LineStrings, Polygons                   |

- Format detection is **by file extension** (case-insensitive) — there is no content sniffing.
- Conversion is **resilient**: non-fatal issues produce `warnings` without aborting. If **zero** features are extracted, `importAsLayer()` throws rather than adding an empty layer.
- **KMZ size limit**: 50 MB once decompressed (zip-bomb protection); beyond that the archive is rejected with a warning.

---

## Public API (`GeoLeaf.FileImport`)

### `convert(file)`

Detects the format by extension and converts the file to GeoJSON. Never rejects — returns an empty `FeatureCollection` with `warnings` on an unsupported/empty file.

```typescript
function convert(file: File): Promise<{
    data: GeoJSON.FeatureCollection;
    warnings: string[];
}>;
```

### `importAsLayer(file, options?)`

Converts the file (via `convert`) then renders it on the map through the core map adapter (`GeoLeaf.Core.getMap().addGeoJSONLayer`): a GeoJSON source and fill/line/circle sub-layers are created. Returns the layer id (auto-generated when `layerId` is omitted). Throws if no feature is extracted or if the map adapter is unavailable. See [Limitations](#limitations).

```typescript
interface ImportLayerOptions {
    layerId?: string; // auto-generated if omitted
    layerName?: string; // defaults to the file name
    visible?: boolean; // default true
    cluster?: boolean; // default false
}

function importAsLayer(file: File, options?: ImportLayerOptions): Promise<string>;
```

### `getSupportedFormats()`

Returns the registered extensions (native + custom).

```typescript
function getSupportedFormats(): string[]; // e.g. [".gpx", ".kml", ".kmz", ".csv", ".tsv", ".topojson"]
```

### `registerConverter(ext, converter)`

Registers a custom converter for an extension (e.g. `.shp`). The extension is normalised to lowercase and replaces any existing handler.

```typescript
interface IFileConverter {
    readonly formatName: string;
    convert(
        input: string | ArrayBuffer
    ):
        | { data: GeoJSON.FeatureCollection; warnings: string[] }
        | Promise<{ data: GeoJSON.FeatureCollection; warnings: string[] }>;
}

function registerConverter(ext: string, converter: IFileConverter): void;
```

---

## Limitations

- **`importAsLayer()` renders on the map but is not added to the layer-manager panel.** It draws the converted GeoJSON via the core map adapter (`GeoLeaf.Core.getMap().addGeoJSONLayer`) — a source plus fill/line/circle sub-layers — but does not register the layer in the layer-manager UI (that registration is core-internal). Use `convert()` if you need the layer listed/toggleable there and add it through your own pipeline.
- **CSV/TSV** produce **Point** geometries only — from `lat`/`lng` (or `x`/`y`) columns, or a WKT column restricted to `POINT(...)`.
- **KMZ** reads the first `.kml` entry of the archive; embedded raster overlays (`GroundOverlay`) are not vectorised (a warning is emitted).

---

## Bundle budget

| Part          | Size (gzip)           |
| ------------- | --------------------- |
| Plugin bundle | ~26 KB (budget 55 KB) |

`@tmcw/togeojson`, `papaparse`, `topojson-client` and `fflate` are bundled inline. `maplibre-gl` is a peer dependency provided by the host page.

---

## MIT License

Copyright © 2026 Mattieu Pottier. See [LICENSE](LICENSE) for details.
