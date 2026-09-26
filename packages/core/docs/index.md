---
layout: home

hero:
    name: "GeoLeaf"
    text: "Mapping library for the web"
    tagline: Interactive maps configured through JSON profiles — built on MapLibre GL JS.
    actions:
        - theme: brand
          text: Get started
          link: /GETTING_STARTED
        - theme: alt
          text: API Reference
          link: /API_REFERENCE
        - theme: alt
          text: geoleaf.dev
          link: https://geoleaf.dev

features:
    - title: Configured in JSON
      details: GeoJSON layers, styles, themes, POI taxonomy — everything is configured through JSON profiles, with no code to write.
    - title: WebGL & vector tiles
      details: MapLibre GL JS v6 engine — WebGL rendering, native vector tiles, GPU clustering.
    - title: Security built in
      details: XSS protection, DOM sanitisation, CSP-ready — safe by default for production deployments.
    - title: Strict TypeScript
      details: Complete types, TSDoc on the public facades, ESM-only.
    - title: Load on demand
      details: The core loads at startup; plugins are added to the map one at a time, as needed.
    - title: MIT licensed
      details: "@geoleaf/core and the @geoleaf-plugins/* packages are all MIT licensed."
---

## Release v3.10.4 <Badge type="tip" text="2026-09-26" />

The filter reaches line layers, and a vector-tile layer draws the labels it declares.

**Highlights:**

- **Fixed** — a filter field without `layers` now filters line layers too; they used to stay drawn
  under any search. To keep a layer out of a field, list the layers that field targets in its
  `layers`. `GeoLeaf.Layers.setVisibleSubset()` now works on a line layer.
- **Fixed** — the filter panel filters every loaded layer in one pass, so a layer of any declared
  kind is reached; `geoleaf:filter:apply` is emitted once per application.
- **Fixed** — a vector-tile layer's labels name their source-layer and are drawn; a vector-tile layer
  created through `GeoLeaf.Layers.create()` arms the labels it declares.
- **Documented** — a vector-tile layer is not filtered by the filter panel: it keeps no feature in
  memory.

Release v3.10.3 (2026-09-25) — destroying a set-aside field capture no longer leaves its entity on
the map, and the documentation says what the code does:

- **Fixed** — destroying a quarantined capture (`GeoLeaf.Storage.discardQuarantined`) returns its
  entity to the server's truth: the local record is removed when the server has nothing to give
  back, and marked for replacement by the next pull otherwise. It used to stay on the device, drawn
  on every load by layers that read the device first.
- **Fixed** — documentation that contradicted the code: `Storage.clearAll()`, `GeoLeaf.init()`'s
  accepted keys, the 401/403 session rule, the requeueable quarantine motives, and
  `ServerDeletionPolicy`.
- **Fixed** — two dead CSS rules of the feature-info side panel removed; nothing changes on screen.
  `@geoleaf-plugins/geocoding` 1.1.1 carries a corrected source comment.

Release v3.10.2 (2026-09-25) — a `layers.json` entry keeps the promises its schema makes: its
`label` renames the layer, and the two keys that did nothing are gone:

- **Fixed** — an entry's `label` now overrides the label of the layer config its `configFile`
  points to; the loader used to drop it.
- **Fixed** — `layers.schema.json` no longer accepts `order` or `defaultVisible` on an entry. No
  code read either: a layer manager section lists its layers by descending `zIndex`, and visibility
  at load follows the theme. The schema is not part of the npm package; a running map is
  unaffected.

Release v3.10.1 (2026-09-25) — two fixes for a host that embeds the map: loading the bundle no
longer touches the page, and a value set with `Config.set` before anything reads the configuration
is kept:

- **Fixed** — loading the bundle wrote `<html lang>`, before a host could set
  `ui.syncDocumentLang: false`: the layer manager's title and the branding's default text were
  translated when their module was imported. They are now translated when their control is built,
  so they follow the profile's `ui.language` and `labels`. The boot alone fixes the language and
  writes the attribute.
- **Fixed** — `GeoLeaf.Config.set` dropped a value set before anything had read the configuration.
- **Documented** — the active profile replaces each top-level section it carries, `ui` included: a
  host overrides a profile value, such as `ui.language`, from the `beforeBoot` hook.

Release v3.10.0 (2026-09-25) — a feature is found by its reference with no network, a form's option
lists work off-network, the device says before going off-network whether it can leave, and layers
placed outside the adapter survive a basemap switch:

- **New** — `GeoLeaf.Layers.search(query)` finds features by reference in the layers declaring
  `searchable: { fields }`, from what the map holds; `GeoLeaf.Layers.focus(layerId, id)` frames one
  and selects it — the `selected` state is now painted. `@geoleaf-plugins/geocoding` 1.1.0 exposes
  it as the `layers` provider; given a list of providers, it skips the network ones off-network.
- **New** — `GeoLeaf.Storage.resolveOptions(url)`: a dropdown's `fetchOptions` list is kept on the
  device by the offline preparation and by any form opened online (`@geoleaf/field-renderer` 1.3.0,
  `setOptionsResolver`; wired by `@geoleaf-plugins/editor`).
- **New** — `GeoLeaf.Storage.preflight()`: whether the browser keeps the data, each layer that
  declares something to pull and whether it is on the device, what the last preparation left out,
  and a verdict. `@geoleaf-plugins/offline-ui` 1.6.0 shows it in the offline window.
- **New** — `IMapAdapter.declareOwnedStyleIds`: sources and layers a plugin places on the engine
  cross a basemap switch that replaces the style (`@geoleaf-plugins/measure` 1.0.6,
  `@geoleaf-plugins/cog` 1.0.4, `@geoleaf-plugins/editor` 1.5.1).
