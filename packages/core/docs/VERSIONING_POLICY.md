---
title: "GeoLeaf Versioning Policy"
---

# GeoLeaf Versioning Policy

**Product version:** Platform V3
**Technical SemVer baseline:** core `@geoleaf/core` `3.0.x`

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

### Pre-adoption window (decided 24/08/2026)

The MAJOR row above protects consumers who follow a semver range: an automatic
`^3.0.0` upgrade must never break them. While the packages have **no such consumer**
— no integrator installs from the registry and the only downstream vendors a pinned
commit, so nobody upgrades automatically — a breaking change that is justified as
better long-term MAY land in the minor under preparation (currently 3.1.0), with its
justification recorded in the CHANGELOG entry and in the code at the changed site.

This window closes by observation, not by date: the first consumer that follows a
semver range restores the table above in full. Every change that used the window is
labelled BREAKING in the CHANGELOG, so an adopter reading the release notes sees
exactly what moved.

---

## Deprecation

The table above says a breaking change lands in a MAJOR. It does not say how one gets
there. This section does: a public symbol is never removed without notice, and the notice
is what makes that MAJOR predictable instead of surprising.

### What counts as an announcement

Three artifacts, all three required. They are not three copies of one statement — each
reaches a different reader through a different channel.

| Artifact                             | Role         | Reaches                                                                         |
| ------------------------------------ | ------------ | ------------------------------------------------------------------------------- |
| `@deprecated` TSDoc on the symbol    | the carrier  | every consumer — the tag ships inside the package and editors strike call sites |
| An entry in `CHANGELOG.md`           | the record   | whoever reads the version history, on the repository and the documentation site |
| An entry in the deprecation register | the register | machines — this is the artifact a gate can read                                 |

::: warning

**Only the first one travels inside the package.** The npm tarball carries `dist/`,
`README.md` and `LICENSE`, nothing else — `CHANGELOG.md` and this page are published on the
repository and the documentation site, not in the tarball. The `@deprecated` tag reaches a
consumer who never leaves `node_modules`, because it rides in the emitted `.d.ts` files.
That is why it is required rather than recommended.

:::

The register lives at `docs/reference/consumers/DEPRECATIONS.json`. It is public because it
names **symbols**, never a customer: downstream declares what it depends on, upstream
declares what it allows itself to remove, and the two files are not written by the same
hand.

Each entry carries four fields, and each one closes a different door:

| Field         | Meaning                                        | Constraint                                        |
| ------------- | ---------------------------------------------- | ------------------------------------------------- |
| `since`       | the version that first shipped the tag         | within the current MAJOR line                     |
| `removeIn`    | the version that removes the symbol            | a MAJOR **strictly greater** than the current one |
| `replacement` | what to use instead                            | must resolve on the current published surface     |
| `symbol`      | where the tag lives, as `path.ts#Owner.member` | must designate a real `@deprecated` declaration   |

A deprecation whose `replacement` does not resolve is refused: **a symbol is not deprecated
towards nothing.** If no replacement exists, the symbol is not deprecated — it is
unsupported, which is a different statement, made elsewhere.

### How long the announcement must stand

**The announcement must survive at least one published `minor`, and `removeIn` is the next
MAJOR.** These are one rule, not two: the announcement enters on a `minor` of the current
MAJOR line, and the removal lands on the first MAJOR published after it.

::: danger

A release that both announces and removes announces nothing. `removeIn` must be strictly
greater than the current MAJOR — an announcement dated in the present is a removal one
warns about afterwards. And the clock runs on **published** versions, never on commits: a
deprecation announced in a release nobody published has not been announced.

:::

### What `@deprecated` does not mark

The tag marks a symbol that is **going away**. It does not mark:

- **A kept alias.** A misnomer preserved so existing configurations keep working is
  normalised into its canonical spelling and is not scheduled for removal. Tagging it
  strikes the key through in the integrator's editor while promising a removal that is not
  planned — the tag would lie to autocompletion. Describe it as a kept alias instead, and
  point at the canonical name.
- **An option with no effect.** A declared key that no code reads is a defect to fix, or a
  field to withdraw under this policy — not a permanent state to annotate.

Both cases existed in these sources before this policy was written. Anything left tagged
without a register entry is exempted **by name** in the verifier below, never by class: a
named exemption is auditable, an implicit one is a hole.

### The verifier

This policy is enforced by **`CC-10`** of `scripts/verify-consumer-contract.cjs`, wired into
the local and CI gate runs. A path may leave the consumed public surface only if it appears
in the register with its four fields **and** carries a real `@deprecated` tag on its symbol.
Any other disappearance turns the run red.

A policy with no named verifier goes stale in silence. The verifier is named here for that
reason, and renaming it without updating this section is itself a defect.

---

## Plugin Versioning

Plugins are versioned independently of the core: a plugin's own version says nothing
about which core it targets. That relationship is carried by the dependency range each
plugin declares — and **not** by `peerDependencies`.

Every published plugin is MIT, and each lists `@geoleaf/core` under `dependencies` at range
`^3.0.0`:

```jsonc
// packages/plugins/<name>/package.json — the shape they share
{ "dependencies": { "@geoleaf/core": "^3.0.0" } }
```

The list of published plugins and their versions is not restated here — it changes, and a
count written by hand goes wrong the first time one is added or merged away. Read it with
`npm run versions:check`.

::: warning

**`dependencies`, not `peerDependencies` — and the difference is not cosmetic.** A peer
dependency asks the consumer to supply the core and merely warns on mismatch; a regular
dependency lets npm **install its own copy** next to the one the consumer already has. For a
library that mounts a global `GeoLeaf` namespace, two copies in one tree is a different
problem from an unenforced range.

That choice is settled: the ranges were tightened from `*` to `^3.0.0` on 2026-08-09.
Under `*` a plugin built against V3 installed silently alongside a V2 core — which is what
would have happened at the first publication, `latest` for `@geoleaf/core` being `2.1.8` at
the time. `check-versions.cjs` now guards the range.

:::

Some plugins additionally declare a peer dependency on `maplibre-gl` — never on the core.
Which ones is derived, not listed here.

---

## Important

As of **Platform V3** (July 2026), the technical SemVer baseline is **3.0.x**
(`@geoleaf/core@3.0.0`). For future major/minor bumps, update `package.json`
and all relevant documentation consistently.

No further releases are planned on the `1.x` or `2.x` branches.
