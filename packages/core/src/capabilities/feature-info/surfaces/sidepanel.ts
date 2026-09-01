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
import { isTitleField } from "../render/dom.js";
import { buildNormalizedModel, resolvePath } from "../resolve.js";
import { hasFields, resolveSurfaceFields, toRenderFields } from "../convert.js";
import { handleFocusTrap } from "../../../utils/controls/focus-trap.js";
// Through the BARREL, not `events/event-bus.js`: the deep-import rule forbids
// `capabilities/**` to import deep under `kernel/**`. The symbol is already
// re-exported there — nothing to widen.
import { dispatchGeoLeafEvent } from "../../../kernel/events/index.js";
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
/**
 * POI whose panel is open — carried ONLY so `geoleaf:poi:panel:close` can name it.
 * `closeSidePanel()` receives no argument, and the identity of what closes is
 * deducible from nothing else once the panel is emptied.
 */
let _openPoiId: string | null = null;

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

    // ⚠️ This context carried only `layerId` until 14/08/2026, while the popup already
    // passed all three fields. Measured consequence: a `type: "action"` button clicked
    // IN THE PANEL emitted `featureId: null` and no `lngLat` — the widget is in the
    // shared dispatch table, so it renders here too. `render/dom.ts` and the
    // capability's spec sheet nonetheless declared this point settled: it only was on
    // the popup side.
    const body = buildSidePanelBody(fields, detail.properties, {
        layerId: detail.layerId,
        featureId: detail.featureId,
        lngLat: detail.lngLat,
        onClose: closeSidePanel,
    });
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
    _emitPanelOpened(detail, fields);
}

/**
 * Emits `geoleaf:poi:panel:open`, and nothing else — the opening is already done.
 *
 * 🛑 **This key was TYPED WITHOUT AN EMITTER from the start**: an integrator
 * subscribing to it wrote code that compiles and never fires. The arbitration was to
 * **wire the emitter** rather than remove the key — removing a published interface is
 * a major break, and this adds surface, it does not take any away.
 *
 * ⚠️ **We do NOT emit when `featureId` is absent.** `poiId` is declared `string` in a
 * published interface: widening its shape would be precisely the break being avoided,
 * and forging an identifier (`""`, an index) would be worse than staying silent — the
 * subscriber could not tell two id-less POIs apart. A layer without a stable
 * identifier therefore does not emit.
 *
 * `poiName` resolves through the SAME path as the displayed title — the field marked
 * `title` by the layer binding, resolved against the normalised model. The name the
 * event carries is thus, by construction, the one the user reads.
 */
function _emitPanelOpened(detail: GeoLeafFeatureClickDetail, fields: readonly RenderField[]): void {
    if (detail.featureId === null || detail.featureId === undefined) {
        _openPoiId = null;
        return;
    }
    const poiId = String(detail.featureId);
    const titleField = fields.find((f) => isTitleField(f));
    const rawName = titleField
        ? resolvePath(buildNormalizedModel(detail.properties), titleField.field)
        : undefined;
    _openPoiId = poiId;
    dispatchGeoLeafEvent("geoleaf:poi:panel:open", {
        poiId,
        poiName: rawName === undefined || rawName === null ? "" : String(rawName),
    });
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
    // The `!_el || !_isOpen` guard at the top of the function means this NEVER fires
    // on an empty close — all four paths (button, outside click, Escape,
    // `FeatureInfo.close()`) go through it. `_openPoiId` is null when the opening had
    // no identifier: we stay silent then too, symmetrically.
    if (_openPoiId !== null) {
        const poiId = _openPoiId;
        _openPoiId = null;
        dispatchGeoLeafEvent("geoleaf:poi:panel:close", { poiId });
    }
}

/** Returns `true` when the side-panel is currently open. */
export function isSidePanelOpen(): boolean {
    return _isOpen;
}

/**
 * Removes the side-panel element from the DOM. Called on plugin destroy / reset.
 *
 * ⚠️ **Does NOT emit `geoleaf:poi:panel:close`, deliberately.** This is a TEARDOWN,
 * not a close: nobody closed the panel, the capability is being pulled from under it.
 * Emitting here would fake a user gesture in the middle of a `Core.destroy()`, and do
 * so at a moment when the subscribers are themselves being detached. What the
 * lifecycle should announce at destruction is a distinct question, left open on
 * purpose. `_openPoiId` is still reset: letting it survive would emit a `close` for a
 * stale POI at the next open-close.
 */
export function destroySidePanel(): void {
    _detachListeners();
    if (_el) {
        _el.remove();
        _el = null;
        _content = null;
    }
    _isOpen = false;
    _openPoiId = null;
    document.body.classList.remove("gl-poi-sidepanel-open");
}

/**
 * Structural check (compile-time only): these three exports collectively satisfy
 * `ISidePanelRenderer` — the contract the core-side delegate relies on
 * structurally, without ever importing this file. Catches signature drift here.
 */
const _isidePanelRendererContract: ISidePanelRenderer = {
    openSidePanel,
    closeSidePanel,
    isSidePanelOpen,
};
void _isidePanelRendererContract;
