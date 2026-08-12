# @geoleaf/build-config

> Shared build configuration for the monorepo. **Private** package, never published to npm.

It exists to keep the build configuration declarative and, above all, **insensitive to directory
depth** — packages live under `packages/plugins/` and `packages/libs/`, and moving one must not
break anything.

The number of consumer packages is derived rather than restated:

```bash
node -e "const r=require('./scripts/lib/packages.cjs'); console.log(r.all().filter(p=>/^packages\/(plugins|libs)\//.test(p.dir)).length)"
```

## What it holds

| File                   | Role                                |
| ---------------------- | ----------------------------------- |
| `tsconfig.base.json`   | The shared `compilerOptions`        |
| `rollup.mjs`           | Rollup configuration factory        |
| `csp-style-inject.mjs` | CSP-compatible CSS injector         |
| `vitest/*.mjs`         | Vitest base plus resolution plugins |

## How it is consumed

Always **through an npm specifier**, never through a relative path:

```jsonc
// packages/<a-package>/tsconfig.json
{ "extends": "@geoleaf/build-config/tsconfig.base.json" }
```

```js
// packages/<a-package>/rollup.config.mjs
import { pluginConfig } from "@geoleaf/build-config/rollup.mjs";
```

That is the whole point: npm resolves by **name**, so moving the consuming package breaks nothing.
A `../../` would have to be rewritten every time a package moves.

## Two non-negotiable rules

### 1. Everything here is `.mjs` — never `.ts`

**This is a robustness choice, not a technical constraint.** A `.ts` module from this package,
imported by npm specifier from a `vitest.config.ts`, loads without trouble — including with
`NODE_OPTIONS` explicitly emptied — because Vitest transpiles its configuration graph with its own
esbuild loader. The rule is kept for reasons that do not depend on that behaviour:

- `ensure-tsx-node-options.mjs` exists solely to install the loader that would be needed to read it.
  Depending on a transpiler to load the thing that installs the transpiler is a circularity we
  refuse on principle, even where it happens to work.
- Vitest's config-loading behaviour is an implementation detail, not a contract — it **already
  changed between v3 and v4**, and that change is precisely what made `ensure-tsx-node-options`
  necessary.
- An `.mjs` file also loads from a non-Vite context: a bare node script, or a gate, with no
  toolchain at all.

Typing is therefore done in **JSDoc**. A welcome side effect: this package needs no build step to be
ordered in Turborepo.

If the rule ever becomes expensive, it is to be re-discussed as a decision — not treated as an
inherited prohibition.

### 2. `${configDir}` is mandatory on every path in `tsconfig.base.json`

TypeScript resolves relative paths against the file **where they are written**. Without
`${configDir}`, every package whose `tsconfig.json` extends this base would emit into
`packages/build-config/dist`:

```
without ${configDir} → outDir=../dist   rootDir=../src    wrong
with    ${configDir} → outDir=./dist    rootDir=./src     correct
```

The trap is not specific to this package: a `tsconfig.base.json` placed at the repository root would
trigger it identically.

## Why it has no `exports` field

An `exports` map is **exhaustive**: anything absent from it becomes unresolvable. It would therefore
have to declare the `.json` explicitly, or `extends: "@geoleaf/build-config/tsconfig.base.json"`
would stop resolving. Without `exports`, any file in the package is reachable by its path — which is
exactly the behaviour wanted from a private configuration package.

It has no `files[]` either: nothing is published, and the `check-package-files.cjs` gate ignores
packages that declare none.
