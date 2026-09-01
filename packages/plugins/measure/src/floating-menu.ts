/*!
 * @geoleaf-plugins/measure — Floating measure sub-menu
 * © 2026 Mattieu Pottier — MIT License
 *
 * Draggable sub-menu — tool buttons, recap-box host, pill layout matching the left
 * toolbar bar, unit cycle buttons (m↔km, m²→ha→km²), icon-only tool/action buttons,
 * onToggle callback for pill active state.
 * https://geoleaf.dev
 */
import type { MeasureConfig, MeasureMap, MeasureType, MeasureToolId, Units } from "./types.js";
import { getMeasureConfig } from "./config.js";
import { _getNativeMap, _el, _getLabel } from "./internal.js";
import { wireDrag, wireTooltips, wireTouchDrag, positionMenuNear } from "@geoleaf/host-runtime";
import { initRecapBox, setRecapMenuOpen, destroyRecapBox } from "./recap-box.js";

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _root: HTMLElement | null = null;
let _menuEl: HTMLElement | null = null;
let _isOpen = false;
let _activeTool: MeasureToolId | null = null;
let _units: Units = { distance: "auto", area: "auto" };
let _cfg: MeasureConfig | null = null;
let _distUnitBtn: HTMLButtonElement | null = null;
let _areaUnitBtn: HTMLButtonElement | null = null;
let _scrollEl: HTMLElement | null = null;
let _navUp: HTMLElement | null = null;
let _navDown: HTMLElement | null = null;
let _resizeObserver: ResizeObserver | null = null;
let _tooltipEl: HTMLDivElement | null = null;
let _onToggle: ((open: boolean) => void) | undefined;
let _onToolSelect: ((type: MeasureToolId | null) => void) | undefined;
let _onUnitsChange: ((u: Partial<Units>) => void) | undefined;
let _onClearAll: (() => void) | undefined;
let _onExport: (() => void) | undefined;
let _submenuOpenListener: ((e: Event) => void) | null = null;

/** Callbacks provided by the public API layer. */
interface MenuCallbacks {
    /** Called when the menu opens (true) or closes (false). */
    onToggle?: (open: boolean) => void;
    onToolSelect?: (type: MeasureToolId | null) => void;
    onUnitsChange?: (u: Partial<Units>) => void;
    onClearAll?: () => void;
    onExport?: () => void;
}

// ---------------------------------------------------------------------------
// SVG icon constants
// ---------------------------------------------------------------------------

const _SVG_GRIP =
    '<line x1="5" y1="8" x2="19" y2="8"/><line x1="5" y1="12" x2="19" y2="12"/><line x1="5" y1="16" x2="19" y2="16"/>';
const _SVG_DISTANCE =
    '<line x1="4" y1="20" x2="20" y2="4"/><line x1="7.5" y1="18.5" x2="9.5" y2="16.5"/><line x1="11" y1="15" x2="13" y2="13"/><line x1="14.5" y1="11.5" x2="16.5" y2="9.5"/>';
const _SVG_GPS =
    '<path d="M12 2C8.69 2 6 4.69 6 8c0 4.5 6 14 6 14s6-9.5 6-14c0-3.31-2.69-6-6-6z"/><circle cx="12" cy="8" r="2"/>';
const _SVG_RECT = '<rect x="3" y="6" width="18" height="12" rx="1.5"/>';
const _SVG_CIRCLE = '<circle cx="12" cy="12" r="9"/>';
const _SVG_POLYGON = '<polygon points="12,3 20,7.5 20,16.5 12,21 4,16.5 4,7.5"/>';
const _SVG_ANNOT_TOOLTIP = '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>';
const _SVG_CLEAR =
    '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4h6v2"/>';
const _SVG_EXPORT =
    '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>';
const _SVG_CHEVRON_UP = '<path d="M18 15l-6-6-6 6"/>';
const _SVG_CHEVRON_DOWN = '<path d="M6 9l6 6 6-6"/>';

// ---------------------------------------------------------------------------
// SVG helper — static source paths only, never user input
// ---------------------------------------------------------------------------

