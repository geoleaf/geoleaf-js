/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Core (feature-info capability) — The single widget dispatch
 *
 * ONE table, one entry per widget, for the three reading surfaces.
 *
 * ⚠️ There used to be THREE engines, not two — and the roadmap line that ordered
 * this refactor said "merge the two dispatch tables", which was measurably wrong
 * about the shape of the problem:
 *
 *  - `popup-content.ts` held a 17-entry table of direct function REFERENCES;
 *  - `sidepanel-content.ts` held a 19-entry table of LAMBDAS;
 *  - `popup-content.ts` also held the tooltip, which had NO table at all and
 *    joined `String(value)` with `" | "`.
 *
 * The popup table was a strict SUBSET of the side panel's (`comm -23` returned
 * empty), so nothing was "diverging" at the level of the key lists. What diverged
 * was the BODY behind a shared key: `price` reached `formatPrice` on the side
 * panel and raw `renderText` on the popup, which is where `[object Object]` came
 * from — and the tooltip stringified everything, so it had the same defect on
 * more widgets.
 *
 * This module therefore splits the problem the way the surfaces actually differ:
 *
 *  - {@link formatFieldText} is the TEXT projection — the single place a value
 *    becomes a string. The tooltip is nothing but this, and `display.mode: "raw"`
 *    is this on any surface.
 *  - {@link renderFieldNode} is the DOM projection, and it takes the surface as a
 *    PARAMETER rather than being duplicated per surface.
 *
 * Two branches that used to live outside the tables now live inside them, because
 * the signature carries what they needed. The old motive — written on site, and
 * true at the time — was that only the render loop held both `ctx.layerId` and the
 * raw property bag. Passing both here dissolves it, and that is what lets `action`
 * render on the side panel: its absence there was not a missing branch but a
 * missing payload (trou fonctionnel ④).
 */

import {
    el,
    escapeHtml,
    isTitleField,
    resolveBadgeStyle,
    resolveTitleIcon,
    svgUseIcon,
    type RenderContext,
    type RenderField,
    type RenderSurface,
} from "./dom.js";
import type { GeoLeafPopupActionDetail } from "../../../contracts/event-bus.contract.js";
import { getLabel as _getLabel } from "../../../utils/i18n/i18n.js";
import { isUnsafeKey } from "../../../utils/general/object-path-guard.js";
import {
    renderBadge,
    renderLink,
    renderList,
    renderRating,
    renderReviews,
    renderTable,
    renderTags,
    renderText,
} from "./fields.js";
import { renderGallery, renderImage } from "./media.js";

export type { RenderSurface } from "./dom.js";

/** Structural view of a currency-amount price object formatted by {@link formatPrice}. */
interface PriceValue {
    /** ISO currency code; defaults to `"EUR"`. */
    currency?: unknown;
    /** Monetary amount; coerced to a number (defaulting to `0`). */
    amount?: unknown;
}

/** Structural view of a lat/lng pair formatted by {@link formatCoords}. */
interface CoordsValue {
    /** Latitude in decimal degrees. */
    lat?: unknown;
    /** Longitude in decimal degrees. */
    lng?: unknown;
}

/** Structural view of the object form a `link`, `url` or `email` value may take. */
interface LinkValue {
    /** The address itself. */
    href?: unknown;
    /** Human-readable anchor text; falls back to the field label, then the address. */
    label?: unknown;
}

/** A single opening-hours slot for one day. */
interface HoursSlot {
    /** Opening time (e.g. `"09:00"`). */
    open: string;
    /** Closing time (e.g. `"18:00"`). */
    close: string;
    /** Whether the day/slot is marked closed. */
    closed: boolean;
}

/** Ordered day keys used to render an opening-hours table. */
const HOURS_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/**
 * Reports whether a resolved field value should be treated as empty.
 *
 * A `0` is NOT empty — it is a valid price, rating or metric.
 *
 * @param v - Resolved field value.
 * @returns `true` when the value is nullish, an empty string, an empty array, or an
 *   empty plain object.
 */
