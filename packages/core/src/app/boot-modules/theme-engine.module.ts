/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * ThemeEngineModule — `ICoreModule` that applies the profile's DEFAULT theme at boot.
 *
 * Kernel, unconditional. S8/F2 decouples the default-theme application from the
 * theme-selector UI: the engine (loader + applier, kept in core) applies the
 * default theme independently of whether the selector capability is enabled. The
 * selector, when present, only builds the switch UI and reflects the active theme.
 *
 * Ordering (`dependencies` = `["geojson", "ui"]`):
 * - `geojson` — layers loaded (hot registry) before the applier runs → TOGGLE branch.
 * - `ui` — `setupReveal` (#23) + the permalink listeners are registered before the
 *   `geoleaf:theme:applied` this init dispatches; otherwise the reveal would fall back
 *   to the 5 s safety timeout and permalink layer/filter restore would be missed.
 * Depending on `ui` is safe (no `route`-style deadlock): after F2, `UIModule.init`
 * no longer drives the theme work eagerly (the block was removed from `initGeoJSON`),
 * so it never waits on this module.
 */

import type { ILifecycleModule } from "../../contracts/core-module.contract.ts";
import type { IMapAdapter } from "../../contracts/map-adapter.contract.ts";
import type { IGeoLeafConfig } from "../../contracts/config.contract.ts";
import { ensureGeoLeaf } from "../../utils/general/geoleaf-global.js";
import { ThemeLoader } from "../../kernel/themes/theme-loader.js";
import { ThemeApplierCore, type ThemeConfig } from "../../kernel/themes/theme-applier/core.js";
import { ProfileLoader } from "../../kernel/config/profile-loader.js";
import { asFn, type AppNamespace } from "../app-types.js";
import { asObject } from "../../utils/general/type-guards.js";

/**
 * Whether the active profile is a MODULAR profile without a `themes` block — one that declares
 * no theme.
 *
 * A modular profile resolves its themes INTO the active profile, which is where the theme loader
 * reads them without a request. Without that block, the loader falls back to the legacy
 * `profiles/<id>/themes.json`, which can only 404 for such a profile — retried after 1 s. The
 * reveal of a profile without any theme waits for the end of the registry, i.e. for this module:
 * measured on tourism stripped of its themes, four 404s and 1.1 to 2.1 s of veil. A LEGACY
 * profile still goes through the loader: its themes do live in that file.
 *
 * @param config - The `GeoLeaf.Config` facade, read loosely.
 * @returns `true` only when the active profile is readable, modular, and carries no `themes`.
 */
function _declaresNoThemes(config: Record<string, unknown> | null): boolean {
    const getActiveProfile = asFn(config?.getActiveProfile);
    const profile = asObject(getActiveProfile ? getActiveProfile.call(config) : null);
    if (!profile || profile.themes !== undefined) return false;
    return ProfileLoader.isModularProfile(profile);
}

/**
 * Applies the active profile's default theme once at boot, when themes exist.
 * The selector no longer applies it (F2) — this is the single boot apply.
 */
export class ThemeEngineModule implements ILifecycleModule {
    readonly id = "theme-engine" as const;
    readonly dependencies = ["geojson", "ui"] as const;

    async init(_adapter: IMapAdapter, _config: IGeoLeafConfig): Promise<void> {
        const GeoLeaf = ensureGeoLeaf();
        const AppLog = ((GeoLeaf._app ?? {}) as AppNamespace).AppLog;
        try {
            const config = asObject(GeoLeaf.Config);
            const getActiveProfileId = asFn(config?.getActiveProfileId);
            const profileId = getActiveProfileId ? getActiveProfileId.call(config) : null;
            if (typeof profileId !== "string" || !profileId) return;
            if (_declaresNoThemes(config)) return;

            // Same source as the (now UI-only) ThemeSelector.init: the loader resolves
            // `defaultTheme` to `themes[0]` when unset, and returns `null` only when the
            // profile declares no theme → byte-identical default selection.
            const themesConfig = await ThemeLoader.loadThemesConfig(profileId);
            const defaultId = themesConfig.defaultTheme;
            if (!defaultId) return; // no theme → nothing to apply (reveal via no-theme path)

            const theme = themesConfig.themes.find((t) => t.id === defaultId);
            if (!theme) return;

            // Dispatches `geoleaf:theme:applied` → reveal + permalink + toast + the
            // theme-selector `_onAppReady` (all already subscribed: this runs after `ui`
            // and after every `geojson`-freed module). Also on a profile whose `themes` has no
            // `defaultTheme`: the loader resolved `themes[0]` above, and this apply reveals
            // before the boot's own release (`releaseThemelessReveal`), which is then a no-op.
            await ThemeApplierCore.applyTheme(theme as ThemeConfig);
        } catch (e) {
            // init() MUST NOT reject — a rejection aborts the ModuleRegistry chain.
            AppLog?.warn?.("[ThemeEngine] Default theme apply failed (non-fatal):", e);
        }
    }

    destroy(): void {
        // Recreate: the applier singleton's layer state is cleared by the GeoJSON reset
        // paths on module teardown; no dedicated teardown here. `destroy` must be a
        // function — the registry validates init + destroy as a pair.
    }
}
