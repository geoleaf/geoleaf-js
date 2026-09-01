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
    /**
     * Legacy profile key, read **only** when {@link UISlotGuards.profileKey} is not
     * defined in the loaded configuration.
     *
     * 🛑 **Why this field exists, and why it is not debt.** `INV-CONFIG` (Plugin
     * Contract v1 §5, frozen) requires a plugin's configuration to live under
     * `modules.<pluginId>`. Five plugins declared their button under `ui.show<Name>`
     * — outside that branch. Migrating dryly would have made **a button disappear**
     * for any integrator whose profile carries the old key: measured, two of them
     * (`ui.showEditor`, `ui.showCacheButton`) are declared in
     * `profiles/schemas/ui.schema.json` **and** carried by three repo profiles.
     *
     * The canonical key **wins whenever present**; the legacy one serves only as a
     * fallback. An already-migrated profile therefore never depends on this field,
     * and an old profile keeps working unmodified — migration is nobody's burden.
     *
     * ⚠️ **Do not use it to introduce a second convention.** It exists only to
     * absorb the ones that predate `INV-CONFIG`; a new plugin declaring it would
     * invent debt instead of settling it. `PC-14` guards this point.
     */
    legacyProfileKey?: string;
    defaultVisible?: boolean;
    requiresPlugin?: string;
}

/** How the caller wants the three guards evaluated. */
interface UISlotVisibilityOptions {
    /** Evaluate the `requiresPlugin` guard. Lazy slots skip it — they are the plugin. */
    checkRequiresPlugin: boolean;
    /** Use `defaultVisible` as the config fallback. Lazy slots always fall back to visible. */
    useDefaultVisible: boolean;
    /**
     * Plugin id whose `modules.<id>.enabled` flag gates this slot — set by the LAZY renderers
     * only, and deliberately left unset on the registry path.
     *
     * 🛑 **Why this field exists: without it, the same profile flag yielded two
     * OPPOSITE verdicts depending on the load path.** The `entry.ts` of `print`,
     * `measure` and `editor` wraps its registration in
     * `if (getXConfig().enabled !== false)` — a disabled module therefore has no
     * button for an integrator loading the bundle themselves.
     * ⚠️ **Three other lazy-slot plugins do NOT gate** (`table`, `geocoding`,
     * `position-share`): the field is thus set by the renderers **as an opt-in**,
     * never uniformly — see `PluginLazyUI.gateOnModuleEnabled`. The lazy slot,
     * meanwhile, is declared by `apps/geoleaf-app/init.js` **before the profile
     * loads**: it cannot read `enabled` at declaration time, and so never read it.
     * Measured on 20/08/2026 on `demo.full`: `modules.print.enabled: false` → 0
     * buttons through the eager path, 1 VISIBLE button through the lazy path.
     *
     * The guard is therefore set HERE, at RENDER, the only moment the merged
     * configuration exists.
     *
     * ⚠️ **Useless on the registry path**: `entry.ts` already filtered at
     * registration there, and in-core capabilities have their own grid
     * (`presets/apply-preset.ts`). Adding it would double a guard instead of
     * filling one.
     */
    moduleGateId?: string;
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

/*
 * Resolves the configured visibility, canonical key first, legacy as fallback.
 *
 * 🛑 **THE `undefined` SENTINEL IS WHAT MAKES THE FALLBACK POSSIBLE**, and it is not
 * decorative: `get(key, fallback)` returns the fallback when the key is absent,
 * which makes "not declared" and "declared `true`" **indistinguishable**. Querying
 * with no default distinguishes the three states — absent, `true`, `false` — the
 * only way to know whether the legacy key must be consulted.
 *
 * The canonical key **wins whenever present**; the legacy one only speaks in its
 * silence. An already-migrated profile is therefore never governed by the old
 * value, even if it still lingers in the file — otherwise the fallback would be a
 * trap instead of a transition.
 *
 * 📌 Extracted from {@link resolveUISlotVisibility} on 17/08/2026: the fallback
 * pushed its cyclomatic complexity to **22 for a ceiling of 20**, and the lint said
 * so. The threshold played its role — the guard did two things, it now does one per
 * function.
 */
function _configuredVisibility(
    def: UISlotGuards,
    opts: UISlotVisibilityOptions
): boolean | undefined {
    const cfg = getGeoLeaf()?.Config as SlotConfigLike | undefined;
    let visible = cfg?.get?.(def.profileKey as string, undefined);
    if (visible === undefined && def.legacyProfileKey) {
        visible = cfg?.get?.(def.legacyProfileKey, undefined);
    }
    if (visible === undefined) {
        return opts.useDefaultVisible ? (def.defaultVisible ?? true) : true;
    }
    return visible as boolean;
}

/**
 * Resolves whether a registry / lazy-plugin UI slot button should be rendered.
 *
 * Three guards, in order:
 * 1. `profileKey` — hidden when `Config.get(profileKey)` is explicitly `false`.
 * 2. `requiresPlugin` — hidden unless the plugin is loaded OR lazy-available.
 * 3. `moduleGateId` — hidden when `modules.<id>.enabled` is explicitly `false` (lazy slots only).
 *
 * @param def - The slot definition carrying the guard fields.
 * @param opts - Which guards to apply and how to resolve the config fallback.
 * @returns `true` when the button should be built, `false` when a guard rejects it.
 */
export function resolveUISlotVisibility(def: UISlotGuards, opts: UISlotVisibilityOptions): boolean {
    // Guard 1 — profileKey: respect config-driven visibility (IModuleUISlot contract)
    if (def.profileKey && _configuredVisibility(def, opts) === false) return false;

    // Guard 2 — requiresPlugin: show if loaded OR lazy-available (S4 lazy-load)
    if (opts.checkRequiresPlugin && def.requiresPlugin) {
        const pluginReg = getGeoLeaf()?.plugins as SlotPluginsLike | undefined;
        const loaded = pluginReg?.isLoaded?.(def.requiresPlugin);
        const lazyAvailable = pluginReg?.isLazyAvailable?.(def.requiresPlugin);
        if (!loaded && !lazyAvailable) return false;
    }

    // Guard 3 — module gate: do not offer a slot for a module the profile switched off.
    //
    // 🛑 OPT-OUT (`=== false`), and this is not a style detail: it is the EXACT
    // semantics of the `!== false` the three `entry.ts` carry. An `=== true` would
    // make any button whose profile does not declare the module disappear —
    // measured, `profiles/tourism` declares NEITHER `print`, NOR `measure`, NOR
    // `editor`, and their three buttons are legitimate. Only an EXPLICIT
    // deactivation removes the button.
    if (opts.moduleGateId) {
        const cfg = getGeoLeaf()?.Config as SlotConfigLike | undefined;
        if (cfg?.get?.(`modules.${opts.moduleGateId}.enabled`, undefined) === false) return false;
    }

    return true;
}
