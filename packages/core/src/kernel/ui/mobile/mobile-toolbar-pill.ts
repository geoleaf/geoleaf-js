/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf UI – Mobile toolbar: pill DOM creation, nav arrows, tooltip and filter state.
 */

import { DOMSecurity } from "../../security/dom-security.js";
import { domState } from "./mobile-toolbar-state.js";
import { getGeoLeaf } from "../../../utils/general/geoleaf-global.js";
import { getLabel } from "../../../utils/i18n/i18n.js";
import { resolveRovingIndex } from "../roving-tabindex.js";
import { resolveUISlotVisibility, UI_SLOT_SVG_TAGS } from "../ui-slot-builder.js";
import type { IModuleUISlot } from "../../../contracts/core-module.contract.ts";

type MobileIconDef = NonNullable<IModuleUISlot["mobileIcon"]>;

/** Lazy-plugin UI slot — an `IModuleUISlot` paired with its owning plugin id. */
interface LazyUISlot extends IModuleUISlot {
    id: string;
    /** Owning plugin, i.e. the 2nd argument of `registerLazyForAction`. Gates on
     *  `modules.<pluginName>.enabled` when `gateOnModuleEnabled` is set — the doc comment said "paired with its owning plugin id"
     *  while the type declared no such field, so nothing could read it. */
    pluginName: string;
    /** Opt-in for the `modules.<pluginName>.enabled` guard — see `PluginLazyUI`. */
    gateOnModuleEnabled?: boolean;
}

/** Subset of `GeoLeaf.plugins` consumed by the pill / registry-icon builders. */
interface PillPluginsLike {
    getLazyUISlots?: () => LazyUISlot[] | undefined;
}

/**
 * Builds an SVG icon element from path data.
 *
 * Constructed node by node, never parsed from a markup string — the same rule the security
 * helpers enforce, applied here because the path data comes from configuration.
 *
 * @param pathData - The `d` attribute of the path.
 * @param size - Width and height in pixels. Defaults to `22`.
 * @returns The icon element, not yet attached.
 */
export function createSvgIcon(pathData: string, size = 22): SVGElement {
    const opts = { stroke: "currentColor", strokeWidth: "2", fill: "none" as const };
    return DOMSecurity.createSVGIcon(size, size, pathData, opts);
}

/**
 * Updates nav arrow visibility according to current scroll position.
 * Arrows appear only when the content overflows the visible area.
 */
export function updateNavVisibility(): void {
    if (!domState.scrollEl || !domState.navUp || !domState.navDown) return;
    const { scrollTop, scrollHeight, clientHeight } = domState.scrollEl;
    const hasOverflow = scrollHeight > clientHeight + 2;
    const canScrollUp = scrollTop > 2;
    const canScrollDown = scrollTop + clientHeight < scrollHeight - 2;

    domState.navUp.classList.toggle("gl-is-visible", hasOverflow && canScrollUp);
    domState.navDown.classList.toggle("gl-is-visible", hasOverflow && canScrollDown);
}

/**
 * Refreshes the visual state of the filter button (active / reset).
 */
export function refreshFilterButtonState(): void {
    let active = domState.options?.getFilterActiveState?.() ?? false;
    if (!active) {
        const panel = document.querySelector("#gl-filter-panel");
        if (panel) {
            const checkedCats = panel.querySelectorAll(
                ".gl-filter-tree__checkbox--category:checked, .gl-filter-tree__checkbox--subcategory:checked"
            ).length;
            const selectedTags = panel.querySelectorAll(
                ".gl-filter-panel__tag-badge.gl-is-selected"
            ).length;
            active = checkedCats > 0 || selectedTags > 0;
        }
    }
    domState.filterBtn?.classList.toggle("gl-map-toolbar__btn--active", active);
    domState.filterGroup?.classList.toggle("gl-has-active-filters", active);
}

