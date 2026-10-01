/*!
 * @geoleaf-plugins/print — Basemap credit
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * The credit of the basemap on screen, as plain text for the printed page.
 *
 * Read from the public `GeoLeaf.Baselayers.getActiveLayer()` — the definition of the
 * active basemap — because the off-screen map carries no attribution control and the
 * page is a canvas: whatever is not drawn on it is not printed.
 */

import { getGeoLeaf } from "@geoleaf/host-runtime";

/** The two places a basemap definition declares its credit. */
interface CreditedDefinition {
    attribution?: unknown;
    options?: { attribution?: unknown } | null;
}

/**
 * Reduces an attribution — commonly HTML: an entity, a link — to its text.
 *
 * Parsed as an inert document, never assigned to a live element: nothing in it runs,
 * and only its text is kept.
 */
function _toPlainText(html: string): string {
    if (typeof DOMParser === "undefined") return html.replace(/<[^>]*>/g, "").trim();
    const doc = new DOMParser().parseFromString(html, "text/html");
    return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Returns the credit the active basemap declares — `attribution`, or the legacy
 * `options.attribution` — as plain text, or `""` when there is no active basemap or
 * it declares none.
 */
export function readBasemapCredit(): string {
    const baselayers = getGeoLeaf()?.Baselayers as
        { getActiveLayer?(): CreditedDefinition | null } | undefined;
    const definition = baselayers?.getActiveLayer?.();
    const declared = definition?.attribution ?? definition?.options?.attribution;
    return typeof declared === "string" ? _toPlainText(declared) : "";
}
