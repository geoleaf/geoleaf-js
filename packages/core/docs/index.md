---
layout: home

hero:
    name: "GeoLeaf"
    text: "Mapping library for the web"
    tagline: Cartes interactives configurables via profils JSON — construite sur MapLibre GL JS.
    actions:
        - theme: brand
          text: Démarrage rapide
          link: /GETTING_STARTED
        - theme: alt
          text: API Reference
          link: /API_REFERENCE
        - theme: alt
          text: geoleaf.dev
          link: https://geoleaf.dev

features:
    - title: Configurable par JSON
      details: Couches GeoJSON, styles, thèmes, taxonomie POI — tout se configure via des profils JSON sans écrire de code.
    - title: WebGL & Vector Tiles
      details: Moteur MapLibre GL JS v6 — rendu WebGL, tuiles vectorielles natives, clustering GPU.
    - title: Sécurité intégrée
      details: Protection XSS, sanitisation DOM, CSP-ready — sécurisé par défaut pour les déploiements en production.
    - title: TypeScript strict
      details: Types complets, TSDoc sur les façades publiques, compatible ESM-only.
    - title: Chargement à la demande
      details: Le core est chargé au démarrage ; les plugins s'ajoutent à la carte, un par besoin.
    - title: MIT — npm public
      details: "@geoleaf/core est MIT, publié sur npmjs.org. Les plugins @geoleaf-plugins/* le sont aussi."
---

## Version courante — v3.0.0

Ajout de trois nouveaux plugins MIT : `@geoleaf-plugins/file-import`, `@geoleaf-plugins/flatgeobuf`, `@geoleaf-plugins/cog`.

**Changements v3.0.0 :**

- **Nouveau** — `@geoleaf-plugins/file-import` (MIT) — import GeoJSON, KML, GPX, CSV depuis le navigateur
- **Nouveau** — `@geoleaf-plugins/flatgeobuf` (MIT) — lecture streaming de fichiers FlatGeobuf
- **Nouveau** — `@geoleaf-plugins/cog` (MIT) — rendu Cloud Optimized GeoTIFF natif WebGL

---

## Release v2.0.0 <Badge type="tip" text="2026-03-22" />

Migration majeure du moteur de rendu : **Leaflet → MapLibre GL JS v5**. Rendu WebGL, GPU clustering natif, ESM-only.

**Changements clés :**

- **Breaking** — peer dependency `leaflet` → `maplibre-gl@^6.0.0`, coordonnées `[lat,lng]` → `[lng,lat]`, scope `geoleaf` → `@geoleaf/core`
- **Nouveau** — `@geoleaf-plugins/connector` v1.0.0 (MIT) — intercepteur fetch universel pour sources géospatiales authentifiées
- **Supprimé** — bundle UMD, distribution ESM-only uniquement
- **Tests** — migration Jest → Vitest 3, 8 317 tests, couverture branches 77,97 %

[Notes de release complètes →](releases/PATCHNOTE_V2.0.0) · [Changelog →](CHANGELOG)