function _getNavItems() {
    return [
        {
            id: "",
            label: getLabel("aria.toolbar.fullscreen"),
            tooltip: getLabel("aria.toolbar.fullscreen"),
            path: "M4 4h6M4 4v6M20 4h-6M20 4v6M4 20h6M4 20v-6M20 20h-6M20 20v-6",
            action: "fullscreen",
        },
        {
            id: "",
            label: getLabel("aria.toolbar.zoom_in"),
            tooltip: getLabel("aria.toolbar.zoom_in"),
            path: "M12 5v14M5 12h14",
            action: "zoom-in",
        },
        {
            id: "",
            label: getLabel("aria.toolbar.zoom_out"),
            tooltip: getLabel("aria.toolbar.zoom_out"),
            path: "M5 12h14",
            action: "zoom-out",
        },
        ...(domState.options?.showGeolocation !== false
            ? [
                  {
                      id: "geoloc",
                      label: getLabel("aria.toolbar.geoloc"),
                      tooltip: getLabel("aria.toolbar.geoloc"),
                      path: "M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 7a3 3 0 100 6 3 3 0 000-6z",
                  },
              ]
            : []),
    ];
}

function _getMapToolItems() {
    // Legend and table are rendered dynamically via registry.getUISlots()
    return [
        ...(domState.options?.showThemeSelector !== false
            ? [
                  {
                      id: "",
                      label: getLabel("aria.toolbar.themes"),
                      tooltip: getLabel("tooltip.toolbar.themes"),
                      path: "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z",
                      action: "themes",
                  },
              ]
            : []),
        ...(domState.options?.showLayerManager !== false
            ? [
                  {
                      id: "layers",
                      label: getLabel("aria.toolbar.layers"),
                      tooltip: getLabel("tooltip.toolbar.layers"),
                      path: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
                  },
              ]
            : []),
    ];
}

function _getToolbarItems() {
    // Search is rendered dynamically via registry.getUISlots()
    //
    // The "add a POI" button left this list. It was built here behind
    // `showAddPoi && POIAddFormContract.isAddFormAvailable()`, i.e. a NAMESPACE
    // PROBE of a plugin, evaluated ONCE at boot (`_getToolbarItems` has one caller
    // and no rebuild exists). That only held because `addpoi` was loaded as an eager
    // `<script>` tag; any lazy plugin made the probe false forever and the button
    // vanished WITHOUT A WORD — the error guard meant to flag it living itself
    // behind the never-created button.
    // It therefore goes through the lazy-slot path (`getLazyUISlots`, below), which
    // `apps/geoleaf-app/init.js` declares BEFORE the plugin loads.
    return [
        ..._getNavItems(),
        {
            id: "proximity",
            label: getLabel("aria.toolbar.proximity"),
            tooltip: getLabel("tooltip.toolbar.proximity"),
            path: "M12 2v2M12 20v2M2 12h2M20 12h2M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M12 12m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0",
        },
        ..._getMapToolItems(),
    ];
}

function _buildToolbarButton(
    b: { id: string; label: string; path: string; action?: string; tooltip: string },
    index: number,
    filterGroup: HTMLElement,
    scroll: HTMLElement
): void {
    if (index === 6 && domState.options?.showFilterPanel !== false) scroll.appendChild(filterGroup);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gl-map-toolbar__btn";
    if (b.id) btn.setAttribute("data-gl-sheet", b.id);
    btn.setAttribute("aria-label", b.label);
    btn.setAttribute("data-tooltip", b.tooltip);
    if (b.action) btn.setAttribute("data-gl-toolbar-action", b.action);
    if ((b.id && !["geoloc", "proximity"].includes(b.id)) || b.action === "themes")
        btn.setAttribute("aria-expanded", "false");
    btn.appendChild(createSvgIcon(b.path));
    scroll.appendChild(btn);
}

function _attachNavScroll(btn: HTMLButtonElement, direction: number): void {
    const SCROLL_STEP = 80;
    btn.addEventListener("click", () => {
        if (domState.scrollEl) {
            domState.scrollEl.scrollBy({ top: direction * SCROLL_STEP, behavior: "smooth" });
        }
    });
}

