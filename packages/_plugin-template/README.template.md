# `_plugin-template/` — Canonical GeoLeaf plugin scaffold

> Not a published package. This is the source template consumed by
> `scripts/create-plugin.cjs` to generate a new Plugin Contract v1-compliant
> plugin. It is excluded from the contract scan and the workspace plugin globs.

## Generate a plugin

```sh
node scripts/create-plugin.cjs <name> [--ui] [--i18n] [--map]
# or:  npm run create:plugin -- <name> --ui --i18n
```

- `<name>` — kebab-case plugin id (e.g. `heatmap`). Produces `packages/plugins/<name>/`.
  Every plugin is MIT and published to npmjs with public access — nothing to pick.
  ⚠️ This line read `packages/plugin-<name>/` until 31/07/2026 — the pre-ARCHI-S10 layout.
  `create-plugin.cjs` has emitted under `packages/plugins/<name>/` for a long time, and says so in
  a comment right above the code that does it. A scaffold README is the one document where a
  stale path is re-seeded into every package created after it.
- `--ui` — keep the toolbar slot, event listener, CSS and the root element built by
  `<name>-api.ts`. The `config.ts` reader is emitted with or without it.
- `--i18n` — keep the i18n dictionaries and `registerDict()` call.
- `--map` — keep `maplibre-gl` as an externalised peer dependency.

The generator substitutes placeholders, strips the flag-gated blocks whose flag
is off, removes the files that belong to disabled flags, then runs structural
PC-01…PC-12 self-checks on the result.

**Nothing to register by hand for the contract scan.** `verify-plugin-contract.cjs` derives its `PLUGINS` list from
`scripts/lib/packages.cjs` (`registry.plugins()`), itself derived from the `workspaces` globs —
a new plugin is enrolled in the repo-wide scan the moment it exists on disk.
⚠️ This paragraph asked to "add the new plugin to the `PLUGINS` table" until 31/07/2026. That
table was hand-typed and has been replaced by the registry precisely because a list nobody
derives is a list nobody checks.

## What a generated plugin is born passing, and what its author still enrols

`verify-plugin-scaffold.cjs` scaffolds two throwaway plugins and holds them to the repo's own
gates: typecheck, Plugin Contract v1, module headers, README rendering, TSDoc, dead CSS,
README ↔ config, façade purity, module graph, a discoverable `geoleaf` descriptor, the
package's own coverage threshold — and the core's guards with the typecheck of the test suites
(SCAF-14). A template change that breaks one of them reddens that gate.

The rest stays with the author, because each step is an entry in a file the plugin does not
own; `create-plugin.cjs` prints them all, and SCAF-14 accepts a core-guard red only if one of
them announces it. Among them: the package's entry in `knip.js`, its mounted API type in the
orphan-export list AND its frozen key, the bundle's import in the app's `init.js`, the
namespace's declaration in the core's `GeoLeafGlobal`, its consumption witness, its HOST-02
exemption, the three documents of its configuration (sheet, README table, inventory), and the
generated references. The printed list is the reference — this paragraph does not count it.

## Placeholders

| Token                  | Meaning                                                 |
| ---------------------- | ------------------------------------------------------- |
| `__PLUGIN_NAME__`      | kebab-case id (registry id, bundle name, namespace key) |
| `__PLUGIN_NAMESPACE__` | PascalCase namespace mounted on `GeoLeaf.*`             |
| `__PLUGIN_PKG__`       | full npm package name                                   |

## Flag-gated blocks

Code spans delimited by `/* <ui> */ … /* </ui> */`, `<i18n>`, `<map>` are kept
when the flag is on and removed (delimiters and content) when off.
