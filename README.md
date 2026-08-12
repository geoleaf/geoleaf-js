# GeoLeaf JS

**Applies to:** `@geoleaf/core` v3.x
**License:** MIT
**Description:** Modern TypeScript mapping library built on MapLibre GL JS with advanced features for interactive web mapping applications.

[![npm version](https://img.shields.io/npm/v/@geoleaf/core.svg)](https://www.npmjs.com/package/@geoleaf/core)
[![npm downloads](https://img.shields.io/npm/dm/@geoleaf/core.svg)](https://www.npmjs.com/package/@geoleaf/core)
[![GitHub license](https://img.shields.io/github/license/geoleaf/geoleaf-js)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Quick Start

Get started with GeoLeaf in less than 5 minutes:

### Installation

**Via NPM (recommended — ESM):**

```bash
npm install @geoleaf/core
```

```javascript
// ES Modules (recommended)
import { Core } from "@geoleaf/core";
import "@geoleaf/core/style.css";

Core.init({
    map: { target: "map", center: [46.5, 2.5], zoom: 6 },
});
```

> [!WARNING]
> Two things that catch people out. `POI` and `Filters` are **not exported** — a POI is now a
> feature of an ordinary GeoJSON layer. And the stylesheet is imported through the declared
> `@geoleaf/core/style.css` subpath: a `@geoleaf/core/dist/…` specifier throws
> `ERR_PACKAGE_PATH_NOT_EXPORTED`, because the `exports` map does not open `dist/`. The list of
> real exports is printed by `npm run gen:api-surface`.
>
> **This does not apply to the CDN URLs further down**, which do carry a `/dist/` segment: a CDN
> serves the tarball flat and reads no `exports` map. Both regimes are detailed under
> [Distribution](#distribution).

**In the browser — self-hosted (recommended):**

This is what the application shipped in this repository does. Copy **all four** MapLibre files from
`node_modules/maplibre-gl/dist/` next to your assets and serve everything from your own origin:
each third-party origin is an availability dependency, a leak of your visitors' IP addresses, and
one more entry in your CSP.

```
vendor/maplibre-gl/
├── maplibre-gl.mjs          the entry point
├── maplibre-gl-shared.mjs   imported by the entry, through a RELATIVE path
├── maplibre-gl-worker.mjs   loaded by `new Worker(url, {type:"module"})`
├── maplibre-gl.css
└── global.mjs               the shim below, which you write
```

The directory must stay **flat and complete**: the three modules reference each other by relative
path. GeoLeaf reads the engine from `globalThis.maplibregl`, which v6 no longer publishes — two
lines put it back:

```javascript
// vendor/maplibre-gl/global.mjs
import * as maplibregl from "./maplibre-gl.mjs";
globalThis.maplibregl = maplibregl;
```

```html
<!-- MapLibre GL JS — ESM since v6; the shim republishes the global -->
<link rel="stylesheet" href="/vendor/maplibre-gl/maplibre-gl.css" />
<script type="module" src="/vendor/maplibre-gl/global.mjs"></script>

<!-- GeoLeaf — ESM -->
<link rel="stylesheet" href="/dist/geoleaf-main.min.css" />
<script type="module" src="/dist/geoleaf.esm.js"></script>
```

Both `<script type="module">` tags execute **in document order** (guaranteed by the HTML spec for
any non-`async` module), so `maplibregl` is in place before GeoLeaf reads it. Adding `async` to
either one breaks that guarantee.

> [!WARNING]
> **Your server must know the MIME type of `.mjs`.** Many configurations only list `js` (nginx,
> for one) and serve the module as `application/octet-stream` — the browser then **refuses to
> execute it**, with nothing else to signal the problem. On nginx: `types { text/javascript mjs; }`.
>
> MapLibre v6 is ESM-only: `maplibre-gl.js` and `maplibre-gl-csp.js` are no longer published at
> all, so there is no non-module fallback to fall back to.

> [!IMPORTANT]
> **Do not forget `dist/chunks/`**: the entry point imports several of them **statically**. Their
> names carry a content hash, so copy the directory — never list the files by hand.

**From a CDN:**

Usable, but add subresource integrity (`integrity` + `crossorigin`) where the tag accepts it.

The URLs below pin the **major** (`@3`), like the `maplibre-gl@6` above them: jsDelivr resolves it to
the latest 3.x, so the recipe stays copy-pasteable and cannot go stale. Pin a full version only if
you need byte-for-byte reproducibility — and never write one into prose, which is how this page once
advertised a version the registry had never seen.

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.css" />
<script type="module">
    import * as maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.mjs";
    globalThis.maplibregl = maplibregl;
</script>

<link
    rel="stylesheet"
    href="https://cdn.jsdelivr.net/npm/@geoleaf/core@3/dist/geoleaf-main.min.css"
/>
<script
    type="module"
    src="https://cdn.jsdelivr.net/npm/@geoleaf/core@3/dist/geoleaf.esm.js"
></script>
```

> [!WARNING]
> This shim is **inline**, so it requires `'unsafe-inline'` (or a nonce/hash) in your `script-src`.
> The self-hosted recipe above does not, since its shim is a file — one more reason to prefer it.
> `integrity` is in any case inapplicable to an imported module, as the attribute only covers the
> tag itself.

### Your First Map

```html
<!DOCTYPE html>
<html>
    <head>
        <!-- MapLibre GL JS -->
        <link rel="stylesheet" href="/vendor/maplibre-gl/maplibre-gl.css" />
        <!-- GeoLeaf -->
        <link rel="stylesheet" href="/dist/geoleaf-main.min.css" />
        <style>
            #map {
                height: 600px;
            }
        </style>
    </head>
    <body>
        <div id="map"></div>

        <!-- MapLibre GL JS — ESM shim, which puts the `maplibregl` global back -->
        <script type="module" src="/vendor/maplibre-gl/global.mjs"></script>
        <!-- GeoLeaf ESM -->
        <script type="module">
            import GeoLeaf from "/dist/geoleaf.esm.js";

            // Initialize map — `center` is [lat, lng]
            GeoLeaf.Core.init({
                map: {
                    target: "map",
                    center: [46.5, 2.5],
                    zoom: 6,
                },
            });
        </script>
    </body>
</html>
```

> [!NOTE]
> **Adding points.** A POI is a feature of an ordinary GeoJSON layer, written with
> `GeoLeaf.Layers.addFeature(layerId, feature)` — which assumes a declared layer, and therefore a
> profile. See [PROFILES_GUIDE](packages/core/docs/PROFILES_GUIDE.md) then
> [GEOJSON_LAYERS_GUIDE](packages/core/docs/geojson/GEOJSON_LAYERS_GUIDE.md). For interactive
> creation, use the [`@geoleaf-plugins/editor`](packages/plugins/editor/README.md) plugin:
> `GeoLeaf.Editor.AddForm.openAddForm({ lat, lng })`.
>
> The two coordinate orders coexist and are not interchangeable: `map.center` is `[lat, lng]`,
> while the `coordinates` of a GeoJSON feature stay `[lng, lat]`.

---

## Why GeoLeaf?

### GeoLeaf vs Popular Alternatives

| Feature                       | Google Maps | Mapbox GL   | MapLibre GL | **GeoLeaf**      |
| ----------------------------- | ----------- | ----------- | ----------- | ---------------- |
| **Security (XSS Protection)** | Built-in    | Basic       | Basic       | Advanced         |
| **GeoJSON Multi-Style**       | Full        | Full        | Full        | Full             |
| **Offline Support**           | No          | Partial     | No          | Full (IndexedDB) |
| **POI Clustering**            | Built-in    | Built-in    | Built-in    | Built-in         |
| **Label System**              | Built-in    | Built-in    | Built-in    | Built-in         |
| **Business Profiles**         | No          | No          | No          | Multi-profile    |
| **Open Source**               | Proprietary | Proprietary | BSD-3       | MIT              |
| **Free for Production**       | Paid API    | Paid        | Yes         | Yes              |
| **Offline-First Ready**       | No          | No          | No          | Yes              |
| **TypeScript Support**        | Official    | Official    | Official    | Full             |

### Best For

**Choose GeoLeaf if you need:**

- Security-first mapping (XSS protection built-in)
- Offline-first applications (mobile, unreliable networks)
- Business context switching (profiles)
- Complex styling rules per layer
- Open source with MIT licensing
- Professional mapping without vendor lock-in

---

## Features

### Multi-Profile System

Switch between different business contexts (Tourism, Custom...) with dedicated configurations, taxonomies, and UI presets.

### Advanced POI Management

- Category-based organization with icons
- Custom sidepanel layouts (JSON-driven)
- Search, filters, and clustering
- Add/Edit/Delete with validation

### Dynamic Theming

- Light/Dark mode with system detection
- Primary & secondary theme switchers
- Layer visibility presets per theme
- CSS custom properties integration

### GeoJSON Layers

- Load multiple GeoJSON layers from configuration
- Style system with multiple presets per layer
- Labels with scale-based visibility
- Interactive shapes with tooltips/popups

### Offline Cache

_(through the [`@geoleaf-plugins/offline-ui`](packages/plugins/offline-ui/README.md) plugin)_

- IndexedDB storage for profiles and data
- Basemap tile caching for offline usage
- Automatic cache management
- Progress tracking and notifications

### Integrated Labels System

- Style-based label configuration
- Scale-dependent visibility
- Dynamic field rendering
- Toggle controls in layer manager

### Smart Filters

- Category/subcategory filtering
- Tag-based filtering
- Full-text search
- Proximity/radius filtering
- Result counters

### Data Table

- Tabular view of layer features
- Sortable columns
- Export to CSV/Excel
- Synchronized with map selection

### Security

- XSS protection via Content Security Policy
- Input sanitization
- Safe HTML rendering
- CORS headers support

---

## Documentation

**[Complete Documentation Index](packages/core/docs/INDEX_CORE.md)** — browse all documentation
organized by category, or read it online at [geoleaf.dev/docs](https://www.geoleaf.dev/docs/).

Usage documentation lives in `packages/core/docs/`; the technical contracts live in
[`docs/specs/`](docs/specs/); the reference material is generated rather than written by hand.

### Getting Started

- **[Getting Started Guide](packages/core/docs/GETTING_STARTED.md)** - Your first map in 5 minutes
- **[User Guide](packages/core/docs/USER_GUIDE.md)** - Complete user documentation (10 sections)
- **[Configuration Guide](packages/core/docs/CONFIGURATION_GUIDE.md)** - JSON configuration reference (9 types)
- **[Profiles Guide](packages/core/docs/PROFILES_GUIDE.md)** - Create custom business profiles

### Development

- **[API Reference](packages/core/docs/API_REFERENCE.md)** - Complete API documentation
- **[Contributing Guide](CONTRIBUTING.md)** - Contribution guidelines and standards
- **[Architecture Guide](packages/core/docs/ARCHITECTURE_GUIDE.md)** - System architecture and design patterns
- **[Versioning Policy](packages/core/docs/VERSIONING_POLICY.md)** - Independent per-package versioning

### Guides & References

- **[Profiles Guide](packages/core/docs/PROFILES_GUIDE.md)** - Create custom business profiles
- **[JSON Schemas](packages/core/docs/schema/)** - Validation schemas for profiles
- **[Cookbook](packages/core/docs/COOKBOOK.md)** - Practical recipes and solutions
- **[FAQ](packages/core/docs/FAQ.md)** - Frequently asked questions

### Module Documentation

- [Baselayers](packages/core/docs/baselayers/GeoLeaf_Baselayers_README.md) - Basemap management
- [Configuration](packages/core/docs/config/GeoLeaf_Config_README.md) - Profile loading
- [GeoJSON Layers](packages/core/docs/geojson/GEOJSON_LAYERS_GUIDE.md) - Vector layers
- [Labels System](packages/core/docs/labels/GeoLeaf_Labels_README.md) - Map labels
- [Themes](packages/core/docs/PROFILE_JSON_REFERENCE.md) - Theme system (`config/core/themes.json` + `modules.theme-selector`)
- [Storage plugin docs](packages/plugins/offline-ui/docs/OVERVIEW.md) - Offline storage
- [UI Components](packages/core/docs/ui/GeoLeaf_UI_README.md) - User interface
- [View all modules](packages/core/docs/)

---

## Performance Metrics

GeoLeaf is optimized for production performance. Every line below carries the command that measures
it, so nothing here can go stale unnoticed:

- **Bundle Size** — the transitive closure of static imports from the entry point, not the entry
  point alone: `npm run size` (hard budget: the build fails above 300 KB gz, warns at 270).
  MapLibre GL is an `external` peer dependency and sits outside that budget
- **Plugin bundles** — `npm run size:plugins`, one budget per plugin
- **Weight actually served by the shipped application** — `npm run size:app`, measured on
  `deploy/deploy-core/` and `deploy/deploy-full/` after the deploy output is regenerated
- **Browser Support**: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+ — derived from the `ES2022`
  compilation target declared in the repository's `tsconfig` files
- **Offline** — an in-core capability, enabled per profile; what the browser actually executes at
  boot is measured by `node scripts/verify-e2e-coverage.cjs`

### Code Quality

- **Test Coverage**: gated per package, ratcheted upwards only — `npm run test:coverage:all` (Vitest + Istanbul), plus Playwright E2E
- **Security**: XSS protection, input sanitization, CSP headers — the surface is guarded by
  `scripts/audit-innerhtml.cjs` and the ESLint `security/*` rules
- **TypeScript**: strict mode, with definitions published alongside the package. Typing coverage of
  the global namespace is not yet complete (a trailing `[key: string]: unknown` remains); progress
  is measured by `node scripts/check-namespace-typing-coverage.cjs`
- **ESLint**: `npm run lint` — zero warnings is the pass condition

---

## Architecture

GeoLeaf is developed in a **Turborepo monorepo** (GeoLeaf-Js). The core library lives in
`packages/core/`; the published plugins live under `packages/plugins/`, and the shared libraries
under `packages/libs/`.

```
GeoLeaf-Js/
├── apps/
│   └── geoleaf-app/          # The deployable app — single source of the deploy variants
├── packages/
│   ├── core/                 # @geoleaf/core (MIT) — the library
│   │   └── src/              # kernel/, capabilities/, api/, app/, presets/, security/, …
│   ├── plugins/              # The published plugins (@geoleaf-plugins/*)
│   ├── libs/                 # field-renderer, host-runtime
│   └── build-config/         # Shared build configuration (private)
├── profiles/                 # Business profiles (JSON)
├── deploy/                   # Generated deploy variants — npm run build:deploy
├── e2e/                      # Playwright E2E tests
└── scripts/                  # Build, CI and verification scripts
```

The tree above is a summary. The authoritative one is **generated and gated**: `npm run docs:tree`
writes `docs/reference/ARBORESCENCE_QUALIFIEE.md`, and `ci:local` fails when it drifts. The shipped
package list comes from `npm run versions:check`.

See [Architecture Guide](packages/core/docs/ARCHITECTURE_GUIDE.md) for structure and design details.

---

## Use Cases

### Tourism & Heritage

Display points of interest, tourist routes, climate data, and protected areas with category-based filtering and rich popups.

### Custom Applications

Build your own business-specific mapping application using the flexible profile system.

---

## Configuration

GeoLeaf uses a **profile-based configuration system** with JSON files:

### Application configuration (`profiles/geoleaf.config.json`)

Which profile to load, and the app-wide capabilities (`modules.*`):

```jsonc
{
    "debug": false,
    "data": {
        "activeProfile": "tourism",
        "profilesBasePath": "../profiles", // relative to THIS file
    },
    "modules": {
        "profile-switcher": { "enabled": true },
        // … branding, pwa, theme-palette, language-switcher
    },
}
```

### Profile configuration (`profiles/tourism/profile.json`)

> [!WARNING]
> **Sub-configurations do NOT live at the root of the profile.** `profile.json` is a manifest that
> **routes** them through `Files`. An example that puts `layers`, `ui` or `basemaps` at the root
> loads nothing — and reports no error.

```jsonc
{
    "id": "tourism",
    "label": "Profil tourisme",
    "displayLabel": "Tourisme",
    "icon": "🏖️",
    "version": "1.3.0",
    "map": {
        "bounds": [/* … */],
        "initialMaxZoom": 10,
    },
    "Files": {
        "themesFile": "config/core/themes.json",
        "layersFile": "config/core/layers.json",
        "basemapsFile": "config/core/basemaps.json",
        "uiFile": "config/core/ui.json",
        "featuresFile": "config/core/features.json",
        "modules": {
            "legend": "config/plugins/legend.json",
            "filter": "config/plugins/filter.json",
            // … one entry per configured capability or plugin
        },
    },
}
```

**The exhaustive key inventory is generated, not written** — see
[`PROFILE_SCHEMA_REFERENCE.md`](docs/reference/PROFILE_SCHEMA_REFERENCE.md), produced by
`npm run gen:profile-schema` from the schemas in `profiles/schemas/`. Introductory guide:
[Configuration Guide](packages/core/docs/CONFIGURATION_GUIDE.md).

---

## Development

### Prerequisites

- Node.js 22+ and npm
- Modern browser with ES2022+ support

### Setup

```bash
# Clone repository
git clone https://github.com/geoleaf/geoleaf-js.git
cd GeoLeaf-Js

# Install dependencies
npm install

# Build all packages
npm run build

# Run unit tests (Vitest)
npm run test:vitest

# Run E2E tests (Playwright)
npm run test:e2e

# Lint code
npm run lint
```

### Project Scripts

- `npm run build` - Build all packages (Turborepo)
- `npm run build:core` - Build @geoleaf/core only
- `npm run test:vitest` - Run unit tests (Vitest, all packages)
- `npm run test:vitest:coverage` - Unit tests with Istanbul coverage
- `npm run test:e2e` - Run E2E tests (Playwright)
- `npm run lint` - Lint all packages
- `npm run build:deploy` - Build deploy variants

---

## Distribution

### NPM Package

```bash
npm install @geoleaf/core
```

```javascript
import { Core } from "@geoleaf/core";
import "@geoleaf/core/style.css";
```

> [!IMPORTANT]
> **There are two resolution regimes, and they must not be confused.** An `import` (bundler, Node,
> TypeScript) goes through the package's `exports` map: only the subpaths it declares exist, and
> `@geoleaf/core/dist/…` throws `ERR_PACKAGE_PATH_NOT_EXPORTED` — the stylesheet is called
> `@geoleaf/core/style.css`. A **CDN URL**, on the other hand, resolves nothing at all: jsDelivr and
> unpkg serve the tarball **flat** and ignore the `exports` map, so
> `…/@geoleaf/core@3/dist/geoleaf.esm.js` stays valid. Both forms below are therefore
> correct **each within its own regime**; aligning the CDN URLs on `./style.css` would break them.
>
> The list of subpaths that are actually open:
> `node -p "Object.keys(require('@geoleaf/core/package.json').exports).join('\n')"`.

### CDN (jsDelivr)

`@3` pins the major and resolves to the latest 3.x, exactly as `maplibre-gl@6` does beside it.
`npm view @geoleaf/core version` prints what the registry currently serves.

```html
<!-- MapLibre GL JS — peer dependency, to load BEFORE GeoLeaf -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.css" />
<script type="module">
    import * as maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.mjs";
    globalThis.maplibregl = maplibregl;
</script>

<link
    rel="stylesheet"
    href="https://cdn.jsdelivr.net/npm/@geoleaf/core@3/dist/geoleaf-main.min.css"
/>
<script
    type="module"
    src="https://cdn.jsdelivr.net/npm/@geoleaf/core@3/dist/geoleaf.esm.js"
></script>
```

---

## Testing

- **Unit tests:** Vitest (ESM, Istanbul coverage) — the installed version is declared in the root
  `devDependencies` rather than restated here
- **E2E tests:** Playwright (Chromium)
- **Coverage:** per-package thresholds, gated and ratcheted upwards only — `npm run test:coverage:all`

```bash
npm run test:vitest              # Run all unit tests
npm run test:vitest:coverage     # Generate coverage report
npm run test:e2e                 # E2E tests
```

---

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for:

- Code standards and conventions
- Branch naming and PR process
- Testing requirements
- Documentation guidelines

---

## License & Legal

**License:** MIT (Open Source)

GeoLeaf Core is released under the **MIT License** — free for commercial and personal use.

- **Plugins:** the optional packages under the `@geoleaf-plugins/*` scope are MIT too, versioned
  independently. Each ships its own `LICENSE` and its own documentation.
- See [LICENSE](LICENSE) for the complete license text
- See [NOTICE.md](packages/core/docs/NOTICE.md) for core vs modules and third-party attributions

### Using GeoLeaf

**You can:**

- Use in commercial projects
- Modify and redistribute
- Use for private projects
- Include in open source projects

**You must:**

- Include license and copyright notice
- Document changes

**You cannot:**

- Hold the author liable
- Use the author's name for endorsement

---

## Credits

### Built With

- [MapLibre GL JS](https://maplibre.org/) - WebGL-based interactive maps
- [Turf.js](https://turfjs.org/) - Geospatial analysis
- TypeScript (ES2022, strict mode)

### Maintainers

- **Lead Developer:** Mattieu Pottier

---

## Support

- **Documentation:** [docs/](packages/core/docs/)
- **Issues:** [GitHub Issues](https://github.com/geoleaf/geoleaf-js/issues)

---

## License

GeoLeaf Core is released under the MIT License.
(c) 2026 Mattieu Pottier

For licensing details, see [NOTICE.md](packages/core/docs/NOTICE.md).

---

See [CHANGELOG.md](CHANGELOG.md) for version history.
