/**
 * Config-contract Phase C / C3 — B4 themes.json: per-value validation/normalisation.
 *
 * Read path: ThemeLoader._validateConfig(raw) is the pure seam every theme config
 * flows through (theme-loader.ts:173-222) — it merges config.primaryThemes /
 * config.secondaryThemes defaults, normalises each theme entry, and resolves
 * defaultTheme (present / absent / invalid). The live visibility TOGGLE of
 * layers[].{visible,style} is shared-state-coupled (theme-applier + GeoJSONShared)
 * and is covered end-to-end by e2e/cfg-c3 — here we lock the config wiring.
 *
 * Consumer: packages/core/src/kernel/themes/theme-loader.ts. Inventory B4.
 * Source of truth: profiles/_reference/config/core/themes.json.
 */

import { ThemeLoader } from "../../src/kernel/themes/theme-loader.js";
import { REFERENCE_THEMES, clone } from "./_helpers/config-harness.js";

describe("config B4 — themes._validateConfig (themes/theme-loader.ts)", () => {
    // ── reference fixture: every leaf carried through ─────────────────────────
    describe("reference fixture", () => {
        const out = ThemeLoader._validateConfig(clone(REFERENCE_THEMES));

        it("defaultTheme (root, canonical) is kept", () => {
            expect(out.defaultTheme).toBe("base");
        });
        it("config.primaryThemes.{enabled,position} are read", () => {
            expect(out.config.primaryThemes).toMatchObject({ enabled: true, position: "top-map" });
        });
        it("config.secondaryThemes.{enabled,placeholder,showNavigationButtons,position} are read", () => {
            expect(out.config.secondaryThemes).toMatchObject({
                enabled: true,
                placeholder: "Choisir une saison…",
                showNavigationButtons: true,
                position: "top-layermanager",
            });
        });
        it("all themes normalised, primary vs secondary type preserved", () => {
            expect(out.themes).toHaveLength(4);
            expect(out.themes.find((t) => t.id === "base").type).toBe("primary");
            expect(out.themes.find((t) => t.id === "season-winter").type).toBe("secondary");
        });
        it("themes[].layers[].{id,visible,style} preserved (incl. visible:false)", () => {
            const base = out.themes.find((t) => t.id === "base");
            expect(base.layers).toEqual([
                { id: "layer-a", visible: true, style: "defaut" },
                { id: "layer-b", visible: true, style: "defaut" },
                { id: "layer-c", visible: false, style: "defaut" },
            ]);
        });
    });

    // ── defaultTheme resolution ───────────────────────────────────────────────
    describe("defaultTheme resolution", () => {
        const themes = [
            { id: "a", layers: [] },
            { id: "b", layers: [] },
        ];

        it("absent defaultTheme → first theme id", () => {
            const out = ThemeLoader._validateConfig({ themes });
            expect(out.defaultTheme).toBe("a");
        });
        it("defaultTheme not matching any theme → first theme id (fallback)", () => {
            const out = ThemeLoader._validateConfig({ defaultTheme: "ghost", themes });
            expect(out.defaultTheme).toBe("a");
        });
        it("valid defaultTheme → kept as-is", () => {
            const out = ThemeLoader._validateConfig({ defaultTheme: "b", themes });
            expect(out.defaultTheme).toBe("b");
        });
    });

    // ── config defaults merge (empty config) ──────────────────────────────────
    describe("config.{primary,secondary}Themes defaults", () => {
        const out = ThemeLoader._validateConfig({ themes: [{ id: "a", layers: [] }] });

        it("primaryThemes defaults: enabled true, position top-map", () => {
            expect(out.config.primaryThemes).toMatchObject({ enabled: true, position: "top-map" });
        });
        it("secondaryThemes defaults: enabled true, showNavigationButtons true, position top-layermanager", () => {
            expect(out.config.secondaryThemes).toMatchObject({
                enabled: true,
                showNavigationButtons: true,
                position: "top-layermanager",
            });
        });
        it("per-flag override wins over default (enabled:false)", () => {
            const o = ThemeLoader._validateConfig({
                config: { primaryThemes: { enabled: false } },
                themes: [{ id: "a", layers: [] }],
            });
            expect(o.config.primaryThemes.enabled).toBe(false);
        });
    });

    // ── per-theme normalisation ───────────────────────────────────────────────
    describe("theme normalisation (theme-loader.ts:_normalizeTheme)", () => {
        it("missing label → id ; missing type → 'secondary' ; missing desc/icon → ''", () => {
            const out = ThemeLoader._validateConfig({ themes: [{ id: "x", layers: [] }] });
            expect(out.themes[0]).toMatchObject({
                id: "x",
                label: "x",
                type: "secondary",
                description: "",
                icon: "",
                layers: [],
            });
        });
        it("theme without id → dropped from the normalised list", () => {
            const out = ThemeLoader._validateConfig({
                themes: [{ id: "keep", layers: [] }, { label: "no-id" }],
            });
            expect(out.themes).toHaveLength(1);
            expect(out.themes[0].id).toBe("keep");
        });
        it("non-array layers → coerced to []", () => {
            const out = ThemeLoader._validateConfig({ themes: [{ id: "x", layers: "oops" }] });
            expect(out.themes[0].layers).toEqual([]);
        });
    });

    // ── edge: no themes ───────────────────────────────────────────────────────
    it("non-array themes → empty themes list, no throw", () => {
        const out = ThemeLoader._validateConfig({ defaultTheme: "x" });
        expect(out.themes).toEqual([]);
    });
});
