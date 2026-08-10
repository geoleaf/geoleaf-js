/*!
 * GeoLeaf Core (feature-info capability) — Side-panel surface (selection)
 * © 2026 Mattieu Pottier — MIT License
 *
 * Standalone right-drawer panel appended to `document.body` — self-contained, no
 * external namespace dependency. Reproduces the pre-extraction core side-panel shell
 * (`gl-poi-sidepanel` + header/close + scrollable `__content`) and fills the
 * content with the ported renderers (`buildSidePanelBody`), so the rendered DOM
 * and its theme-driven CSS are identical to before. This is the surface the
 * `ISidePanelRenderer` contract injects into core (S9).
 * https://geoleaf.dev
 */
import { buildSidePanelBody } from "../render/sidepanel-content.js";
import type { RenderField } from "../render/dom.js";
import { hasFields, resolveSurfaceFields, toRenderFields } from "../convert.js";
import { handleFocusTrap } from "../../../utils/controls/focus-trap.js";
import type { GeoLeafFeatureClickDetail, ISidePanelRenderer, SidePanelLayout } from "../types.js";

interface GeoLeafHost {
    GeoLeaf?: { I18n?: { t?: (key: string, fallback?: string) => string } };
}

function i18n(key: string, fallback: string): string {
    const g = globalThis as unknown as GeoLeafHost;
    return g.GeoLeaf?.I18n?.t?.(key, fallback) ?? fallback;
}

let _el: HTMLDivElement | null = null;
let _content: HTMLDivElement | null = null;
let _outsideHandler: ((e: Event) => void) | null = null;
let _keyHandler: ((e: Event) => void) | null = null;
let _isOpen = false;

/** Resolves the side-panel field list from a `layout` override or the layer binding. */
function resolveFieldList(
    detail: GeoLeafFeatureClickDetail,
    layout?: SidePanelLayout
): readonly RenderField[] {
    if (layout) return toRenderFields(layout.fields);
    // ⚠️ The former fallback listed every property, then dropped all of them further
    // down because none carried a widget — which is exactly why the one profile
    // writing `"all"` on this surface rendered an EMPTY panel. Both halves are gone.
    const resolved = resolveSurfaceFields(detail.layerId, "sidepanel");
    return hasFields(resolved) ? resolved : [];
}

/** Creates (idempotent) the drawer shell (header + close + scrollable content), appended to `document.body`. */
function ensureContainer(): HTMLDivElement {
    if (_el && _content) return _el;
    const panel = document.createElement("div");
    panel.className = "gl-poi-sidepanel";
    panel.setAttribute("role", "complementary");
    panel.setAttribute("aria-label", i18n("feature-info.sidepanel.landmark", "Panneau de détails"));
    // Closed drawers stay in the DOM (`closeSidePanel` only drops the `.open` class)
    // and CSS hides them with `transform: translateX(100%)` alone — no `display`,
    // `visibility` or `inert`. Off-screen is not hidden: without these attributes the
    // whole panel, its close button and its links remain in the accessibility tree
    // AND in the tab order while invisible. `inert` is what takes them out of the tab
    // order; `aria-hidden` alone over focusable children is itself a violation
    // (axe `aria-hidden-focus`). Both toggled in `openSidePanel` / `closeSidePanel`.
    panel.setAttribute("aria-hidden", "true");
    panel.toggleAttribute("inert", true);

    const header = document.createElement("div");
    header.className = "gl-poi-sidepanel__header";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "gl-poi-sidepanel__close";
    closeBtn.setAttribute("data-action", "close");
    closeBtn.setAttribute("aria-label", i18n("feature-info.sidepanel.close", "Fermer"));
    closeBtn.textContent = "×";
    header.appendChild(closeBtn);

    const content = document.createElement("div");
    content.className = "gl-poi-sidepanel__content";

    panel.appendChild(header);
    panel.appendChild(content);
    document.body.appendChild(panel);
    _el = panel;
    _content = content;
    return _el;
}