function _makeIcon(paths: string): DocumentFragment {
    const tpl = document.createElement("template");
    tpl.innerHTML = // SAFE: `paths` is always a static _SVG_* literal constant, never user input.
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"` +
        ` stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
    return tpl.content.cloneNode(true) as DocumentFragment;
}

// ---------------------------------------------------------------------------
// Unit cycling
// ---------------------------------------------------------------------------

const _DIST_CYCLE: Array<"m" | "km"> = ["m", "km"];
const _AREA_CYCLE: Array<"m2" | "ha" | "km2"> = ["m2", "ha", "km2"];
const _DIST_LABEL: Record<string, string> = { m: "m", km: "km", auto: "~" };
const _AREA_LABEL: Record<string, string> = { m2: "m²", ha: "ha", km2: "km²", auto: "~" };

function _distLabel(): string {
    return _DIST_LABEL[_units.distance] ?? _units.distance;
}
function _areaLabel(): string {
    return _AREA_LABEL[_units.area] ?? _units.area;
}

function _cycleDistUnit(): void {
    const idx = _DIST_CYCLE.indexOf(_units.distance as "m" | "km");
    // The modulo keeps the index in range, so the default never fires — it states that
    // invariant rather than asserting it (qualite Q5).
    const next = _DIST_CYCLE[(idx < 0 ? 0 : idx + 1) % _DIST_CYCLE.length] ?? "m";
    _units.distance = next;
    _syncUnitBtns();
    _onUnitsChange?.({ distance: next });
}

function _cycleAreaUnit(): void {
    const idx = _AREA_CYCLE.indexOf(_units.area as "m2" | "ha" | "km2");
    const next = _AREA_CYCLE[(idx < 0 ? 0 : idx + 1) % _AREA_CYCLE.length] ?? "m2";
    _units.area = next;
    _syncUnitBtns();
    _onUnitsChange?.({ area: next });
}

function _syncUnitBtns(): void {
    if (_distUnitBtn) _distUnitBtn.textContent = _distLabel();
    if (_areaUnitBtn) _areaUnitBtn.textContent = _areaLabel();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialises the floating menu with config and callbacks.
 * Idempotent: updates callbacks without rebuilding the DOM if already initialised.
 */
export function initMenu(cfg: MeasureConfig, cbs: MenuCallbacks = {}): void {
    _cfg = cfg;
    _onToggle = cbs.onToggle;
    _onToolSelect = cbs.onToolSelect;
    _onUnitsChange = cbs.onUnitsChange;
    _onClearAll = cbs.onClearAll;
    _onExport = cbs.onExport;
    _units = { distance: cfg.defaultDistanceUnit, area: cfg.defaultAreaUnit };
    if (!_root) {
        const map = _getNativeMap();
        if (map) _buildDOM(map, cfg);
    } else {
        _syncUnitBtns();
    }
}

/**
 * Toggles the sub-menu open or closed.
 * Lazy-initialises the DOM if initMenu() was not called before.
 */
export function toggleMeasureMenu(): void {
    if (!_root) {
        const map = _getNativeMap();
        if (!map) return;
        const cfg = _cfg ?? getMeasureConfig();
        _cfg = cfg;
        _units = { distance: cfg.defaultDistanceUnit, area: cfg.defaultAreaUnit };
        _buildDOM(map, cfg);
    }
    _isOpen ? _close() : _open();
}

/**
 * Sets the armed tool's VISUAL state only — does not notify `onToolSelect`.
 *
 * ⚠️ Use {@link selectTool} to actually arm a tool. This one is for the disarm paths
 * that have already torn the tools down themselves (`stopMeasure`, `clearAll`, the GPS
 * completion callback), where notifying would run `_deactivateAll()` a second time —
 * re-entrantly, in the GPS case.
 */
export function setActiveTool(type: MeasureToolId | null): void {
    _activeTool = type;
    _syncActiveButton();
}

/**
 * Arms `type` programmatically, exactly as clicking its button does.
 *
 * This is the path `GeoLeaf.Measure.startMeasure()` needs: `setActiveTool()` only lights
 * the button up, so the public API armed the UI and never wired a single drawing handler
 * (CDC finding #1). The two intents had drifted into two code paths — a click went
 * through `_onToolSelect`, the API did not.
 */
export function selectTool(type: MeasureToolId | null): void {
    _activeTool = type;
    _syncActiveButton();
    _onToolSelect?.(type);
}

/** Returns the currently armed tool, or null if none. */
export function getCurrentTool(): MeasureToolId | null {
    return _activeTool;
}

/** Updates the unit toggle buttons to reflect the given partial units. */
export function setCurrentUnits(u: Partial<Units>): void {
    _units = { ..._units, ...u };
    _syncUnitBtns();
}

/** Returns a copy of the currently active units. */
export function getCurrentUnits(): Units {
    return { ..._units };
}

/** Overrides the floating menu position (viewport-absolute pixels). */
export function setMenuPosition(top: number, left: number): void {
    if (!_root) return;
    _root.style.setProperty("--gl-measure-top", `${top}px`);
    _root.style.setProperty("--gl-measure-left", `${left}px`);
}

/** Returns the rendered height of the menu element (0 if hidden or not built). */
export function getMenuHeight(): number {
    return _menuEl?.offsetHeight ?? 0;
}

/**
 * Places the menu to the right of the toolbar pill, vertically centred on it and
 * clamped inside the map container.
 *
 * Moved out of `public-api.openMeasureMenu` at PLUGINS S5 — the façade exposes the API,
 * it does not hold layout logic — and the geometry itself lives in
 * `@geoleaf/host-runtime`, shared with `plugin-editor` which computed it identically.
 * This function is the measure plugin's binding of it to its own menu.
 *
 * @param pillEl - The clicked toolbar button; its pill-bar ancestor is preferred as the
 * anchor so the menu aligns to the bar rather than to one button.
 * @param mapEl - The map container the result is clamped to.
 */
export function positionMeasureMenuNear(pillEl: Element, mapEl: HTMLElement): void {
    positionMenuNear(pillEl, mapEl, {
        menuHeight: getMenuHeight(),
        setPosition: setMenuPosition,
    });
}

/** Removes the menu DOM and resets all module state. */
export function destroyMenu(): void {
    if (_submenuOpenListener) {
        document.removeEventListener("geoleaf:submenu:open", _submenuOpenListener);
        _submenuOpenListener = null;
    }
    _resizeObserver?.disconnect();
    _resizeObserver = null;
    _root?.parentNode?.removeChild(_root);
    destroyRecapBox();
    _root = null;
    _menuEl = null;
    _scrollEl = null;
    _navUp = null;
    _navDown = null;
    _tooltipEl = null;
    _isOpen = false;
    _activeTool = null;
    _cfg = null;
    _distUnitBtn = null;
    _areaUnitBtn = null;
    _onToggle = undefined;
    _onToolSelect = undefined;
    _onUnitsChange = undefined;
    _onClearAll = undefined;
    _onExport = undefined;
}

// ---------------------------------------------------------------------------
// DOM construction
// ---------------------------------------------------------------------------

type ToolDef = { id: MeasureType; lk: string; ak: string; svg: string };

const _GROUPS: Array<{ tools: ToolDef[] }> = [
    {
        tools: [
            {
                id: "distance",
                lk: "measure.tool.distance",
                ak: "measure.aria.distanceTool",
                svg: _SVG_DISTANCE,
            },
            { id: "gps", lk: "measure.tool.gps", ak: "measure.aria.gpsTool", svg: _SVG_GPS },
        ],
    },
    {
        tools: [
            { id: "rect", lk: "measure.tool.rect", ak: "measure.aria.rectTool", svg: _SVG_RECT },
            {
                id: "circle",
                lk: "measure.tool.circle",
                ak: "measure.aria.circleTool",
                svg: _SVG_CIRCLE,
            },
            {
                id: "polygon",
                lk: "measure.tool.polygon",
                ak: "measure.aria.polygonTool",
                svg: _SVG_POLYGON,
            },
        ],
    },
    {
        tools: [
            {
                id: "annotation-tooltip",
                lk: "measure.tool.annotationTooltip",
                ak: "measure.aria.annotationTooltipTool",
                svg: _SVG_ANNOT_TOOLTIP,
            },
        ],
    },
];

function _buildNavBtn(svg: string, dir: -1 | 1, label: string): HTMLElement {
    const btn = _el(
        "button",
        `gl-measure-menu__nav gl-measure-menu__nav--${dir < 0 ? "up" : "down"}`
    );
    btn.setAttribute("type", "button");
    btn.setAttribute("aria-label", label);
    btn.appendChild(_makeIcon(svg));
    btn.addEventListener("click", () => _scrollEl?.scrollBy({ top: dir * 80, behavior: "smooth" }));
    return btn;
}

function _updateNavVisibility(): void {
    if (!_scrollEl || !_navUp || !_navDown) return;
    const { scrollTop, scrollHeight, clientHeight } = _scrollEl;
    const hasOverflow = scrollHeight > clientHeight + 2;
    _navUp.classList.toggle("gl-is-visible", hasOverflow && scrollTop > 2);
    _navDown.classList.toggle(
        "gl-is-visible",
        hasOverflow && scrollTop + clientHeight < scrollHeight - 2
    );
}

function _buildDOM(map: MeasureMap, cfg: MeasureConfig): void {
    const container: HTMLElement = map.getContainer();

    _root = _el("div", "gl-measure-root");
    _root.style.setProperty(
        "--gl-measure-max-h",
        `${Math.max(200, container.clientHeight - 80)}px`
    );
    _applyPosition(cfg.menuPosition);

    _tooltipEl = document.createElement("div");
    // `gl-tooltip` carries the shared presentation
    // (host-runtime/src/css/tooltip.lazy.css); `gl-measure-tooltip` stays for
    // targeting and overrides.
    _tooltipEl.className = "gl-tooltip gl-measure-tooltip";
    _tooltipEl.setAttribute("aria-hidden", "true");
    _root.appendChild(_tooltipEl);

    _menuEl = _el("div", "gl-measure-menu gl-measure-menu--hidden");
    _menuEl.setAttribute("role", "dialog");
    _menuEl.setAttribute("aria-label", _getLabel("measure.menu.title"));

    // Drag handle — outside scroll area, always visible.
    // Decorative mouse/touch-only affordance (menu repositioning is a non-essential
    // enhancement, not keyboard-operable). The menu dialog already carries the
    // accessible name, so the grip is hidden from assistive tech — an aria-label on a
    // role-less element is prohibited (WCAG 4.1.2 / axe aria-prohibited-attr).
    const handle = _el("div", "gl-measure-menu__handle");
    handle.setAttribute("aria-hidden", "true");
    const grip = _el("span", "gl-measure-menu__grip");
    grip.appendChild(_makeIcon(_SVG_GRIP));
    handle.appendChild(grip);
    _menuEl.appendChild(handle);

    // Nav up
    _navUp = _buildNavBtn(_SVG_CHEVRON_UP, -1, "Scroll up");
    _menuEl.appendChild(_navUp);

    // Scrollable content area
    _scrollEl = _el("div", "gl-measure-menu__scroll");

    const activeGroups = _GROUPS
        .map((g) => g.tools.filter((t) => cfg.enabledTools.includes(t.id)))
        .filter((tools) => tools.length > 0);

    for (const [i, group] of activeGroups.entries()) {
        if (i > 0) _scrollEl.appendChild(_el("div", "gl-measure-menu__sep"));
        for (const tool of group) {
            _scrollEl.appendChild(_buildToolBtn(tool));
        }
    }

    _scrollEl.appendChild(_el("div", "gl-measure-menu__sep"));
    _distUnitBtn = _buildUnitBtn("dist");
    _areaUnitBtn = _buildUnitBtn("area");
    _scrollEl.appendChild(_distUnitBtn);
    _scrollEl.appendChild(_areaUnitBtn);

    _scrollEl.appendChild(_el("div", "gl-measure-menu__sep"));
    _scrollEl.appendChild(
        _buildActionBtn(_SVG_CLEAR, "measure.btn.clear", "measure.aria.clearBtn", "clear", () =>
            _onClearAll?.()
        )
    );
    _scrollEl.appendChild(
        _buildActionBtn(_SVG_EXPORT, "measure.btn.export", "measure.aria.exportBtn", "export", () =>
            _onExport?.()
        )
    );

    _menuEl.appendChild(_scrollEl);

    // Nav down
    _navDown = _buildNavBtn(_SVG_CHEVRON_DOWN, 1, "Scroll down");
    _menuEl.appendChild(_navDown);

    _root.appendChild(_menuEl);

    // Recap box, hosted under the menu — `.gl-measure-root` is a column flex container,
    // so appending after the menu places it exactly where the CDC puts it ("sous ce menu").
    initRecapBox(_root);
    setRecapMenuOpen(_isOpen);

    container.appendChild(_root);

    _scrollEl.addEventListener("scroll", _updateNavVisibility, { passive: true });
    if (typeof ResizeObserver !== "undefined") {
        _resizeObserver = new ResizeObserver(_updateNavVisibility);
        _resizeObserver.observe(_scrollEl);
    }

    wireDrag(handle, container, () => _root, "measure");
    wireTouchDrag(handle, container, () => _root, "measure");
    wireTooltips(
        () => _root,
        () => _tooltipEl
    );

    _submenuOpenListener = (e: Event) => {
        const ce = e as CustomEvent<{ id: string }>;
        if (ce.detail?.id !== "measure" && _isOpen) _close();
    };
    document.addEventListener("geoleaf:submenu:open", _submenuOpenListener);
}

function _buildToolBtn(tool: ToolDef): HTMLButtonElement {
    const btn = _el("button", "gl-measure-tool-btn");
    btn.type = "button";
    btn.dataset.tool = tool.id;
    btn.dataset.tooltip = _getLabel(tool.lk);
    btn.setAttribute("aria-label", _getLabel(tool.ak));
    btn.setAttribute("aria-pressed", "false");
    btn.appendChild(_makeIcon(tool.svg));
    btn.addEventListener("click", () => _handleToolClick(tool.id));
    return btn;
}

function _buildUnitBtn(type: "dist" | "area"): HTMLButtonElement {
    const btn = _el("button", "gl-measure-unit-btn");
    btn.type = "button";
    btn.dataset.unitType = type;
    btn.dataset.tooltip = _getLabel(
        type === "dist" ? "measure.unit.distance.label" : "measure.unit.area.label"
    );
    btn.setAttribute(
        "aria-label",
        _getLabel(type === "dist" ? "measure.unit.distance.label" : "measure.unit.area.label")
    );
    btn.textContent = type === "dist" ? _distLabel() : _areaLabel();
    btn.addEventListener("click", type === "dist" ? _cycleDistUnit : _cycleAreaUnit);
    return btn;
}

function _buildActionBtn(
    svg: string,
    lk: string,
    ak: string,
    action: string,
    handler: () => void
): HTMLButtonElement {
    const btn = _el("button", "gl-measure-action-btn");
    btn.type = "button";
    btn.dataset.action = action;
    btn.dataset.tooltip = _getLabel(lk);
    btn.setAttribute("aria-label", _getLabel(ak));
    btn.appendChild(_makeIcon(svg));
    btn.addEventListener("click", handler);
    return btn;
}

// ---------------------------------------------------------------------------
// Position
// ---------------------------------------------------------------------------

/** Pixel offset of the `"top-left"` preset from the map's top-left corner. */
const _TOP_LEFT_OFFSET = { top: 10, left: 10 };

function _applyPosition(pos: MeasureConfig["menuPosition"]): void {
    if (!_root) return;
    // The only string the contract allows is "top-left", and config.ts has already
    // rejected anything else — so this is the named preset, not a catch-all fallback.
    const { top, left } = typeof pos === "object" ? pos : _TOP_LEFT_OFFSET;
    _root.style.setProperty("--gl-measure-top", `${top}px`);
    _root.style.setProperty("--gl-measure-left", `${left}px`);
}

// ---------------------------------------------------------------------------
// Open / close
// ---------------------------------------------------------------------------

function _open(): void {
    _isOpen = true;
    _menuEl?.classList.remove("gl-measure-menu--hidden");
    setRecapMenuOpen(true);
    _onToggle?.(true);
    document.dispatchEvent(
        new CustomEvent("geoleaf:submenu:open", { detail: { id: "measure" }, bubbles: false })
    );
}

function _close(): void {
    _isOpen = false;
    _menuEl?.classList.add("gl-measure-menu--hidden");
    // Hide the box with the menu, but keep its rows: a measurement may still be running.
    setRecapMenuOpen(false);
    _onToggle?.(false);
    if (_activeTool !== null) {
        _activeTool = null;
        _syncActiveButton();
        _onToolSelect?.(null);
    }
}

// ---------------------------------------------------------------------------
// Tool handling
// ---------------------------------------------------------------------------

function _handleToolClick(id: MeasureType): void {
    // Clicking the armed tool disarms it; `selectTool` is the shared arming path, so a
    // click and `startMeasure()` can no longer diverge.
    selectTool(_activeTool === id ? null : id);
}

function _syncActiveButton(): void {
    if (!_menuEl) return;
    for (const btn of _menuEl.querySelectorAll<HTMLButtonElement>("button[data-tool]")) {
        const active = btn.dataset.tool === _activeTool;
        btn.classList.toggle("gl-measure-tool-btn--active", active);
        btn.setAttribute("aria-pressed", String(active));
    }
}
