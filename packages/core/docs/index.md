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

## Current version — v3.0.0

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
