/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf UI – Mobile toolbar: sheet modal (full-height overlay panel).
 */

import { domState, getDefaultSheetTitles } from "./mobile-toolbar-state.js";
import { createSvgIcon, refreshFilterButtonState } from "./mobile-toolbar-pill.js";
import { getLabel } from "../../../utils/i18n/i18n.js";
import { handleFocusTrap } from "../../../utils/controls/focus-trap.js";
import { getPanelPane, listPanelPanes, preparePane, registerPaneHost } from "../panel-panes.js";

/**
 * The two heights of the mobile sheet: `"full"` (modal, its default) and `"peek"` (only the header
 * left on screen, the map usable around it).
 */
type PaneSize = "peek" | "full";

/** The overlay modifier that lowers the sheet to its header. */
const PEEK_CLASS = "gl-sheet-overlay--peek";

/** The custom property the stylesheet reads to leave exactly the header on screen. */
const PEEK_HEIGHT_VAR = "--gl-sheet-peek-height";

/**
 * The custom property the map's host carries while the sheet is lowered: the height of the
 * bottom edge the header covers. The bottom-left corner and the toolbar rise by it, since the
 * header sits above them (z-index) and hid the scale bar and the branding.
 */
const PEEK_CLEARANCE_VAR = "--gl-sheet-peek-clearance";

// C1: guard — only one document-level Escape listner at a time
let _escapeListenerAdded = false;

function _attachFocusTrap(overlay: HTMLElement): void {
    // The `open` guard stays here rather than moving into the shared helper:
    // this sheet is the only surface whose overlay stays mounted while closed.
    // A reduced sheet is not modal: trapping focus in a header would lock the map out.
    overlay.addEventListener("keydown", (e) => {
        if (!overlay.classList.contains("open")) return;
        if (overlay.classList.contains(PEEK_CLASS)) return;
        handleFocusTrap(overlay, e);
    });
}

/** Creates the sheet overlay DOM and attaches keyboard / clickk handlers. */
export function createSheetDom(): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className = "gl-sheet-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "gl-sheet-panel-title");
    overlay.setAttribute("aria-describedby", "gl-sheet-panel-body");

    const panel = document.createElement("div");
    panel.className = "gl-sheet-panel";

    const header = document.createElement("div");
    header.className = "gl-sheet-panel__header";

    const title = document.createElement("h2");
    title.className = "gl-sheet-panel__title";
    title.id = "gl-sheet-panel-title";
    domState.panelTitle = title;

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "gl-sheet-panel__close";
    closeBtn.setAttribute("aria-label", getLabel("aria.sheet.close"));
    closeBtn.appendChild(createSvgIcon("M18 6L6 18M6 6l12 12", 24));

    const body = document.createElement("div");
    body.className = "gl-sheet-panel__body";
    body.id = "gl-sheet-panel-body";
    domState.panelBody = body;

    header.appendChild(title);
    header.appendChild(closeBtn);
    panel.appendChild(header);
    panel.appendChild(body);
    overlay.appendChild(panel);

    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeSheet();
    });
    closeBtn.addEventListener("click", () => closeSheet());
    _attachPeekHeader(header);

    _attachFocusTrap(overlay);

    // C1: add document Escape listner only once
    if (!_escapeListenerAdded) {
        _escapeListenerAdded = true;
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && domState.overlay?.classList.contains("open")) closeSheet();
        });
    }

    return overlay;
}

/** Moves a node into the sheet body and registers it for restoration on close. */
function moveNodeToSheetBody(node: HTMLElement | null): void {
    if (!node || !domState.panelBody) return;
    const parent = node.parentElement;
    if (!parent) return;
    const nextSibling = node.nextSibling;
    domState.restoreOnClose.push({ parent, node, nextSibling });
    domState.panelBody.appendChild(node);
}

/** Injects existing DOM panels (filters, layers, legend) into the sheet body. */
function injectSheetContent(sheetId: string): void {
    if (!domState.panelBody) return;
    domState.restoreOnClose = [];
    if (sheetId === "filters") {
        const panel = document.getElementById("gl-filter-panel");
        if (panel) {
            panel.classList.add("gl-is-open", "gl-sheet-content");
            moveNodeToSheetBody(panel);
        }
    } else if (sheetId === "layers") {
        const lm = document.querySelector(".gl-layer-manager") as HTMLElement | null;
        if (lm) {
            lm.classList.remove("gl-layer-manager--collapsed");
            moveNodeToSheetBody(lm);
        }
    } else if (sheetId === "legend") {
        const legendEl = document.querySelector(".gl-map-legend") as HTMLElement | null;
        if (legendEl) moveNodeToSheetBody(legendEl);
    } else {
        // A pane registered from outside the kernel. Same gesture as the three above — the
        // node is MOVED and restored on close — but the selector comes from the registry
        // rather than from a literal here, which is what lets the kernel host a panel it
        // does not name.
        const pane = getPanelPane(sheetId);
        if (pane) {
            // The owner builds on demand — see `PanelPane.onOpen`.
            preparePane(sheetId);
            moveNodeToSheetBody(document.querySelector<HTMLElement>(pane.selector));
        }
    }
}

