---
title: "GeoLeaf Core — Documentation Index"
---

# GeoLeaf Core — Documentation Index

**Package:** `@geoleaf/core`
**Version:** 3.0.0
**License:** MIT

Documentation for the **GeoLeaf Core** library (MIT only). This index covers the public core package only. Each plugin ships its own documentation in its npm package. For available plugins, visit [geoleaf.dev](https://geoleaf.dev).

---

## Quick links

| Document                                                | Description                                               |
| ------------------------------------------------------- | --------------------------------------------------------- |
| [Getting Started](GETTING_STARTED.md)                   | Installation and first map — v3.0.0                       |
| [Quickstart Tutorial](QUICKSTART_TUTORIAL.md)           | End-to-end project (store locator) — v3.0.0               |
| [User Guide](USER_GUIDE.md)                             | Complete feature documentation — v3.0.0                   |
| [Configuration Guide](CONFIGURATION_GUIDE.md)           | JSON configuration reference — v3.0.0                     |
| [API Reference](API_REFERENCE.md)                       | Public API — facades & ESM exports — v3.0.0               |
| [Architecture Guide](ARCHITECTURE_GUIDE.md)             | Design, boot sequence, modules — v3.0.0                   |
| [Plugin Development Guide](PLUGIN_DEVELOPMENT_GUIDE.md) | Build a custom plugin — v3.0.0                            |
| [Core Extension Guide](CORE_EXTENSION_GUIDE.md)         | Add an internal core module (MIT fork) — v3.0.0           |
| Connector Guide → shipped by the plugin                 | HTTP authentication (@geoleaf-plugins/connector) — v3.0.0 |
| [Contributing](CONTRIBUTING.md)                         | Contribution guidelines — v3.0.0                          |

---

## User & configuration

- [Getting Started](GETTING_STARTED.md) — Installation, two initialization modes, first steps — v3.0.0
- [Quickstart Tutorial](QUICKSTART_TUTORIAL.md) — Complete end-to-end project with a profile — v3.0.0
- [User Guide](USER_GUIDE.md) — Features and usage — v3.0.0
- [Configuration Guide](CONFIGURATION_GUIDE.md) — Profile and layer configuration — v3.0.0
- [Profiles Guide](PROFILES_GUIDE.md) — Custom business profiles — v3.0.0
- [Profile JSON Reference](PROFILE_JSON_REFERENCE.md) — Schema and fields (120+ parameters) — v3.0.0
- [Plugin Configuration Guide](PLUGIN_CONFIGURATION_GUIDE.md) — Plugin-related profile keys (storage, addpoi) — v3.0.0
- [CDN / ESM usage](usage-cdn.md) — NPM and CDN integration — v3.0.0
- [FAQ](FAQ.md) — Common questions and troubleshooting — v3.0.0
- [Cookbook](COOKBOOK.md) — Practical recipes — v3.0.0
- [Accessibility](ACCESSIBILITY.md) — RGAA 4.1 compliance — v3.0.0
- [PWA](pwa.md) — Progressive Web App: configuration, deployment, install prompt

---

## Developer

- [Architecture Guide](ARCHITECTURE_GUIDE.md) — Boot sequence, in-core capabilities, plugin registry — v3.0.0
- [Plugin Development Guide](PLUGIN_DEVELOPMENT_GUIDE.md) — Build a custom plugin (ESM pattern, globalThis bridge, PluginRegistry) — v3.0.0
- [Core Extension Guide](CORE_EXTENSION_GUIDE.md) — Add a new internal module to a forked core (boot sequence, ICoreModule, facades) — v3.0.0
- Connector Guide — Transparent HTTP authentication with @geoleaf-plugins/connector (MIT) — v3.0.0. **The guide is not part of this package**: it ships with the plugin package, at `docs/CONNECTOR_GUIDE.md` (repository: `packages/plugins/connector/docs/CONNECTOR_GUIDE.md`)
- [Contributing](CONTRIBUTING.md) — Monorepo workflow, conventions, TSDoc — v3.0.0
- [Versioning Policy](VERSIONING_POLICY.md) — SemVer policy — v3.0.0
- [Performance Metrics](PERFORMANCE_METRICS.md) — Runtime metrics — v3.0.0

---

## API reference

- **[API Reference](API_REFERENCE.md)** — 27 named ESM exports + public facades + global namespace — v3.0.0
- **[Events API](EVENTS_API.md)** — Event bus, event types — v3.0.0
- **[Notifications API](notifications/NOTIFICATIONS_API.md)** — Notification system API — v3.0.0
- **TypeDoc (generated)** — Run `npm run docs:api` in `packages/core` to generate locally at `packages/core/docs/api/`

---

## Module documentation

### Core modules

| Module                | README                                                                                       | Version |
| --------------------- | -------------------------------------------------------------------------------------------- | ------- |
| Core                  | [core/GeoLeaf_core_README.md](core/GeoLeaf_core_README.md)                                   | v3.0.0  |
| Layers (feature data) | [API_REFERENCE.md](API_REFERENCE.md#layers--feature-data)                                    | v3.0.0  |
| GeoJSON Layers        | [geojson/GEOJSON_LAYERS_GUIDE.md](geojson/GEOJSON_LAYERS_GUIDE.md)                           | v3.0.0  |
| MVT / Vector Tiles    | [geojson/MVT_GUIDE.md](geojson/MVT_GUIDE.md)                                                 | v3.0.0  |
| UI                    | [ui/GeoLeaf_UI_README.md](ui/GeoLeaf_UI_README.md)                                           | v3.0.0  |
| UI Controls           | [ui/GeoLeaf_UI_Controls_README.md](ui/GeoLeaf_UI_Controls_README.md)                         | v3.0.0  |
| UI Components         | [ui/GeoLeaf_UI_Components_README.md](ui/GeoLeaf_UI_Components_README.md)                     | v3.0.0  |
| Cache Button          | [ui/cache-button.md](ui/cache-button.md)                                                     | v3.0.0  |
| Breakpoints           | [ui/BREAKPOINTS.md](ui/BREAKPOINTS.md)                                                       | v3.0.0  |
| Permalink             | [ui/PERMALINK.md](ui/PERMALINK.md)                                                           | v3.0.0  |
| Table                 | [table/GeoLeaf_Table_README.md](table/GeoLeaf_Table_README.md)                               | v3.0.0  |
| Legend                | [legend/GeoLeaf_Legend_README.md](legend/GeoLeaf_Legend_README.md)                           | v3.0.0  |
| LayerManager          | [layer-manager/GeoLeaf_LayerManager_README.md](layer-manager/GeoLeaf_LayerManager_README.md) | v3.0.0  |
| Baselayers            | [baselayers/GeoLeaf_Baselayers_README.md](baselayers/GeoLeaf_Baselayers_README.md)           | v3.0.0  |
| Labels                | [labels/GeoLeaf_Labels_README.md](labels/GeoLeaf_Labels_README.md)                           | v3.0.0  |
| Label Button Manager  | [labels/LABEL_BUTTON_MANAGER.md](labels/LABEL_BUTTON_MANAGER.md)                             | v3.0.0  |
| Config                | [config/GeoLeaf_Config_README.md](config/GeoLeaf_Config_README.md)                           | v3.0.0  |
| Config Layers         | [config/LAYER_CONFIG.md](config/LAYER_CONFIG.md)                                             | v3.0.0  |
| Taxonomy (symbols)    | [API_REFERENCE.md](API_REFERENCE.md#taxonomy--the-point-symbol)                              | v3.0.0  |
| Config Scale          | [config/SCALE_CONFIG.md](config/SCALE_CONFIG.md)                                             | v3.0.0  |
| Data Normalizer       | [config/data-normalizer.md](config/data-normalizer.md)                                       | v3.0.0  |
| POI Fields Tourism    | [config/poi-fields-tourism.md](config/poi-fields-tourism.md)                                 | v3.0.0  |
| Helpers               | [helpers/GeoLeaf_Helpers_README.md](helpers/GeoLeaf_Helpers_README.md)                       | v3.0.0  |
| Validators            | [validators/GeoLeaf_Validators_README.md](validators/GeoLeaf_Validators_README.md)           | v3.0.0  |
| Errors                | [errors/GeoLeaf_Errors_README.md](errors/GeoLeaf_Errors_README.md)                           | v3.0.0  |
| Security              | [security/GeoLeaf_Security_README.md](security/GeoLeaf_Security_README.md)                   | v3.0.0  |
| Security Contract     | [security/SECURITY_CONTRACT.md](security/SECURITY_CONTRACT.md)                               | v3.0.0  |
| Security Guide (CSP)  | [SECURITY.md](SECURITY.md)                                                                   | v3.0.0  |
| Log                   | [log/GeoLeaf_Logging_README.md](log/GeoLeaf_Logging_README.md)                               | v3.0.0  |
| Utils                 | [utils/GeoLeaf_Utils_README.md](utils/GeoLeaf_Utils_README.md)                               | v3.0.0  |
| Constants             | [constants/GeoLeaf_Constants_README.md](constants/GeoLeaf_Constants_README.md)               | v3.0.0  |
| Performance           | [performance/PERFORMANCE_ARCHITECTURE.md](performance/PERFORMANCE_ARCHITECTURE.md)           | v3.0.0  |
| CSS Animations        | [performance/CSS_ANIMATION_OPTIMIZATION.md](performance/CSS_ANIMATION_OPTIMIZATION.md)       | v3.0.0  |

### Schema

| Topic   | Document                             | Version |
| ------- | ------------------------------------ | ------- |
| Schemas | [schema/README.md](schema/README.md) | v3.0.0  |

### Legal

| Document               | Description                          |
| ---------------------- | ------------------------------------ |
| [NOTICE.md](NOTICE.md) | Third-party notices and attributions |

---

## Plugins

### Public MIT plugin

- **@geoleaf-plugins/connector** — Transparent HTTP authentication (fetch interception, JWT, login modal). Documentation: `packages/plugins/connector/README.md` and `packages/plugins/connector/docs/CONNECTOR_GUIDE.md`, both shipped by the plugin package

### Commercial plugins

Plugin documentation is **not** duplicated here — it ships inside each `@geoleaf-plugins/*` package.

- **@geoleaf-plugins/offline-ui** — Offline cache, IndexedDB, tile persistence

For plugin configuration inside a profile: [PLUGIN_CONFIGURATION_GUIDE.md](PLUGIN_CONFIGURATION_GUIDE.md)

Visit [geoleaf.dev](https://geoleaf.dev) for licensing information.
