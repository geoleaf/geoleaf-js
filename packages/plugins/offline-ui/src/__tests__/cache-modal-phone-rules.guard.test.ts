/**
 * Guard — a phone rule of `cache-modal.css` is not undone by `cache-control.css`.
 *
 * `entry.ts` imports `cache-modal.css` BEFORE `cache-control.css`. A rule of the first sheet
 * that ties with a rule of the second — same subject, same property, equal specificity — loses
 * on source order, `@media` or not: a media query adds no weight. That is how the phone remedies
 * did nothing: the layer table's box stayed `overflow-x: hidden` (the Style column cut, Size and
 * Cache out of reach) and the status row stayed `nowrap` and scrolling.
 *
 * jsdom applies no cascade, so the guard replays the part of it that decides: for every
 * declaration of a `cache-modal.css` rule inside a `max-width` media query, no rule of
 * `cache-control.css` that also applies at that width (top level, or a `max-width` query at
 * least as wide) may set the same property — longhand or its shorthand — on the same subject
 * with a specificity at least equal, nor with `!important` over a normal declaration. Same
 * subject = the same classes on the selector's last compound.
 *
 * ⚠️ What this does not judge: a rule of `cache-control.css` reaching the same element through
 * another class (a state modifier such as `--collapsed`), which is meant to win.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import postcss, { type AtRule, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const CSS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "css");
const ENTRY = path.resolve(CSS_DIR, "..", "entry.ts");

function parse(name: string) {
    const file = path.join(CSS_DIR, name);
    return postcss.parse(fs.readFileSync(file, "utf8"), { from: file });
}

/** The `max-width` of the media query enclosing `rule`, `Infinity` at the top level. */
function maxWidthOf(rule: Rule): number {
    for (let p: postcss.Node | undefined = rule.parent; p && p.type !== "root"; p = p.parent) {
        if (p.type === "atrule" && (p as AtRule).name === "media") {
            const m = /max-width:\s*(\d+)px/.exec((p as AtRule).params);
            return m ? Number(m[1]) : NaN;
        }
    }
    return Infinity;
}

/** (ids, classes/attributes/pseudo-classes, types/pseudo-elements) — enough for these sheets. */
function specificity(selector: string): [number, number, number] {
    let s = selector.replace(/::[\w-]+/g, () => " _pe_ ");
    const ids = (s.match(/#[\w-]+/g) ?? []).length;
    s = s.replace(/#[\w-]+/g, " ");
    const classes =
        (s.match(/\.[\w-]+/g) ?? []).length +
        (s.match(/\[[^\]]*\]/g) ?? []).length +
        (s.replace(/\[[^\]]*\]/g, " ").match(/:(?!not\(|is\(|where\()[\w-]+/g) ?? []).length;
    s = s.replace(/\.[\w-]+|\[[^\]]*\]|:[\w-]+(\([^)]*\))?/g, " ");
    const types = (s.match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
    return [ids, classes, types];
}

function atLeast(a: [number, number, number], b: [number, number, number]): boolean {
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
    return true;
}

/** The classes of the selector's last compound, sorted — its subject. */
function subjectOf(selector: string): string {
    const last =
        selector
            .trim()
            .split(/\s*[\s>+~]\s*/)
            .pop() ?? "";
    if (/::|:[\w-]/.test(last)) return `pseudo:${last}`;
    return (last.match(/\.[\w-]+/g) ?? []).sort().join("");
}

/** The property names a declaration of `prop` sets: itself, and the longhands of a shorthand. */
const SHORTHANDS: Record<string, string[]> = {
    overflow: ["overflow-x", "overflow-y"],
    "flex-flow": ["flex-direction", "flex-wrap"],
    flex: ["flex-grow", "flex-shrink", "flex-basis"],
};
function setsOf(prop: string): string[] {
    return [prop, ...(SHORTHANDS[prop] ?? [])];
}

interface Decl {
    selector: string;
    prop: string;
    important: boolean;
    maxWidth: number;
}

function declsOf(root: postcss.Root): Decl[] {
    const out: Decl[] = [];
    root.walkRules((rule) => {
        if (rule.parent?.type === "atrule" && (rule.parent as AtRule).name === "keyframes") return;
        const maxWidth = maxWidthOf(rule);
        for (const selector of rule.selectors) {
            rule.each((node) => {
                if (node.type !== "decl") return;
                out.push({ selector, prop: node.prop, important: !!node.important, maxWidth });
            });
        }
    });
    return out;
}

describe("cache-modal.css — its phone rules survive cache-control.css", () => {
    it("reads the import order it relies on: cache-modal.css before cache-control.css", () => {
        const entry = fs.readFileSync(ENTRY, "utf8");
        const modal = entry.indexOf('"./css/cache-modal.css"');
        const control = entry.indexOf('"./css/cache-control.css"');
        expect(modal, "cache-modal.css is no longer imported").toBeGreaterThanOrEqual(0);
        expect(control, "cache-control.css is no longer imported").toBeGreaterThanOrEqual(0);
        // Swapped, the later sheet would be cache-modal.css and this guard would judge nothing.
        expect(modal).toBeLessThan(control);
    });

    it("finds phone rules to judge, and no later rule of equal weight undoes one", () => {
        const phone = declsOf(parse("cache-modal.css")).filter((d) => Number.isFinite(d.maxWidth));
        const later = declsOf(parse("cache-control.css"));
        // The rule guarding the guard: a reader that finds nothing compares nothing.
        expect(phone.length).toBeGreaterThan(0);
        expect(later.length).toBeGreaterThan(0);

        const losers: string[] = [];
        for (const d of phone) {
            const subject = subjectOf(d.selector);
            const spec = specificity(d.selector);
            for (const o of later) {
                // A later rule only competes at the phone's width if its own query includes it.
                if (o.maxWidth < d.maxWidth) continue;
                if (subjectOf(o.selector) !== subject) continue;
                if (!setsOf(o.prop).includes(d.prop)) continue;
                const wins = o.important
                    ? !d.important || atLeast(specificity(o.selector), spec)
                    : !d.important && atLeast(specificity(o.selector), spec);
                if (wins) losers.push(`${d.selector} { ${d.prop} } ← ${o.selector} { ${o.prop} }`);
            }
        }
        expect(losers).toEqual([]);
    });

    // In the scrolling table the Style list kept `width: 100%` of a 57 px column: « défaut » read
    // « défa ». On a phone the list is given the room of its longest default word.
    it("gives the Style list a floor on a phone, so « défaut » reads whole", () => {
        const floors: string[] = [];
        parse("cache-modal.css").walkRules((rule) => {
            if (maxWidthOf(rule) === Infinity) return;
            if (!/\.gl-cache-layers__style-select\b/.test(rule.selector)) return;
            rule.walkDecls("min-width", (d) => {
                floors.push(d.value);
            });
        });
        expect(floors).toHaveLength(1);
        expect(floors[0]).toMatch(/^\d+(\.\d+)?rem$/);
    });
});