- **Deprecated** — `@geoleaf-plugins/geocoding`: an unknown single `provider` value now warns, and
  will be refused by the next minor release.

Release v3.9.0 (2026-09-24) — a layer can stay out of the layer manager, a vector basemap applied
at startup keeps the layers created while its style downloads, and a host can unmount the map during
its boot.

Release v3.8.0 (2026-09-23) — the filter says which category a checked sub-category belongs to,
and a selected shape in the editor moves when it is pressed near an edge.

Release v3.7.0 (2026-09-23) — a host sets the GeoJSON worker's URL, a layer declares its labels
itself, a failed worker no longer fails a page's first layers, and the editor loads its drawing
engine on the first tool use.

Release v3.6.1 (2026-09-22) — three fixes to the camera and the basemap, all three visible on a
3D basemap: it no longer waits for the user's first gesture to apply, it reaches the tilt it asks
for, and re-framing the map keeps the angle instead of flattening it.

Release v3.6.0 (2026-09-20) — three seams a host application was missing: the map stops claiming
the page's language, and the authority behind a layer's visibility — plus the style it wears —
can now be read, not guessed:

- **New** — `ui.syncDocumentLang` lets a host keep its own `<html lang>`. The attribute is
  page-wide, so a map embedded in a form used to rewrite the locale of everything around it.
  Defaults to `true`: a standalone application behaves exactly as before, and opting out
  suppresses only the write — the map still resolves its language normally.
- **New** — `Layers.getVisibilitySource(id)` names _which_ authority last set a layer's
  visibility (`"user"`, `"theme"`, `"zoom"`, `"system"`). `isUserOverridden` only answers "not
  the user", which leaves a theme indistinguishable from a zoom threshold. The same value
  already travelled on the `geoleaf:layer:toggle` event; this is the pull route, for code that
  mounted after the change.
- **New** — `Layers.getStyle(id)` returns which style a layer wears, as `{ id, label }`. A
  normalised projection rather than the raw entry: the underlying field has two shapes depending
  on which writer spoke last, and only these two survive both.

Release v3.5.0 (2026-09-19) — a second download converges on its source instead of rewriting
everything, and « Stop » stops the whole download, entities included:

- **New** — a second pull rewrites only what changed (`unchanged`), and an entity deleted on the
  server leaves the device (`removed`). A layer can declare freshness and deletions —
  `offline.source.delta` — and then only asks for what changed.
- **New** — the download window's zone bounds the entity pull, not only the tiles: its extent
  leaves with every pull as the OGC `bbox`.
- **New** — the server contract page: what GeoLeaf asks of a server to pull, write and renew a
  session, in one place.
- **Fixed** — a photo written back after the fact no longer erases the entity that owns it.
- **Fixed** — « Stop » reaches the entity pull, and its confirmation is clickable.

Release v3.4.0 (2026-09-19) — the failure screen, the log export and the conflict store:

- **New** — `geoleaf:boot:failed` names why a boot could not complete, and the app shell's loading
  veil becomes a failure screen with a **Reload** button and a diagnostic to copy. A watchdog,
  `GeoLeaf.boot({ watchdogMs })`, catches a boot that stops progressing.
- **New** — `GeoLeaf.Log.getEntries()` and `GeoLeaf.Log.exportDiagnostic()`: the latest log
  entries, redacted when read.
- **New** — a settled offline write conflict keeps the server version it overwrote, readable
  through `Storage.listConflicts()` and purgeable through `Storage.clearConflicts()`.
- **Changed** — the offline preparation no longer downloads tiles from an undeclared third-party
  origin. An origin whose terms allow it is declared in `modules.offline.dataOrigins`, with
  `cacheable: true` and `prefetch: true`.
- **Changed** — the basemap credit is displayed.
- **Removed (breaking)** — `GeoLeaf.Security.CSRFToken` and the `csrf` write authentication.
- **Fixed** — GeoLeaf no longer unregisters service workers it did not register.

Releases v3.1.0 (2026-09-01), v3.2.0 (2026-09-08) and v3.3.0 (2026-09-09) are described in the
[changelog](CHANGELOG).

---

## Release v3.0.0 <Badge type="tip" text="2026-08-12" />

Three new MIT plugins: `@geoleaf-plugins/file-import`, `@geoleaf-plugins/flatgeobuf`,
`@geoleaf-plugins/cog`.

**What changed in v3.0.0:**

- **New** — `@geoleaf-plugins/file-import` (MIT) — import GeoJSON, KML, GPX and CSV from the browser
- **New** — `@geoleaf-plugins/flatgeobuf` (MIT) — streaming reader for FlatGeobuf files
- **New** — `@geoleaf-plugins/cog` (MIT) — native WebGL rendering of Cloud Optimized GeoTIFF

---

## Release v2.0.0 <Badge type="tip" text="2026-03-22" />

A major rendering engine migration: **Leaflet → MapLibre GL JS v5**. WebGL rendering, native GPU
clustering, ESM-only.

**Key changes:**

- **Breaking** — peer dependency `leaflet` → `maplibre-gl`, coordinates `[lat,lng]` → `[lng,lat]`,
  scope `geoleaf` → `@geoleaf/core`
- **New** — `@geoleaf-plugins/connector` v1.0.0 (MIT) — a universal fetch interceptor for
  authenticated geospatial sources
- **Removed** — the UMD bundle; distribution is ESM-only
- **Tests** — Jest → Vitest 3 migration, 8,317 tests, 77.97% branch coverage

[Full release notes →](releases/PATCHNOTE_V2.0.0) · [Changelog →](CHANGELOG)
