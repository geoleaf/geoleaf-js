/*!
 * @geoleaf-plugins/editor — API implementation
 * © 2026 Mattieu Pottier — MIT License
 *
 * The menu-toggle wrapper and the teardown hook behind `GeoLeaf.Editor`. Split out of
 * `public-api.ts` (backlog B.12), which held three module-level `let`s and the
 * first-open positioning branch — state and control flow a facade must not carry.
 * https://geoleaf.dev
 */
import {
    toggleEditorMenu as _toggle,
    destroyEditorMenu,
    positionEditorMenuNear,
} from "./sub-menu/floating-menu.js";
import { _getNativeMap } from "./internal.js";

let _destroyHook: (() => void) | null = null;
let _pillBtn: Element | null = null;
let _menuPositioned = false;

/** Called by entry.ts once modals are ready to register their cleanup. */
export function setDestroyHook(fn: () => void): void {
    _destroyHook = fn;
}

/**
 * Opens or closes the editor floating sub-menu.
 *
 * Wraps the raw menu toggle to place the panel beside the pill bar on FIRST open only:
 * the anchor is not known until the toolbar hands it over, and re-positioning on every
 * toggle would fight a menu the user has dragged.
 */
export function toggleEditorMenu(anchorEl?: Element | null): void {
    if (anchorEl) _pillBtn = anchorEl;
    _toggle(anchorEl);
    // On first open: position the sub-menu to the right of the pill bar.
    if (_pillBtn && !_menuPositioned) {
        const mapEl = _getNativeMap()?.getContainer();
        if (mapEl) positionEditorMenuNear(_pillBtn, mapEl);
        _menuPositioned = true;
    }
}

/**
 * Takes the editor down: the menu, then everything the wiring built (form, drawing engine,
 * listeners, persistence) through the hook the entry registered.
 *
 * Two callers, one teardown: `GeoLeaf.Editor.destroy()`, the host's, and the module the entry
 * registers with the core's module registry, which `GeoLeaf.mount()`'s `unmount()` reaches.
 * The second came later than the first, and its absence is why an application unmounted left
 * the editor's menu in the page and its engine bound to the map that had gone.
 *
 * The hook runs ONCE per wiring: it is dropped as it runs, so a second call — the host's, then
 * the unmount's — finds a menu already gone and nothing else to undo. The anchor and the
 * first-open latch go with it: the next wiring is positioned against the toolbar of its own
 * application.
 */
export function destroyEditor(): void {
    destroyEditorMenu();
    const hook = _destroyHook;
    _destroyHook = null;
    _pillBtn = null;
    _menuPositioned = false;
    hook?.();
}
