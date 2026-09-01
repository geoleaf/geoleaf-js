/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Profile-switcher capability — the selector DOM.
 *
 * Mirrors the layer manager's own style-selector idiom (`div > select` carrying an
 * `aria-label`, since there is no visible `<label>` to associate).
 */

import { domCreate } from "../../utils/general/dom-helpers.js";
import { getLabel } from "../../utils/i18n/i18n.js";
import type { AvailableProfileEntry } from "../../kernel/config/geoleaf-config/config-types.js";

/**
 * Root class of the injected control — also the idempotency marker.
 *
 * ⚠️ Class names are written as **string literals** here, never composed
 * (`` `${ROOT}__select` ``). purgecss scans the sources statically: a name it cannot
 * read as a literal is reported as a dead rule and the style gets stripped from the
 * production CSS — the control would render unstyled, with every test still green.
 */
export const PROFILE_SWITCHER_CLASS = "gl-profile-switcher";

/** Class of the `<select>` itself — literal, for the reason above. Module-local. */
const PROFILE_SELECT_CLASS = "gl-profile-switcher__select";

/**
 * Builds the profile selector.
 *
 * @param profiles - Profiles to offer (caller guarantees ≥ 2).
 * @param activeId - Currently active profile id, reflected as the selected option.
 * @param onSwitch - Called with the chosen id when it differs from `activeId`.
 * @returns The container element, ready to insert.
 */
export function createProfileSelect(
    profiles: AvailableProfileEntry[],
    activeId: string | null,
    onSwitch: (id: string) => void
): HTMLElement {
    const container = domCreate("div", PROFILE_SWITCHER_CLASS);

    const select = domCreate("select", PROFILE_SELECT_CLASS, container);
    // WCAG 2.1 AA (4.1.2 Name, Role, Value): no visible <label> is attached, so the
    // control needs an accessible name of its own.
    select.setAttribute("aria-label", getLabel("aria.profile_switcher.select"));

    for (const profile of profiles) {
        const option = document.createElement("option");
        option.value = profile.id;
        // textContent, never innerHTML: `displayLabel` and `icon` come from a profile
        // JSON, i.e. data the core does not author.
        option.textContent = profile.icon
            ? `${profile.icon} ${profile.displayLabel}`
            : profile.displayLabel;
        if (profile.id === activeId) option.selected = true;
        select.appendChild(option);
    }

    select.addEventListener("change", () => {
        const chosen = select.value;
        // Re-selecting the active profile would reload for nothing.
        if (!chosen || chosen === activeId) return;
        onSwitch(chosen);
    });

    return container;
}

/**
 * Reflects `activeId` in an already-built selector.
 *
 * The active profile is only known once the config has loaded, which can be after the
 * layer manager built its panel — so the selector is created first and synced after.
 */
export function syncProfileSelect(container: HTMLElement, activeId: string): void {
    const select = container.querySelector<HTMLSelectElement>(`.${PROFILE_SELECT_CLASS}`);
    if (select && select.value !== activeId) select.value = activeId;
}