function _createFilterGroup(): HTMLElement {
    const filterGroup = document.createElement("div");
    filterGroup.className = "gl-map-toolbar__group";
    domState.filterGroup = filterGroup;
    const filterBtn = document.createElement("button");
    filterBtn.type = "button";
    filterBtn.className = "gl-map-toolbar__btn";
    filterBtn.setAttribute("data-gl-sheet", "filters");
    filterBtn.setAttribute("aria-label", getLabel("aria.toolbar.filters"));
    filterBtn.setAttribute("aria-expanded", "false");
    filterBtn.appendChild(createSvgIcon("M4 4h16v2.5l-6 6v6l-4 2v-8l-6-6V4z"));
    domState.filterBtn = filterBtn;
    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "gl-map-toolbar__reset";
    resetBtn.setAttribute("aria-label", getLabel("aria.toolbar.reset_filters"));
    resetBtn.setAttribute("data-gl-toolbar-action", "reset-filters");
    resetBtn.appendChild(createSvgIcon("M4 6h16M4 12h16M4 18h16M3 3l18 18", 18));
    domState.resetBtn = resetBtn;
    filterGroup.appendChild(filterBtn);
    filterGroup.appendChild(resetBtn);
    filterBtn.setAttribute("data-tooltip", getLabel("tooltip.toolbar.filters"));
    return filterGroup;
}

/**
 * Implements roving tabindex on the toolbar (WCAG 2.1 §1.5.5).
 * Only the active button exposes tabindex=0; arrow keys cycle focus.
 */
function _attachRovingTabindex(toolbar: HTMLElement): void {
    const _btns = (): HTMLButtonElement[] =>
        Array.from(
            toolbar.querySelectorAll<HTMLButtonElement>(
                ".gl-map-toolbar__btn:not([disabled]), .gl-map-toolbar__reset:not([disabled])"
            )
        ).filter((b) => b.offsetParent !== null);

    // Initialise: first button focusable, others withdrawn from tab order
    const initial = _btns();
    initial.forEach((b, i) => b.setAttribute("tabindex", i === 0 ? "0" : "-1"));

    toolbar.addEventListener("keydown", (e: KeyboardEvent) => {
        const btns = _btns();
        if (!btns.length) return;
        const idx = btns.indexOf(document.activeElement as HTMLButtonElement);
        if (idx === -1) return;

        const next = resolveRovingIndex(e.key, idx, btns.length);
        if (next === null) return;

        const current = btns[idx];
        const target = btns[next];
        if (!current || !target) return;

        e.preventDefault();
        current.setAttribute("tabindex", "-1");
        target.setAttribute("tabindex", "0");
        target.focus();
    });

    // Keep tabindex=0 in sync when a button receives focus by any means
    toolbar.addEventListener("focusin", (e: FocusEvent) => {
        const target = e.target as HTMLElement;
        const btn = target.closest<HTMLButtonElement>(
            ".gl-map-toolbar__btn, .gl-map-toolbar__reset"
        );
        if (!btn) return;
        _btns().forEach((b) => b.setAttribute("tabindex", b === btn ? "0" : "-1"));
    });
}

/**
 * Builds a mobile toolbar icon button for a registry module or lazy plugin slot,
 * or returns null when an idempotency, profileKey or requiresPlugin guard rejects it.
 * SVG icon is routed through the sanitizer to strip scripts/handlers.
 */
function _buildMobileIconButton(
    scroll: HTMLElement,
    id: string,
    icon: MobileIconDef,
    opts: {
        checkRequiresPlugin: boolean;
        useDefaultVisible: boolean;
        hasDesktopTabButton: boolean;
        moduleGateId?: string;
    }
): HTMLButtonElement | null {
    // Idempotent — skip if already rendered (e.g. after a re-render call)
    if (scroll.querySelector(`[data-gl-sheet="${id}"]`)) return null;

    // profileKey + requiresPlugin guards (shared with the desktop tab builder)
    if (!resolveUISlotVisibility(icon, opts)) return null;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gl-map-toolbar__btn";
    btn.setAttribute("data-gl-sheet", id);
    btn.setAttribute("aria-label", getLabel(icon.labelKey));
    btn.setAttribute("data-tooltip", getLabel(icon.labelKey));
    btn.setAttribute("aria-expanded", "false");
    if (icon.action) btn.setAttribute("data-gl-toolbar-action", icon.action);
    // Hide in pill on desktop when the module also exposes a desktopTabButton
    if (opts.hasDesktopTabButton) btn.setAttribute("data-gl-desktop-slot", "");
    // @security Route module-provided SVG through sanitizer to strip scripts/handlers
    DOMSecurity.setSafeHTML(btn, icon.icon, UI_SLOT_SVG_TAGS);
    return btn;
}