/**
 * Restores nodes moved into the sheet back to their original positions.
 *
 * 🛑 ONLY THE NODES THE SHEET STILL HOLDS. A node its owner took out in the meantime — a
 * plugin's teardown runs BEFORE this one at an unmount, and removes its own panel — is not
 * the sheet's to give back: restored anyway, a removed panel came back into the document,
 * orphaned and hidden, and its owner built a second one beside it at the next opening.
 */
function restoreMovedNodes(): void {
    const body = domState.panelBody;
    for (const { parent, node, nextSibling } of [...domState.restoreOnClose].reverse()) {
        node.classList.remove("gl-sheet-content");
        if (!body?.contains(node)) continue;
        if (nextSibling && nextSibling.parentNode === parent) {
            parent.insertBefore(node, nextSibling);
        } else {
            parent.appendChild(node);
        }
    }
    domState.restoreOnClose = [];
    document.getElementById("gl-filter-panel")?.classList.remove("gl-is-open");
}

/** Opens the sheet overlay for the given sheetId. */
export function openSheet(sheetId: string): void {
    const titles = { ...getDefaultSheetTitles(), ...(domState.options?.sheetTitles ?? {}) };
    const registered = getPanelPane(sheetId);
    // A host override wins over the registered label, so an integrator keeps the last word;
    // the pane resolves its own i18n key otherwise, and only then do we fall back to the id.
    const title = titles[sheetId] ?? (registered ? getLabel(registered.labelKey) : sheetId);
    if (domState.panelTitle) domState.panelTitle.textContent = title;
    if (domState.panelBody) domState.panelBody.innerHTML = ""; // SAFE: empty string — clears element, no user data
    domState.activeSheetId = sheetId;
    domState.lastFocusedElement =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Every opening is a full one: a height lowered for a previous content is not this one's.
    _applySize("full");
    domState.overlay?.classList.add("open");
    domState.overlay?.setAttribute("aria-labelledby", "gl-sheet-panel-title");
    const openedBtn = domState.toolbar?.querySelector(`[data-gl-sheet="${sheetId}"]`);
    if (openedBtn instanceof HTMLElement) openedBtn.setAttribute("aria-expanded", "true");
    if (["filters", "layers", "legend"].includes(sheetId) || registered) {
        injectSheetContent(sheetId);
    }
    const sheetCloseBtn = domState.overlay?.querySelector<HTMLElement>(".gl-sheet-panel__close");
    sheetCloseBtn?.focus();
    refreshFilterButtonState();
}

/**
 * Marks the pill button of every registered pane as having a desktop equivalent.
 *
 * ⚠️ Reuses the EXISTING `data-gl-desktop-slot` contract rather than inventing a rule: the
 * kernel stylesheet already hides `.gl-map-toolbar__btn[data-gl-desktop-slot]` above 1440px,
 * where the side panel shows the same content as a tab. Without this, a pane owner would get
 * both a tab and a pill on a wide screen — two controls for one panel.
 */
export function markPillsWithPane(): void {
    for (const pane of listPanelPanes()) {
        const btn = domState.toolbar?.querySelector<HTMLElement>(
            "[data-gl-sheet='" + pane.id + "']"
        );
        btn?.setAttribute("data-gl-desktop-slot", "");
    }
}

// The mobile sheet offers itself as a pane host, BEHIND the desktop panel — see the priority
// note there. Below 1440px the desktop host is inactive and this one answers.
registerPaneHost({
    id: "mobile-sheet",
    priority: 10,
    isActive: () => domState.overlay !== null,
    sync: () => markPillsWithPane(),
    open: (paneId) => {
        if (!getPanelPane(paneId)) return false;
        openSheet(paneId);
        return true;
    },
    close: () => closeSheet(),
});

/** Closes the sheet overlay and restores any moved nodes. */
export function closeSheet(): void {
    restoreMovedNodes();
    _applySize("full");
    domState.overlay?.classList.remove("open");
    domState.activeSheetId = null;
    domState.toolbar
        ?.querySelectorAll("[aria-expanded]")
        .forEach((el) => el.setAttribute("aria-expanded", "false"));
    if (domState.lastFocusedElement) {
        domState.lastFocusedElement.focus();
        domState.lastFocusedElement = null;
    }
    refreshFilterButtonState();
}

/**
 * Makes the header of a reduced sheet the way back to its full height.
 *
 * ⚠️ The close button lives in that header and keeps its own meaning: a tap on it closes the sheet,
 * it does not expand it first. Keyboard: the header takes focus only while reduced, and Enter or
 * Space restore the full height.
 */
function _attachPeekHeader(header: HTMLElement): void {
    const isPeek = (): boolean => domState.overlay?.classList.contains(PEEK_CLASS) === true;
    header.addEventListener("click", (e) => {
        if (!isPeek()) return;
        if (e.target instanceof Element && e.target.closest(".gl-sheet-panel__close")) return;
        void setPaneSize("full");
    });
    header.addEventListener("keydown", (e) => {
        if (!isPeek() || e.target !== header) return;
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        void setPaneSize("full");
    });
}

