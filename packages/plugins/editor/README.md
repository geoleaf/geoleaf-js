# @geoleaf-plugins/editor

GeoLeaf plugin for **creating, editing and deleting geometries** (Point / Line / Polyline / Polygon) bound to map layers, with a responsive attribute form, a standardized component catalog, and online/offline persistence. Built on [Terra Draw](https://github.com/JamesLMilner/terra-draw) + the official MapLibre adapter.

- **MIT** — published on npmjs.org
- Requires `@geoleaf/core` loaded before this plugin
- ESM only — no CommonJS/UMD
- Optional integration with `@geoleaf-plugins/offline-ui` for **offline** write-through (IndexedDB sync queue)
- Drawing engine is **lazy-loaded** on first tool activation (kept out of the initial bundle)

---

## Installation

```bash
npm install @geoleaf-plugins/editor
```

Load in your HTML after `@geoleaf/core`:

```html
<script
    type="module"
    src="node_modules/@geoleaf-plugins/editor/dist/geoleaf-editor.plugin.js"
></script>
```

> **Deploy note** — the plugin ships as one entry file **plus lazy chunks** (`geoleaf-editor.terra-draw-*.js`, `geoleaf-editor.modes-*.js`). All `dist/*.js` files must be deployed **together in the same directory**; the entry resolves the chunks relatively at runtime. The first time a drawing tool is activated, the browser fetches the Terra Draw chunk.

---

## Quick start

Once loaded, an **"Edit"** button appears in the pill toolbar. Clicking it opens a floating vertical sub-menu (draggable, top-left by default) with:

1. **Point / Line / Polyline / Polygon** — drawing tools. Click to place vertices; `Enter` or double-click to finish.
2. **Select** — click an editable feature to select it and edit its vertices (drag, add midpoint, delete vertex).
3. **Undo / Redo** — `Ctrl+Z` / `Ctrl+Shift+Z`.
4. **Delete** — removes the selected feature (`Del`).

Finishing a geometry opens an **attribute form**: a centered modal on desktop (≥ 768 px) or a full-screen drawer on mobile, with a **target-layer dropdown** filtered to layers granting `edition.create` or `edition.update`, and a compatible geometry type.

A layer becomes editable in the profile via:

```json
{
    "id": "hebergements",
    "edition": { "create": true, "update": true },
    "editableGeometryTypes": ["Point"],
    "write": {
        "enabled": true,
        "endpoint": "https://backend.example/collections/hebergements",
        "properties": ["name", "description", "website"]
    },
    "attributes": {
        "fields": [
            {
                "field": "properties.name",
                "label": "Name",
                "primitive": "string",
                "widget": "text",
                "display": { "surfaces": ["popup"] },
                "edit": { "required": true }
            },
            {
                "field": "properties.description",
                "label": "Description",
                "primitive": "string",
                "widget": "longtext",
                "edit": {}
            },
            {
                "field": "properties.website",
                "label": "Website",
                "primitive": "string",
                "widget": "url",
                "display": { "surfaces": ["sidepanel"] },
                "edit": {}
            }
        ]
    }
}
```

The form is a **projection** of `attributes.fields[]`: a field is captured when it declares
`edit`, and only then. `widget` serves both projections; `edit.widget` overrides it where
capture and display genuinely differ — a `badge` read as a coloured pill but captured as a
`dropdown`, say.

⚠️ This block used to be a separate `formSchema` array, removed at task 7.2. It was a second
field list, parallel to `attributes.fields[]` and reconciled with it by nothing. Declaring
`edit` on any field obliges the layer to declare both `edition.update: true` and a `write`
target — rule A14, enforced by `npm run validate:profiles`.

---

## Public API — `GeoLeaf.Editor`

### `toggleMenu(anchorEl?)`

Opens or closes the floating sub-menu.

```typescript
function toggleMenu(anchorEl?: Element | null): void;
```

### `setActiveTool(tool)`

Syncs the active-tool highlight in the menu UI (or clears it when `null`). This updates the button state only; drawing is initiated through the menu/toolbar interaction flow.

```typescript
function setActiveTool(tool: "point" | "line" | "polyline" | "polygon" | "select" | null): void;
```

### `getActiveTool()`

Returns the currently armed tool identifier, or `null`.

```typescript
function getActiveTool(): string | null;
```

### `updateUndoRedoState(canUndo, canRedo)`

Updates the enabled state of the undo/redo buttons (advanced/host integration).

### `destroy()`

Tears down the plugin DOM (menu + modals) and event listeners.

```typescript
function destroy(): void;
```

---

## Configuration (`editorConfig`)

Add an `editorConfig` key to your GeoLeaf profile JSON. All fields are optional and fall back to the defaults below.

```json
{
    "editorConfig": {
        "enabled": true,
        "menuPosition": "top-right",
        "enabledTools": [
            "point",
            "line",
            "polyline",
            "polygon",
            "select",
            "undo",
            "redo",
            "delete"
        ],
        "api": {
            "baseUrl": "https://api.example.com",
            "authHeader": "Bearer <token>",
            "timeoutMs": 8000
        },
        "persistence": {
            "mode": "auto",
            "dialect": "rest",
            "conflictResolution": "prompt"
        },
        "modal": { "desktopBreakpointPx": 768, "maxWidthPx": 640 }
    }
}
```

| Field                            | Type                   | Default       | Description                                                                                                                                                                                                                                                                                           |
| -------------------------------- | ---------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`                        | boolean                | `true`        | Enables / disables the entire plugin.                                                                                                                                                                                                                                                                 |
| `showButton`                     | boolean                | `true`        | Shows the "Edit" pill toolbar button (alias `ui.showEditor`).                                                                                                                                                                                                                                         |
| `menuPosition`                   | string \| `{top,left}` | `"top-right"` | Initial anchor of the floating sub-menu: `"top-left"`, `"top-right"`, `"bottom-left"`, `"bottom-right"`, or explicit `{top,left}` pixels. Defaults to the right so the pill does not sit under the core map toolbar, which owns the top-left column.                                                  |
| `enabledTools`                   | string[]               | all 8 tools   | Subset of tools to display.                                                                                                                                                                                                                                                                           |
| `snapPx`                         | number                 | `12`          | Snap radius (px) for polygon closure on the first vertex.                                                                                                                                                                                                                                             |
| `poiSnapMeters`                  | number                 | `50`          | Duplicate-guard radius in **metres** for point capture: tapping within this ground distance of an existing feature on an editable point layer snaps onto it and reports its identity. `0` disables the guard. Not to be confused with `snapPx`, which is a drawing comfort measured in screen pixels. |
| `showExport`                     | boolean                | `true`        | Show the "export this session" toolbar button. Downloads the features created since page load as GeoJSON. Note that "session" means _until reload_: tracking is in-memory.                                                                                                                            |
| `vertexHandleSize`               | number                 | `8`           | Diameter (px) of draggable vertex handles. Clamped to [4, 24].                                                                                                                                                                                                                                        |
| `midpointHandleSize`             | number                 | `5`           | Diameter (px) of midpoint handles. Clamped to [3, 20].                                                                                                                                                                                                                                                |
| `minVerticesLineString`          | number                 | `2`           | Min vertices for a LineString (deletion blocked below).                                                                                                                                                                                                                                               |
| `minVerticesPolygon`             | number                 | `3`           | Min vertices for a Polygon.                                                                                                                                                                                                                                                                           |
| `api.baseUrl`                    | string                 | `""`          | Base URL for persistence requests.                                                                                                                                                                                                                                                                    |
| `api.authHeader`                 | string \| null         | `null`        | Optional `Authorization` header value.                                                                                                                                                                                                                                                                |
| `api.timeoutMs`                  | number                 | `8000`        | Network timeout before falling back to the offline queue.                                                                                                                                                                                                                                             |
| `api.geometryProperty`           | string                 | `"geom"`      | Geometry property key in the `"collection"` dialect.                                                                                                                                                                                                                                                  |
| `persistence.mode`               | string                 | `"auto"`      | `"auto"` (online/offline detection), `"online"`, or `"offline"`.                                                                                                                                                                                                                                      |
| `persistence.dialect`            | string                 | `"rest"`      | `"rest"` (`{feature, layerId}` envelope) or `"collection"` (flat OGC/PostgREST body, create-only).                                                                                                                                                                                                    |
| `persistence.conflictResolution` | string                 | `"prompt"`    | HTTP 409 strategy: `"client-wins"`, `"server-wins"`, `"prompt"`.                                                                                                                                                                                                                                      |
| `undoStackSize`                  | number                 | `100`         | Maximum undo/redo depth per session.                                                                                                                                                                                                                                                                  |
| `modal.desktopBreakpointPx`      | number                 | `768`         | Width threshold: ≥ value → modal; < value → drawer.                                                                                                                                                                                                                                                   |
| `modal.maxWidthPx`               | number                 | `640`         | Max width of the desktop modal.                                                                                                                                                                                                                                                                       |
| `confirmDelete`                  | boolean                | `true`        | Confirmation dialog before deleting.                                                                                                                                                                                                                                                                  |
| `confirmCancelOnDirty`           | boolean                | `true`        | Confirm when closing a modified form unsaved.                                                                                                                                                                                                                                                         |
| `defaultLayer`                   | string \| null         | `null`        | Pre-selected target layer (`null` = first compatible).                                                                                                                                                                                                                                                |
| `eventNamespace`                 | string                 | `"editor"`    | Prefix for public DOM events.                                                                                                                                                                                                                                                                         |

---

## Persistence

| Mode             | Behaviour                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `online`         | Always uses the REST adapter (`POST/PUT/DELETE` to `api.baseUrl`).                                                                                                       |
| `offline`        | Always writes through the IndexedDB sync queue (requires `@geoleaf-plugins/offline-ui`).                                                                                 |
| `auto` (default) | Detects connectivity (`navigator.onLine` + cached HEAD ping); falls back to the queue on transport failure, replays `editor.*` queued entries autonomously on reconnect. |

**REST dialect** (`dialect: "rest"`): `POST/PUT/DELETE {baseUrl}/features?layerId=…` with a `{ feature, layerId }` envelope.
**Collection dialect** (`dialect: "collection"`): `POST {baseUrl}/{layerId}` with a flat `{ ...properties, geom: geometry }` body (OGC API Features / PostgREST). Create-only at this time.

On HTTP 409, conflict resolution follows `persistence.conflictResolution`; `"prompt"` opens a merge dialog.

---

## Internationalisation

Six languages bundled (FR/EN/ES/PT/IT/DE) via `GeoLeaf.I18n`. Unknown locales fall back to French. All UI strings (tools, history, modal, sync, errors, ARIA) are translated; no hardcoded labels.

---

## AddPOI merged in — breaking, no alias

`@geoleaf-plugins/addpoi` **merged into this plugin** in v3 (Sprint 5). There is one editing plugin
now, and **`GeoLeaf.AddPOI` was removed without an alias**.

| Before                                    | Now                                       |
| ----------------------------------------- | ----------------------------------------- |
| `GeoLeaf.AddPOI.AddForm.openAddForm(ll)`  | `GeoLeaf.Editor.AddForm.openAddForm(ll)`  |
| `GeoLeaf.AddPOI.PlacementMode.activate()` | `GeoLeaf.Editor.PlacementMode.activate()` |
| `ui.showAddPoi`                           | `modules.editor.showAddPoi`               |
| `modules.addpoi.defaultPosition`          | `modules.editor.poiAddDefaultPosition`    |
| `ui.showPoiExport`                        | `modules.editor.showExport`               |

⚠️ The two `ui.showPoi*` flags are **not** carried over under those names: neither was declared in
any profile schema while `ui.schema.json` is `additionalProperties: false`, so writing them failed
profile validation — one button was permanently visible, the other permanently hidden. Their
replacements live under `modules.editor.*` and are declared.

⚠️ `ui.showAddPoi` was read by the **core**, which drew the button itself. It now belongs to the
plugin: the button is a lazy toolbar slot, declared by the host app before the bundle loads.

---

## Security notes (for integrators)

The plugin renders user data via `textContent` / DOM APIs (no `innerHTML` with user input) and whitelists URL protocols (`http`, `https`, `mailto`, `tel`) — `javascript:`/`data:` URIs are blocked. Client-side upload validation checks MIME type and size. **You must, on the server:**

- Re-validate uploaded file MIME type, size and content (reject polyglot/EXIF-injected files; prevent path traversal).
- Serve the host page with a Content-Security-Policy, e.g. `default-src 'self'; script-src 'self'; img-src 'self' data: https:;`.

⚠️ This line pointed at `_docs_projet/travail/audits/audit-securite_plugin-editor.md` « for the full
audit » until 31/07/2026. **That file has never existed under that name in this repository** — the
reference was a phantom in a published README, invisible to every gate because it sits in inline
code rather than a markdown link. The recommendations above stand on their own; the security
guidance that does exist is [`@geoleaf/core` → `docs/SECURITY.md`](../../core/docs/SECURITY.md) and
the repository policy in [`.github/SECURITY.md`](../../../.github/SECURITY.md).

---

## Bundle budget

| Part              | Size (gzip) | Loaded                           |
| ----------------- | ----------- | -------------------------------- |
| Plugin entry      | ~35 KB      | At boot                          |
| Terra Draw engine | ~45 KB      | Lazily, on first tool activation |
| Modes chunk       | ~1 KB       | Lazily, with the engine          |

`maplibre-gl` is a peer dependency (host page), excluded from the bundle. `@geoleaf/core` is external.

---

## License

MIT — © 2026 Mattieu Pottier. See [LICENSE](./LICENSE).
