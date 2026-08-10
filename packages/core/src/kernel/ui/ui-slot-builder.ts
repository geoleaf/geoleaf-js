/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf UI – Shared helpers for building registry / lazy-plugin UI slot buttons.
 *
 * Lives in `ui/` root because both `ui/desktop/` and `ui/mobile/` consume it and
 * the ESLint `no-restricted-imports` boundary forbids them from importing each
 * other (archi B.4). Extracted in KERNEL S8 from the two byte-identical guard
 * blocks in `desktop-panel-slots.ts` and `mobile-toolbar-pill.ts`.
 */

import { getGeoLeaf } from "../../utils/general/geoleaf-global.js";

/**
 * SVG tags allowed in module-provided icon markup.
 *
 * Shared by the desktop tab strip and the mobile pill: both route
 * `IModuleUISlot` icons through `DOMSecurity.setSafeHTML` with this allowlist.
 */
export const UI_SLOT_SVG_TAGS: string[] = [
    "svg",
    "path",
    "circle",
    "rect",
    "line",
    "polyline",
    "polygon",
    "g",
    "defs",
    "use",
];

/**
 * Guard members read off an `IModuleUISlot` entry.
 *
 * Structural rather than a union of `mobileIcon` / `desktopTabButton` so it
 * accepts both — they declare the same three fields with the same semantics
 * (the contract says so explicitly), differing only in whether `profileKey`
 * is required.
 */
interface UISlotGuards {
    profileKey?: string;
    defaultVisible?: boolean;
    requiresPlugin?: string;
}

/** How the caller wants the two guards evaluated. */
interface UISlotVisibilityOptions {
    /** Evaluate the `requiresPlugin` guard. Lazy slots skip it — they are the plugin. */
    checkRequiresPlugin: boolean;
    /** Use `defaultVisible` as the config fallback. Lazy slots always fall back to visible. */
    useDefaultVisible: boolean;
}

/** Subset of `GeoLeaf.Config` read when resolving `profileKey` visibility. */
interface SlotConfigLike {
    get?: (key: string, def?: unknown) => unknown;
}

/** Subset of `GeoLeaf.plugins` read when resolving the `requiresPlugin` guard. */
interface SlotPluginsLike {
    isLoaded?: (name: string) => boolean;
    isLazyAvailable?: (name: string) => boolean;
}

/**
 * Resolves whether a registry / lazy-plugin UI slot button should be rendered.
 *
 * Two guards, in order:
 * 1. `profileKey` — hidden when `Config.get(profileKey)` is explicitly `false`.
 * 2. `requiresPlugin` — hidden unless the plugin is loaded OR lazy-available.
 *
 * @param def - The slot definition carrying the guard fields.
 * @param opts - Which guards to apply and how to resolve the config fallback.
 * @returns `true` when the button should be built, `false` when a guard rejects it.
 */
export function resolveUISlotVisibility(def: UISlotGuards, opts: UISlotVisibilityOptions): boolean {
    // Guard 1 — profileKey: respect config-driven visibility (IModuleUISlot contract)
    if (def.profileKey) {
        const cfg = getGeoLeaf()?.Config as SlotConfigLike | undefined;
        const fallback = opts.useDefaultVisible ? (def.defaultVisible ?? true) : true;
        const visible = cfg?.get?.(def.profileKey, fallback);
        if (visible === false) return false;
    }

    // Guard 2 — requiresPlugin: show if loaded OR lazy-available (S4 lazy-load)
    if (opts.checkRequiresPlugin && def.requiresPlugin) {
        const pluginReg = getGeoLeaf()?.plugins as SlotPluginsLike | undefined;
        const loaded = pluginReg?.isLoaded?.(def.requiresPlugin);
        const lazyAvailable = pluginReg?.isLazyAvailable?.(def.requiresPlugin);
        if (!loaded && !lazyAvailable) return false;
    }

    return true;
}
