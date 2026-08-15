/*!
 * GeoLeaf Core (feature-info capability) — Ported renderers: shared DOM foundation
 * © 2026 Mattieu Pottier — MIT License
 *
 * Dependency-free foundation for the ported "before" attribute renderers.
 * It carries the field-config shape, the per-surface render context, a small
 * element factory, and the runtime security / i18n seams. Every seam is
 * duck-typed off `globalThis.GeoLeaf` so this module never imports core, the
 * field-renderer package, or any sibling package: when a seam is absent, a
 * local fallback keeps rendering XSS-safe.
 * https://geoleaf.dev
 */

/**
 * Field-config shape consumed by the ported renderers. Mirrors the authored
 * layout entries of the pre-extraction core (`type`, `variant`, `accordion`, …)
 * plus an index signature for renderer-specific extras. Every property is
 * optional except `field`; renderers read only what they need.
 */
export interface RenderField {
    /** Dotted path resolved against the normalized feature model (e.g. `attributes.photo`). */
    field: string;
    /** Renderer selector (`text`, `image`, `list`, `table`, `tags`, `badge`, …). */
    type?: string;
    /** Human label shown as a section heading or link text. */
    label?: string;
    /** Presentation style (`title`, `multiline`, …). */
    style?: string;
    /** Renderer variant (`hero`, `short`, `disc`, …). */
    variant?: string;
    /** Wrap the section in a collapsible accordion. */
    accordion?: boolean;
    /** Open the accordion by default when `accordion` is set. */
    defaultOpen?: boolean;
    /** Table column descriptors (`{ key, label? }`). */
    columns?: { key: string; label?: string }[];
    /** Table border toggles / colour (`outer`, `row`, `column`, `color`). */
    borders?: Record<string, unknown>;
    /** Maximum number of items rendered (e.g. reviews). */
    maxCount?: number;
    /** Text inserted before the resolved value. */
    prefix?: string;
    /** Text inserted after the resolved value. */
    suffix?: string;
    /** Label shown when an accordion is closed. */
    closedLabel?: string;
    /** Skip rendering this field entirely. */
    hidden?: boolean;
    /** Escape hatch for renderer-specific configuration keys. */
    [k: string]: unknown;
}

/**
 * Per-surface context threaded from a surface handler down to the field
 * renderers. `layerId` + `feature` let taxonomy-aware renderers resolve a value
 * against the whole feature (e.g. a category label).
 */
export interface RenderContext {
    /** GeoLeaf layer id the feature belongs to. */
    readonly layerId?: string;
    /** Raw feature property bag (for cross-field lookups). */
    readonly feature?: Record<string, unknown>;
    /**
     * Feature identifier, carried for `type: "action"` buttons (B-69).
     *
     * ⚠️ Ce champ et le suivant ont manqué pendant toute la vie du type `action`, et c'est
     * exactement ce qui a fait abandonner la fonctionnalité : le détail du clic les porte
     * (`GeoLeafFeatureClickDetail`), mais le contexte de rendu s'arrêtait au `layerId` — donc le
     * renderer ne pouvait pas construire la charge utile que le contrat promettait.
     *
     * ⚠️ **Et B-69 n'a réparé que la MOITIÉ, ce qui ne s'est vu que le 14/08/2026** :
     * `surfaces/popup.ts` passait les trois champs, `surfaces/sidepanel.ts` s'en tenait au
     * `layerId`. Le widget `action` vivant dans la table de dispatch partagée, il rend sur les
     * deux surfaces — une action cliquée dans le panneau émettait donc `featureId: null`
     * pendant seize jours, sous un commentaire qui disait le contraire. Une réparation
     * asymétrique se lit comme une réparation.
     */
    readonly featureId?: string | number | null;
    /** Geographic position of the popup, for the `action` payload (B-69). */
    readonly lngLat?: { readonly lat: number; readonly lng: number };
    /**
     * Closes the surface this context belongs to — supplied by `surfaces/popup.ts`
     * (`closePopup`) and `surfaces/sidepanel.ts` (`closeSidePanel`).
     *
     * ⚠️ **First non-data field of this interface, and it is injected rather than imported for a
     * structural reason.** The graph runs `surfaces/popup.ts → render/popup-content.ts →
     * render/widget-dispatch.ts` (and symmetrically for the side panel); a renderer importing a
     * surface back would close a cycle. Injection is also **the only way to close the RIGHT
     * surface** — the `action` widget is in the shared dispatch table and renders on both.
     *
     * Optional because most render paths have no surface to close (tooltip, tests, direct
     * `renderFieldNode` calls). Absent, `close()` on the event detail is a no-op.
     */
    readonly onClose?: () => void;
}

/** Structural view of the runtime `GeoLeaf.Security` seam (duck-typed). */
interface SecuritySeam {
    /** Escapes HTML text nodes. */
    escapeHtml?: (v: string) => string;
    /** Validates a URL — THROWS on unsafe input, returns the normalized URL otherwise. */
    validateUrl?: (url: string) => string;
}

