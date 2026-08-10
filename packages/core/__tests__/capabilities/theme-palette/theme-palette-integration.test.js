/**
 * Integration tests — theme-palette wiring (S3).
 *
 * Le point le plus important est le DERNIER : les blocs de palette doivent réellement
 * exister dans la feuille source livrée. C'est le risque n°1 du CDC — un attribut posé
 * en JS que le CSS ne suit pas donne un bouton qui « marche » et un écran qui ne change
 * pas, tous tests unitaires au vert.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const { FULL } = await import("../../../src/presets/manifest.full.ts");
const { THEME_PALETTE_INSTALLER } = await import(
    "../../../src/capabilities/theme-palette/install.ts"
);
const { ThemePaletteModule } = await import("../../../src/capabilities/theme-palette/module.ts");

// `import.meta.dirname`, pas `fileURLToPath(import.meta.url)` : sous happy-dom
// `import.meta.url` n'est pas une URL `file:` et la conversion jette (même idiome que
// `__tests__/capabilities/scaffold-taxonomy.test.js`).
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
    // Sans ce contrôle, `applyPalette("green")` poserait un attribut que RIEN ne stylise :
    // le bouton fonctionnerait, l'écran ne changerait pas, et aucun test DOM ne le verrait.
    for (const id of ["green", "blue"]) {
        it(`palettes/${id}.css cible :root[data-gl-palette="${id}"] en clair ET en sombre`, () => {
            const file = join(CAPABILITY_DIR, "css", "palettes", `${id}.css`);
            expect(existsSync(file)).toBe(true);

            const css = readFileSync(file, "utf-8");
            const root = `:root[data-gl-palette="${id}"]`;
            expect(css).toContain(`${root} {`);
            expect(css).toContain(`${root} .gl-theme-light`);
            expect(css).toContain(`${root} .gl-theme-dark`);

            // Enveloppée dans la couche des capacités : c'est ce qui fait gagner la
            // surcharge sur gl.tokens SANS !important.
            expect(css.trimStart().startsWith("@layer gl.capabilities")).toBe(true);

            // Et surtout : AUCUNE ligne de sélecteur non scopée. Sinon la palette
            // s'applique globalement et la DERNIÈRE importée gagne pour tout le monde.
            //
            // ⚠️ La première version de cette garde ne cherchait que `.gl-theme-light {`
            // — une accolade sur la même ligne. Or les feuilles récupérées portent des
            // listes de sélecteurs MULTI-LIGNES (`body.gl-theme-light,\n.gl-theme-light {`),
            // dont seule la seconde ligne avait été scopée. La garde est sortie verte
            // pendant que la palette bleue repeignait toutes les pages : elle portait
            // exactement la cécité qu'elle prétendait mesurer.
            //
            // On vérifie donc CHAQUE ligne de sélecteur (celles qui finissent par `,` ou
            // `{`), et non plus une forme particulière.
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
