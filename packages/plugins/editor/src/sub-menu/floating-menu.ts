/*!
 * @geoleaf-plugins/editor — Floating sub-menu (ADR-8: custom pill, not maplibre-gl-terradraw)
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { EditorConfig, EditorMap, EditorTool } from "../types.js";
import { getEditorConfig } from "../config.js";
import { _getNativeMap, _el, _getLabel } from "../internal.js";
import { wireDrag, wireTooltips, wireTouchDrag, positionMenuNear } from "@geoleaf/host-runtime";

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _root: HTMLElement | null = null;
let _menuEl: HTMLElement | null = null;
let _tooltipEl: HTMLDivElement | null = null;
let _isOpen = false;
let _activeTool: EditorTool | null = null;
let _cfg: EditorConfig | null = null;
let _undoBtn: HTMLButtonElement | null = null;
let _redoBtn: HTMLButtonElement | null = null;
let _queueBadge: HTMLButtonElement | null = null;
let _onToggle: ((open: boolean) => void) | undefined;
let _onToolSelect: ((tool: EditorTool | null) => void) | undefined;
let _onUndo: (() => void) | undefined;
let _onRedo: (() => void) | undefined;
let _onDelete: (() => void) | undefined;
let _onPendingBadgeClick: (() => void) | undefined;
let _submenuOpenListener: ((e: Event) => void) | null = null;

/** Callbacks wired by the public API layer. */
interface EditorMenuCallbacks {
    onToggle?: (open: boolean) => void;
    onToolSelect?: (tool: EditorTool | null) => void;
    onUndo?: () => void;
    onRedo?: () => void;
    onDelete?: () => void;
    /** Opens the pending-operations detail when the offline queue badge is clicked. */
    onPendingBadgeClick?: () => void;
}

// ---------------------------------------------------------------------------
// SVG icon paths (static — never user input)
// ---------------------------------------------------------------------------

const _SVG_GRIP =
    '<line x1="5" y1="8" x2="19" y2="8"/><line x1="5" y1="12" x2="19" y2="12"/><line x1="5" y1="16" x2="19" y2="16"/>';
const _SVG_CLOSE = '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>';
const _SVG_POINT = '<circle cx="12" cy="10" r="4"/><line x1="12" y1="14" x2="12" y2="21"/>';
const _SVG_LINE =
    '<line x1="4" y1="20" x2="20" y2="4"/><circle cx="4" cy="20" r="1.5" fill="currentColor"/><circle cx="20" cy="4" r="1.5" fill="currentColor"/>';
const _SVG_POLYLINE = '<polyline points="4,20 8,10 14,16 20,4"/>';
const _SVG_POLYGON = '<polygon points="12,3 21,9 17,21 7,21 3,9"/>';
const _SVG_SELECT = '<path d="M5 3l14 9-8 1.5-3 7.5z" fill="currentColor" stroke="none"/>';
const _SVG_UNDO = '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>';
const _SVG_REDO = '<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/>';
const _SVG_DELETE =
    '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4h6v2"/>';