/** Structural view of the runtime `GeoLeaf.I18n` seam (duck-typed). */
interface I18nSeam {
    /** Translates `key`, returning `fallback` when the key is missing. */
    t?: (key: string, fallback?: string) => string;
}

/**
 * The three reading surfaces, as the render layer names them.
 *
 * ⚠️ Declared here rather than imported from `contracts/attributes.contract.ts`,
 * where `AttributeSurface` says the same thing, because this module's stated
 * invariant is that it imports nothing — not core, not the field-renderer package,
 * not a sibling. The parity gate is what keeps the two lists equal; a shared import
 * would trade a checked duplication for a broken invariant.
 */
export type RenderSurface = "tooltip" | "popup" | "sidepanel";

/**
 * The surface parameter of the taxonomy seam.
 *
 * An alias rather than a second union: the seam takes exactly the reading surfaces,
 * and giving it its own list would be one more thing that can drift.
 */
export type TaxonomySurface = RenderSurface;

/**
 * Structural view of the runtime `GeoLeaf.Taxonomy` seam (duck-typed). Lets the
 * self-contained renderers ask the taxonomy capability to resolve a category
 * icon / label WITHOUT importing it — taxonomy owns the decision + config, these
 * renderers own the DOM. Every method is optional: absent seam → no decoration.
 */
interface TaxonomySeam {
    /** Sprite `symbolId` of the title icon for a feature on a surface, or `null`. */
    resolveTitleIcon?: (
        layerId: string,
        feature: Record<string, unknown>,
        surface: TaxonomySurface
    ) => string | null;
    /** Ensures the profile sprite `<symbol>` defs are in the DOM (idempotent). */
    ensureSprite?: () => void;
    /** Colours of a category / sub-category pill badge, or `null`. */
    resolveBadgeStyle?: (
        layerId: string,
        feature: Record<string, unknown>,
        surface: TaxonomySurface,
        field: string
    ) => BadgeStyle | null;
}

/** Validated colours for one pill badge, as handed over by the taxonomy seam. */
export interface BadgeStyle {
    /** Pill background. */
    background: string;
    /** Pill border. */
    border: string;
    /** Pill text colour, already picked for contrast. */
    text: string;
}

/** Structural view of the `globalThis.GeoLeaf` host object (duck-typed). */
interface GeoLeafHost {
    GeoLeaf?: {
        Security?: SecuritySeam;
        I18n?: I18nSeam;
        Taxonomy?: TaxonomySeam;
    };
}

/** Reads the runtime `GeoLeaf.Security` seam, or an empty object when unmounted. */
function security(): SecuritySeam {
    return (globalThis as unknown as GeoLeafHost).GeoLeaf?.Security ?? {};
}

/** Reads the runtime `GeoLeaf.I18n` seam, or an empty object when unmounted. */
function i18nSeam(): I18nSeam {
    return (globalThis as unknown as GeoLeafHost).GeoLeaf?.I18n ?? {};
}

/** Reads the runtime `GeoLeaf.Taxonomy` seam, or an empty object when unmounted. */
function taxonomy(): TaxonomySeam {
    return (globalThis as unknown as GeoLeafHost).GeoLeaf?.Taxonomy ?? {};
}

/**
 * Creates an `HTMLElement` for `tag`, optionally assigning a `className` and a
 * flat map of string attributes via `setAttribute`. This is the capability-local
 * element factory the ported renderers use in place of the former core
 * renderer base class.
 *
 * @param tag HTML tag name (e.g. `"div"`, `"img"`, `"a"`).
 * @param className Optional class name(s) assigned verbatim.
 * @param attrs Optional string-valued attributes set via `setAttribute`.
 * @returns The created element, typed as `HTMLElement`.
 */
export function el(tag: string, className?: string, attrs?: Record<string, string>): HTMLElement {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (attrs) {
        for (const [key, val] of Object.entries(attrs)) {
            node.setAttribute(key, val);
        }
    }
    return node;
}

