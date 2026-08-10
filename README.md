# GeoLeaf JS

**S'applique à :** `@geoleaf/core` v3.x
**License:** MIT
**Description:** Modern TypeScript mapping library built on MapLibre GL JS with advanced features for interactive web mapping applications.

> **Versioning policy**
>
> - Versionnage **indépendant par paquet** — la liste et les versions courantes s'impriment :
>   `npm run versions:check`. Ne pas recopier un numéro ici, il a déjà dérivé d'une majeure.
> - Details: [docs/VERSIONING_POLICY.md](packages/core/docs/VERSIONING_POLICY.md)

> **Licence scope (important)**
>
> - **GeoLeaf Core (`@geoleaf/core`, ce depot)** : licence **MIT** (usage, modification, redistribution autorises selon MIT)
> - **Plugins (`@geoleaf-plugins/*`)** : MIT également, **destinés** à npmjs.org — l'état réel du
>   registre se mesure paquet par paquet (`npm view <paquet> version`), il ne se recopie pas ici
> - Chaque package embarque son propre fichier `LICENSE`

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

> ⚠️ Deux pièges corrigés ici le 31/07/2026, tous deux **mesurés** :
> `POI` et `Filters` **ne sont pas exportés** (dissous au S9 / retiré au S4.5) ; et la CSS
> s'importe par le sous-chemin déclaré `@geoleaf/core/style.css` — un `@geoleaf/core/dist/…`
> lève `ERR_PACKAGE_PATH_NOT_EXPORTED`, la carte `exports` ne l'ouvre pas.
> La liste des exports réels : `npm run gen:api-surface`.
> ⚠️ **Ceci ne vaut PAS pour les URLs de CDN plus bas**, qui portent bien un `/dist/` : un CDN
> sert le tarball à plat et ne lit aucune carte `exports`. Les deux régimes sont détaillés au
> §Distribution.

**Dans le navigateur — auto-hébergé (recommandé) :**

C'est ce que fait l'application livrée du dépôt. Copiez **les quatre fichiers** de MapLibre
depuis `node_modules/maplibre-gl/dist/` à côté de vos assets, et servez tout depuis votre
origine : chaque origine tierce est une dépendance de disponibilité, une fuite de l'adresse IP
de vos visiteurs, et une entrée de plus dans votre CSP.

```
vendor/maplibre-gl/
├── maplibre-gl.mjs          l'entrée
├── maplibre-gl-shared.mjs   importée par la précédente, en chemin RELATIF
├── maplibre-gl-worker.mjs   chargée par `new Worker(url, {type:"module"})`
├── maplibre-gl.css
└── global.mjs               le shim ci-dessous, que vous écrivez
```

Le répertoire doit rester **plat et complet** : les trois modules se référencent entre eux par
chemin relatif. GeoLeaf lit le moteur sur `globalThis.maplibregl`, que la v6 ne publie plus —
deux lignes le reposent :

```javascript
// vendor/maplibre-gl/global.mjs
import * as maplibregl from "./maplibre-gl.mjs";
globalThis.maplibregl = maplibregl;
```

```html
<!-- MapLibre GL JS — ESM depuis la v6 ; le shim republie le global -->
<link rel="stylesheet" href="/vendor/maplibre-gl/maplibre-gl.css" />
<script type="module" src="/vendor/maplibre-gl/global.mjs"></script>

<!-- GeoLeaf — ESM -->
<link rel="stylesheet" href="/dist/geoleaf-main.min.css" />
<script type="module" src="/dist/geoleaf.esm.js"></script>
```

Les deux `<script type="module">` s'exécutent **dans l'ordre du document** (garanti par la
spec HTML pour tout module non-`async`), donc `maplibregl` est posé avant que GeoLeaf ne le
lise. Ajouter un `async` sur l'un des deux casse cette garantie.

> ⚠️ **Votre serveur doit connaître le type MIME de `.mjs`.** Beaucoup de configurations n'ont
> que `js` dans leur table (nginx, par exemple), et servent alors le module en
> `application/octet-stream` — le navigateur **refuse de l'exécuter**, sans que rien d'autre
> ne le signale. Côté nginx : `types { text/javascript mjs; }`.

> 🛑 **Ce bloc a dit l'exact inverse jusqu'à MapLibre 6, et les deux énoncés étaient justes à
> leur date.** En v5, le paquet déclarait `main: dist/maplibre-gl.js` **sans `module` ni carte
> `exports`** : c'était un script classique, le charger en `type="module"` ne publiait pas le
> global, et l'exemple ne pouvait pas fonctionner — défaut mesuré ici même le 08/08/2026. La
> v6 est **ESM-only** : `maplibre-gl.js` et `maplibre-gl-csp.js` ne sont plus publiés du tout,
> et c'est la forme sans `type="module"` qui rend désormais un 404. Les deux recettes sont
> gardées en sens inverse par `scripts/validate-docs-examples.cjs`.

