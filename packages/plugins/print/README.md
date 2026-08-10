# @geoleaf-plugins/print

GeoLeaf plugin for exporting an interactive map at a controlled scale to a paper format (A4, A3) as a PDF or JPG file at 300 DPI, ready to print.

- **MIT License** — public registry (npmjs.org)
- Requires `@geoleaf/core` loaded before this plugin
- ESM only — no CommonJS/UMD
- jsPDF loaded lazily (~100 KB gzip) — only on PDF export

---

## Installation

```bash
npm install @geoleaf-plugins/print
```

Load in your HTML after `@geoleaf/core`:

```html
<script
    type="module"
    src="node_modules/@geoleaf-plugins/print/dist/geoleaf-print.plugin.js"
></script>
```

---

## Quick start

Once the plugin is loaded, a printer icon appears in the left toolbar. The interactive flow is:

1. **Set the scale** — zoom the map to the desired scale (read in the scale module).
2. **Click the printer icon** — activates the extent selection mode.
3. **Draw the extent** — click-drag to draw the print rectangle; release to confirm; adjust corner handles; press **Enter** or click **OK**.
4. **Configure in the modal** — the scale is locked (padlock indicator); choose the paper format (A4 / A3); tick Legend, Scale bar, North arrow; fill in title and description.
5. **Export** — click **PDF** or **JPG**; the file is downloaded.

---

## Public API

### `GeoLeaf.Print.openPrintFlow(opts?)`

Opens the interactive flow (extent selection → modal → export).

```typescript
function openPrintFlow(opts?: PrintFlowOptions): Promise<Blob | null>;

interface PrintFlowOptions {
    defaultFormat?: string; // "A4" | "A3" | … (default: from printConfig)
    includeLegend?: boolean;
    includeScale?: boolean;
    includeNorthArrow?: boolean;
    title?: string; // Pre-filled title
}
```

Resolves with the exported `Blob` when the user clicks PDF or JPG, or `null` if cancelled.

---

### `GeoLeaf.Print.captureExtent(bbox, opts)`

Re-renders the map off-screen on a geographic bounding box at high resolution.

```typescript
function captureExtent(bbox: EmpriseBbox, opts: CaptureOptions): Promise<CaptureResult>;

interface EmpriseBbox {
    minLng: number;
    minLat: number;
    maxLng: number;
    maxLat: number;
}

interface CaptureOptions {
    format?: string; // "A4" | "A3" | …
    orientation?: "portrait" | "landscape";
    dpi?: number; // default 300
    center?: [number, number]; // [lng, lat] — defaults to bbox center
    scaleDenominator?: number; // locked scale denominator
}

interface CaptureResult {
    canvas: HTMLCanvasElement;
    dataUrl: string;
    widthPx: number;
    heightPx: number;
    bbox: EmpriseBbox;
    scaleDenominator: number;
}
```

---

### `GeoLeaf.Print.captureViewport(opts?)`

Shortcut: captures an extent matching the current map viewport (A4 by default).

```typescript
function captureViewport(opts?: CaptureOptions): Promise<CaptureResult>;
```

---

### `GeoLeaf.Print.exportImage(opts)`

Composes the full page and exports as JPEG.

```typescript
function exportImage(opts: ExportOptions): Promise<Blob>;

interface ExportOptions {
    bbox?: EmpriseBbox; // explicit extent; omit to use current viewport
    format?: string; // "A4" | "A3" | …
    orientation?: "portrait" | "landscape";
    dpi?: number;
    title?: string;
    description?: string;
    includeLegend?: boolean;
    includeScale?: boolean;
    includeNorthArrow?: boolean;
    quality?: number; // JPEG quality 0–1 (default 0.92)
    filename?: string;
}
```

---

### `GeoLeaf.Print.exportPDF(opts)`

Same as `exportImage` but produces a PDF. Loads jsPDF lazily on first call.

```typescript
function exportPDF(opts: ExportOptions): Promise<Blob>;
```

---

### `GeoLeaf.Print.registerExporter(format, fn)`

Adds a custom export format (e.g. PNG). The format name appears as a button in the modal if listed in `printConfig.exportFormats`.

```typescript
function registerExporter(format: string, fn: ExporterFn): void;

type ExporterFn = (canvas: HTMLCanvasElement, opts: ComposedExportOpts) => Promise<Blob>;

// Example: add PNG export
GeoLeaf.Print.registerExporter("png", async (canvas) => {
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
});
```

