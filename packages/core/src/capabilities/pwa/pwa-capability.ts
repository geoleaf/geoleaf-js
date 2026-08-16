/*!
 * GeoLeaf Core (pwa capability) — Capability declaration
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Capability declaration for the in-core `pwa` capability (S14 Phase A).
 *
 * Bundles the Progressive-Web-App surface that used to live under the top-level
 * `pwa.*` config: the unified service-worker registration, the install prompt
 * (Android banner + iOS instructions) and the web-app manifest fields. This is the
 * *app-installable* layer — the heavy offline data engine is a separate capability
 * (`modules.offline`, Phase B) that depends on this one.
 *
 * Registered by the preset loop (Pass 1) so that
 * `GeoLeaf.Introspection.getAllCapabilities()` / `getCapabilitySchema('pwa')` work.
 *
 * Config gate: `modules.pwa.enabled`. **Opt-in** (`enableWhenAbsent: false`) — the
 * PWA is off unless a profile/app explicitly enables it (no SW, no prompt). Unlike
 * the per-profile capabilities, `modules.pwa.*` is **app-global** (lives in the base
 * `geoleaf.config.json`), so it is present in `baseCfg` even pre-merge; the SW/prompt
 * gating is nonetheless enforced pull-based, post-merge, by `PwaLifecycle` from
 * `shared.module` #7 (reads the merged `Config.get('modules.pwa…')`).
 *
 * ⚠ **This block spans two consumers, and the schema now says which is which (B.30).**
 * A `modules.pwa` key is read by the RUNTIME (this bundle, at boot), by the BUILD
 * (`scripts/build-deploy.cjs`, which merges the block into the deployed
 * `manifest.json`), or by both:
 *
 * | key                                     | runtime | build |
 * | --------------------------------------- | ------- | ----- |
 * | `enabled`                               | ✅ gate | —     |
 * | `installPrompt.enabled`                 | ✅      | —     |
 * | `offlineDetector.enabled`               | ✅      | —     |
 * | `name`, `short_name`                    | ✅      | ✅    |
 * | `description`, `theme_color`, `background_color` | —  | ✅ only |
 *
 * The last row is the one that misleads: those three exist in-core as TYPE members
 * (`PWAConfig`, pwa-manager.ts) and nowhere else — no runtime code reads them, so
 * changing one has no effect until `npm run build:deploy` regenerates the manifest.
 * They are NOT dead: `build-deploy.cjs` consumes each, in its manifest merge. The two-sided keys
 * `name` / `short_name` are the contrast that makes the distinction visible — the
 * runtime reads them for the install banner's app name
 * (`PwaLifecycle.init` → `PWAManager.init`), the build writes them to the manifest.
 * `PwaLifecycleConfig` already encodes the runtime half as a
 * `Pick<PWAConfig, …>`; `__tests__/capabilities/pwa/manifest-only-keys.test.js` pins it.
 */

import type { ICapabilityDeclaration } from "../../contracts/capability.contract.js";

/** In-core capability declaration for the PWA (service worker + install prompt + manifest). */
export const PWA_CAPABILITY: ICapabilityDeclaration = {
    id: "pwa",
    label: "PWA",
    description:
        "Installable Progressive Web App: unified service worker, install prompt and web-app manifest.",
    gate: { configPath: "modules.pwa.enabled", enableWhenAbsent: false },
    configSchema: {
        enabled: {
            type: "boolean",
            default: false,
            description:
                "Master gate (opt-in): register the service worker, enable the install prompt and emit the manifest.",
        },
        name: {
            type: "string",
            description:
                "Full application name. RUNTIME + BUILD: the install banner falls back to it " +
                "when `short_name` is absent (`PWAManager.init`), and the build writes it to " +
                "the deployed manifest `name` (`build-deploy.cjs`, manifest merge).",
        },
        short_name: {
            type: "string",
            description:
                "Short name shown under the home-screen icon. RUNTIME + BUILD: it is the app " +
                "name in the install banner (`PWAManager.init`) and the manifest " +
                "`short_name` (`build-deploy.cjs`, manifest merge).",
        },
        description: {
            type: "string",
            description:
                "Application description. BUILD-TIME ONLY — read solely by " +
                "`scripts/build-deploy.cjs` (manifest merge) to fill the deployed manifest.json; no runtime " +
                "code reads it, so a change takes effect only on the next deploy build.",
        },
        theme_color: {
            type: "string",
            description:
                "Theme color for the browser chrome / splash screen (hex). BUILD-TIME ONLY — " +
                "`scripts/build-deploy.cjs` (manifest merge) → manifest.json; not read at runtime.",
        },
        background_color: {
            type: "string",
            description:
                "Background color for the PWA splash screen (hex). BUILD-TIME ONLY — " +
                "`scripts/build-deploy.cjs` (manifest merge) → manifest.json; not read at runtime.",
        },
        installPrompt: {
            type: "object",
            description:
                "Custom install banner (Android `beforeinstallprompt` + iOS instructions).",
            properties: {
                enabled: {
                    type: "boolean",
                    default: false,
                    description: "Show the install banner when the browser signals installability.",
                },
            },
        },
        offlineDetector: {
            type: "object",
            description: "Online/offline connectivity badge.",
            properties: {
                enabled: {
                    type: "boolean",
                    default: false,
                    description: "Show a connectivity status badge.",
                },
            },
        },
    },
    // No loader: the SW registration + prompt are inline (tiny, boot-time). The heavy
    // offline engine is the separate `modules.offline` capability (dynamic loader).
};
