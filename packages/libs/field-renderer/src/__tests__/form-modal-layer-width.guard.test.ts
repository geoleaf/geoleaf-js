/**
 * Guard — the form's layer menu takes the room its label needs, within a relative bound.
 *
 * The header lays the title and the layer menu side by side. The menu was capped at a fixed
 * `180px`: on a desktop, with a header of 640 px, a layer named « Sites touristiques – Rosario »
 * (≈ 158 px of text, plus the padding and the arrow) was cut while the title kept room to spare.
 *
 * jsdom lays nothing out, so the guard reads the sheet: outside any `@media`, the menu's ceiling
 * is relative to the header (a percentage, bounded by a length in a `min()`), never a bare fixed
 * length — and the title keeps `flex: 1`, which is what makes it the one that yields.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import postcss, { type AtRule, type Declaration, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const SHEET = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "css",
    "form-modal-base.css"
);

const root = postcss.parse(fs.readFileSync(SHEET, "utf8"), { from: SHEET });

function inMedia(rule: Rule): boolean {
    for (let p = rule.parent; p && p.type !== "root"; p = p.parent) {
        if (p.type === "atrule" && (p as AtRule).name === "media") return true;
    }
    return false;
}

/** Last declaration of `prop` outside any `@media`, among the rules naming exactly `selector`. */
function declOf(selector: string, prop: string): Declaration | null {
    let found: Declaration | null = null;
    root.walkRules((rule) => {
        if (inMedia(rule)) return;
        if (!rule.selectors.map((s) => s.trim()).includes(selector)) return;
        rule.walkDecls(prop, (decl) => {
            found = decl;
        });
    });
    return found;
}

describe("form modal — the layer menu's width", () => {
    it("is bounded relatively to the header, never by a bare fixed length", () => {
        const max = declOf(".gl-form-modal__layer", "max-width");
        expect(max, "an unbounded menu would push the title out of the header").not.toBeNull();
        const value = max!.value.replace(/\s+/g, "");
        expect(value).toMatch(/^min\(\d+(\.\d+)?%,\d+(\.\d+)?(rem|px)\)$/);
    });

    it("leaves the title as the side that yields", () => {
        expect(declOf(".gl-form-modal__title", "flex")?.value.trim()).toBe("1");
    });
});