> ⚠️ **N'oubliez pas `dist/chunks/`** : l'entrée en importe plusieurs **statiquement**. Leurs
> noms portent un hachage de contenu — on copie le répertoire, on ne liste jamais les fichiers.

**Depuis un CDN :**

Utilisable, mais posez alors une intégrité de sous-ressource (`integrity` + `crossorigin`).

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.css" />
<script type="module">
    import * as maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.mjs";
    globalThis.maplibregl = maplibregl;
</script>

<link
    rel="stylesheet"
    href="https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf-main.min.css"
/>
<script
    type="module"
    src="https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf.esm.js"
></script>
```

> ⚠️ Ce shim-ci est **en ligne**, donc il exige `'unsafe-inline'` (ou un nonce/hash) dans votre
> `script-src`. La recette auto-hébergée ci-dessus n'a pas ce défaut, puisque son shim est un
> fichier — c'est une raison de plus de la préférer. `integrity` est par ailleurs inapplicable
> à un module importé, l'attribut ne portant que sur la balise.

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

        <!-- MapLibre GL JS — shim ESM, qui repose le global `maplibregl` -->
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

> **Et pour poser des points ?** Ce bloc s'arrêtait autrefois sur un `GeoLeaf.POI.add({…})`
> copiable-collable — API **dissoute au S9**. Un POI est désormais une feature d'une couche
> GeoJSON ordinaire : elle s'écrit par `GeoLeaf.Layers.addFeature(layerId, feature)`, ce qui
> suppose une couche déclarée, donc un profil. Voir
> [PROFILES_GUIDE](packages/core/docs/PROFILES_GUIDE.md) puis
> [GEOJSON_LAYERS_GUIDE](packages/core/docs/geojson/GEOJSON_LAYERS_GUIDE.md). Pour la création
> interactive, le plugin [`@geoleaf-plugins/editor`](packages/plugins/editor/README.md), qui a
> absorbé `addpoi` au Sprint 5 : `GeoLeaf.Editor.AddForm.openAddForm({ lat, lng })`.
>
> ⚠️ Les deux ordres de coordonnées coexistent et ne s'interchangent pas : `map.center` est
> `[lat, lng]`, les `coordinates` d'une feature GeoJSON restent `[lng, lat]`.

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

_(via le plugin [`@geoleaf-plugins/offline-ui`](packages/plugins/offline-ui/README.md) — renommé depuis `storage`)_

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

**[Complete Documentation Index](packages/core/docs/INDEX_CORE.md)** - Browse all documentation organized by category

### Getting Started

- **[Getting Started Guide](packages/core/docs/GETTING_STARTED.md)** - Your first map in 5 minutes
- **[User Guide](packages/core/docs/USER_GUIDE.md)** - Complete user documentation (10 sections)
- **[Configuration Guide](packages/core/docs/CONFIGURATION_GUIDE.md)** - JSON configuration reference (9 types)
- **[Profiles Guide](packages/core/docs/PROFILES_GUIDE.md)** - Create custom business profiles

### Development

- **[API Reference](packages/core/docs/API_REFERENCE.md)** - Complete API documentation
- **[Contributing Guide](CONTRIBUTING.md)** - Contribution guidelines and standards
- **[Architecture Guide](packages/core/docs/ARCHITECTURE_GUIDE.md)** - System architecture and design patterns

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

GeoLeaf is optimized for production performance. **Chaque ligne ci-dessous porte la commande qui
la mesure** : un chiffre recopié en prose se périme sans que personne ne le voie — celui du bundle
avait déjà divergé d'un facteur supérieur à 100.

- **Bundle Size** — la clôture transitive des imports statiques depuis l'entrée, pas l'entrée
  seule : `npm run size` (budget dur : échec de build au-delà de 300 Ko gz, alerte à 270).
  MapLibre GL est une peer dependency `external`, hors de ce budget
- **Bundle des plugins** — `npm run size:plugins`, un budget par plugin
- **Poids réellement servi par l'application livrée** — `npm run size:app`, mesuré sur
  `deploy/deploy-core/` et `deploy/deploy-full/` après régénération du déployé
- **Browser Support**: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+ — dérivé de la cible de
  compilation `ES2022`, déclarée dans les `tsconfig` du dépôt
- **Offline** — capacité in-core, activée par profil ; ce que le navigateur exécute réellement
  au boot se mesure par `node scripts/verify-e2e-coverage.cjs`

> ⚠️ **Trois métriques ont été retirées d'ici le 10/08/2026 parce qu'aucune commande ne les
> rendait** : « Tree-Shaking : 75.7 % », « Initialization : < 100 ms » et « Runtime : smooth
> avec 1000+ POI ». Elles n'étaient pas fausses — elles étaient **infalsifiables**, donc
> incapables de se périmer. Une mesure qu'on ne peut pas rejouer ne vieillit jamais : elle
> fossilise. Les rétablir demande d'abord d'écrire l'oracle qui les produit.

### Code Quality

- **Test Coverage**: gated per package, ratcheted upwards only — `npm run test:coverage:all` (Vitest + Istanbul), plus Playwright E2E
- **Security**: XSS protection, input sanitization, CSP headers — surface gardée par
  `scripts/audit-innerhtml.cjs` et les règles `security/*` d'ESLint
- **TypeScript**: strict mode, définitions publiées avec le paquet. ⚠️ La couverture du typage
  du namespace global n'est **pas** complète (traîne `[key: string]: unknown`) : son avancement
  se mesure par `node scripts/check-namespace-typing-coverage.cjs`
- **ESLint**: `npm run lint` — 0 warning est la condition de passage, pas une observation

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

> **No count is written above, and that is deliberate.** This tree said « 369 source files »,
> named two packages that had been renamed (`plugin-storage`, `plugin-addpoi`) and two deploy
> variants that never existed (`deploy-storage`, `deploy-storage-addpoi`) — while listing a `src/`
> layout (`poi/`, `filters/`, `route/`, `table/`) that had been dissolved or moved. It is the
> repository's own showcase, and it had not followed eight structure sprints.
>
> The authoritative tree is **generated and gated**: `npm run docs:tree` writes
> `docs/reference/ARBORESCENCE_QUALIFIEE.md`, and `ci:local` fails when it drifts. The
> shipped package list is `npm run versions:check`.

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

### Configuration applicative (`profiles/geoleaf.config.json`)

Quel profil charger, et les capacités app-globales (`modules.*`) :

```jsonc
{
    "debug": false,
    "data": {
        "activeProfile": "tourism",
        "profilesBasePath": "../profiles", // relatif à CE fichier
    },
    "modules": {
        "profile-switcher": { "enabled": true },
        // … branding, pwa, theme-palette, language-switcher
    },
}
```

### Configuration de profil (`profiles/tourism/profile.json`)

⚠️ **Les sous-configurations ne vivent PAS à la racine du profil** : `profile.json` est un
manifeste qui les **route** par `Files`. Un exemple qui place `layers`, `ui` ou `basemaps` à
la racine ne charge rien — sans erreur.

```jsonc
{
    "id": "tourism",
    "label": "Profil tourisme",
    "displayLabel": "Tourisme",
    "icon": "🏖️",
    "version": "1.3.0",
    "map": {
        "bounds": [
            /* … */
        ],
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
            // … une entrée par capacité ou plugin configuré
        },
    },
}
```

**L'inventaire exhaustif des clés est généré, pas rédigé** — 404 propriétés sur 12 schémas,
qu'aucun document ne recopie : [`PROFILE_SCHEMA_REFERENCE.md`](docs/reference/PROFILE_SCHEMA_REFERENCE.md)
(`npm run gen:profile-schema`). Guide de prise en main :
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

> 🛑 **Deux régimes de résolution, et les confondre est l'erreur qui a produit ce paragraphe.**
> Un `import` (bundler, Node, TypeScript) passe par la carte `exports` du paquet : seuls les
> sous-chemins qu'elle déclare existent, et `@geoleaf/core/dist/…` lève
> `ERR_PACKAGE_PATH_NOT_EXPORTED` — la feuille de style s'appelle `@geoleaf/core/style.css`.
> Une **URL de CDN**, elle, ne résout rien du tout : jsDelivr et unpkg servent le tarball **à
> plat** et ignorent la carte `exports`, donc `…/@geoleaf/core@<version>/dist/geoleaf.esm.js`
> reste valide. Les deux formes ci-dessous sont donc justes **chacune dans son régime** ;
> aligner les URLs de CDN sur `./style.css` les casserait.
> La liste des sous-chemins réellement ouverts :
> `node -p "Object.keys(require('@geoleaf/core/package.json').exports).join('\n')"`.

### CDN (jsDelivr)

```html
<!-- MapLibre GL JS — peer dependency, à charger AVANT GeoLeaf -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.css" />
<script type="module">
    import * as maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.mjs";
    globalThis.maplibregl = maplibregl;
</script>

<link
    rel="stylesheet"
    href="https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf-main.min.css"
/>
<script
    type="module"
    src="https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf.esm.js"
></script>
```

> ⚠️ Charger `geoleaf.esm.js` seul ne lève pas tout de suite — `maplibre-gl` est `external`, et
> son global n'est lu qu'à la création de la carte. **HTML-04** ne mord donc pas sur ce bloc, qui
> ne boote rien. Le shim est là parce qu'une recette d'installation doit porter sa peer
> dependency, pas parce qu'une gate l'exige.

---

## Testing

- **Unit tests:** Vitest (ESM, Istanbul coverage) — la version installée se lit dans le
  `devDependencies` de la racine, elle ne se recopie pas ici
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

GeoLeaf Core is released under the **MIT License** - free for commercial and personal use.

- **Plugins:** optional packages under the `@geoleaf-plugins/*` scope are MIT too, **intended for**
  npmjs.org and versioned independently. Each ships its own `LICENSE` and documentation.
  Which of them are actually on the registry is measured, never copied: `npm view <package> version`.
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