export function isEmptyFieldValue(v: unknown): boolean {
    if (v === null || v === undefined || v === "") return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === "object") return Object.keys(v).length === 0;
    return false;
}

/* -------------------------------------------------------------------------- */
/* Value formatters — the text projection, one per widget that needs one       */
/* -------------------------------------------------------------------------- */

/**
 * Formats a price object as a localized currency string.
 *
 * Falls back to a plain `amount currency` concatenation when `Intl.NumberFormat`
 * throws on an unknown currency code.
 *
 * @param value - Resolved price value (object with `amount`/`currency`, or scalar).
 * @returns The formatted price string.
 */
function formatPrice(value: unknown): string {
    if (!value || typeof value !== "object") return String(value ?? "");
    const price = value as PriceValue;
    try {
        return new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: String(price.currency || "EUR"),
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
        }).format(Number(price.amount ?? 0));
    } catch {
        return `${price.amount ?? ""} ${price.currency ?? ""}`.trim();
    }
}

/**
 * Formats a `{ lat, lng }` coordinate object as `"lat, lng"` with six decimals.
 *
 * @param value - Resolved coordinates value.
 * @returns The formatted coordinate string, or `""` when either component is missing.
 */
function formatCoords(value: unknown): string {
    if (!value || typeof value !== "object") return String(value ?? "");
    const coords = value as CoordsValue;
    const lat = typeof coords.lat === "number" ? coords.lat.toFixed(6) : "";
    const lng = typeof coords.lng === "number" ? coords.lng.toFixed(6) : "";
    return lat && lng ? `${lat}, ${lng}` : "";
}

/**
 * Formats a date value through `Intl.DateTimeFormat`.
 *
 * ⚠️ This ROUTES, it does not implement — decision Q4. The widget was declared and
 * rendered nowhere, so a `date` field disappeared silently from both surfaces. The
 * fix is a compact rendering, not a date library.
 *
 * `options.locale` is honoured per field, with the runtime default underneath. An
 * unparseable value is returned verbatim rather than becoming `Invalid Date`: a
 * profile that names a field holding free text should show that text, not a
 * diagnostic.
 *
 * @param value - Resolved date value (ISO string, timestamp, or `Date`).
 * @param locale - BCP 47 tag from the field's options, when declared.
 * @returns The formatted date, or the value verbatim when it is not a date.
 */
function formatDate(value: unknown, locale?: unknown): string {
    if (value === null || value === undefined || value === "") return "";
    const date = value instanceof Date ? value : new Date(value as string | number);
    if (Number.isNaN(date.getTime())) return String(value);
    try {
        return new Intl.DateTimeFormat(typeof locale === "string" ? locale : undefined, {
            dateStyle: "medium",
        }).format(date);
    } catch {
        return date.toISOString().slice(0, 10);
    }
}

/**
 * Formats a value as text, per widget — the SINGLE place a value becomes a string.
 *
 * The tooltip is nothing but this function, and `display.mode: "raw"` is this
 * function on any surface. Routing all three surfaces through it is what stops
 * `badge`, `link` and `price` — which hold OBJECTS, not scalars — from reading as
 * `[object Object]` anywhere.
 *
 * @param field - Field descriptor; its `type` selects the formatter.
 * @param value - Already-resolved field value.
 * @returns The formatted text, or `""` when the widget has no text projection.
 */
function formatFieldText(field: RenderField, value: unknown): string {
    if (isEmptyFieldValue(value)) return "";
    const formatter = TEXT_FORMATTERS[field.type ?? "text"];
    return formatter ? formatter(value, field) : String(value);
}

/** `{label, color}` — only the label is text. */
function textOfBadge(value: unknown): string {
    return typeof value === "object" && value !== null && "label" in value
        ? String((value as { label: unknown }).label ?? "")
        : String(value);
}

/** `{href, label?}` — prefer the human-readable half. */
function textOfLink(value: unknown): string {
    if (typeof value !== "object" || value === null) return String(value);
    const link = value as { label?: unknown; href?: unknown };
    return String(link.label ?? link.href ?? "");
}

