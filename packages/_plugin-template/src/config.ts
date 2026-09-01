/*!
 * __PLUGIN_PKG__ — Config reader
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Config reader for `__PLUGIN_PKG__`.
 *
 * Single door onto the plugin's branch of the profile: `DEFAULTS` states what the plugin does
 * when the profile says nothing, and `getPluginConfig()` merges any override over it. Every
 * other module reads the configuration through here, never through `coreConfigGet` directly —
 * a second reader is a second set of defaults, and the two diverge without a word.
 */

import { coreConfigGet } from "@geoleaf/host-runtime";

const DEFAULTS = {
    enabled: true,
    /* <ui> */
    // Read by the toolbar slot of `entry.ts` as `modules.__PLUGIN_NAME__.showButton` — the
    // SAME branch this file reads. That template declared its button under
    // `ui.show<Namespace>` until 08/08/2026: a second branch, which did not even share this
    // one's casing, so a scaffolded plugin's button could not be switched on from the config
    // its own file documented. INV-CONFIG forbids it; `create-plugin.cjs` now rejects it.
    showButton: true,
    /* </ui> */
} as const;

/**
 * The plugin's configuration, as read from `modules.__PLUGIN_NAME__` in the active profile.
 *
 * ⚠️ This interface is the ORACLE of the plugin's README: `check-plugin-readme-config.cjs`
 * requires every member here to be documented there. Adding a key without documenting it
 * reddens that gate — deliberately, because a key read at runtime and written down nowhere is
 * a setting an integrator cannot find.
 */
export interface PluginConfig {
    /** Mounts the plugin when `true`. The profile may switch it off without unloading it. */
    enabled: boolean;
    /* <ui> */
    showButton: boolean;
    /* </ui> */
    [key: string]: unknown;
}

/**
 * Reads the plugin configuration from the `modules.__PLUGIN_NAME__` namespace of the running
 * core (Plugin Contract v1, INV-CONFIG), merged over the built-in defaults.
 *
 * ⚠️ `modules.__PLUGIN_NAME__` is the plugin's ONLY branch of the profile — never open a
 * second one, whatever the key. See `PLUGIN_ARCHITECTURE_SPEC.md` §5.
 *
 * @returns The merged configuration — built-in defaults under any profile override.
 */
export function getPluginConfig(): PluginConfig {
    const raw = (coreConfigGet<Partial<PluginConfig>>("modules.__PLUGIN_NAME__", {}) ??
        {}) as Partial<PluginConfig>;
    return { ...DEFAULTS, ...raw } as PluginConfig;
}