function _makeIcon(paths: string): DocumentFragment {
    const tpl = document.createElement("template");
    // SAFE: static SVG wrapper; `paths` is always one of the internal _SVG_* string literals (no external input).
    const svg =
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"` +
        ` stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
    tpl.innerHTML = svg; // SAFE: see above — static SVG markup only.
    return tpl.content.cloneNode(true) as DocumentFragment;
}

// ---------------------------------------------------------------------------
// Group / tool definitions
// ---------------------------------------------------------------------------

type ToolDef = { id: EditorTool; lk: string; ak: string; svg: string };
type ActionDef = { id: "undo" | "redo" | "delete"; lk: string; ak: string; svg: string };

const _CREATION_TOOLS: ToolDef[] = [
    { id: "point", lk: "editor.tool.point.label", ak: "editor.tool.point.hint", svg: _SVG_POINT },
    { id: "line", lk: "editor.tool.line.label", ak: "editor.tool.line.hint", svg: _SVG_LINE },
    {
        id: "polyline",
        lk: "editor.tool.polyline.label",
        ak: "editor.tool.polyline.hint",
        svg: _SVG_POLYLINE,
    },
    {
        id: "polygon",
        lk: "editor.tool.polygon.label",
        ak: "editor.tool.polygon.hint",
        svg: _SVG_POLYGON,
    },
];

const _SELECT_TOOL: ToolDef = {
    id: "select",
    lk: "editor.tool.select.label",
    ak: "editor.tool.select.hint",
    svg: _SVG_SELECT,
};

const _HISTORY_ACTIONS: ActionDef[] = [
    { id: "undo", lk: "editor.tool.undo.label", ak: "editor.tool.undo.hint", svg: _SVG_UNDO },
    { id: "redo", lk: "editor.tool.redo.label", ak: "editor.tool.redo.hint", svg: _SVG_REDO },
];

const _DELETE_ACTION: ActionDef = {
    id: "delete",
    lk: "editor.tool.delete.label",
    ak: "editor.tool.delete.hint",
    svg: _SVG_DELETE,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialises the floating menu with config and callbacks.
 * Idempotent: updates callbacks without rebuilding the DOM if already initialised.
 */
export function initEditorMenu(cfg: EditorConfig, cbs: EditorMenuCallbacks = {}): void {
    _cfg = cfg;
    _onToggle = cbs.onToggle;
    _onToolSelect = cbs.onToolSelect;
    _onUndo = cbs.onUndo;
    _onRedo = cbs.onRedo;
    _onDelete = cbs.onDelete;
    _onPendingBadgeClick = cbs.onPendingBadgeClick;
    if (!_root) {
        const map = _getNativeMap();
        if (map) _buildDOM(map, cfg);
    }
}

/**
 * Toggles the sub-menu open or closed.
 * Lazy-initialises the DOM if initEditorMenu() was not called before.
 */
export function toggleEditorMenu(_anchorEl?: Element | null): void {
    if (!_root) {
        const map = _getNativeMap();
        if (!map) return;
        const cfg = _cfg ?? getEditorConfig();
        _cfg = cfg;
        _buildDOM(map, cfg);
    }
    _isOpen ? _close() : _open();
}

/** Arms the given drawing mode tool, or disarms all if null. */
export function setEditorActiveTool(tool: EditorTool | null): void {
    _activeTool = tool;
    _syncActiveButton();
}

/**
 * Disarms the currently active tool (if any), syncs the button state, and
 * notifies via `onToolSelect(null)`. No-op when no tool is armed. Used by the
 * menu close flow and by the "Enter exits select mode" keyboard shortcut.
 */
export function deactivateActiveTool(): void {
    if (_activeTool === null) return;
    _activeTool = null;
    _syncActiveButton();
    _onToolSelect?.(null);
}

/** Returns the currently armed tool, or null. */
export function getEditorActiveTool(): EditorTool | null {
    return _activeTool;
}

/**
 * Updates the enabled state of the undo/redo buttons and their tooltips.
 * When an operation type is supplied, the tooltip becomes dynamic
 * ("Undo: move"); otherwise it falls back to the static hint.
 */
export function updateUndoRedoState(
    canUndo: boolean,
    canRedo: boolean,
    undoType: string | null = null,
    redoType: string | null = null
): void {
    if (_undoBtn) {
        _undoBtn.disabled = !canUndo;
        _undoBtn.dataset.tooltip =
            canUndo && undoType
                ? _historyTip("editor.history.undoOf", undoType)
                : _getLabel("editor.tool.undo.hint");
    }
    if (_redoBtn) {
        _redoBtn.disabled = !canRedo;
        _redoBtn.dataset.tooltip =
            canRedo && redoType
                ? _historyTip("editor.history.redoOf", redoType)
                : _getLabel("editor.tool.redo.hint");
    }
}

/**
 * Updates the offline pending-queue badge: shows "⏳ N" when N > 0, hides it at 0.
 * No-op when the menu DOM is not built. The badge tooltip/aria carries the
 * localised "{n} pending" label.
 */
export function updatePendingQueueCount(count: number): void {
    if (!_queueBadge) return;
    if (count > 0) {
        _queueBadge.textContent = `⏳ ${count}`;
        const label = _getLabel("editor.sync.pending").replace("{n}", String(count));
        // Native title: the badge is appended after wireTooltips(), so the custom
        // JS tooltip would not be bound to it.
        _queueBadge.title = label;
        _queueBadge.setAttribute("aria-label", label);
        _queueBadge.setAttribute("aria-hidden", "false");
        _queueBadge.style.display = "";
    } else {
        _queueBadge.textContent = "";
        _queueBadge.removeAttribute("data-tooltip");
        _queueBadge.setAttribute("aria-hidden", "true");
        _queueBadge.style.display = "none";
    }
}

/** Builds a dynamic history tooltip: "{prefix} {operation label}". */
function _historyTip(templateKey: string, opType: string): string {
    const opLabel = _getLabel(`editor.history.op.${opType}`);
    return _getLabel(templateKey).replace("{op}", opLabel);
}

/**
 * Overrides the floating menu position (viewport-absolute pixels).
 *
 * ⚠️ B-12 — must NEUTRALISE the opposite edges, not just write `top`/`left`. Since
 * the anchors became real, a right- or bottom-anchored pill carries
 * `--gl-editor-right` / `--gl-editor-bottom`; writing only the two other edges would
 * leave BOTH sides pinned, and the element would stretch or ignore the drag instead
 * of moving. Absolute pixels are by definition a top-left placement — so this says so.
 */
function setEditorMenuPosition(top: number, left: number): void {
    if (!_root) return;
    _root.style.setProperty("--gl-editor-top", `${top}px`);
    _root.style.setProperty("--gl-editor-left", `${left}px`);
    _root.style.setProperty("--gl-editor-right", "auto");
    _root.style.setProperty("--gl-editor-bottom", "auto");
    _root.removeAttribute("data-gl-anchor-x");
}

/** Returns the rendered height of the menu element (0 if hidden or not built). */
function getEditorMenuHeight(): number {
    return _menuEl?.offsetHeight ?? 0;
}

/**
 * Places the menu to the right of the toolbar pill, vertically centred on it and
 * clamped inside the map container.
 *
 * Moved out of `public-api.toggleEditorMenu` at PLUGINS S4: it is layout logic
 * about this module's own element, and the façade is meant to expose the API, not
 * to hold it (project rule «façade ≠ implémentation»). It also measured the menu
 * through `getEditorMenuHeight()` and wrote back through `setEditorMenuPosition()`
 * — both defined here — so the round trip was the only thing the façade added.
 *
 * The geometry itself moved to `@geoleaf/host-runtime` at PLUGINS S5: `plugin-measure`
 * computed the identical placement. This function stays as the editor's binding of the
 * shared routine to its own menu height and position sink.
 *
 * @param pillEl - The clicked toolbar button; its pill-bar ancestor is preferred
 * as the anchor so the menu aligns to the bar rather than to one button.
 * @param mapEl - The map container the result is clamped to.
 */
export function positionEditorMenuNear(pillEl: Element, mapEl: HTMLElement): void {
    positionMenuNear(pillEl, mapEl, {
        menuHeight: getEditorMenuHeight(),
        setPosition: setEditorMenuPosition,
    });
}

/** Removes the menu DOM and resets all module state. */
export function destroyEditorMenu(): void {
    if (_submenuOpenListener) {
        document.removeEventListener("geoleaf:submenu:open", _submenuOpenListener);
        _submenuOpenListener = null;
    }
    _root?.parentNode?.removeChild(_root);
    _root = null;
    _menuEl = null;
    _tooltipEl = null;
    _undoBtn = null;
    _redoBtn = null;
    _queueBadge = null;
    _isOpen = false;
    _activeTool = null;
    _cfg = null;
    _onToggle = undefined;
    _onToolSelect = undefined;
    _onUndo = undefined;
    _onRedo = undefined;
    _onDelete = undefined;
    _onPendingBadgeClick = undefined;
}

// ---------------------------------------------------------------------------
// DOM construction
// ---------------------------------------------------------------------------

function _buildDOM(map: EditorMap, cfg: EditorConfig): void {
    const container: HTMLElement = map.getContainer();
    const enabled = cfg.enabledTools ?? [
        "point",
        "line",
        "polyline",
        "polygon",
        "select",
        "undo",
        "redo",
        "delete",
    ];

    _root = _el("div", "gl-editor-root");
    _applyPosition(cfg.menuPosition ?? "top-right");

    const { handle, menu } = _buildMenuShell();
    _buildToolGroups(menu, enabled);
    _appendCloseButton(menu);

    _root.appendChild(menu);
    container.appendChild(_root);

    _wireMenu(handle, container);
}

/**
 * Builds the menu skeleton — tooltip (appended to `_root`), the dialog element,
 * the drag handle and the offline queue badge. Assigns module state and returns
 * the handle + menu element (the menu is appended to `_root` by the caller after
 * its groups are populated).
 */
function _buildMenuShell(): { handle: HTMLElement; menu: HTMLElement } {
    _tooltipEl = document.createElement("div");
    // `gl-tooltip` porte la présentation partagée (host-runtime/src/css/tooltip.css,
    // STRUCT S2 F8) ; `gl-editor-tooltip` reste pour le ciblage et les surcharges.
    _tooltipEl.className = "gl-tooltip gl-editor-tooltip";
    _tooltipEl.setAttribute("aria-hidden", "true");
    _root!.appendChild(_tooltipEl);

    const menu = _el("div", "gl-editor-menu gl-editor-menu--hidden");
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", _getLabel("editor.menu.tools"));
    _menuEl = menu;

    // Drag handle
    const handle = _el("div", "gl-editor-menu__handle");
    handle.setAttribute("aria-label", _getLabel("editor.aria.dragMenu"));
    const grip = _el("span", "gl-editor-menu__grip");
    grip.appendChild(_makeIcon(_SVG_GRIP));
    handle.appendChild(grip);
    menu.appendChild(handle);

    // Offline pending-queue badge (hidden while the queue is empty).
    _queueBadge = _el("button", "gl-editor-queue-badge") as HTMLButtonElement;
    _queueBadge.type = "button";
    _queueBadge.style.display = "none";
    _queueBadge.setAttribute("aria-hidden", "true");
    _queueBadge.addEventListener("click", () => _onPendingBadgeClick?.());
    menu.appendChild(_queueBadge);

    return { handle, menu };
}

/** Appends the conditional tool groups (creation / selection / history / delete). */
function _buildToolGroups(menu: HTMLElement, enabled: string[]): void {
    // Group 1 — Creation tools
    const creationTools = _CREATION_TOOLS.filter((t) => enabled.includes(t.id));
    if (creationTools.length > 0) {
        for (const t of creationTools) menu.appendChild(_buildModeBtn(t));
        menu.appendChild(_el("div", "gl-editor-menu__sep"));
    }

    // Group 2 — Selection
    if (enabled.includes("select")) {
        menu.appendChild(_buildModeBtn(_SELECT_TOOL));
        menu.appendChild(_el("div", "gl-editor-menu__sep"));
    }

    // Group 3 — History (undo / redo)
    _buildHistoryGroup(menu, enabled);

    // Group 4 — Delete
    if (enabled.includes("delete")) {
        menu.appendChild(_buildActionBtn(_DELETE_ACTION, _onDelete));
    }
}

/** Appends the undo/redo group, caching the buttons for later state updates. */
function _buildHistoryGroup(menu: HTMLElement, enabled: string[]): void {
    const historyActions = _HISTORY_ACTIONS.filter((a) => enabled.includes(a.id));
    if (historyActions.length === 0) return;
    for (const a of historyActions) {
        const btn = _buildActionBtn(a, a.id === "undo" ? _onUndo : _onRedo);
        btn.disabled = true;
        if (a.id === "undo") _undoBtn = btn;
        if (a.id === "redo") _redoBtn = btn;
        menu.appendChild(btn);
    }
    menu.appendChild(_el("div", "gl-editor-menu__sep"));
}

/** Appends the always-present close button to the menu. */
function _appendCloseButton(menu: HTMLElement): void {
    const closeBtn = _el("button", "gl-editor-action-btn gl-editor-action-btn--close");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", _getLabel("editor.aria.closeMenu"));
    closeBtn.dataset.tooltip = _getLabel("editor.aria.closeMenu");
    closeBtn.appendChild(_makeIcon(_SVG_CLOSE));
    closeBtn.addEventListener("click", _close);
    menu.appendChild(closeBtn);
}

/** Wires drag (mouse + touch), tooltips, and the submenu-exclusivity listener. */
function _wireMenu(handle: HTMLElement, container: HTMLElement): void {
    wireDrag(handle, container, () => _root, "editor");
    wireTouchDrag(handle, container, () => _root, "editor");
    wireTooltips(
        () => _root,
        () => _tooltipEl
    );

    _submenuOpenListener = (e: Event) => {
        const ce = e as CustomEvent<{ id: string }>;
        if (ce.detail?.id !== "editor" && _isOpen) _close();
    };
    document.addEventListener("geoleaf:submenu:open", _submenuOpenListener);
}

function _buildModeBtn(tool: ToolDef): HTMLButtonElement {
    const btn = _el("button", "gl-editor-tool-btn");
    btn.type = "button";
    btn.dataset.tool = tool.id;
    btn.dataset.tooltip = _getLabel(tool.lk);
    btn.setAttribute("aria-label", _getLabel(tool.ak));
    btn.setAttribute("aria-pressed", "false");
    btn.appendChild(_makeIcon(tool.svg));
    btn.addEventListener("click", () => _handleToolClick(tool.id as EditorTool));
    return btn;
}

function _buildActionBtn(action: ActionDef, handler: (() => void) | undefined): HTMLButtonElement {
    const btn = _el("button", "gl-editor-action-btn");
    btn.type = "button";
    btn.dataset.action = action.id;
    btn.dataset.tooltip = _getLabel(action.lk);
    btn.setAttribute("aria-label", _getLabel(action.ak));
    btn.appendChild(_makeIcon(action.svg));
    btn.addEventListener("click", () => handler?.());
    return btn;
}

// ---------------------------------------------------------------------------
// Position
// ---------------------------------------------------------------------------

/**
 * The four anchors, expressed by EDGE rather than by top/left with a −1 sentinel.
 *
 * B-12 — the old map stored `{top, left}` and encoded "not this edge" as `-1`, which
 * `_applyPosition` turned into `left: auto`. Since the stylesheet declared no `right`
 * and no `bottom`, three of the four anchors silently collapsed to the top-left
 * corner (measured on deploy-full: `top-right` → left 0, `bottom-left` → top 0,
 * `bottom-right` → 0,0). A sentinel that no consumer honours is not a value, it is a
 * hole — so the edges are now named, and each anchor sets exactly the two it owns.
 */
/** Anchor used when `pos` is absent or unknown — named so the fallback is not itself a lookup. */
const _DEFAULT_ANCHOR: { y: "top" | "bottom"; x: "left" | "right" } = { y: "top", x: "right" };

const _POSITION_MAP: Record<string, { y: "top" | "bottom"; x: "left" | "right" }> = {
    "top-left": { y: "top", x: "left" },
    "top-right": _DEFAULT_ANCHOR,
    "bottom-left": { y: "bottom", x: "left" },
    "bottom-right": { y: "bottom", x: "right" },
};

/** Marge au bord de la carte, identique sur les quatre ancrages. */
const _ANCHOR_INSET_PX = 10;

/**
 * Positions `_root` via the four `--gl-editor-*` custom properties.
 *
 * ⚠️ The DEFAULT is `top-right`, and that is a fix, not a preference: the core map
 * toolbar (`.gl-map-toolbar-wrapper`) occupies the top-LEFT column at z-index 1000,
 * above this pill's 980. Defaulting to `top-left` rendered the tool buttons under it
 * — visible to `toBeVisible()`, unreachable to a click, for tests and users alike.
 *
 * An explicit `{top, left}` object still wins and keeps the historical sentinel
 * semantics (a negative coordinate means "leave this edge to `auto`"), so an
 * integrator who pinned exact pixels is unaffected.
 */
function _applyPosition(pos: EditorConfig["menuPosition"]): void {
    if (!_root) return;

    const set = (edge: string, value: string): void =>
        _root?.style.setProperty(`--gl-editor-${edge}`, value);

    if (typeof pos === "object" && pos !== null) {
        set("top", pos.top >= 0 ? `${pos.top}px` : "auto");
        set("left", pos.left >= 0 ? `${pos.left}px` : "auto");
        set("right", "auto");
        set("bottom", "auto");
        _root.removeAttribute("data-gl-anchor-x");
        return;
    }

    const anchor = _POSITION_MAP[pos ?? "top-right"] ?? _DEFAULT_ANCHOR;
    const inset = `${_ANCHOR_INSET_PX}px`;
    set("top", anchor.y === "top" ? inset : "auto");
    set("bottom", anchor.y === "bottom" ? inset : "auto");
    set("left", anchor.x === "left" ? inset : "auto");
    set("right", anchor.x === "right" ? inset : "auto");
    // Drives `align-items: flex-end` in the stylesheet — without it a right-anchored
    // pill lays its children toward the map centre instead of hugging the edge.
    _root.setAttribute("data-gl-anchor-x", anchor.x);
}

// ---------------------------------------------------------------------------
// Open / close
// ---------------------------------------------------------------------------

function _open(): void {
    _isOpen = true;
    _menuEl?.classList.remove("gl-editor-menu--hidden");
    _onToggle?.(true);
    document.dispatchEvent(
        new CustomEvent("geoleaf:submenu:open", { detail: { id: "editor" }, bubbles: false })
    );
}

function _close(): void {
    _isOpen = false;
    _menuEl?.classList.add("gl-editor-menu--hidden");
    _onToggle?.(false);
    // Disarm any active tool so closing the menu also restores popups/tooltips.
    deactivateActiveTool();
}

// ---------------------------------------------------------------------------
// Tool handling
// ---------------------------------------------------------------------------

function _handleToolClick(id: EditorTool): void {
    const next = _activeTool === id ? null : id;
    _activeTool = next;
    _syncActiveButton();
    _onToolSelect?.(next);
}

function _syncActiveButton(): void {
    if (!_menuEl) return;
    for (const btn of _menuEl.querySelectorAll<HTMLButtonElement>("button[data-tool]")) {
        const active = btn.dataset.tool === _activeTool;
        btn.classList.toggle("gl-editor-tool-btn--active", active);
        btn.setAttribute("aria-pressed", String(active));
    }
}
