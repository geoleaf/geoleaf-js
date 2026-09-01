/**
 * Integration tests — language-switcher wiring (S2).
 *
 * Verifies the joins a unit test does not see: the installer is carried by
 * the shipped manifest, its shape respects the contract, and the desktop tab
 * strip really emits the seam the capability subscribes to.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { FULL } = await import("../../../src/presets/manifest.full.ts");
const { LANGUAGE_SWITCHER_INSTALLER } =
    await import("../../../src/capabilities/language-switcher/install.ts");
const { LanguageSwitcherModule } =
    await import("../../../src/capabilities/language-switcher/module.ts");
const { initDesktopPanel, destroyDesktopPanel } =
    await import("../../../src/kernel/ui/desktop/desktop-panel.ts");

describe("preset manifest wiring", () => {
    it("ships the language-switcher installer", () => {
        expect(FULL.capabilities).toContain(LANGUAGE_SWITCHER_INSTALLER);
    });

    it("est APPENDU après les capacités préexistantes", () => {
        // Same invariant as before: what matters is that no EARLIER index
        // moves, not being the very last entry (later work will append behind).
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
        // A seam nobody emits would leave every unit test green while the
        // button never appears.
        const glMain = document.createElement("div");
        glMain.className = "gl-main";
        document.body.appendChild(glMain);

        initDesktopPanel({ glMain });

        expect(received).toBeDefined();
        expect(received.tabs.classList.contains("gl-rp-tabs")).toBe(true);
        // The insertion point the capability depends on: the theme toggle is
        // present, and the language button goes right before it.
        expect(received.tabs.querySelector(".gl-rp-theme-toggle")).not.toBeNull();
    });
});