/**
 * Appends toolbar buttons for modules that declare a `mobileIcon` UI slot.
 *
 * Icons are rendered by **declared `mobileIcon.order`** (ascending), then by module
 * registration order for those that declare none — socle-init 7.5.
 *
 * ⚠️ The previous rule was registration order alone, and the comment here said so. That made
 * the toolbar layout an emergent property of `presets/manifest.full.ts`, whose order is
 * load-bearing for **three other, unrelated reasons** (Kahn tie-breaks, `sharedLifecycle`
 * sequencing, dependency edges). Reordering the manifest for any of them silently moved the
 * buttons, and nothing named the coupling. `filterTab` already carried an explicit `order`;
 * this aligns the two halves of `IModuleUISlot`.
 *
 * Each button gets `data-gl-sheet={moduleId}` for the existing sheet delegation.
 */
function _appendRegistryIcons(scroll: HTMLElement): void {
    const registry = getGeoLeaf()?.registry;
    if (!registry) return;

    const showMap: Record<string, boolean> = {
        legend: domState.options?.showLegend !== false,
        filters: domState.options?.showFilterPanel !== false,
    };

    // Stable sort on a copy: modules without `order` keep their relative registration order
    // and land after every ordered one. `Array.prototype.sort` is stable per spec, so the
    // comparator only has to be total on the ordered subset.
    const ordered = [...registry.getAll()].sort((a, b) => {
        const oa = a.ui?.mobileIcon?.order;
        const ob = b.ui?.mobileIcon?.order;
        if (oa === undefined && ob === undefined) return 0;
        if (oa === undefined) return 1;
        if (ob === undefined) return -1;
        return oa - ob;
    });

    for (const mod of ordered) {
        if (!mod.ui?.mobileIcon) continue;
        if (mod.id in showMap && !showMap[mod.id]) continue;
        const btn = _buildMobileIconButton(scroll, mod.id, mod.ui.mobileIcon, {
            checkRequiresPlugin: true,
            useDefaultVisible: true,
            hasDesktopTabButton: !!mod.ui.desktopTabButton,
        });
        if (btn) scroll.appendChild(btn);
    }

    // Lazy plugins (S4): render toolbar buttons for plugins registered lazy but not yet loaded.
    // Buttons are added here so they appear immediately at boot without loading the bundle.
    const pluginReg = getGeoLeaf()?.plugins as PillPluginsLike | undefined;
    const lazySlots = pluginReg?.getLazyUISlots?.() ?? [];
    for (const slot of lazySlots) {
        const icon = slot.mobileIcon;
        if (!icon) continue;
        const btn = _buildMobileIconButton(scroll, slot.id, icon, {
            checkRequiresPlugin: false,
            useDefaultVisible: false,
            hasDesktopTabButton: !!slot.desktopTabButton,
            // Aligns the lazy path on what THIS PLUGIN's `entry.ts` does — only
            // three of six gate on `enabled`, hence the opt-in rather than a uniform
            // rule (detailed motive on `PluginLazyUI.gateOnModuleEnabled`).
            //
            // ⚠️ Conditional spread and not `: … : undefined` —
            // `exactOptionalPropertyTypes` refuses an EXPLICIT `undefined` on an
            // optional property, and it is right: "absent" and "present at
            // undefined" are not the same contract. The first draft wrote the
            // ternary, and the build went red (TS2379).
            ...(slot.gateOnModuleEnabled ? { moduleGateId: slot.pluginName } : {}),
        });
        if (btn) scroll.appendChild(btn);
    }
}

/**
 * Builds the mobile toolbar's DOM skeleton, without wiring any behaviour.
 *
 * Structure only: the buttons exist but do nothing until the state module binds them. The
 * split is what lets the toolbar be rebuilt on a layout change without re-registering
 * listeners.
 *
 * @returns The toolbar root, not yet attached.
 */
