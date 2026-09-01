/**
 * Integration tests — theme-palette wiring (S3).
 *
 * The most important point is the LAST: the palette blocks must really exist
 * in the shipped source sheet. The CDC's risk no. 1 — an attribute set in JS
 * the CSS does not follow gives a button that "works" and a screen that does
 * not change, all unit tests green.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const { FULL } = await import("../../../src/presets/manifest.full.ts");
const { THEME_PALETTE_INSTALLER } =
    await import("../../../src/capabilities/theme-palette/install.ts");
const { ThemePaletteModule } = await import("../../../src/capabilities/theme-palette/module.ts");

// `import.meta.dirname`, not `fileURLToPath(import.meta.url)`: under
// happy-dom `import.meta.url` is not a `file:` URL and the conversion throws
// (same idiom as `__tests__/capabilities/scaffold-taxonomy.test.js`).
const CAPABILITY_DIR = resolve(import.meta.dirname, "../../../src/capabilities/theme-palette");

describe("preset manifest wiring", () => {
    it("ships the theme-palette installer", () => {
        expect(FULL.capabilities).toContain(THEME_PALETTE_INSTALLER);
    });

    it("est APPENDU après les capacités préexistantes", () => {
        const ids = FULL.capabilities.map((c) => c.declaration.id);
        expect(ids.indexOf("theme-palette")).toBeGreaterThan(ids.indexOf("vector-tiles"));
    });

    it("mounts GeoLeaf.ThemePalette through registerGlobals", () => {
        const gl = {};
        THEME_PALETTE_INSTALLER.registerGlobals(gl);
        expect(typeof gl.ThemePalette.list).toBe("function");
        expect(typeof gl.ThemePalette.get).toBe("function");
        expect(typeof gl.ThemePalette.set).toBe("function");
        expect(typeof gl.ThemePalette.isEnabled).toBe("function");
        expect(typeof gl.ThemePalette.getConfig).toBe("function");
    });

    it("builds a module declaring the geojson dependency", () => {
        const mod = THEME_PALETTE_INSTALLER.createModule();
        expect(mod).toBeInstanceOf(ThemePaletteModule);
        expect(mod.id).toBe("theme-palette");
        expect(mod.dependencies).toContain("geojson");
    });
});

describe("les feuilles de palette existent et ciblent le bon attribut", () => {
    // Without this check, `applyPalette("green")` would set an attribute
    // NOTHING styles: the button would work, the screen would not change, and
    // no DOM test would see it.
    for (const id of ["green", "blue"]) {
        it(`palettes/${id}.css cible :root[data-gl-palette="${id}"] en clair ET en sombre`, () => {
            const file = join(CAPABILITY_DIR, "css", "palettes", `${id}.css`);
            expect(existsSync(file)).toBe(true);

            const css = readFileSync(file, "utf-8");
            const root = `:root[data-gl-palette="${id}"]`;
            expect(css).toContain(`${root} {`);
            expect(css).toContain(`${root} .gl-theme-light`);
            expect(css).toContain(`${root} .gl-theme-dark`);

            // Wrapped in the capabilities layer: what makes the override win
            // over gl.tokens WITHOUT !important.
            expect(css.trimStart().startsWith("@layer gl.capabilities")).toBe(true);

            // And above all: NO unscoped selector line. Otherwise the palette
            // applies globally and the LAST imported wins for everyone.
            //
            // ⚠️ This guard's first version only looked for `.gl-theme-light {`
            // — a brace on the same line. Yet the retrieved sheets carry
            // MULTI-LINE selector lists (`body.gl-theme-light,\n.gl-theme-light {`),
            // of which only the second line had been scoped. The guard came
            // out green while the blue palette repainted every page: it
            // carried exactly the blindness it claimed to measure.
            //
            // So EVERY selector line is checked (those ending in `,` or `{`),
            // no longer one particular shape.
            const selectorLines = css
                .split("\n")
                .map((l) => l.trim())
                .filter((l) => /[,{]$/.test(l))
                .filter((l) => !l.startsWith("/*") && !l.startsWith("*") && !l.startsWith("@"))
                .filter((l) => /gl-theme-(?:light|dark)|:root/.test(l));

            expect(selectorLines.length).toBeGreaterThan(0);
            for (const line of selectorLines) {
                expect(line, `sélecteur non scopé dans ${id}.css : « ${line} »`).toContain(
                    `[data-gl-palette="${id}"]`
                );
            }
        });
    }

    it("la feuille d'entrée importe les deux palettes", () => {
        const css = readFileSync(join(CAPABILITY_DIR, "css", "theme-palette.css"), "utf-8");
        expect(css).toContain("./palettes/green.css");
        expect(css).toContain("./palettes/blue.css");
    });

    it("l'installer tire la feuille dans le graphe JS (tree-shaking)", () => {
        const src = readFileSync(join(CAPABILITY_DIR, "install.ts"), "utf-8");
        expect(src).toContain('import "./css/theme-palette.css"');
    });
});