/** Affixes belong to `metric`, and to nothing else — see {@link WIDGET_RENDERERS}. */
function textOfMetric(value: unknown, field: RenderField): string {
    const prefix = typeof field.prefix === "string" ? field.prefix : "";
    const suffix = typeof field.suffix === "string" ? field.suffix : "";
    return prefix + String(value) + suffix;
}

/** A widget with no one-line form contributes nothing to a text surface. */
function noTextProjection(): string {
    return "";
}

/** A list of scalars, comma-joined. Shared by `tags` and `list`, which read alike. */
function textOfStringList(value: unknown): string {
    return Array.isArray(value) ? value.map((v) => String(v)).join(", ") : String(value);
}

/**
 * Widget → text formatter. A widget absent from this table stringifies plainly,
 * which is the right answer for `text`, `longtext`, `number` and their kin.
 *
 * ⚠️ A table rather than a `switch`, for the same reason the renderers are one:
 * a `switch` over 24 widgets is a single function with a cyclomatic complexity the
 * lint budget refuses, and each added widget makes it worse. Flat entries stay flat.
 */
const TEXT_FORMATTERS: Record<string, (value: unknown, field: RenderField) => string> = {
    // A button is a gesture; a URL is not information.
    action: noTextProjection,
    image: noTextProjection,
    gallery: noTextProjection,
    // Structured values have no meaningful one-line form, and a label alone would
    // read as data rather than as an omission.
    hours: noTextProjection,
    table: noTextProjection,
    reviews: noTextProjection,
    price: (value) => formatPrice(value),
    coordinates: (value) => formatCoords(value),
    date: (value, field) => formatDate(value, field["locale"]),
    metric: textOfMetric,
    badge: textOfBadge,
    link: textOfLink,
    url: textOfLink,
    email: textOfLink,
    // ⚠️ UNE fonction nommée, pas deux flèches identiques. `tags` et `list` portaient
    // le même corps écrit deux fois — deux objets fonction distincts pour un seul
    // comportement, donc deux sites à corriger et deux à couvrir. C'est exactement le
    // doublon structurel que la clause C4 interdit, à l'échelle de deux lignes.
    tags: textOfStringList,
    list: textOfStringList,
};

/**
 * Escapes a value for a text surface, through the security seam when present.
 *
 * @param field - Field descriptor.
 * @param value - Already-resolved field value.
 * @returns The escaped text, or `""` when the widget has no text projection.
 */
export function formatFieldTextEscaped(field: RenderField, value: unknown): string {
    const text = formatFieldText(field, value);
    return text ? escapeHtml(text) : "";
}

/* -------------------------------------------------------------------------- */
/* The action button — a core-only widget, absent from field-renderer          */
/* -------------------------------------------------------------------------- */

/**
 * Applies (or clears) the pending state of an action button.
 *
 * Three marks, and none is decorative: `disabled` stops a double submit, `aria-busy` is what a
 * screen reader announces, and the BEM modifier is what CSS can hook. The repo had no single
 * pattern to copy — `capabilities/legend/legend-overlay.ts:91` puts `aria-busy` on a *container*,
 * and `libs/field-renderer/.../responsive-modal.ts` toggles `disabled` + a modifier *without*
 * `aria-busy`. This is deliberately the union of the two, decided on 14/08/2026.
 *
 * Writes to a detached node when the surface has already closed. That is inert, and it is why
 * `setBusy` needs no liveness guard on the caller's side.
 *
 * @param btn - The action button.
 * @param busy - `true` to enter the pending state, `false` to leave it.
 */
function _setActionBusy(btn: HTMLButtonElement, busy: boolean): void {
    btn.disabled = busy;
    btn.setAttribute("aria-busy", String(busy));
    btn.classList.toggle("gl-poi-popup__action--busy", busy);
}

