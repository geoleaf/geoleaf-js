/**
 * @file js-alpha-equivalence.guard.test.ts
 * @description Guard test — PUB-05's second regime compares JavaScript up to a renaming of
 * LOCAL bindings only: what a minifier renames compares equal, what changes behaviour does not.
 *
 * Why this guard exists
 * ------------------------------------------------------------------------------------
 * A comparison that equates two programs which behave differently goes green in silence —
 * the worst failure a gate can have. The first sketch of this rule numbered every identifier
 * and would have equated `GeoLeaf.I18n` with `GeoLeaf.Lang`. These cases pin both sides of
 * the line: each renaming a minifier performs, and each change a minifier never makes.
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const requireCjs = createRequire(import.meta.url);

interface JsAlphaEquivalence {
    alphaHash(code: string): string;
}

const lib: JsAlphaEquivalence = requireCjs("../../../../scripts/lib/js-alpha-equivalence.cjs");

const same = (a: string, b: string): boolean => lib.alphaHash(a) === lib.alphaHash(b);

describe("PUB-05 — JavaScript à renommage près des liaisons locales", () => {
    it("égale deux programmes qui ne diffèrent que par leurs liaisons locales", () => {
        expect(
            same(
                "const a=1;function f(b){return a+b}export{f as run}",
                "const x=1;function g(y){return x+y}export{g as run}"
            )
        ).toBe(true);
    });

    it("égale une propriété abrégée et sa forme explicite", () => {
        expect(same("const x=1;export default {x}", "const y=1;export default {x:y}")).toBe(true);
    });

    it("égale deux imports dont seule la liaison locale diffère", () => {
        expect(same('import{a as b}from"m";b()', 'import{a as c}from"m";c()')).toBe(true);
    });

    it("égale une étiquette renommée — c'est une liaison", () => {
        expect(same("a:for(;;){break a}", "b:for(;;){break b}")).toBe(true);
    });

    it("voit un littéral changé", () => {
        expect(same("export default 1", "export default 2")).toBe(false);
    });

    it("voit une propriété renommée partout — c'est une API externe", () => {
        expect(same("export default o=>o.I18n", "export default o=>o.Lang")).toBe(false);
    });

    it("voit une globale libre renommée partout — c'est un nom de l'hôte", () => {
        expect(same("export default ()=>globalThis.x", "export default ()=>window.x")).toBe(false);
    });

    it("voit un nom exporté ou importé changé — c'est le contrat du module", () => {
        expect(same("const a=1;export{a as x}", "const a=1;export{a as y}")).toBe(false);
        expect(same("export const o=1", "export const p=1")).toBe(false);
        expect(same('import{a}from"m";a()', 'import{b as a}from"m";a()')).toBe(false);
    });

    it("garde les références internes numérotées derrière un nom exporté", () => {
        expect(same("export const o=1;const a=o", "export const o=1;const b=o")).toBe(true);
    });

    it("voit un opérateur ou un ordre d'arguments changé", () => {
        expect(same("export default (a,b)=>a+b", "export default (a,b)=>a-b")).toBe(false);
        expect(same("export default (a,b)=>a(b)", "export default (a,b)=>b(a)")).toBe(false);
    });

    it("refuse de conclure sur un code qui ne se parse pas", () => {
        expect(() => lib.alphaHash("export const = ;")).toThrow();
    });
});