/**
 * Puts the overlay in `size`, synchronously, whether or not the sheet is open.
 *
 * @param size - The height to apply.
 * @returns The panel, for the caller that waits for its transition; `null` without a sheet.
 */
function _applySize(size: PaneSize): HTMLElement | null {
    const overlay = domState.overlay;
    if (!overlay) return null;
    const panel = overlay.querySelector<HTMLElement>(".gl-sheet-panel");
    const header = overlay.querySelector<HTMLElement>(".gl-sheet-panel__header");
    const body = domState.panelBody;
    const peek = size === "peek";
    const host = domState.options?.glMain ?? null;
    let clearance = 0;
    if (peek && panel && header) {
        // Measured, not assumed: the title wraps on a narrow phone, and a fixed height would
        // either clip it or leave a strip of body showing.
        const height = header.getBoundingClientRect().height;
        if (height > 0) {
            panel.style.setProperty(PEEK_HEIGHT_VAR, `${height}px`);
            clearance = Math.ceil(height);
        }
    }
    // Set on the host, not on the overlay: the corner lives in the map container, a sibling.
    if (clearance > 0) host?.style.setProperty(PEEK_CLEARANCE_VAR, `${clearance}px`);
    else host?.style.removeProperty(PEEK_CLEARANCE_VAR);
    overlay.classList.toggle(PEEK_CLASS, peek);
    if (peek) overlay.removeAttribute("aria-modal");
    else overlay.setAttribute("aria-modal", "true");
    // The lowered body is off screen: out of the tab order, and out of the accessibility tree.
    body?.toggleAttribute("inert", peek);
    if (header) {
        if (peek) header.setAttribute("tabindex", "0");
        else header.removeAttribute("tabindex");
    }
    if (peek && body?.contains(document.activeElement)) header?.focus();
    return panel;
}

/**
 * The longest transition declared on `el`, delay included, in milliseconds.
 *
 * @returns `0` when nothing animates — reduced motion, or an environment without layout.
 */
function _transitionMs(el: HTMLElement): number {
    const style = getComputedStyle(el);
    const parse = (list: string): number[] =>
        list
            .split(",")
            .map((v) => v.trim())
            .map((v) => (v.endsWith("ms") ? parseFloat(v) : parseFloat(v) * 1000))
            .map((n) => (Number.isFinite(n) ? n : 0));
    const durations = parse(style.transitionDuration || "0s");
    const delays = parse(style.transitionDelay || "0s");
    return durations.reduce((max, d, i) => Math.max(max, d + (delays[i] ?? delays[0] ?? 0)), 0);
}

/**
 * Resolves once the panel has stopped moving.
 *
 * ⚠️ Bounded by the declared duration, not only by `transitionend`: a transition that does not
 * run — the panel already at its target, a tab in the background — never fires the event.
 */
function _settled(panel: HTMLElement): Promise<void> {
    const ms = _transitionMs(panel);
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const finish = (): void => {
            panel.removeEventListener("transitionend", onEnd);
            if (timer !== null) clearTimeout(timer);
            resolve();
        };
        const onEnd = (e: TransitionEvent): void => {
            if (e.target === panel && e.propertyName === "transform") finish();
        };
        panel.addEventListener("transitionend", onEnd);
        timer = setTimeout(finish, ms + 50);
    });
}

/**
 * Sets the height of the open mobile sheet.
 *
 * `"peek"` lowers the sheet to its header and makes it non-modal: the backdrop no longer darkens
 * nor catches the map's gestures, focus is not trapped, `aria-modal` is dropped and the hidden body
 * leaves the tab order. The map's host carries the header's height (`--gl-sheet-peek-clearance`)
 * while the sheet is lowered, so that the bottom-left corner and the toolbar rise above it. A tap
 * on the header — or `setPaneSize("full")` — brings the full height back. Closing or reopening
 * the sheet always gives the full height.
 *
 * A no-op answering `false` when no mobile sheet is open — which is always the case at desktop
 * widths, where panes live in the side panel.
 *
 * @param size - `"peek"` (header only) or `"full"` (the default height).
 * @returns A promise of `true` once the panel has reached that height — the moment to measure what
 *          it covers — or of `false` when no sheet is open.
 */
export function setPaneSize(size: PaneSize): Promise<boolean> {
    const overlay = domState.overlay;
    // Read from plain JS too: an unknown size is refused rather than read as "full".
    if (size !== "peek" && size !== "full") return Promise.resolve(false);
    if (!overlay?.classList.contains("open")) return Promise.resolve(false);
    const wasPeek = overlay.classList.contains(PEEK_CLASS);
    const panel = _applySize(size);
    if (!panel || wasPeek === (size === "peek")) return Promise.resolve(true);
    return _settled(panel).then(() => true);
}
