/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf PWA — public facade
 *
 * @description
 * Exposes the PWA install prompt manager via `GeoLeaf.PWA` (UMD) and as a
 * named ESM export `{ PWA }` from the ESM bundle entry point.
 *
 * Activated automatically by `app/boot.ts` after config is loaded.
 * Configure via the `pwa` section in `geoleaf.config.json`.
 *
 * @see {@link ../capabilities/pwa/public-api.ts} for the declared surface
 *
 * @remarks
 * The install prompt itself is **declarative**: it is driven by the
 * `pwa.installPrompt.enabled` config flag and the browser's native
 * `beforeinstallprompt` signal. `PWA.init(config)` is invoked automatically by
 * `app/boot.ts` (no-op unless `installPrompt.enabled === true`) — you never call it.
 *
 * The one imperative method is {@link PWAManager.isInstallable}, for integrators who
 * want to render their own install button rather than the built-in banner.
 */

export { PWA } from "../capabilities/pwa/public-api.js";
export type { PWAConfig, InstallPromptConfig } from "../capabilities/pwa/public-api.js";
