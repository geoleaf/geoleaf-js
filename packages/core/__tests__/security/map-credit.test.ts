/**
 * A map credit is HTML a profile or a caller writes, and it ends in the engine's attribution
 * control. `sanitizeAttribution` is the one door it goes through — for a basemap's credit and for
 * a layer's `attribution` option alike: inline formatting and links with a safe URL are kept,
 * everything else becomes text.
 *
 * Why the core sanitises although the engine does too: the peer range admits every MapLibre 6.x,
 * and up to 6.10 the attribution control cleaned by blocklist (scripts and `on*` attributes) then
 * re-injected the result through `innerHTML` — a parse, serialise, parse round trip.
 */

import { describe, expect, it } from "vitest";

const { sanitizeAttribution } = await import("../../src/kernel/security/map-credit.js");

describe("sanitizeAttribution — the credit of a map", () => {
    it("keeps a credit made of text and a safe link", () => {
        const out = sanitizeAttribution(
            '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        );
        expect(out).toContain('href="https://www.openstreetmap.org/copyright"');
        expect(out).toContain("OpenStreetMap</a> contributors");
        expect(out.startsWith("©")).toBe(true);
    });

    it("drops what can run: scripts, event handlers, foreign markup", () => {
        const out = sanitizeAttribution(
            '© Source<img src=x onerror="alert(1)"><script>alert(2)</script><svg onload="alert(3)"></svg>'
        );
        expect(out).not.toMatch(/<img|<script|<svg|onerror|onload/i);
        expect(out.startsWith("© Source")).toBe(true);
    });

    it("drops a link whose URL is not safe, and keeps its text", () => {
        const out = sanitizeAttribution('<a href="javascript:alert(1)">Provider</a>');
        expect(out).not.toMatch(/javascript:/i);
        expect(out).toContain("Provider");
    });

    it("renders nothing for an empty or absent credit", () => {
        expect(sanitizeAttribution("")).toBe("");
        expect(sanitizeAttribution("   ")).toBe("");
        expect(sanitizeAttribution(undefined as unknown as string)).toBe("");
    });
});
