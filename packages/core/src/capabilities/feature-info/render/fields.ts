/*!
 * GeoLeaf Core (feature-info capability) — Ported renderers: per-type field renderers
 * © 2026 Mattieu Pottier — MIT License
 *
 * Self-contained port of the pre-extraction core field/component renderers.
 * Each renderer is a plain function `(config, value) => HTMLElement | null`
 * that reproduces the EXACT sidepanel DOM (class names, element nesting, inline
 * styles) of the "before" implementation, minus the POI-only taxonomy coupling
 * (category colour + SVG sprite icon) which is intentionally dropped. Values are
 * resolved by the caller and passed in already-resolved; renderers never touch
 * the raw feature. All text goes through `textContent` and every URL sink is
 * guarded by `safeUrl`, so the output is XSS-safe with no core dependency.
 * https://geoleaf.dev
 */

import { el, safeUrl, svgUseIcon, type BadgeStyle, type RenderField } from "./dom.js";

/** Structural view of a price object accepted by {@link renderList}. */
interface PriceLike {
    /** Lower price bound (coerced to a finite number, else ignored). */
    from?: unknown;
    /** Upper price bound (coerced to a finite number, else ignored). */
    to?: unknown;
    /** ISO currency code; defaults to `"USD"`. */
    currency?: string;
    /** Free-text price description rendered under the range. */
    description?: string;
}

/** A single table row: a map of column key → cell value. */
type TableRow = Record<string, unknown>;

/** Structural view of a review entry rendered by {@link renderReviews}. */
interface ReviewLike {
    /** Display name of the review author; defaults to `"Anonyme"`. */
    authorName?: string;
    /** Numeric rating out of 5; non-finite values render as `0`. */
    rating?: number;
    /** Whether the review is marked verified (appends a check mark). */
    verified?: boolean;
    /** Free-text review body. */
    comment?: string;
    /** Human-readable creation date. */
    createdAt?: string;
}

/** Table border toggles / colour read from `config.borders`. */
interface TableBorders {
    /** Draw the outer table border (default `true`). */
    outer?: boolean;
    /** Draw horizontal row separators (default `true`). */
    row?: boolean;
    /** Draw vertical column separators (default `false`). */
    column?: boolean;
    /** Border colour override; defaults to `var(--gl-color-border-soft)`. */
    color?: string;
}

/** Table column descriptor read from `config.columns`. */
interface TableColumn {
    /** Row-object key providing the cell value. */
    key: string;
    /** Header label (rendered in `<th>`). */
    label?: string;
}

// ── Text ────────────────────────────────────────────────────────────────────

/**
 * Renders a text field. When `config.style === "title"` or
 * `config.variant === "title"`, produces the sidepanel title
 * (`<h2 class="gl-poi-sidepanel__title"><span class="gl-poi-sidepanel__title-text">`)
 * — the title always renders (empty value coerced to `""`). When `iconSymbolId` is
 * provided (the feature's category/sub-category icon, resolved by the caller for
 * this surface), the sprite glyph is prefixed BEFORE the title text, reproducing
 * the legacy "category icon next to the title" behaviour; without it the title DOM
 * is byte-identical to the pre-extraction original. Otherwise produces a
 * `gl-poi-sidepanel__desc` paragraph, or a `<div>` with `white-space: pre-wrap`
 * when `config.variant === "multiline"`. Non-title fields return `null` when empty.
 *
 * @param config Field configuration.
 * @param value Already-resolved field value.
 * @param iconSymbolId Optional title-icon sprite symbol id to prefix (title path only).
 * @returns The rendered element, or `null` for an empty non-title value.
 */
export function renderText(
    config: RenderField,
    value: unknown,
    iconSymbolId?: string | null
): HTMLElement | null {
    // Title path — prefix the feature's category glyph before the title text.
    if (config.style === "title" || config.variant === "title") {
        const titleH2 = el("h2", "gl-poi-sidepanel__title");
        if (iconSymbolId) titleH2.appendChild(svgUseIcon(iconSymbolId));
        const titleSpan = el("span", "gl-poi-sidepanel__title-text");
        titleSpan.textContent = (value as string) || "";
        titleH2.appendChild(titleSpan);
        return titleH2;
    }

    if (!value) return null;

    const element = el(config.variant === "multiline" ? "div" : "p", "gl-poi-sidepanel__desc");

    if (config.variant === "multiline") {
        element.style.whiteSpace = "pre-wrap";
        element.style.lineHeight = "1.6";
    }

    element.textContent = value as string;
    return element;
}

