/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * desktop-panel-slots.ts
 *
 * Injects registry-declared `desktopTabButton` slots into the desktop tab
 * strip. Extracted from desktop-panel.ts to keep it within the 700-line limit.
 */

import { DOMSecurity } from "../../security/dom-security.js";
import { getGeoLeaf } from "../../../utils/general/geoleaf-global.js";
import { getLabel } from "../../../utils/i18n/i18n.js";
import { dispatchToolbarAction } from "../toolbar-dispatch.js";
import { resolveUISlotVisibility, UI_SLOT_SVG_TAGS } from "../ui-slot-builder.js";
import type { IModuleRegistry, IModuleUISlot } from "../../../contracts/core-module.contract.ts";

type DesktopTabButtonDef = NonNullable<IModuleUISlot["desktopTabButton"]>;

/** Lazy-plugin UI slot — an `IModuleUISlot` paired with its owning plugin id. */
interface LazyUISlot extends IModuleUISlot {
    id: string;
}

/** Subset of `GeoLeaf.plugins` consumed by the desktop-tab builders. */
interface RegistryPluginsLike {
    getLazyUISlots?: () => LazyUISlot[] | undefined;
}

/**
 * Inserts a registry desktop button into the tab strip.
 * - `variant: "tab"` → joins the TOP tab group: inserted before the
 *   `.gl-rp-theme-separator` (whose `margin-top:auto` pushes the icon stack to the
 *   bottom), so it sits right after the native Filtrer/Couches/Légende tabs.
 * - otherwise (icon) → the bottom icon stack, before the theme toggle (or appended).
 */
function _insertTabButton(
    tabs: HTMLElement,
    btn: HTMLElement,
    variant: DesktopTabButtonDef["variant"]
): void {
    if (variant === "tab") {
        const separator = tabs.querySelector(".gl-rp-theme-separator");
        if (separator) {
            tabs.insertBefore(btn, separator);
            return;
        }
    }
    const themeToggle = tabs.querySelector(".gl-rp-theme-toggle");
    if (themeToggle) {
        tabs.insertBefore(btn, themeToggle);
    } else {
        tabs.appendChild(btn);
    }
}

/**
 * Builds a registry/lazy desktop tab button, or returns null when an idempotency,
 * profileKey or requiresPlugin guard rejects it. SVG icon is routed through the sanitizer.
 */
function _buildDesktopTabButton(
    tabs: HTMLElement,
    id: string,
    btnDef: DesktopTabButtonDef,
    opts: { checkRequiresPlugin: boolean; useDefaultVisible: boolean }
): HTMLButtonElement | null {
    // Idempotent
    if (tabs.querySelector(`[data-gl-desktop-tab="${id}"]`)) return null;

    // profileKey + requiresPlugin guards (shared with the mobile pill builder)
    if (!resolveUISlotVisibility(btnDef, opts)) return null;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-gl-desktop-tab", id);
    // Tracked so a late plugin i18n dict (registerDict racing this build) can be
    // re-resolved once on geoleaf:app:ready instead of leaving the raw key baked in.
    btn.dataset.glLabelKey = btnDef.labelKey;
    const label = getLabel(btnDef.labelKey);
    btn.setAttribute("aria-label", label);
    btn.title = label;
    if (btnDef.action) btn.setAttribute("data-gl-toolbar-action", btnDef.action);
    btn.addEventListener("click", () => {
        dispatchToolbarAction(btnDef.action ?? id, btn);
    });
    if (btnDef.variant === "tab") {
        // Vertical-text tab matching the built-in Filtrer/Couches/Légende tabs.
        // Label is plain text (textContent) — the icon is intentionally ignored.
        btn.className = "gl-rp-tab gl-rp-registry-tab-btn";
        btn.textContent = label;
    } else {
        // Default: icon button in the bottom stack.
        btn.className = "gl-rp-tab-btn gl-rp-registry-tab-btn";
        // @security Route module-provided SVG through sanitizer
        DOMSecurity.setSafeHTML(btn, btnDef.icon, UI_SLOT_SVG_TAGS);
    }
    return btn;
}

/**
 * Re-resolves the label of already-inserted registry tab buttons that still show
 * their raw i18n key — happens when a plugin's `registerDict()` call has not run
 * yet at the moment its button is built. Runs once on `geoleaf:app:ready`, by which
 * point every eager plugin script has finished executing, so it is a correctness
 * net for a genuine race rather than the expected path.
 */
function _healStaleLabels(tabs: HTMLElement): void {
    const buttons = tabs.querySelectorAll<HTMLButtonElement>("[data-gl-label-key]");
    buttons.forEach((btn) => {
        const key = btn.dataset.glLabelKey;
        if (!key) return;
        const label = getLabel(key);
        if (label === key) return; // still unresolved — nothing to heal yet
        if (btn.getAttribute("aria-label") === key) btn.setAttribute("aria-label", label);
        if (btn.title === key) btn.title = label;
        if (btn.classList.contains("gl-rp-tab") && btn.textContent === key) {
            btn.textContent = label;
        }
    });
}

let _healListenerBound = false;

/**
 * Adds one tab button per panel declared in the registry.
 *
 * Driven by what is actually registered rather than by a fixed list, which is what lets a
 * plugin contribute a panel without the desktop shell knowing about it in advance.
 *
 * @param tabs - The tab strip the buttons are appended to.
 */
export function appendRegistryTabButtons(tabs: HTMLElement): void {
    const registry = getGeoLeaf()?.registry as IModuleRegistry | undefined;
    if (!registry) return;

    for (const mod of registry.getAll()) {
        const btnDef = mod.ui?.desktopTabButton;
        if (!btnDef) continue;
        const btn = _buildDesktopTabButton(tabs, mod.id, btnDef, {
            checkRequiresPlugin: true,
            useDefaultVisible: true,
        });
        if (btn) _insertTabButton(tabs, btn, btnDef.variant);
    }

    // Lazy plugins (S4): render desktop tab buttons for plugins registered lazy but not yet loaded.
    const pluginReg = getGeoLeaf()?.plugins as RegistryPluginsLike | undefined;
    const lazySlots = pluginReg?.getLazyUISlots?.() ?? [];
    for (const slot of lazySlots) {
        const btnDef = slot.desktopTabButton;
        if (!btnDef) continue;
        const btn = _buildDesktopTabButton(tabs, slot.id, btnDef, {
            checkRequiresPlugin: false,
            useDefaultVisible: false,
        });
        if (btn) _insertTabButton(tabs, btn, btnDef.variant);
    }

    if (!_healListenerBound) {
        _healListenerBound = true;
        document.addEventListener("geoleaf:app:ready", () => _healStaleLabels(tabs), {
            once: true,
        });
    }
}
