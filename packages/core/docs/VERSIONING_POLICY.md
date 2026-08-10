---
title: "GeoLeaf Versioning Policy"
---

# GeoLeaf Versioning Policy

**Version produit :** Platform V3
**Baseline SemVer technique :** Core `@geoleaf/core` `3.0.x`

---

## Purpose

This policy separates:

- **Product/marketing version** (what users see): `GeoLeaf Platform V3`
- **Technical package versions** (SemVer, tooling, CI/CD): `3.0.x`, `3.0.0`, etc.

This avoids breaking package history, release pipelines, dependency updates, and compatibility tracking.

---

## Official Mapping

| Product label         | Technical SemVer      | Status     |
| --------------------- | --------------------- | ---------- |
| `GeoLeaf Platform V3` | `@geoleaf/core@3.x.x` | Current    |
| `GeoLeaf Platform V2` | `@geoleaf/core@2.x.x` | Superseded |

> V3.0.0 keeps MapLibre GL JS v6 as its rendering engine (WebGL, ESM-only) — the peer
> dependency range is unchanged from V2. What V3 changes is the library's own surface:
> the POI subsystem is dissolved into generic point layers, optional modules moved to
> in-core capabilities or MIT plugins, and all legacy aliases/shims were removed.

---

## Documentation Rules

Use **Platform V3** in:

- Landing pages and project overviews
- Product positioning sections
- Executive summaries and business-facing documents

Keep **technical SemVer** in:

- `package.json` files
- `CHANGELOG.md`
- release notes and git tags
- CDN/npm installation snippets
- compatibility matrices

---

## SemVer Rules for v3.x

| Change type                                              | Version bump  |
| -------------------------------------------------------- | ------------- |
| Breaking API change (facade, init signature, etc.)       | MAJOR (4.0.0) |
| New feature, new module, new named export (non-breaking) | MINOR (3.X.0) |
| Bug fix, performance patch, security fix                 | PATCH (3.0.X) |

---

## Plugin Versioning

Plugins are versioned independently of the core: a plugin's own version says nothing
about which core it targets. That relationship is carried by its manifest — and today,
**not** by `peerDependencies`.

All **13** published plugins are MIT. None of them declares `@geoleaf/core` as a
**peer** dependency; every one lists it under `dependencies`, at range `*`:

```jsonc
// packages/plugins/<name>/package.json — the shape all 13 share
{ "dependencies": { "@geoleaf/core": "*" } }
```

> ⚠️ **`dependencies`, not `peerDependencies` — and the difference is not cosmetic.** A peer
> dependency asks the consumer to supply the core and merely warns on mismatch; a regular
> dependency lets npm **install its own copy** next to the one the consumer already has. For a
> library that mounts a global `GeoLeaf` namespace, two copies in one tree is a different
> problem from an unenforced range.
>
> The range `*` means no compatibility constraint either way: a plugin built against V3
> installs silently alongside a V2 core. Deciding between « tighten to `^3.0.0` » and « move to
> `peerDependencies` » belongs to the distribution workstream, not to this policy.
>
> ⚠️ This paragraph said « both manifests declare it as a **peer** dependency » until the
> 30/07/2026. It named two plugins out of thirteen and the wrong manifest key — while claiming,
> in the same breath, that writing a contract the manifests do not declare was to be avoided.
> The list and the key are now derived: `node -e "…"` over the plugin manifests, not recopied.

**Six** of the thirteen do declare peer dependencies — for `maplibre-gl`, never for the core:
`addpoi`, `editor`, `geocoding`, `measure`, `print`, `table`.

---

## Important

As of **Platform V3** (July 2026), the technical SemVer baseline is **3.0.x**
(`@geoleaf/core@3.0.0`). For future major/minor bumps, update `package.json`
and all relevant documentation consistently.

No further releases are planned on the `1.x` or `2.x` branches.