/**
 * Renders an action button emitting `geoleaf:popup:action` on click.
 *
 * Four option keys are honoured, and each is read from the descriptor rather than
 * from prose:
 *
 * - `actionId` — opaque to the core, forwarded verbatim. Absent, nothing renders;
 * - `requiresPlugin` — a button whose plugin is missing is not rendered at all,
 *   because rendering it then failing on click would promise an action nothing can
 *   serve;
 * - `confirm` / `confirmKey` — confirmation before emitting;
 * - `payloadFields` — strict whitelist of properties joined to the event. **Without
 *   it, NO property is joined**: the default goes to confidentiality, not
 *   convenience, because this is a document event any script on the page can hear.
 *
 * ⚠️ Since 14/08/2026 the detail also carries `button`, `setBusy()` and `close()` — a live node
 * and two closures — so the event is dispatched as a **raw `CustomEvent`** and its key lives in
 * `GeoLeafRawEventMap`. `close()` goes through `ctx.onClose`, never through an import of a
 * surface: the graph is `surfaces/* → popup-content → here`, and this widget renders on **both**
 * surfaces, so only the injected closure knows which one to close.
 *
 * @param field - Field descriptor.
 * @param ctx - Render context; carries the identity the event payload promises, and `onClose`.
 * @param rawProperties - Raw feature property bag, filtered by `payloadFields`.
 * @returns The button element, or `null` when it must not render.
 */