// ── Badge ─────────────────────────────────────────────────────────────────────

/**
 * Renders a category badge: `<div class="gl-poi-badge-container">` wrapping a
 * `<span class="gl-poi-badge">`.
 *
 * When the taxonomy hands over colours (the surface opted in via
 * `render.<surface>.colorBadges`), the pill wears the same fill and border as the
 * category's marker disc on the map — the pill and the symbol should read as one
 * object. Without them the pill falls back to its stylesheet colours.
 *
 * Colours are written through the CSSOM, one property at a time. A literal
 * `style="…"` attribute would be blocked by the strict `style-src` CSP; per-property
 * writes are not. The values arrive pre-validated from taxonomy.
 *
 * @param config Field configuration — its `style` selects the pill variant.
 * @param value Already-resolved badge text.
 * @param badgeStyle Colours from the taxonomy seam, or `null` for an uncoloured pill.
 * @returns The rendered element, or `null` when the value is empty.
 */
export function renderBadge(
    config: RenderField,
    value: unknown,
    badgeStyle?: BadgeStyle | null
): HTMLElement | null {
    if (!value) return null;

    const container = el("div", "gl-poi-badge-container");

    // `style` is the profile's own hint ("category" / "subcategory"). It only picks
    // a CSS variant — the colouring itself is routed by column name inside taxonomy,
    // because profiles do not tag their popup badges consistently.
    const variant =
        config?.style === "subcategory"
            ? " gl-poi-badge--subcategory"
            : config?.style === "category"
              ? " gl-poi-badge--category"
              : "";
    const badge = el("span", `gl-poi-badge${variant}`);
    badge.textContent = value as string;

    if (badgeStyle) {
        badge.style.backgroundColor = badgeStyle.background;
        badge.style.borderColor = badgeStyle.border;
        badge.style.color = badgeStyle.text;
    }

    container.appendChild(badge);
    return container;
}

// ── Link ──────────────────────────────────────────────────────────────────────

/**
 * Renders an external website link:
 * `<div class="gl-poi-link-container"><a class="gl-poi-website-link" target="_blank" rel="noopener noreferrer">`.
 * The URL is validated via {@link safeUrl}; the anchor text is `config.label`
 * (defaulting to `"Visiter le site web →"`).
 *
 * @param config Field configuration (provides the optional anchor `label`).
 * @param value Already-resolved URL.
 * @returns The rendered element, or `null` when the URL is empty or unsafe.
 */
export function renderLink(config: RenderField, value: unknown): HTMLElement | null {
    if (!value) return null;

    // Validate at the sink before assigning to anchor.href.
    const href = safeUrl(String(value));
    if (!href) return null;

    const container = el("div", "gl-poi-link-container");
    const link = el("a", "gl-poi-website-link", {
        href,
        target: "_blank",
        rel: "noopener noreferrer",
    });
    link.textContent = config.label || "Visiter le site web →";
    container.appendChild(link);
    return container;
}

// ── List ──────────────────────────────────────────────────────────────────────

/** Builds the human-readable price range string for a price object. */
function buildPriceText(data: PriceLike): string {
    const safeFrom = Number.isFinite(Number(data.from)) ? Number(data.from) : null;
    const safeTo = Number.isFinite(Number(data.to)) ? Number(data.to) : null;
    const safeCurrency = data.currency || "USD";
    if (safeFrom !== null && safeTo !== null)
        return `From ${safeFrom} to ${safeTo} ${safeCurrency}`;
    if (safeFrom !== null) return `From ${safeFrom} ${safeCurrency}`;
    if (safeTo !== null) return `Up to ${safeTo} ${safeCurrency}`;
    return "";
}

