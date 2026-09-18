---
title: "Direction — what GeoLeaf is, and what it is not"
---

# Direction — what GeoLeaf is, and what it is not

**Applies to:** `@geoleaf/core` v3.x

GeoLeaf is a **field mapping client**: a map application defined by a JSON profile, used on a phone
or a tablet to consult data and to edit it, with or without network. It is **agnostic of any
backend and of any business domain**: it runs from static files, or behind any server that honours
its contracts, and the profile — not the code — decides what the application is about.

It is **not a general-purpose GIS library**. Where a general-purpose tool is the better answer,
GeoLeaf does not try to compete with it.

---

## The four axes GeoLeaf develops

1. **Profiles.** One JSON profile defines the whole application — layers, styles, themes,
   taxonomy, modules. Changing the application means changing the profile, not the code.
2. **The offline write cycle.** An edit is recorded locally under a client identity, queued, and
   replayed to the server when the network returns, idempotently. An update made on stale data is
   detected through a freshness marker the server provides.
3. **Prepared offline.** What a field day needs — data and tiles — is declared in the profile and
   downloaded ahead of time, instead of being limited to what was browsed.
4. **The weight budget.** What a page loads at boot is measured and capped, and treated as a
   property of the product.

## What GeoLeaf does not develop

- **A generic capture tool.** Forms, photos and geometry editing exist to serve the write cycle and
  the server's data model, not as a standalone survey product.
- **Generic GPS tooling** — external receivers, track analytics.
- **A general-purpose, desktop-first GIS** — spatial analysis, a growing list of data formats,
  desktop-first interfaces. The format plugins that exist (`cog`, `flatgeobuf`, `file-import`) are
  maintained like the others; new formats are not planned.

---

## What is guaranteed

| Topic          | Guarantee                                                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scale          | Displaying and editing a layer of **30,000 features** is measured and gated. Larger volumes are a margin, not a promise.                                                         |
| Device         | A **personal** device, preferably with the application installed (PWA). A device shared between users is **not supported**: local edits are not bound to the user who made them. |
| Data at rest   | Local data is not encrypted by the application — a key the application can derive would protect nothing. Rely on the device's own encryption, managed by your fleet policy.      |
| Authentication | Both modes of `@geoleaf-plugins/connector`: a login endpoint the library calls, or a token the host application supplies.                                                        |
| Conflicts      | An update made on stale data is detected; the last write wins today.                                                                                                             |
| Browsers       | Those that run MapLibre GL JS 6: WebGL2 and ES modules.                                                                                                                          |

## Plugins

GeoLeaf's plugins are **first-party**: they are written in the GeoLeaf repository, against build
tooling that is not published. Writing a plugin outside that repository is not a supported path, and
no scaffolding tool is published. Every published package is maintained under the same
[versioning policy](VERSIONING_POLICY.md).

This documentation is written for **integrators** — applications that use the published API and
write profiles. The public API is what the versioning policy protects.

## Known limits

- **One GeoLeaf application per page.** Configuration, state and events are shared by the whole
  page.

## Versions

`@geoleaf/core` 3.x is the only line: no new major is planned. How a change is numbered, and how a
removal is announced, is written in the [Versioning Policy](VERSIONING_POLICY.md).
