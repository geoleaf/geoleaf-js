// @vitest-environment happy-dom
/*!
 * @geoleaf/host-runtime — css-adopt tests
 * © 2026 Mattieu Pottier — MIT License
 *
 * Needs a DOM (`CSSStyleSheet` + `document.adoptedStyleSheets`), hence the per-file
 * environment override — the package default stays `node` for the namespace accessors.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The idempotence set is module-scoped, so each case imports a fresh instance rather
 * than sharing state with its neighbours.
 */
async function freshAdopt(): Promise<(css: string, key: string) => void> {
    vi.resetModules();
    const mod = await import("../ui/css-adopt.js");
    return mod.adoptStylesheet;
}

beforeEach(() => {
    document.adoptedStyleSheets = [];
});

describe("adoptStylesheet", () => {
    it("adopts a constructable stylesheet rather than injecting <style>", async () => {
        const adoptStylesheet = await freshAdopt();
        adoptStylesheet(".gl-a{color:red}", "k1");

        expect(document.adoptedStyleSheets).toHaveLength(1);
        expect(document.querySelector("style")).toBeNull();
    });

    it("preserves the CSS it was given", async () => {
        const adoptStylesheet = await freshAdopt();
        adoptStylesheet(".gl-a{color:red}", "k1");

        const sheet = document.adoptedStyleSheets[0];
        expect(sheet.cssRules).toHaveLength(1);
        expect(sheet.cssRules[0].cssText).toContain("color");
    });

    it("is idempotent per key", async () => {
        const adoptStylesheet = await freshAdopt();
        adoptStylesheet(".gl-a{color:red}", "same");
        adoptStylesheet(".gl-b{color:blue}", "same");

        expect(document.adoptedStyleSheets).toHaveLength(1);
    });

    it("adopts distinct keys independently, appending to what is already there", async () => {
        const adoptStylesheet = await freshAdopt();
        adoptStylesheet(".gl-a{color:red}", "k1");
        adoptStylesheet(".gl-b{color:blue}", "k2");

        expect(document.adoptedStyleSheets).toHaveLength(2);
    });

    it("swallows the failure when constructable stylesheets are unsupported", async () => {
        const adoptStylesheet = await freshAdopt();
        const original = globalThis.CSSStyleSheet;
        // Very old browser: the constructor itself throws.
        globalThis.CSSStyleSheet = class {
            constructor() {
                throw new TypeError("Illegal constructor");
            }
        } as unknown as typeof CSSStyleSheet;

        try {
            expect(() => adoptStylesheet(".gl-a{color:red}", "k1")).not.toThrow();
            expect(document.adoptedStyleSheets).toHaveLength(0);
        } finally {
            globalThis.CSSStyleSheet = original;
        }
    });

    it("does not mark a key as adopted when adoption failed", async () => {
        const adoptStylesheet = await freshAdopt();
        const original = globalThis.CSSStyleSheet;
        globalThis.CSSStyleSheet = class {
            constructor() {
                throw new TypeError("Illegal constructor");
            }
        } as unknown as typeof CSSStyleSheet;
        adoptStylesheet(".gl-a{color:red}", "k1");
        globalThis.CSSStyleSheet = original;

        // The retry must succeed — a transient failure should not poison the key.
        adoptStylesheet(".gl-a{color:red}", "k1");
        expect(document.adoptedStyleSheets).toHaveLength(1);
    });
});
