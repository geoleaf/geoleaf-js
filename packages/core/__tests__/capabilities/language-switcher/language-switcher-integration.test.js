/**
 * Integration tests — language-switcher wiring (S2).
 *
 * Vérifie les jointures qu'un test unitaire ne voit pas : l'installer est bien porté par
 * le manifeste livré, sa forme respecte le contrat, et le bandeau d'onglets desktop
 * émet réellement le seam auquel la capacité s'abonne.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { FULL } = await import("../../../src/presets/manifest.full.ts");
const { LANGUAGE_SWITCHER_INSTALLER } = await import(
    "../../../src/capabilities/language-switcher/install.ts"
);
const { LanguageSwitcherModule } = await import(
    "../../../src/capabilities/language-switcher/module.ts"
);
const { initDesktopPanel, destroyDesktopPanel } = await import(
    "../../../src/kernel/ui/desktop/desktop-panel.ts"
);

describe("preset manifest wiring", () => {
    it("ships the language-switcher installer", () => {
        expect(FULL.capabilities).toContain(LANGUAGE_SWITCHER_INSTALLER);
    });

    it("est APPENDU après les capacités préexistantes", () => {
        // Même invariant qu'au S1 : ce qui compte est qu'aucun index ANTÉRIEUR ne bouge,
        // pas d'être la toute dernière entrée (un sprint suivant appendra derrière).
        const ids = FULL.capabilities.map((c) => c.declaration.id);
        expect(ids.indexOf("language-switcher")).toBeGreaterThan(ids.indexOf("vector-tiles"));
    });

    it("mounts GeoLeaf.LanguageSwitcher through registerGlobals", () => {
        const gl = {};
        LANGUAGE_SWITCHER_INSTALLER.registerGlobals(gl);
        expect(typeof gl.LanguageSwitcher.list).toBe("function");
        expect(typeof gl.LanguageSwitcher.current).toBe("function");
        expect(typeof gl.LanguageSwitcher.switchTo).toBe("function");
        expect(typeof gl.LanguageSwitcher.isEnabled).toBe("function");
        expect(typeof gl.LanguageSwitcher.getConfig).toBe("function");
    });

    it("builds a module declaring the geojson dependency", () => {
        const mod = LANGUAGE_SWITCHER_INSTALLER.createModule();
        expect(mod).toBeInstanceOf(LanguageSwitcherModule);
        expect(mod.id).toBe("language-switcher");
        expect(mod.dependencies).toContain("geojson");
    });
});

describe("le kernel émet réellement le seam du bandeau d'onglets", () => {
    let received;
    const capture = (e) => {
        received = e.detail;
    };

    beforeEach(() => {
        document.body.innerHTML = "";
        received = undefined;
        document.addEventListener("geoleaf:desktop-panel:tabs-ready", capture);
    });

    afterEach(() => {
        document.removeEventListener("geoleaf:desktop-panel:tabs-ready", capture);
        destroyDesktopPanel();
    });

    it("dispatche geoleaf:desktop-panel:tabs-ready à la construction du panneau", () => {
        // Un seam que personne n'émet laisserait tous les tests unitaires verts pendant
        // que le bouton n'apparaît jamais.
        const glMain = document.createElement("div");
        glMain.className = "gl-main";
        document.body.appendChild(glMain);

        initDesktopPanel({ glMain });

        expect(received).toBeDefined();
        expect(received.tabs.classList.contains("gl-rp-tabs")).toBe(true);
        // Le point d'insertion dont dépend la capacité : le toggle de thème est présent,
        // et le bouton de langue se place juste avant lui.
        expect(received.tabs.querySelector(".gl-rp-theme-toggle")).not.toBeNull();
    });
});
