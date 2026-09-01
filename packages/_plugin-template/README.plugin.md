# `__PLUGIN_PKG__`

> Scaffolded from `packages/_plugin-template/` by `scripts/create-plugin.cjs`.
> Replace this line and the TODOs below before publishing.

MIT plugin for [GeoLeaf](https://geoleaf.dev). It mounts `GeoLeaf.__PLUGIN_NAMESPACE__` and
registers itself with the core at load time.

## Installation

```sh
npm install __PLUGIN_PKG__
```

Load it **after** `@geoleaf/core` and **before** `GeoLeaf.boot()` — the plugin registers itself
on import, and the core reads that registry once, at boot.

```html
<script type="module" src="./geoleaf.esm.js"></script>
<script type="module" src="./geoleaf-__PLUGIN_NAME__.plugin.js"></script>
```

## Configuration (`modules.__PLUGIN_NAME__.*`)

Every key below is read through `src/config.ts`, the plugin's single door onto the profile.
A key absent from the profile takes the default shown here.

| Key          | Type      | Default | Description                                                                          |
| ------------ | --------- | ------- | ------------------------------------------------------------------------------------ |
| `enabled`    | `boolean` | `true`  | Mounts the plugin. Switching it off leaves the bundle loaded but inert.              |
| /* <ui> */   |
| `showButton` | `boolean` | `true`  | Shows the toolbar button. Read by the core registry through the slot's `profileKey`. |
| /* </ui> */  |

This table is **gated**: `check-plugin-readme-config.cjs` requires every member of
`PluginConfig` (`src/config.ts`) to appear here. Add a key to the interface without documenting
it and the gate reddens — a setting read at runtime and written down nowhere is one an
integrator cannot find.

## Public API (`GeoLeaf.__PLUGIN_NAMESPACE__`)

| Member    | Description                  |
| --------- | ---------------------------- |
| `version` | The plugin's version string. |

TODO: document what `src/public-api.ts` exposes, one row per member.

## License

MIT © 2026 Mattieu Pottier