/**
 * Renders a price object into a `gl-poi-section` block: a bold price range
 * paragraph (when `from`/`to` are present) and an optional muted description
 * paragraph. Returns `null` when nothing is displayable.
 */
function renderPriceObject(data: PriceLike): HTMLElement | null {
    const div = el("div", "gl-poi-section");
    if (data.from || data.to) {
        const p = document.createElement("p");
        const strong = document.createElement("strong");
        strong.textContent = buildPriceText(data);
        if (strong.textContent) {
            p.appendChild(strong);
            div.appendChild(p);
        }
    }
    if (data.description) {
        const desc = document.createElement("p");
        desc.textContent = data.description;
        desc.style.fontSize = "0.85rem";
        desc.style.color = "var(--gl-color-text-muted)";
        div.appendChild(desc);
    }
    if (div.children.length === 0) return null;
    return div;
}

/**
 * Renders an array as a `<ul class="gl-poi-list-unordered">`, with a `disc` bullet.
 */
function renderArrayList(data: unknown[]): HTMLElement {
    // ⚠️ Un `if`/`else` de cinq lignes vivait ici, et les DEUX branches assignaient la
    // même valeur. L'inventaire le décrivait comme « inatteignable, seul le `else`
    // s'exécute » — c'est l'inverse : `config.variant` est le plus souvent absent, donc
    // le `||` rendait `"disc"` et c'est le `if` qui passait. Peu importe : depuis le
    // Sprint 2 la déclaration ne peut plus porter `disc`/`circle`/`square`, et le seul
    // `variant` que la projection émet est `hero`. Une seule assignation reste.
    const ul = el("ul", "gl-poi-list-unordered");
    ul.style.listStyleType = "disc";
    data.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item as string;
        ul.appendChild(li);
    });
    return ul;
}

/**
 * Renders a list field into a `gl-poi-section`. A plain object is treated as a
 * price object ({@link renderPriceObject}); an array is rendered as an unordered
 * list ({@link renderArrayList}).
 *
 * @param _config Field configuration — inutilisée depuis que la puce est fixe.
 * @param value Already-resolved list value (array or price object).
 * @returns The rendered element, or `null` when the value is empty.
 */
export function renderList(_config: RenderField, value: unknown): HTMLElement | null {
    if (!value) return null;

    const div = el("div", "gl-poi-section");

    // Special case for price (object).
    if (typeof value === "object" && !Array.isArray(value)) {
        return renderPriceObject(value as PriceLike);
    }

    // Normal list (array).
    if (Array.isArray(value)) {
        div.appendChild(renderArrayList(value));
    }

    return div;
}

// ── Table ─────────────────────────────────────────────────────────────────────

/**
 * Normalizes table data. When the rows are plain strings and exactly two
 * columns are configured, each string is split on the first matching separator
 * into a two-key row object; otherwise the data is returned unchanged.
 */
function normalizeTableData(data: unknown[], config: RenderField): unknown[] {
    if (data.length === 0 || typeof data[0] !== "string") return data;
    const columns = config.columns;
    if (!columns || columns.length !== 2) return data;
    const [keyCol, valCol] = columns;
    if (!keyCol || !valCol) return data;
    const separators = [" : ", ": ", " – ", "–", " - ", "-"];
    return data.map((str): TableRow => {
        const text = str as string;
        for (const sep of separators) {
            // head/tail rather than parts[0] + slice(1): the split is the same, and both
            // halves come out typed (qualite Q5).
            const [head, ...tail] = text.split(sep);
            if (head !== undefined && tail.length > 0) {
                return {
                    [keyCol.key]: head.trim(),
                    [valCol.key]: tail.join(sep).trim(),
                };
            }
        }
        return { [keyCol.key]: text, [valCol.key]: "" };
    });
}

