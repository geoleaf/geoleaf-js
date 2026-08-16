/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Language-switcher capability — public API surface.
 * Mounted on `GeoLeaf.LanguageSwitcher` via `api/geoleaf.language-switcher.ts`.
 */

import {
    getLanguageSwitcherConfig,
    getOfferedLanguages,
    type LanguageEntry,
    type LanguageSwitcherCapabilityConfig,
} from "./config.js";
import { switchToLanguage } from "./language-switch.js";
import { getActiveLang } from "../../utils/i18n/i18n.js";

/** The object mounted on `GeoLeaf.LanguageSwitcher`. */
export interface LanguageSwitcherPublicApi {
    /** Languages offered by the switcher. */
    list(): LanguageEntry[];
    /** Active language code — delegates to i18n, so the two cannot drift. */
    current(): string;
    /** Persists the choice and reloads with `?lang=`. */
    switchTo(code: string): void;
    /** `true` when the button is enabled (`modules.language-switcher.enabled === true`). */
    isEnabled(): boolean;
    /** The resolved `modules.language-switcher` config. */
    getConfig(): LanguageSwitcherCapabilityConfig;
}

/** Builds the object mounted on `GeoLeaf.LanguageSwitcher`. */
export function buildPublicApi(): LanguageSwitcherPublicApi {
    return {
        list: (): LanguageEntry[] => getOfferedLanguages(),
        current: (): string => getActiveLang(),
        switchTo: (code: string): void => switchToLanguage(code),
        isEnabled: (): boolean => getLanguageSwitcherConfig().enabled === true,
        getConfig: (): LanguageSwitcherCapabilityConfig => getLanguageSwitcherConfig(),
    };
}
