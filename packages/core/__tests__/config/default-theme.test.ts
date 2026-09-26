/**
 * `resolveDefaultThemeId` — the ONE answer to « which theme does this profile start on? ».
 *
 * 🛑 Three readers answered it, and not alike. The GeoJSON loader and the boot reveal read
 * `config.defautTheme` then `defaultTheme`, and said « none » without either; the theme loader
 * read `defaultTheme` alone and fell back to the first theme. On a profile declaring themes
 * without a default, the loader loaded every layer in the background while `theme-engine`
 * applied `themes[0]`: measured on the tourism profile, 19 to 21 layers visible for a 7-layer
 * theme, a different count from one load to the next.
 *
 * The rule is the theme loader's, extended to the legacy key the other two honoured: the
 * declared default when it names a theme of the list — canonical `defaultTheme` first, the
 * historical `config.defautTheme` typo second —, otherwise the first theme that has an id,
 * otherwise `null`.
 */
import { describe, expect, it } from "vitest";

import { resolveDefaultThemeId } from "../../src/kernel/config/default-theme.js";

const THEMES = [{ label: "no id" }, { id: "t1" }, { id: "t2" }];

describe("resolveDefaultThemeId", () => {
    it("the declared `defaultTheme`, when it names a theme of the list", () => {
        expect(resolveDefaultThemeId({ defaultTheme: "t2", themes: THEMES })).toBe("t2");
    });

    it("the legacy `config.defautTheme`, when it is the only one declared", () => {
        expect(resolveDefaultThemeId({ config: { defautTheme: "t2" }, themes: THEMES })).toBe("t2");
    });

    it("the canonical key wins over the legacy one", () => {
        expect(
            resolveDefaultThemeId({
                defaultTheme: "t1",
                config: { defautTheme: "t2" },
                themes: THEMES,
            })
        ).toBe("t1");
    });

    it("🛑 no default declared: the first theme that has an id — as the theme loader applies", () => {
        expect(resolveDefaultThemeId({ themes: THEMES })).toBe("t1");
    });

    it("a declared default absent from the list falls back the same way", () => {
        expect(resolveDefaultThemeId({ defaultTheme: "gone", themes: THEMES })).toBe("t1");
        expect(
            resolveDefaultThemeId({
                defaultTheme: "gone",
                config: { defautTheme: "t2" },
                themes: THEMES,
            })
        ).toBe("t2");
    });

    it("null when the profile declares no theme", () => {
        expect(resolveDefaultThemeId(undefined)).toBeNull();
        expect(resolveDefaultThemeId(null)).toBeNull();
        expect(resolveDefaultThemeId({})).toBeNull();
        expect(resolveDefaultThemeId({ defaultTheme: "t1" })).toBeNull();
        expect(resolveDefaultThemeId({ defaultTheme: "t1", themes: [] })).toBeNull();
        expect(resolveDefaultThemeId({ themes: [{ label: "no id" }] })).toBeNull();
        expect(resolveDefaultThemeId("t1")).toBeNull();
    });
});
