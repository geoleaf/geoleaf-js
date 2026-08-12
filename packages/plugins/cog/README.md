# @geoleaf-plugins/cog

GeoLeaf plugin for displaying [Cloud Optimized GeoTIFF](https://www.cogeo.org/) (COG)
raster files on a MapLibre GL map. From a single HTTP/HTTPS URL pointing to a `.tif`/`.tiff`,
the plugin reads the file's headers via HTTP Range requests, decodes the needed pixels with
[`geotiff.js`](https://geotiffjs.github.io/), and injects the result as a georeferenced
MapLibre **image** source + **raster** layer.

- **MIT** — published on npmjs.org
- Requires `@geoleaf/core` loaded before this plugin
- ESM only — no CommonJS/UMD
- No runtime configuration: the API is available on `GeoLeaf.COG` as soon as the plugin loads

---

> [!IMPORTANT]
> **Not on the registry at this version.** The GeoLeaf 3.x line is not published yet, so the
> install command below either fails with `E404` or resolves to an older release than the one
> this page describes. Measure rather than assume — no version number is copied into this page:
>
> ```bash
> npm view @geoleaf-plugins/cog version  # what the registry serves
> npm run versions:check                 # what this repository declares
> ```
>
> Until those agree, build from source.

## Installation

```bash
npm install @geoleaf-plugins/cog
```

Load in your HTML **after** `@geoleaf/core` and **before** `GeoLeaf.boot()`:

```html
<script type="module" src="node_modules/@geoleaf-plugins/cog/dist/geoleaf-cog.plugin.js"></script>
```

The core must be present and initialised first; no other plugin is required (`requires: []`).

---

## API — `GeoLeaf.COG.*`

The public API is intentionally minimal: three functions.

### `addLayer(url, map, options?)`

Loads a COG, decodes it, and adds it to the map. Returns a handle for later updates/removal.

```typescript
const handle = await GeoLeaf.COG.addLayer(
    "https://example.com/imagery.tif",
    GeoLeaf.Core.getMap().getNativeMap(),
    { opacity: 0.8 }
);

handle.id; // MapLibre source + layer id
await handle.update({ opacity: 0.4 }); // re-render with new options (reuses cached headers)
handle.remove(); // remove source + layer
```

The full pipeline runs on each `addLayer()` / `handle.update()`: validate URL → read headers
(`getCogInfo`) → select overview → fetch rasters → decode to Canvas → PNG data URL →
`addSource({ type: "image" })` + `addLayer({ type: "raster" })`. Only the `CogInfo` metadata is
cached (so `update()` does not re-fetch the file headers).

### `getInfo(url, options?)`

Reads COG metadata without downloading any pixels (TIFF headers only).

```typescript
const info = await GeoLeaf.COG.getInfo("https://example.com/imagery.tif");
// { url, bounds: [W, S, E, N], width, height, bandCount, nodata, overviewCount, epsg }
```

### `removeLayer(map, layerId)`

Removes a COG layer and its source. Safe to call even if already removed.

```typescript
GeoLeaf.COG.removeLayer(map, handle.id);
```

---

## Options (`addLayer`)

All optional — only the URL is required.

| Option     | Type                                | Default                     | Description                                         |
| ---------- | ----------------------------------- | --------------------------- | --------------------------------------------------- |
| `id`       | `string`                            | `cog-layer-{timestamp}-{n}` | Explicit source/layer id                            |
| `opacity`  | `number`                            | `1`                         | Raster opacity (0–1)                                |
| `overview` | `"auto" \| number`                  | `"auto"`                    | Overview index, or auto-select from viewport width  |
| `bands`    | `[n]` or `[r, g, b]` (**1-based**)  | first bands                 | Band selection (grayscale or RGB / false color)     |
| `colorMap` | `Array<[r, g, b, a]>` (256 entries) | grayscale                   | LUT applied to single-band rendering                |
| `nodata`   | `number`                            | value from file metadata    | Pixels equal to this value are rendered transparent |
| `maxBytes` | `number`                            | `52428800` (50 MB)          | Memory guard before fetching rasters                |
| `signal`   | `AbortSignal`                       | —                           | Cancels an in-flight load                           |

```typescript
// False-color CIR (NIR/Red/Green) on a multi-spectral COG:
await GeoLeaf.COG.addLayer(url, map, { bands: [8, 4, 3] });

// Single-band DEM with a color palette:
await GeoLeaf.COG.addLayer(url, map, { bands: [1], colorMap: my256ColorLut });
```

---

## Types

```typescript
interface CogInfo {
    url: string;
    bounds: [number, number, number, number]; // [west, south, east, north] WGS84
    width: number;
    height: number;
    bandCount: number; // 1 = grayscale, 3 = RGB, 4 = RGBA
    nodata: number | null;
    overviewCount: number;
    epsg: number | null; // e.g. 4326, 3857, 32631
}

interface CogLoadOptions {
    signal?: AbortSignal;
    maxBytes?: number; // default 52 428 800 (50 MB)
}

interface CogLayerOptions extends CogLoadOptions {
    id?: string;
    opacity?: number; // default 1
    overview?: "auto" | number; // default "auto"
    bands?: [number, number, number] | [number]; // 1-based
    colorMap?: Array<[number, number, number, number]>; // 256 RGBA entries
    nodata?: number;
}

interface CogLayerHandle {
    id: string;
    remove(): void;
    update(opts: Partial<CogLayerOptions>): Promise<void>;
}
```

---

## Constraints

- **HTTP/HTTPS only** — `file://` and relative URLs are rejected with a `TypeError`.
- **CORS required** — the COG host must send `Access-Control-Allow-Origin`; the browser blocks
  cross-origin reads otherwise.
- **Projection** — the plugin extracts the bounds and EPSG code but does **not** reproject
  pixels. Serve COGs in EPSG:4326 or EPSG:3857 for correct placement on a Web Mercator map.
- **Static image, not dynamic tiling** — the layer is a single PNG injected into MapLibre; it is
  not re-rendered on zoom. For XYZ dynamic tiling use a server (Titiler, GeoServer).
- **Overviews recommended** — internal TIFF overviews (COG/GDAL) keep loads small. A non-tiled
  GeoTIFF still works but reads the full image.
- **Memory guard** — `maxBytes` (50 MB default) caps a single raster fetch; raise it for large
  overviews or use a higher overview index.

---

## Licence

MIT — © 2026 Mattieu Pottier. See [LICENSE](./LICENSE).
