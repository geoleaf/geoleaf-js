/**
 * Guard — the toolbar's fields keep their theme colours against the core's host guard.
 *
 * This sheet is adopted OUTSIDE the cascade layers, like every plugin sheet. The core's host
 * guard (`geoleaf-host-guard.css`, unlayered too) writes `color` and `background:
 * revert-layer` on every `gl-*` select and input, which drops every unlayered declaration of
 * those properties and hands them back to the `gl.*` layers. No layer styles the table's
 * fields, so wherever the guard outranks this sheet's rule, the browser's own grey and white
 * come back — in the dark theme too, over a black panel.
 *
 * Between two unlayered rules specificity decides, so the guard reads both sheets: each rule
 * of this sheet that colours one of the two fields must outrank the guard's field selector.
 * The guard's specificity is read from the core's sheet, never copied here, so a stronger
 * guard turns this red instead of leaving it green on a stale figure. jsdom computes no
 * cascade (no layers, no `revert-layer`), hence the static reading.
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import postcss, { type Root, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TABLE_SHEET = path.resolve(HERE, "..", "css", "geoleaf-table.css");
const CORE_ROOT = path.dirname(
    createRequire(import.meta.url).resolve("@geoleaf/core/package.json")
);
const GUARD_SHEET = path.join(CORE_ROOT, "src", "css", "geoleaf-host-guard.css");

/** The two fields of the toolbar, both created with a `gl-*` class (`panel.ts`). */
const FIELDS = ["gl-table-panel__select", "gl-table-panel__search-input"];
const COLOUR_PROPS = new Set(["color", "background", "background-color"]);

type Specificity = [number, number, number];

function compare(a: Specificity, b: Specificity): number {
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Splits on top-level commas only, so `:is(a, b)` stays whole. */
function splitList(list: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < list.length; i++) {
        const ch = list[i];
        if (ch === "(" || ch === "[") depth++;
        else if (ch === ")" || ch === "]") depth--;
        else if (ch === "," && depth === 0) {
            parts.push(list.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(list.slice(start));
    return parts.map((p) => p.trim()).filter(Boolean);
}

function maxOf(list: string): Specificity {
    return splitList(list)
        .map(specificity)
        .reduce<Specificity>((best, s) => (compare(s, best) > 0 ? s : best), [0, 0, 0]);
}

/** Selector specificity, enough for the selectors of these two sheets (Selectors Level 4). */
function specificity(selector: string): Specificity {
    const s: Specificity = [0, 0, 0];
    let i = 0;
    const add = (t: Specificity) => {
        s[0] += t[0];
        s[1] += t[1];
        s[2] += t[2];
    };
    const closing = (from: number, open: string, close: string): number => {
        let depth = 0;
        for (let j = from; j < selector.length; j++) {
            if (selector[j] === open) depth++;
            else if (selector[j] === close && --depth === 0) return j;
        }
        throw new Error(`unbalanced selector: ${selector}`);
    };
    while (i < selector.length) {
        const ch = selector[i] ?? "";
        if (ch === "#") {
            s[0]++;
            i++;
        } else if (ch === ".") {
            s[1]++;
            i++;
        } else if (ch === "[") {
            s[1]++;
            i = closing(i, "[", "]") + 1;
            continue;
        } else if (ch === ":") {
            const pseudoElement = selector[i + 1] === ":";
            const name = (/^::?([a-zA-Z-]+)/.exec(selector.slice(i))?.[1] ?? "").toLowerCase();
            i += (pseudoElement ? 2 : 1) + name.length;
            let args: string | null = null;
            if (selector[i] === "(") {
                const end = closing(i, "(", ")");
                args = selector.slice(i + 1, end);
                i = end + 1;
            }
            if (pseudoElement || ["before", "after", "placeholder"].includes(name)) s[2]++;
            else if (name === "where") {
                /* zero */
            } else if (["is", "not", "has", "matches"].includes(name) && args !== null) {
                add(maxOf(args));
            } else s[1]++;
            continue;
        } else if (/[a-zA-Z*]/.test(ch)) {
            const word = /^[a-zA-Z][\w-]*|^\*/.exec(selector.slice(i))![0];
            if (word !== "*") s[2]++;
            i += word.length;
            continue;
        }
        // Skip the rest of a class or id name, then one combinator or whitespace character.
        const from = i;
        while (i < selector.length && /[\w-]/.test(selector[i] ?? "")) i++;
        if (i === from) i++;
    }
    return s;
}

function parse(file: string): Root {
    return postcss.parse(fs.readFileSync(file, "utf8"), { from: file });
}

function isLayered(rule: Rule): boolean {
    for (let p = rule.parent; p && p.type !== "root"; p = p.parent) {
        if (p.type === "atrule" && (p as postcss.AtRule).name === "layer") return true;
    }
    return false;
}

/** The guard's strongest selector on fields: the bar this sheet's field colours must clear. */
function guardFieldSpecificity(): Specificity {
    let bar: Specificity | null = null;
    parse(GUARD_SHEET).walkRules((rule) => {
        const reverts = rule.nodes.some(
            (n) => n.type === "decl" && n.prop === "background" && n.value === "revert-layer"
        );
        if (!reverts) return;
        for (const sel of rule.selectors) {
            if (!/\b(select|input)\b/.test(sel)) continue;
            const sp = specificity(sel);
            if (!bar || compare(sp, bar) > 0) bar = sp;
        }
    });
    if (!bar) throw new Error(`no field rule with revert-layer found in ${GUARD_SHEET}`);
    return bar;
}

/** Unlayered rules of the table sheet that colour the field itself (not a pseudo-element). */
function fieldColourRules(field: string): { selector: string; line: number; sp: Specificity }[] {
    const subject = new RegExp(`\\.${field}(?![\\w-])(?:[^\\s>+~]*)$`);
    const found: { selector: string; line: number; sp: Specificity }[] = [];
    parse(TABLE_SHEET).walkRules((rule) => {
        if (isLayered(rule)) return;
        const colours = rule.nodes.some(
            (n) => n.type === "decl" && COLOUR_PROPS.has(n.prop) && !n.important
        );
        if (!colours) return;
        for (const sel of rule.selectors) {
            const s = sel.trim();
            if (!subject.test(s) || s.includes("::")) continue;
            found.push({ selector: s, line: rule.source?.start?.line ?? 0, sp: specificity(s) });
        }
    });
    return found;
}

describe("table toolbar fields — colours against the host guard", () => {
    it("reads the guard's selector at its documented specificity", () => {
        // The witness that the instrument reads what it claims: (0,1,1) is the specificity the
        // guard's own comment and the kernel spec describe.
        expect(guardFieldSpecificity()).toEqual([0, 1, 1]);
    });

    it.each(FIELDS)("colours .%s from a rule that outranks the guard", (field) => {
        const bar = guardFieldSpecificity();
        const rules = fieldColourRules(field);
        expect(
            rules.length,
            `no rule colours .${field}: the guard would hand it to the browser`
        ).toBeGreaterThan(0);
        const beaten = rules.filter((r) => compare(r.sp, bar) <= 0);
        expect(
            beaten.map((r) => `${r.selector} (${r.sp.join(",")}) at geoleaf-table.css:${r.line}`),
            `reverted by the host guard (${bar.join(",")})`
        ).toEqual([]);
    });
});