function _detachListeners(): void {
    if (_outsideHandler) {
        document.removeEventListener("click", _outsideHandler, true);
        _outsideHandler = null;
    }
    if (_keyHandler) {
        document.removeEventListener("keydown", _keyHandler);
        _keyHandler = null;
    }
}

function _attachListeners(el: HTMLDivElement): void {
    _detachListeners();
    el.querySelector("[data-action='close']")?.addEventListener("click", closeSidePanel);
    _outsideHandler = (e: Event) => {
        const target = e.target as Node | null;
        if (target && !el.contains(target)) closeSidePanel();
    };
    document.addEventListener("click", _outsideHandler, true);
    _keyHandler = (e: Event) => {
        const ke = e as KeyboardEvent;
        if (ke.key === "Escape") {
            closeSidePanel();
            return;
        }
        handleFocusTrap(el, ke);
    };
    document.addEventListener("keydown", _keyHandler);
}

/**
 * Opens the side-panel — standalone DOM, self-contained. Reuses the
 * same shell across successive calls (re-opens on a new feature). `layout`, when
 * provided, fully overrides the auto-resolved layer binding.
 */
export function openSidePanel(detail: GeoLeafFeatureClickDetail, layout?: SidePanelLayout): void {
    const el = ensureContainer();
    const fields = resolveFieldList(detail, layout);

    const body = buildSidePanelBody(fields, detail.properties, { layerId: detail.layerId });
    if (_content) {
        _content.replaceChildren(body);
    }
    _attachListeners(el);
    _isOpen = true;
    // Force a synchronous reflow so the browser commits the closed transform
    // (translateX(100%)) before the .open class flips it — otherwise the very
    // first open on a freshly-inserted element can skip the CSS transition.
    void el.offsetHeight;
    el.classList.add("open");
    // Re-expose to assistive tech and to the tab order BEFORE moving focus: an
    // `inert` / `aria-hidden="true"` subtree cannot legally hold the focus, and
    // `.focus()` on an inert node is a no-op.
    el.toggleAttribute("inert", false);
    el.setAttribute("aria-hidden", "false");
    document.body.classList.add("gl-poi-sidepanel-open");
    // Move focus to the close button on open (keyboard/screen-reader users land inside).
    el.querySelector<HTMLElement>("[data-action='close']")?.focus();
}

/** Closes the side-panel (slide-out). Does not remove it from the DOM. */
export function closeSidePanel(): void {
    if (!_el || !_isOpen) return;
    _el.classList.remove("open");
    // Focus may still sit on the close button that triggered this; hand it back to
    // the document before hiding the subtree, so no focused node ends up inside an
    // `aria-hidden` container.
    if (_el.contains(document.activeElement)) {
        (document.activeElement as HTMLElement | null)?.blur();
    }
    _el.setAttribute("aria-hidden", "true");
    _el.toggleAttribute("inert", true);
    document.body.classList.remove("gl-poi-sidepanel-open");
    _detachListeners();
    _isOpen = false;
}

/** Returns `true` when the side-panel is currently open. */
export function isSidePanelOpen(): boolean {
    return _isOpen;
}

/** Removes the side-panel element from the DOM. Called on plugin destroy / reset. */
export function destroySidePanel(): void {
    _detachListeners();
    if (_el) {
        _el.remove();
        _el = null;
        _content = null;
    }
    _isOpen = false;
    document.body.classList.remove("gl-poi-sidepanel-open");
}

/**
 * Structural check (compile-time only): these three exports collectively satisfy
 * `ISidePanelRenderer` — the contract Sprint 3's core-side delegate relies on
 * structurally, without ever importing this file. Catches signature drift here.
 */
const _isidePanelRendererContract: ISidePanelRenderer = {
    openSidePanel,
    closeSidePanel,
    isSidePanelOpen,
};
void _isidePanelRendererContract;
