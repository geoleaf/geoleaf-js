/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description The single door a map credit goes through before it reaches the engine.
 *
 * A credit is HTML written by a profile (a basemap's `attribution`) or by a caller (a layer's
 * `attribution` option), and it ends in the engine's attribution control. Both pass here, so the
 * two can never be cleaned two different ways.
 *
 * ⚠️ Why the core cleans although the engine does too: the peer range admits every MapLibre 6.x,
 * and up to 6.10 the attribution control cleaned by BLOCKLIST — `<script>` and dangerous
 * attributes — then re-injected the result through `innerHTML`, a parse, serialise, parse round
 * trip. From 6.11 it builds a DOM fragment from an allowlist. This module does not rely on which
 * engine is loaded: what it hands over already holds only allowlisted markup.
 *
 * Deliberately NOT re-exported by `kernel/security/index.ts`: it is an internal seam, not a member
 * of `GeoLeaf.Security`.
 */

import { parseHtmlSafely } from "./sanitizers.js";

/**
 * The markup a credit may keep: inline formatting and links. A credit is one line of the
 * attribution control — paragraphs and lists have no place there, and become text.
 */
const CREDIT_TAGS = ["a", "span", "strong", "em", "b", "i", "br"];

/**
 * Cleans a map credit for the engine's attribution control.
 *
 * Keeps text, inline formatting and links whose URL `validateUrl` accepts (a kept link opens in a
 * new tab, `rel="noopener noreferrer"`); every other element becomes its text, and attributes
 * other than a link's are dropped. Without a DOM there is no attribution control to fill, and
 * the credit is `""`.
 *
 * @param html - The credit as declared — HTML allowed.
 * @returns The cleaned credit, or `""` when there is nothing to show.
 * @example
 * sanitizeAttribution('© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>');
 * // '© <a href="https://www.openstreetmap.org/copyright" rel="noopener noreferrer" target="_blank">OpenStreetMap</a>'
 */
export function sanitizeAttribution(html: string): string {
    if (typeof html !== "string" || html.trim() === "") return "";
    if (typeof document === "undefined") return "";
    const holder = document.createElement("div");
    holder.appendChild(parseHtmlSafely(html, CREDIT_TAGS));
    return holder.innerHTML.trim();
}