/** Local fallback: escapes the five HTML-significant characters `& < > " '`. */
function escapeFallback(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * Escapes `v` for insertion as HTML text, delegating to
 * `GeoLeaf.Security.escapeHtml` when present, else a local fallback. `v` is
 * coerced to a string first, so non-string inputs are handled safely.
 *
 * @param v Arbitrary value to escape.
 * @returns The HTML-escaped string.
 */
export function escapeHtml(v: unknown): string {
    const s = String(v);
    const fn = security().escapeHtml;
    return typeof fn === "function" ? fn(s) : escapeFallback(s);
}

/**
 * Validates a URL destined for an `img.src` / `a.href` sink. Delegates to
 * `GeoLeaf.Security.validateUrl` when present — that helper THROWS on unsafe
 * input and returns the normalized URL on success, so the call is wrapped in a
 * try/catch. When the seam is absent, a local fallback accepts only absolute
 * `http(s)://` URLs. Returns `null` when the URL is unsafe — callers MUST skip
 * rendering in that case.
 *
 * @param url Candidate URL (any type; non-strings are rejected).
 * @returns The safe/normalized URL, or `null` when unsafe.
 */
export function safeUrl(url: unknown): string | null {
    if (typeof url !== "string" || url.length === 0) return null;
    const validate = security().validateUrl;
    if (typeof validate === "function") {
        try {
            return validate(url);
        } catch {
            // Security seam rejected the URL — skip the sink.
            return null;
        }
    }
    return /^https?:\/\//i.test(url) ? url : null;
}

/**
 * Translates `key`, delegating to `GeoLeaf.I18n.t` when present, else returning
 * `fallback`. `fallback` is also returned when the seam yields a nullish value.
 *
 * @param key Translation key.
 * @param fallback Text used when no translation is available.
 * @returns The translated string, or `fallback`.
 */
export function i18n(key: string, fallback: string): string {
    const t = i18nSeam().t;
    return (typeof t === "function" ? t(key, fallback) : undefined) ?? fallback;
}

/** SVG namespace for `createElementNS` (the sprite `<use>` glyph). */
const SVG_NS = "http://www.w3.org/2000/svg";
/** Legacy xlink namespace, set alongside `href` for older user agents. */
const XLINK_NS = "http://www.w3.org/1999/xlink";

/**
 * Builds an inline `<svg class="gl-fi-cat-icon"><use href="#symbolId"></svg>`
 * referencing a `<symbol>` in the profile sprite. Built via `createElementNS` +
 * `setAttribute` (NEVER `innerHTML`) — `symbolId` is an allowlisted id resolved
 * by the taxonomy capability, so the reference is CSP-safe. Decorative: marked
 * `aria-hidden` / `focusable="false"`.
 *
 * @param symbolId Allowlisted sprite symbol id (e.g. `"tourism-poi-cat-museum"`).
 * @returns The decorative SVG icon element.
 */
export function svgUseIcon(symbolId: string): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "gl-fi-cat-icon");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", "#" + symbolId);
    use.setAttributeNS(XLINK_NS, "xlink:href", "#" + symbolId);
    svg.appendChild(use);
    return svg;
}

/**
 * Reports whether a field is a title. A title can be authored two ways —
 * `variant: "title"` or `style: "title"` — and the profile schema keeps both as
 * free strings, so either spelling may appear on either surface. Shared by the
 * popup and side-panel builders: holding one predicate here is what stops the
 * two surfaces from drifting apart on the same field (a title carries the
 * taxonomy glyph and is never dropped when empty, so a surface that misses one
 * spelling silently downgrades the field).
 *
 * @param field Field configuration.
 * @returns `true` when the field renders as a title.
 */
export function isTitleField(field: RenderField): boolean {
    return field.type === "text" && (field.variant === "title" || field.style === "title");
}

/**
 * Asks the taxonomy seam for the icon to show next to a feature's TITLE on a
 * surface (the legacy "category icon before the title" behaviour), honouring the
 * per-surface `render` flags. Ensures the sprite when an icon resolves. Returns
 * the sprite `symbolId` (for `<use href="#…">`) or `null` — `null` (no icon) in
 * every case where the taxonomy seam is absent, the layer is unbound, no flag is
 * on, or nothing resolves, so a surface stays byte-identical until a profile opts in.
 *
 * @param layerId GeoLeaf layer id (from the render context).
 * @param feature Raw feature property bag.
 * @param surface The surface being rendered.
 * @returns The sprite `symbolId` to prefix before the title, or `null`.
 */
export function resolveTitleIcon(
    layerId: string | undefined,
    feature: Record<string, unknown> | undefined,
    surface: TaxonomySurface
): string | null {
    const tx = taxonomy();
    if (!layerId || !feature || typeof tx.resolveTitleIcon !== "function") return null;
    const symbolId = tx.resolveTitleIcon(layerId, feature, surface);
    if (symbolId) tx.ensureSprite?.();
    return symbolId;
}

/**
 * Asks the taxonomy seam for the colours of a category / sub-category pill badge.
 *
 * Returns `null` — an uncoloured pill, exactly as before — whenever the seam is
 * absent, the surface has not set `colorBadges`, the field is not one of the
 * layer's taxonomy columns, or no colour resolves. The colours come back already
 * validated, so the caller can assign them straight to the DOM.
 *
 * @param layerId GeoLeaf layer id (from the render context).
 * @param feature Raw feature property bag.
 * @param surface The surface being rendered.
 * @param field The badge field's configured name (e.g. `properties.categoryId`).
 */
export function resolveBadgeStyle(
    layerId: string | undefined,
    feature: Record<string, unknown> | undefined,
    surface: TaxonomySurface,
    field: string | undefined
): BadgeStyle | null {
    const tx = taxonomy();
    if (!layerId || !feature || !field || typeof tx.resolveBadgeStyle !== "function") return null;
    return tx.resolveBadgeStyle(layerId, feature, surface, field);
}
