/**
 * Guard — on a desktop, the layer selector is as wide as its prompt, within a bound.
 *
 * The base rule fixed the selector at `width: 150px !important`. With no layer chosen, the
 * French prompt (« Sélectionner une couche... ») needs about 173 px of text plus the arrow and
 * the padding: it was cut to « Sélectionner une ». Only the phone rule had been widened.
 *
 * jsdom lays nothing out, so the guard reads the sheet: outside any `@media`, the selector's
 * width follows its content (`auto`), never a fixed length; it keeps a floor and a ceiling, and
 * the ceiling is the very basis the phone rule gives the selector's wrapper — the room it
 * documents as enough for the longest prompt of the six dictionaries. The phone rule lifts the
 * ceiling, since there the selector fills a wrapper that is already bounded by the panel.
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
    "geoleaf-table.css"
);

const root = postcss.parse(fs.readFileSync(SHEET, "utf8"), { from: SHEET });

function inMedia(rule: Rule): AtRule | null {
    let parent = rule.parent;
    while (parent && parent.type !== "root") {
        if (parent.type === "atrule" && (parent as AtRule).name === "media") {
            return parent as AtRule;
        }
        parent = parent.parent;
    }
    return null;
}

/** Last declaration of `prop` among the rules whose selector list is exactly `selector`. */
function declOf(selector: string, prop: string, media: "none" | "phone"): Declaration | null {
    let found: Declaration | null = null;
    root.walkRules((rule) => {
        if (!rule.selectors.map((s) => s.trim()).includes(selector)) return;
        const at = inMedia(rule);
        if (media === "none" && at) return;
        if (media === "phone" && !(at && /max-width:\s*768px/.test(at.params))) return;
        rule.walkDecls(prop, (decl) => {
            found = decl;
        });
    });
    return found;
}

const SELECT = ".gl-table-panel__select";

describe("table layer selector — desktop width", () => {
    it("follows its content outside the phone rule, never a fixed length", () => {
        const width = declOf(SELECT, "width", "none");
        expect(width, "the base rule must still declare the width").not.toBeNull();
        expect(width!.value.trim()).toBe("auto");
    });

    it("keeps a floor and a ceiling, the ceiling being the prompt's documented room", () => {
        const min = declOf(SELECT, "min-width", "none");
        const max = declOf(SELECT, "max-width", "none");
        expect(min?.value.trim()).toBe("150px");
        expect(max, "an unbounded selector grows with the longest layer name").not.toBeNull();

        const basis = declOf(".gl-table-panel__layer-selector", "flex", "phone");
        expect(basis, "the phone rule's basis is the reference room").not.toBeNull();
        const room = basis!.value
            .replace(/!important/, "")
            .trim()
            .split(/\s+/)[2];
        expect(max!.value.trim()).toBe(room);
    });

    it("lets the phone rule lift the ceiling, where the wrapper bounds the selector", () => {
        expect(declOf(SELECT, "max-width", "phone")?.value.trim()).toBe("none");
    });
});
