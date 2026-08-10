---
title: "GeoLeaf Notice and License Attribution"
---

# GeoLeaf Notice and License Attribution

Product Version: GeoLeaf Platform V3

## License

**GeoLeaf Core** is released under the **MIT License**.

```
© 2026 Mattieu Pottier
Released under the MIT License
https://geoleaf.dev
```

See the [LICENSE](../LICENSE) file for the complete license text.

---

## Core vs Modules

### GeoLeaf Core (Open Source)

GeoLeaf Core is an open-source JavaScript mapping library. It includes:

- **Framework bootstrap** - Application initialization and configuration
- **Core mapping** - MapLibre GL JS wrapper and map management
- **Configuration system** - Configuration loading and validation
- **Logging and errors** - Unified logging and error handling
- **UI components** - Base UI system, controls, panels
- **Security** - XSS protection and input sanitization
- **Utilities** - Helper functions and utility library

**Perpetual Status**: The GeoLeaf Core library is and will remain permanently open-source under the MIT License.

### Optional Plugins

GeoLeaf offers **optional** plugins that extend Core functionality — offline cache and Service Worker, feature editing (geometry and attributes), COG rendering, printing, measuring, table views, file import, geocoding, real-time layers and more.

Every plugin is released under the **MIT License**, under the `@geoleaf-plugins/*` scope. **The whole client-side library is MIT: install it, use it, ship it.**

> **Which plugins are on the public registry, and at which version, is measured — never declared here.**
> Run `npm view <package> version` for the registry, and `npm run versions:check` for this repository.
> The two answer different questions, and a list copied into this file would be stale the day it is written.

Plugins:

- ✅ Are **optional** — Core works fully without them
- ✅ Are **independently versioned** — each ships its own `LICENSE`, all MIT
- ✅ Do **not** affect the MIT License of GeoLeaf Core

`packages/core/` never references a plugin package. That boundary is an **architectural** one — it keeps the Core standalone and tree-shakeable — and it is enforced automatically by `scripts/verify-core-standalone.cjs`. It is not, and never was, a licence boundary.

---

## Dependencies

GeoLeaf depends on the following open-source libraries:

- **MapLibre GL JS** (https://maplibre.org) - BSD 3-Clause License
- **Additional dependencies** - See `package.json` for complete list

---

## Attribution and Acknowledgments

GeoLeaf thanks the following communities and projects:

- **MapLibre GL JS** - Core mapping engine (WebGL)
- **OpenStreetMap** - Mapping data and community
- **JavaScript mapping community** - Design patterns and best practices

---

## Contributing

When contributing to GeoLeaf, please ensure all new code includes the appropriate license header. See [CONTRIBUTING.md](./CONTRIBUTING.md#licensing) for details.

---

## Questions

For questions about licensing, see [CONTRIBUTING.md](./CONTRIBUTING.md#licensing) or visit https://geoleaf.dev.