---

### `GeoLeaf.Print.registerPageFormat(name, def)`

Adds a custom paper format (e.g. A2, A1, A0, Letter).

```typescript
function registerPageFormat(name: string, def: PageFormatDef): void;

interface PageFormatDef {
    widthMm: number; // short side (portrait)
    heightMm: number; // long side (portrait)
    defaultMargins?: { top: number; right: number; bottom: number; left: number };
    computeZones(orientation: "portrait" | "landscape", opts: ZoneOptions): PageZones;
}

// Example: add A2
GeoLeaf.Print.registerPageFormat("A2", {
    widthMm: 420,
    heightMm: 594,
    computeZones(orientation, opts) {
        /* … */
    },
});
```

---

## Configuration (`printConfig`)

Add a `printConfig` key to your GeoLeaf profile JSON. All fields are optional.

```json
{
    "printConfig": {
        "enabled": true,
        "showButton": true,
        "defaultFormat": "A4",
        "availableFormats": ["A4", "A3"],
        "dpi": 300,
        "margins": { "top": 10, "right": 10, "bottom": 10, "left": 10 },
        "includeLegend": false,
        "includeScale": true,
        "includeNorthArrow": true,
        "exportFormats": ["pdf", "jpg"],
        "jpgQuality": 0.92
    }
}
```

