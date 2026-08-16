/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */
/**
 * @description Facade public of the UI module.
 * Exposes {@link UI} — the main UI orchestrator that coordinates theme management,
 * notifications, the mobile toolbar, the desktop side-panel and event delegation.
 *
 * ⚠️ The **filter panel is NOT here**: it is owned by the in-core `filter` capability,
 * which mounts it on `geoleaf:app:ready`. Reach it through `GeoLeaf.Filter`, never through
 * this façade — the former filter-panel shims were removed from `getModuleStatus` at S13,
 * and no toggle survives on this surface.
 *
 * @see `kernel/ui/ui-api.ts` for the full implementation
 *
 * @example
 * ```ts
 * GeoLeaf.UI.init({ map, config: profileConfig });
 * GeoLeaf.UI.applyTheme("dark");
 * ```
 */

export { UI } from "../kernel/ui/ui-api.js";