function renderActionButton(
    field: RenderField,
    ctx: RenderContext,
    rawProperties: Record<string, unknown>
): HTMLElement | null {
    const actionId = typeof field.actionId === "string" ? field.actionId : "";
    if (!actionId) return null;

    const requires = field.requiresPlugin;
    if (typeof requires === "string" && requires) {
        const registry = (
            globalThis as { GeoLeaf?: { plugins?: { isLoaded?(n: string): boolean } } }
        ).GeoLeaf?.plugins;
        if (typeof registry?.isLoaded === "function" && !registry.isLoaded(requires)) return null;
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gl-poi-popup__action";
    btn.dataset["glActionId"] = actionId;
    btn.textContent = String(field.label ?? actionId);

    btn.addEventListener("click", () => {
        const confirmText = field.confirmKey
            ? _getLabel(String(field.confirmKey))
            : typeof field.confirm === "string"
              ? field.confirm
              : "";
        if (
            confirmText &&
            typeof globalThis.confirm === "function" &&
            !globalThis.confirm(confirmText)
        ) {
            return;
        }

        const allow = Array.isArray(field.payloadFields) ? field.payloadFields : [];
        const properties: Record<string, unknown> = {};
        for (const key of allow) {
            if (typeof key !== "string" || !(key in rawProperties)) continue;
            // ⚠️ `payloadFields` vient d'un PROFIL, pas du code : `__proto__` y est écrivable.
            // Une écriture par clé dynamique sur un objet littéral y règle le prototype au lieu
            // d'ajouter une propriété — et `Object.keys()` ne la liste pas, donc la fuite serait
            // invisible à la relecture de l'objet émis. Garde canonique du dépôt, exigé par
            // `check-dynamic-key-writes.cjs` (SECURITY_CONTRACT §5).
            if (isUnsafeKey(key)) continue;
            properties[key] = rawProperties[key];
        }

        // ⚠️ Émission en `CustomEvent` BRUT, pas par `dispatchGeoLeafEvent` — patron de
        // `kernel/ui/toolbar-dispatch.ts:27-34`. Le bus assaini fait
        // `JSON.parse(JSON.stringify(detail))` : `button` y arriverait en `{}` et les deux
        // fonctions en `undefined`, SANS erreur. Mesuré sur ce chemin avant le geste, pas déduit.
        // `bubbles: false` comme tous les seams bruts — les abonnés écoutent `document`.
        const detail: GeoLeafPopupActionDetail = {
            actionId,
            layerId: ctx.layerId ?? "",
            featureId: ctx.featureId ?? null,
            properties,
            ...(ctx.lngLat ? { lngLat: { lat: ctx.lngLat.lat, lng: ctx.lngLat.lng } } : {}),
            button: btn,
            setBusy: (busy: boolean) => _setActionBusy(btn, busy),
            close: () => ctx.onClose?.(),
        };
        document.dispatchEvent(new CustomEvent("geoleaf:popup:action", { detail, bubbles: false }));
    });

    return btn;
}

/**
 * Renders an opening-hours table, one row per day (Mon→Sun).
 *
 * A day with no slots, or whose first slot is closed, renders `closedLabel`
 * (defaulting to `"—"`); otherwise the open slots are joined as `open–close, …`.
 *
 * @param config - Field configuration; `closedLabel` overrides the closed marker.
 * @param value - Resolved hours value, keyed by day.
 * @returns The rendered table, or `null` when the value is not an object.
 */
function renderHoursTable(config: RenderField, value: unknown): HTMLElement | null {
    if (!value || typeof value !== "object") return null;
    const hours = value as Record<string, HoursSlot[]>;
    const table = document.createElement("table");
    table.className = "gl-poi-hours";
    for (const day of HOURS_DAYS) {
        // `?? []` ne garde QUE `null`/`undefined` : une donnée GeoJSON distante qui met une
        // chaîne (`{"mon": "9h-18h"}`) passait ici, puis `!slots.length` était faux (une
        // chaîne non vide a une longueur) et `slots[0]?.closed` valait `undefined` — on
        // tombait dans le `else` et `.filter` n'existe pas sur une chaîne. L'exception
        // remontait jusqu'à `buildSidePanelBody` et le panneau latéral ne s'ouvrait plus
        // (CAPACITÉS S11 / B.32). Les tests n'utilisaient que la forme parfaite.
        const raw = hours[day];
        const slots: HoursSlot[] = Array.isArray(raw) ? raw : [];
        const tr = document.createElement("tr");
        const dayTd = document.createElement("td");
        dayTd.className = "gl-poi-hours__day";
        dayTd.textContent = day.charAt(0).toUpperCase() + day.slice(1);
        const hoursTd = document.createElement("td");
        hoursTd.className = "gl-poi-hours__slots";
        if (!slots.length || slots[0]?.closed) {
            hoursTd.textContent = (config.closedLabel as string) || "—";
        } else {
            hoursTd.textContent = slots
                .filter((s) => !s.closed)
                .map((s) => `${s.open}–${s.close}`)
                .join(", ");
        }
        tr.appendChild(dayTd);
        tr.appendChild(hoursTd);
        table.appendChild(tr);
    }
    return table;
}

/**
 * Renders a `url` or `email` value as a link.
 *
 * ⚠️ ROUTES, does not implement — decision Q4. Both widgets were declared in the
 * legacy union and absent from BOTH dispatch tables, so a field declaring one
 * disappeared with no warning. `renderLink` already carries the `safeUrl` guard, so
 * routing to it is what makes them safe as well as visible.
 *
 * @param config - Field configuration.
 * @param value - Resolved value: a bare address, or `{href, label?}`.
 * @param scheme - Scheme prefixed when the value carries none.
 * @returns The rendered link, or `null`.
 */
function renderSchemeLink(
    config: RenderField,
    value: unknown,
    scheme: "mailto:" | ""
): HTMLElement | null {
    if (isEmptyFieldValue(value)) return null;

    // ⚠️ The contract declares `link` as an OBJECT (`{href, label?}`), derived from
    // what the capture component holds. The profiles on disk hold plain strings, and
    // `renderLink` reads a string. Accepting both here is what keeps a declaration
    // written for capture readable — reopening the contract for a reading-side
    // convention would be the wrong end.
    const asObject = typeof value === "object" && value !== null ? (value as LinkValue) : null;
    const raw = String(asObject ? (asObject.href ?? "") : value);
    if (!raw) return null;

    const href = scheme && !raw.startsWith(scheme) ? `${scheme}${raw}` : raw;
    const label = config.label ?? (asObject?.label !== undefined ? String(asObject.label) : raw);

    const anchor = renderLink({ ...config, label }, href);
    if (anchor) return anchor;

    // 🛑 The sanitiser refused the address, and that decision is NOT overridden here.
    // `safeUrl` delegates to `GeoLeaf.Security.validateUrl`, falling back to
    // http(s)-only — so a `mailto:` is refused unless the host allows it. Widening
    // the URL allowlist to make `email` clickable would be a change to the XSS
    // boundary, and this sprint has no mandate for that.
    //
    // ⚠️ But the field must not VANISH either: a silent disappearance is exactly the
    // defect Q4 exists to close. So it degrades to text — the address is readable,
    // simply not clickable. Same reasoning as FE-07's safe mode: never promise an
    // interaction that cannot be served safely.
    const { label: _dropped, ...withoutLabel } = config;
    return renderText(withoutLabel as RenderField, label);
}

/**
 * Renders a title field, which is the one widget whose DOM genuinely differs per
 * surface: `<h3 class="gl-poi-popup__title">` in the popup, `<h2
 * class="gl-poi-sidepanel__title">` in the side panel.
 *
 * ⚠️ The difference is real — a popup heading and a panel heading are not the same
 * element — which is why the surface is switched HERE rather than the branch being
 * duplicated in each builder's loop, as it was before.
 *
 * The two surfaces also differ on an empty value, and that is preserved verbatim:
 * the popup skips an empty title, the side panel renders it anyway (it is one of
 * its two "required" fields, alongside `badge`).
 *
 * @param field - Field descriptor.
 * @param value - Already-resolved title value.
 * @param ctx - Render context.
 * @param surface - Which surface is being painted.
 * @param rawProperties - Raw property bag, for the taxonomy glyph seam.
 * @returns The title element, or `null`.
 */
function renderTitleNode(
    field: RenderField,
    value: unknown,
    ctx: RenderContext,
    surface: RenderSurface,
    rawProperties: Record<string, unknown>
): HTMLElement | null {
    const icon = resolveTitleIcon(ctx.layerId, rawProperties, surface);

    if (surface !== "popup") return renderText(field, value, icon);

    if (isEmptyFieldValue(value)) return null;
    const h3 = el("h3", "gl-poi-popup__title");
    if (icon) {
        h3.appendChild(svgUseIcon(icon));
        const span = document.createElement("span");
        span.textContent = String(value);
        h3.appendChild(span);
    } else {
        h3.textContent = String(value);
    }
    return h3;
}

/* -------------------------------------------------------------------------- */
/* The single dispatch table                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One renderer entry. The context and the raw property bag are threaded to EVERY
 * widget, which is what allows `badge` and `action` — previously stranded in
 * per-surface branches — to live in the table like the others.
 */
type WidgetRenderer = (
    field: RenderField,
    value: unknown,
    ctx: RenderContext,
    surface: RenderSurface,
    rawProperties: Record<string, unknown>
) => HTMLElement | null;

/**
 * Widget → renderer. **The** table: one entry per widget, shared by every surface.
 *
 * Text-family widgets route their value through {@link formatFieldText} rather than
 * through `String(value)`, which is what keeps the popup and the side panel showing
 * the same thing for the same declaration.
 *
 * ⚠️ Affixes apply to `metric` and to nothing else. The popup used to apply them to
 * nine widgets, via an identity comparison on the renderer function
 * (`renderer === renderText`) that the side panel's lambdas had already broken.
 * `MetricOptions` is the only options bag in the contract declaring `prefix` and
 * `suffix`, and the two affixes on disk are both on a `metric` field — so following
 * the contract here is iso-comportement, verified, not a judgement call.
 */
const WIDGET_RENDERERS: Record<string, WidgetRenderer> = {
    action: (field, _value, ctx, _surface, rawProperties) =>
        renderActionButton(field, ctx, rawProperties),
    badge: (field, value, ctx, surface, rawProperties) =>
        renderBadge(
            field,
            value,
            resolveBadgeStyle(ctx.layerId, rawProperties, surface, field.field)
        ),
    checkbox: (field, value) => renderText(field, formatFieldText(field, value)),
    coordinates: (field, value) => renderText(field, formatFieldText(field, value)),
    date: (field, value) => renderText(field, formatFieldText(field, value)),
    dropdown: (field, value) => renderText(field, formatFieldText(field, value)),
    email: (field, value) => renderSchemeLink(field, value, "mailto:"),
    gallery: (field, value) => renderGallery(field, value),
    hours: (field, value) => renderHoursTable(field, value),
    image: (field, value) => renderImage(field, value),
    link: (field, value) => renderSchemeLink(field, value, ""),
    list: (field, value) => renderList(field, value),
    longtext: (field, value) => renderText(field, formatFieldText(field, value)),
    metric: (field, value) => renderText(field, formatFieldText(field, value)),
    number: (field, value) => renderText(field, formatFieldText(field, value)),
    phone: (field, value) => renderText(field, formatFieldText(field, value)),
    price: (field, value) => renderText(field, formatFieldText(field, value)),
    radio: (field, value) => renderText(field, formatFieldText(field, value)),
    rating: (field, value) => renderRating(field, value),
    reviews: (field, value) => renderReviews(field, value),
    table: (field, value) => renderTable(field, value),
    tags: (field, value) => renderTags(field, value),
    text: (field, value, ctx, surface, rawProperties) =>
        isTitleField(field)
            ? renderTitleNode(field, value, ctx, surface, rawProperties)
            : renderText(field, formatFieldText(field, value)),
    url: (field, value) => renderSchemeLink(field, value, ""),
};

/**
 * The widget identifiers this engine renders — the list the parity gate confronts
 * with `AttributeWidget`.
 *
 * ⚠️ Derived from the table, never written by hand. A hand-written twin is exactly
 * the kind of second declaration this sprint exists to remove.
 */
export const RENDERED_WIDGETS: readonly string[] = Object.keys(WIDGET_RENDERERS).sort();

/**
 * Renders one field to DOM, for a given surface.
 *
 * An unknown widget yields `null` AND a runtime warning — decision Q9. It used to
 * yield `null` in silence on one surface and a raw fallback on the other, so a
 * typo'd widget was indistinguishable from a field with no value. It is never
 * fatal: a bad profile must not blank the map.
 *
 * @param field - Field descriptor, already projected to the render model.
 * @param value - Already-resolved field value.
 * @param ctx - Per-surface render context.
 * @param surface - Which surface is being painted.
 * @param rawProperties - Raw feature property bag, for the taxonomy seam and the
 *   action payload.
 * @returns The rendered element, or `null`.
 */
export function renderFieldNode(
    field: RenderField,
    value: unknown,
    ctx: RenderContext,
    surface: RenderSurface,
    rawProperties: Record<string, unknown>
): HTMLElement | null {
    const widget = field.type ?? "text";
    const renderer = WIDGET_RENDERERS[widget];
    if (!renderer) {
        warnUnknownWidget(widget, field.field, ctx.layerId);
        return null;
    }
    if (field.mode === "raw") {
        const text = formatFieldText(field, value);
        if (!text) return null;
        const p = el("p", "gl-poi-sidepanel__desc");
        p.textContent = text;
        return p;
    }
    return renderer(field, value, ctx, surface, rawProperties);
}

/** Widgets already reported, so a per-feature render loop warns once, not per click. */
const warnedWidgets = new Set<string>();

/**
 * Warns once per unknown widget, through the logging seam when present.
 *
 * @param widget - The widget identifier no renderer claims.
 * @param field - The dotted path of the field that declared it.
 * @param layerId - The layer that declared it, when known.
 */
function warnUnknownWidget(widget: string, field: string, layerId?: string): void {
    const key = `${layerId ?? "?"}|${field}|${widget}`;
    if (warnedWidgets.has(key)) return;
    warnedWidgets.add(key);
    const message =
        `[feature-info] widget inconnu "${widget}" sur le champ "${field}"` +
        (layerId ? ` de la couche "${layerId}"` : "") +
        " — le champ n'est pas rendu. Les widgets légaux sont validés par validate:profiles.";
    const seam = (globalThis as { GeoLeaf?: { Log?: { warn?(m: string): void } } }).GeoLeaf?.Log;
    if (typeof seam?.warn === "function") seam.warn(message);
    else console.warn(message);
}
