---
title: "GeoLeaf Versioning Policy"
---

# GeoLeaf Versioning Policy

**Product version:** Platform V3
**Technical SemVer line:** `@geoleaf/core` `3.x` — the only line; no new major is planned

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

| Change type                                              | Version bump                  |
| -------------------------------------------------------- | ----------------------------- |
| New feature, new module, new named export (non-breaking) | MINOR (3.X.0)                 |
| Bug fix, performance patch, security fix                 | PATCH (3.X.Y)                 |
| Removal, or any other breaking change                    | see below — never a new MAJOR |

**No new major line is planned: 3.x is the only one.** A new public member, however small, is
a minor: a consumer who needs it can then require the version that introduced it. A change
that adds nothing and fixes something is a patch, and such fixes are published as patches
between two minors when they are ready.

### Breaking changes: the pre-adoption window (decided 24/08/2026, restated 13/09/2026)

A consumer who follows a semver range receives every minor automatically, so a breaking change
shipped in a minor breaks it without its consent. While the packages have **no such consumer**
— no integrator installs from the registry with a semver range, so nobody upgrades
automatically — a breaking change justified as better long-term MAY land in a later 3.x minor,
on two conditions:

- it was **announced** in an earlier published version (§Deprecation below);
- it is labelled **BREAKING** in the CHANGELOG, with its justification, so an adopter reading
  the release notes sees exactly what moved.

This window closes by observation, not by date: the first consumer that follows a semver range
closes it. **Once it is closed, nothing public is removed any more.** What would have gone
stays, and is declared unsupported instead.

::: warning

**One removal skipped the announcement:** `GeoLeaf.Security.CSRFToken` and the `csrf` write
authentication, in 3.4.0. The module minted its token in the browser and checked it there, so no
server could verify it — nothing it did could be relied on. The exception is recorded, with its
justification, in the 3.4.0 notes; it is not a precedent.

:::

---

## Deprecation

A public symbol is never removed without notice, and the notice is what makes a removal
predictable instead of surprising.

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

| Field         | Meaning                                        | Constraint                                                                    |
| ------------- | ---------------------------------------------- | ----------------------------------------------------------------------------- |
| `since`       | the version that first shipped the tag         | within the 3.x line                                                           |
| `removeIn`    | the version that removes the symbol            | a later 3.x **minor** (`3.y.0`), strictly after the version under preparation |
| `replacement` | what to use instead                            | must resolve on the current published surface                                 |
| `symbol`      | where the tag lives, as `path.ts#Owner.member` | must designate a real `@deprecated` declaration                               |

A deprecation whose `replacement` does not resolve is refused: **a symbol is not deprecated
towards nothing.** If no replacement exists, the symbol is not deprecated — it is
unsupported, which is a different statement, made elsewhere.

### How long the announcement must stand

**The announcement must survive at least one published version, and `removeIn` is a later
minor.** These are one rule, not two: the announcement enters on a published 3.x version, and
the removal lands on a minor published after it — never on a patch, which promises a fix.

::: danger

A release that both announces and removes announces nothing. `removeIn` must be strictly after
the version under preparation — an announcement dated in the present is a removal one warns
about afterwards. And the clock runs on **published** versions, never on commits: a
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

Two halves of this policy are facts no gate reads: whether the announcing version was
**published**, and whether the pre-adoption window is still **open**. They stay with whoever
prepares the release.

A policy with no named verifier goes stale in silence. The verifier is named here for that
reason, and renaming it without updating this section is itself a defect.

---

## Plugin Versioning

Plugins are versioned independently of the core: a plugin's own version says nothing
about which core it targets. That relationship is carried by the range each plugin declares on
the core — **as a peer dependency**.

Every published plugin is MIT, and each lists `@geoleaf/core` under `peerDependencies` at range
`^3.0.0` (and under `devDependencies`, so the workspace resolves it for the plugin's own build
and tests):

```jsonc
// packages/plugins/<name>/package.json — the shape they share
{ "peerDependencies": { "@geoleaf/core": "^3.0.0" } }
```

The list of published plugins and their versions is not restated here — it changes, and a
count written by hand goes wrong the first time one is added or merged away. Read it with
`npm run versions:check`.

::: warning

**`peerDependencies`, not `dependencies` — and the difference is not cosmetic.** With a regular
dependency, two plugins whose ranges do not overlap make npm install **a second copy** of the
core next to the consumer's, silently. Both copies then mount the same global `GeoLeaf`
namespace, so the application runs on duplicated state behind a single global — invisible on
inspection. As a peer, the core is supplied once, by the consumer, and a range mismatch fails
**at install**, loudly, instead of at runtime. npm installs peers automatically since its
version 7, and Node ≥ 22 is already required, so no supported consumer pays a cost.

The ranges were tightened from `*` to `^3.0.0` on 2026-08-09, and moved from `dependencies` to
`peerDependencies` on 2026-08-25. `check-versions.cjs` guards the range.

:::

Some plugins additionally declare a peer dependency on `maplibre-gl`. Which ones is derived,
not listed here.

---

## Important

As of **Platform V3** (July 2026), the technical line is **3.x**, and no new major line is
planned. Bumps follow the table above; `package.json` and the relevant documentation are
updated together.

No further releases are planned on the `1.x` or `2.x` branches.