| Field                         | Type     | Default              | Description                                                                                                                                                                 |
| ----------------------------- | -------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`                     | boolean  | `true`               | Enables / disables the plugin entirely. When `false`, the toolbar button and event listener are not registered; the programmatic API (`GeoLeaf.Print.*`) remains available. |
| `showButton` / `ui.showPrint` | boolean  | `true`               | Shows / hides the printer button in the left toolbar.                                                                                                                       |
| `position`                    | string   | `"left"`             | Toolbar position (future use).                                                                                                                                              |
| `defaultFormat`               | string   | `"A4"`               | Paper format pre-selected in the modal.                                                                                                                                     |
| `availableFormats`            | string[] | `["A4","A3"]`        | Formats shown in the modal drop-down. Add custom formats via `registerPageFormat`.                                                                                          |
| `dpi`                         | number   | `300`                | Print resolution in dots per inch.                                                                                                                                          |
| `availableDpi`                | number[] | `[300]`              | List of selectable DPI values. A single value hides the DPI selector.                                                                                                       |
| `margins`                     | object   | `10 mm` on all sides | Page margins in mm — `{ top, right, bottom, left }`.                                                                                                                        |
| `includeLegend`               | boolean  | `false`              | Default state of the Legend checkbox.                                                                                                                                       |
| `includeScale`                | boolean  | `true`               | Default state of the Scale bar checkbox.                                                                                                                                    |
| `includeNorthArrow`           | boolean  | `true`               | Default state of the North arrow checkbox.                                                                                                                                  |
| `includeAnnotations`          | boolean  | `true`               | Default state of the Annotations checkbox (only shown when `@geoleaf-plugins/measure` is loaded).                                                                           |
| `title`                       | string   | `""`                 | Pre-filled title in the modal.                                                                                                                                              |
| `exportFormats`               | string[] | `["pdf","jpg"]`      | Export buttons shown in the modal, in order. Add custom formats via `registerExporter`.                                                                                     |
| `jpgQuality`                  | number   | `0.92`               | JPEG quality passed to `canvas.toBlob` (0–1).                                                                                                                               |
| `serverEndpoint`              | string   | —                    | URL of the optional server-side render fallback. Disabled by default.                                                                                                       |
| `serverHeaders`               | object   | `{}`                 | Static HTTP headers added to server fallback requests (e.g. API keys).                                                                                                      |
| `forceServer`                 | boolean  | `false`              | Always use the server fallback, bypassing client-side capture.                                                                                                              |
| `maxCanvasPxMobile`           | number   | `16 000 000`         | Maximum canvas pixel count on mobile. The DPI is automatically reduced to stay within this limit.                                                                           |

---

## Paper formats

| Format | Dimensions (portrait) |
| ------ | --------------------- |
| A4     | 210 × 297 mm          |
| A3     | 297 × 420 mm          |

Add A2, A1, A0 or custom sizes via `GeoLeaf.Print.registerPageFormat(name, def)` — they appear in the modal drop-down when added to `availableFormats`.

---

## DPI

The default is **300 DPI** (print-quality standard). Other values (150 draft, 600 poster) can be added via `availableDpi`. On mobile, the DPI is automatically capped to keep canvas area below `maxCanvasPxMobile`.

---

## CORS requirements

The off-screen re-render reads the map canvas (`toDataURL` / `toBlob`). If a tile source does not send proper CORS headers (`Access-Control-Allow-Origin`), the canvas becomes **tainted** and client-side export fails.

**Validated providers (Sprint 1 POC — desktop Chrome):**

| Provider        | Status        | Render time (A4 landscape) |
| --------------- | ------------- | -------------------------- |
| OSM Raster      | ✅ CORS-clean | ~627 ms                    |
| Stadia Maps     | ✅ CORS-clean | ~850 ms                    |
| IGN WMTS (topo) | ✅ CORS-clean | ~3 361 ms                  |
| Jawg Maps       | ✅ CORS-clean | ~900 ms                    |
| Thunderforest   | ✅ CORS-clean | ~1 100 ms                  |

If your tile source does not support CORS, configure `serverEndpoint` or switch to a CORS-compatible provider.

---

## Server-side render fallback (optional)

The plugin automatically falls back to the server if the client canvas is tainted (CORS issue) or if `forceServer: true`.

### Client-side protocol

The plugin POSTs the following JSON payload to `printConfig.serverEndpoint`:

```json
{
    "style": { "…": "MapLibre style object" },
    "center": [2.35, 48.85],
    "zoom": 14.2,
    "bearing": 0,
    "pitch": 0,
    "bbox": { "minLng": 2.33, "minLat": 48.83, "maxLng": 2.37, "maxLat": 48.87 },
    "page": {
        "format": "A4",
        "orientation": "landscape",
        "dpi": 300,
        "margins": { "top": 10, "right": 10, "bottom": 10, "left": 10 }
    },
    "compose": {
        "title": "My map",
        "description": "",
        "includeLegend": true,
        "includeScale": true,
        "includeNorthArrow": true
    },
    "outputFormat": "pdf"
}
```

Expected response: the binary (`application/pdf` or `image/*`) directly in the response body, or `{ "url": "https://…" }` for deferred download.

> **The actual server-side rendering service is the integrator's responsibility.** The plugin only handles the client side (request, response, download).

### Minimal stub endpoint (Node.js — smoke-test only)

```js
// server-stub.mjs — returns a static PDF for smoke-testing the client path
import { createServer } from "http";
import { readFileSync } from "fs";

const PDF = readFileSync("./sample.pdf"); // any valid PDF file

createServer((req, res) => {
    if (req.method === "POST") {
        res.writeHead(200, { "Content-Type": "application/pdf" });
        res.end(PDF);
    } else {
        res.writeHead(405).end();
    }
}).listen(3001, () => console.log("Stub server on :3001"));
```

Set `serverEndpoint: "http://localhost:3001"` in `printConfig` for local smoke testing.

---

## Mobile behaviour

The plugin targets **desktop-first**. Mobile is best-effort:

- **Canvas size cap** — iOS limits canvas area to ~16 Mpx. A3 @ 300 DPI = 17.4 Mpx exceeds this limit. The plugin automatically reduces DPI (to ~240 DPI for A3) to stay within `maxCanvasPxMobile`.
- **File download** — uses `navigator.share({ files })` (Web Share API) on iOS/Android where `<a download>` is restricted. Requires a user gesture and HTTPS.
- **UI** — the click-drag extent selector and modal are optimised for desktop; touch input is best-effort.

---

## Bundle budget

| Part         | Size (gzip)                                       |
| ------------ | ------------------------------------------------- |
| Plugin core  | ~20 KB                                            |
| jsPDF (lazy) | ~100 KB — loaded only when the user exports a PDF |

jsPDF is never loaded if the user only exports JPG or uses the server fallback.

---

## Extensibility

| Extension point                                   | API                                           |
| ------------------------------------------------- | --------------------------------------------- |
| Custom export format (PNG, WebP…)                 | `GeoLeaf.Print.registerExporter(format, fn)`  |
| Custom paper size (A2, A1, Letter…)               | `GeoLeaf.Print.registerPageFormat(name, def)` |
| Custom composition slot (cartouche, extra fields) | `GeoLeaf.Print.registerSlot(slot)`            |