/** Builds the `<thead>` of a data table, applying the border inline styles. */
function buildDataTableHeader(
    table: HTMLElement,
    config: RenderField,
    borders: TableBorders,
    borderColor: string
): void {
    const columns = config.columns;
    if (!columns) return;
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    columns.forEach((col: TableColumn, index: number) => {
        const th = document.createElement("th");
        th.textContent = (col.label as string) ?? "";
        th.style.padding = "8px";
        th.style.textAlign = "left";
        th.style.fontWeight = "600";
        th.style.backgroundColor = "var(--gl-color-bg-subtle)";
        if (borders.row !== false)
            th.style.borderBottom = `1px solid ${borders.color || borderColor}`;
        if (borders.column && index > 0)
            th.style.borderLeft = `1px solid ${borders.color || borderColor}`;
        tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);
}

/** Builds the `<tbody>` of a data table, applying the border inline styles. */
function buildDataTableBody(
    table: HTMLElement,
    config: RenderField,
    tableData: unknown[],
    borders: TableBorders,
    borderColor: string
): void {
    const columns = config.columns;
    const tbody = document.createElement("tbody");
    tableData.forEach((rawRow, rowIndex) => {
        const row = rawRow as TableRow;
        const tr = document.createElement("tr");
        if (columns) {
            columns.forEach((col: TableColumn, colIndex: number) => {
                const td = document.createElement("td");
                td.textContent = (row[col.key] as string) || "";
                td.style.padding = "8px";
                if (borders.row !== false && rowIndex < tableData.length - 1)
                    td.style.borderBottom = `1px solid ${borders.color || borderColor}`;
                if (borders.column && colIndex > 0)
                    td.style.borderLeft = `1px solid ${borders.color || borderColor}`;
                tr.appendChild(td);
            });
        }
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
}

/**
 * Renders a data table (`<table class="gl-poi-table">`) with a header row and a
 * body, preserving the exact inline padding/border styles of the original.
 * Two-string columns are split via {@link normalizeTableData}. Border rendering
 * is driven by `config.borders` (`outer`/`row`/`column`/`color`).
 *
 * @param config Field configuration (`columns`, `borders`).
 * @param value Already-resolved array of rows.
 * @returns The rendered table, or `null` when the value is not an array.
 */
export function renderTable(config: RenderField, value: unknown): HTMLElement | null {
    if (!value || !Array.isArray(value)) return null;

    const tableData = normalizeTableData(value, config);
    const table = el("table", "gl-poi-table");
    const borders: TableBorders = (config.borders as TableBorders) ?? {};
    const borderColor = borders.color ?? "var(--gl-color-border-soft)";
    if (borders.outer !== false) table.style.border = `1px solid ${borderColor}`;
    buildDataTableHeader(table, config, borders, borderColor);
    buildDataTableBody(table, config, tableData, borders, borderColor);
    return table;
}

// ── Tags ──────────────────────────────────────────────────────────────────────

/**
 * Normalizes a tags input into a string array. Accepts an array directly, or a
 * string: a JSON-array string is parsed, otherwise the string is split on commas
 * and semicolons. Returns `null` when the input cannot be interpreted as a list.
 *
 * @param tags Raw tags value (array, JSON-array string, or delimited string).
 * @returns The normalized string array, or `null`.
 */
function normalizeTagsInput(tags: unknown): string[] | null {
    if (typeof tags === "string") {
        const trimmed = tags.trim();
        if (trimmed.startsWith("[")) {
            try {
                tags = JSON.parse(trimmed);
            } catch {
                tags = trimmed
                    .split(/[,;]+/)
                    .map((t: string) => t.trim())
                    .filter(Boolean);
            }
        } else {
            tags = trimmed
                .split(/[,;]+/)
                .map((t: string) => t.trim())
                .filter(Boolean);
        }
    }
    if (!tags || !Array.isArray(tags)) return null;
    return tags as string[];
}

/**
 * Renders a tag cloud: `<div class="gl-poi-sidepanel__tags">` containing one
 * `<span class="gl-poi-tag">` per tag. The input is normalized via
 * {@link normalizeTagsInput}.
 *
 * @param config Field configuration (unused; kept for signature parity).
 * @param value Already-resolved tags value.
 * @returns The rendered element, or `null` when there are no tags.
 */
export function renderTags(config: RenderField, value: unknown): HTMLElement | null {
    void config;
    const tags = normalizeTagsInput(value);
    if (!tags || tags.length === 0) return null;

    const div = el("div", "gl-poi-sidepanel__tags");
    div.style.display = "flex";
    div.style.flexWrap = "wrap";
    div.style.gap = "6px";

    tags.forEach((tag: string) => {
        const tagSpan = el("span", "gl-poi-tag");
        tagSpan.textContent = tag;
        div.appendChild(tagSpan);
    });

    return div;
}

// ── Rating ────────────────────────────────────────────────────────────────────

/**
 * Renders a star rating (`<div class="gl-rating gl-rating--stat">`) with an
 * optional label, five `★` stars (filled up to the rounded value), and a
 * `N.N/5` value. The value is parsed with `parseFloat`.
 *
 * @param config Field configuration (`label` is rendered when present).
 * @param value Already-resolved numeric rating (0–5).
 * @returns The rendered element, or `null` when the value is non-numeric.
 */
export function renderRating(config: RenderField, value: unknown): HTMLElement | null {
    const numRating = parseFloat(value as string);
    if (!Number.isFinite(numRating)) return null;

    const container = el("div", "gl-rating gl-rating--stat");

    if (config.label) {
        const label = el("span", "gl-rating__label");
        label.textContent = config.label;
        container.appendChild(label);
    }

    const starsWrap = el("span", "gl-rating__stars");
    for (let i = 1; i <= 5; i++) {
        const star = el(
            "span",
            "gl-rating__star" + (i <= Math.round(numRating) ? " gl-rating__star--filled" : "")
        );
        star.textContent = "★";
        starsWrap.appendChild(star);
    }
    container.appendChild(starsWrap);

    const valueSpan = el("span", "gl-rating__value");
    valueSpan.textContent = numRating.toFixed(1) + "/5";
    container.appendChild(valueSpan);

    return container;
}

// ── Reviews ───────────────────────────────────────────────────────────────────

/**
 * Renders a list of reviews (`<div class="gl-poi-reviews">`), capped at
 * `config.maxCount` (default 5). Each review renders a bold header
 * (`author - ⭐rating/5` with an optional `✓` for verified), an optional comment
 * paragraph, and an optional muted date paragraph — preserving the exact inline
 * styles of the original.
 *
 * @param config Field configuration (`maxCount` caps the number of reviews).
 * @param value Already-resolved array of reviews.
 * @returns The rendered element, or `null` when the value is not an array.
 */
export function renderReviews(config: RenderField, value: unknown): HTMLElement | null {
    if (!value || !Array.isArray(value)) return null;

    const div = el("div", "gl-poi-reviews");

    const maxCount = (config.maxCount as number) || 5;
    value.slice(0, maxCount).forEach((rawReview) => {
        const review = rawReview as ReviewLike;
        const reviewDiv = el("div", "gl-poi-review");
        reviewDiv.style.borderLeft = "3px solid var(--gl-color-accent-soft)";
        reviewDiv.style.paddingLeft = "12px";
        reviewDiv.style.marginBottom = "12px";

        const header = document.createElement("p");
        header.style.fontSize = "0.875rem";
        header.style.fontWeight = "600";
        header.style.marginBottom = "4px";

        const safeAuthor = review.authorName || "Anonyme";
        const safeRating = Number.isFinite(review.rating) ? review.rating : 0;
        const verifiedMark = review.verified ? " ✓" : "";
        header.textContent = `${safeAuthor} - ⭐${safeRating}/5${verifiedMark}`;
        reviewDiv.appendChild(header);

        if (review.comment) {
            const comment = document.createElement("p");
            comment.textContent = review.comment;
            comment.style.fontSize = "0.85rem";
            comment.style.marginBottom = "4px";
            reviewDiv.appendChild(comment);
        }

        if (review.createdAt) {
            const date = document.createElement("p");
            date.style.fontSize = "0.75rem";
            date.style.color = "var(--gl-color-text-muted)";
            date.textContent = review.createdAt;
            reviewDiv.appendChild(date);
        }

        div.appendChild(reviewDiv);
    });

    return div;
}
