/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description The question both callers of the theme loader ask first: does the active profile
 * declare any theme at all?
 *
 * Apart from `theme-loader.ts` so that the loader keeps its documented fallback untouched, and
 * so that a caller can ask without importing the loader's cache and fetch.
 */

import { getGeoLeaf } from "../../utils/general/geoleaf-global.js";
import { asObject } from "../../utils/general/type-guards.js";
import { ProfileLoader } from "../config/profile-loader.js";

/**
 * Whether the active profile is a MODULAR profile without a `themes` block — one that declares
 * no theme.
 *
 * A modular profile resolves its themes INTO the active profile, which is where
 * `ThemeLoader` reads them without a request. Without that block, the loader falls back
 * to the legacy `profiles/<id>/themes.json`, which can only 404 for such a profile — retried
 * after 1 s. The two callers of the loader ask this first: the boot's theme engine, whose
 * request the reveal waited for, and the theme selector, whose request came after it. A LEGACY
 * profile still goes through the loader: its themes do live in that file.
 *
 * ⚠️ Asked by the CALLERS, not inside the loader: its fallback to the legacy file is a
 * documented contract, and a profile whose shape cannot be read must still reach it.
 *
 * @param config - The `GeoLeaf.Config` facade, read loosely. Defaults to the live one.
 * @returns `true` only when the active profile is readable, modular, and carries no `themes`.
 * @example
 * if (!declaresNoThemes()) {
 *     const themes = await ThemeLoader.loadThemesConfig(profileId);
 * }
 */
export function declaresNoThemes(
    config: Record<string, unknown> | null = asObject(getGeoLeaf()?.Config)
): boolean {
    const getActiveProfile = config?.getActiveProfile;
    const profile = asObject(
        typeof getActiveProfile === "function" ? getActiveProfile.call(config) : null
    );
    if (!profile || profile.themes !== undefined) return false;
    return ProfileLoader.isModularProfile(profile);
}