export function createToolbarDom(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "gl-map-toolbar-wrapper";

    const navUp = document.createElement("button");
    navUp.type = "button";
    navUp.className = "gl-map-toolbar__nav";
    navUp.setAttribute("aria-label", getLabel("aria.toolbar.scroll_up"));
    navUp.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 15l-6-6-6 6"/></svg>';
    wrapper.appendChild(navUp);
    domState.navUp = navUp;

    const toolbar = document.createElement("div");
    toolbar.className = "gl-map-toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", getLabel("aria.toolbar.root"));
    domState.toolbar = toolbar;

    const scroll = document.createElement("div");
    scroll.className = "gl-map-toolbar__scroll";
    domState.scrollEl = scroll;

    const filterGroup = _createFilterGroup();

    const items = _getToolbarItems();
    items.forEach((b, index) => _buildToolbarButton(b, index, filterGroup, scroll));

    // Render module-driven toolbar icons from registry UI slots
    _appendRegistryIcons(scroll);

    toolbar.appendChild(scroll);
    wrapper.appendChild(toolbar);

    const navDown = document.createElement("button");
    navDown.type = "button";
    navDown.className = "gl-map-toolbar__nav";
    navDown.setAttribute("aria-label", getLabel("aria.toolbar.scroll_down"));
    navDown.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>';
    wrapper.appendChild(navDown);
    domState.navDown = navDown;

    _attachNavScroll(navUp, -1);
    _attachNavScroll(navDown, 1);

    scroll.addEventListener("scroll", updateNavVisibility, { passive: true });

    if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(() => updateNavVisibility());
        ro.observe(scroll);
    }

    // Roving tabindex for keyboard navigation within role=toolbar (1.5.5)
    toolbar.setAttribute("aria-orientation", "vertical");
    _attachRovingTabindex(toolbar);

    return wrapper;
}

// ── Tooltip ──────────────────────────────────────────────────────────────────

/** Creates the floating tooltip div (outside the pill, inside glMain). */
export function createTooltipDom(): HTMLElement {
    const tip = document.createElement("div");
    tip.className = "gl-toolbar-tooltip";
    tip.setAttribute("aria-hidden", "true");
    domState.tooltipEl = tip;
    return tip;
}

function _showTooltip(btn: HTMLElement, glMain: HTMLElement): void {
    if (!domState.tooltipEl) return;
    const label = btn.getAttribute("data-tooltip");
    if (!label) return;
    domState.tooltipEl.textContent = label;
    domState.tooltipEl.style.display = "block";
    const btnRect = btn.getBoundingClientRect();
    const mainRect = glMain.getBoundingClientRect();
    const top = btnRect.top - mainRect.top + btnRect.height / 2;
    const left = btnRect.right - mainRect.left + 10;
    domState.tooltipEl.style.top = `${top}px`;
    domState.tooltipEl.style.left = `${left}px`;
    requestAnimationFrame(() => {
        if (domState.tooltipEl) domState.tooltipEl.classList.add("gl-is-visible");
    });
}

function _hideTooltip(): void {
    if (!domState.tooltipEl) return;
    domState.tooltipEl.classList.remove("gl-is-visible");
    domState.tooltipEl.addEventListener(
        "transitionend",
        () => {
            if (domState.tooltipEl && !domState.tooltipEl.classList.contains("gl-is-visible")) {
                domState.tooltipEl.style.display = "none";
            }
        },
        { once: true }
    );
}

/**
 * Wires the toolbar's tooltips, positioned against the map container.
 *
 * Tooltips are placed relative to `glMain` rather than the button, so they stay inside the
 * map on the edges of the screen — the case a pure CSS tooltip gets wrong.
 *
 * @param wrapper - The toolbar element carrying the buttons.
 * @param glMain - The map container, used as the positioning frame.
 */
export function attachTooltipHandlers(wrapper: HTMLElement, glMain: HTMLElement): void {
    const btns = wrapper.querySelectorAll<HTMLElement>("[data-tooltip]");
    btns.forEach((btn) => {
        btn.addEventListener("mouseenter", () => _showTooltip(btn, glMain));
        btn.addEventListener("focusin", () => _showTooltip(btn, glMain));
        btn.addEventListener("mouseleave", _hideTooltip);
        btn.addEventListener("focusout", _hideTooltip);
        btn.addEventListener("pointerleave", _hideTooltip);
    });
}
