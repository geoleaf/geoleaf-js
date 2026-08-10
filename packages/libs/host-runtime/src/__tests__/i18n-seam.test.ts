/*!
 * @geoleaf/host-runtime — i18n-seam tests
 * © 2026 Mattieu Pottier — MIT License
 *
 * Runs under the package default (`environment: "node"`): the seam only reads the
 * `GeoLeaf` namespace off `globalThis`, it never touches the DOM.
 *
 * The three contracts this seam replaced are asserted EXPLICITLY, because the merge
 * only holds if `tLabel` is a strict behavioural superset of all three:
 *   - `t(key, fallback)`  — connector, geocoding (fallback required)
 *   - `t(key)`            — storage (key as fallback)
 *   - `getLabel(key)`     — table (key as fallback, echo counted as resolved)
 */
import { describe, it, expect, afterEach } from "vitest";
import { tLabel, getActiveLang } from "../i18n-seam.js";

type Facade = {
    getLabel?: (key: string, ...args: string[]) => string;
    getActiveLang?: () => string;
};
const carrier = globalThis as { GeoLeaf?: { I18n?: Facade } };

const mount = (facade: Facade) => {
    carrier.GeoLeaf = { I18n: facade };
};

afterEach(() => {
    delete carrier.GeoLeaf;
});

describe("tLabel — resolution", () => {
    it("returns the localized label when the catalog resolves the key", () => {
        mount({ getLabel: (k) => (k === "ui.table.x" ? "Traduit" : k) });
        expect(tLabel("ui.table.x")).toBe("Traduit");
    });

    it("resolves at CALL time, not at import time", () => {
        expect(tLabel("ui.a", "repli")).toBe("repli");
        mount({ getLabel: () => "Tardif" });
        expect(tLabel("ui.a", "repli")).toBe("Tardif");
    });

    it("forwards nothing but the key — interpolation belongs to the core", () => {
        const seen: string[][] = [];
        mount({
            getLabel: (k, ...args) => {
                seen.push([k, ...args]);
                return "ok";
            },
        });
        tLabel("ui.b");
        expect(seen).toEqual([["ui.b"]]);
    });
});

describe("tLabel — miss detection", () => {
    const MISSES: Array<[string, Facade]> = [
        ["the namespace is absent", {}],
        ["getLabel is not mounted", { getActiveLang: () => "fr" }],
        ["getLabel echoes the key back (the core's miss signal)", { getLabel: (k) => k }],
        ["getLabel yields an empty string", { getLabel: () => "" }],
        ["getLabel yields a non-string", { getLabel: () => 123 as unknown as string }],
    ];

    it.each(MISSES)("falls back to the key when %s", (_why, facade) => {
        if (Object.keys(facade).length) mount(facade);
        expect(tLabel("ui.missing")).toBe("ui.missing");
    });

    it.each(MISSES)("falls back to the supplied fallback when %s", (_why, facade) => {
        if (Object.keys(facade).length) mount(facade);
        expect(tLabel("ui.missing", "Valeur par défaut")).toBe("Valeur par défaut");
    });

    it("is a silent no-op when the whole namespace is missing", () => {
        expect(() => tLabel("ui.c")).not.toThrow();
    });
});

describe("tLabel — the three contracts it replaced", () => {
    it("reproduces connector/geocoding `t(key, fallback)`: fallback on echo", () => {
        // The pre-S2 body was `value && value !== key ? value : fallback`.
        mount({ geoLabelless: true } as unknown as Facade);
        expect(tLabel("connector.modal.title", "Connexion")).toBe("Connexion");
        mount({ getLabel: (k) => k });
        expect(tLabel("connector.modal.title", "Connexion")).toBe("Connexion");
    });

    it("reproduces storage `t(key)`: key on miss", () => {
        // The pre-S2 body was `getLabel?.(key) ?? key`.
        mount({ getLabel: () => undefined as unknown as string });
        expect(tLabel("storage.cache.title")).toBe("storage.cache.title");
    });

    it("reproduces table `getLabel(key)`: an echoed key yields the same string", () => {
        // The pre-S2 body counted an echo as RESOLVED and returned `value`; `tLabel`
        // counts it as a miss and returns `key`. Both are the same string — which is
        // why the merge changes no call site.
        mount({ getLabel: (k) => k });
        expect(tLabel("ui.table.layer_placeholder")).toBe("ui.table.layer_placeholder");
    });
});

describe("getActiveLang", () => {
    it("returns the code the core resolved", () => {
        mount({ getActiveLang: () => "en" });
        expect(getActiveLang()).toBe("en");
    });

    it.each([
        ["the namespace is absent", undefined],
        ["getActiveLang is not mounted", {} as Facade],
        ["it yields an empty string", { getActiveLang: () => "" }],
        ["it yields a non-string", { getActiveLang: () => 7 as unknown as string }],
    ])('defaults to "fr" when %s', (_why, facade) => {
        if (facade) mount(facade);
        expect(getActiveLang()).toBe("fr");
    });
});
