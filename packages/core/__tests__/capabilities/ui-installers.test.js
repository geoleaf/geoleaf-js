/**
 * Unit tests — S2 Lot 2 UI-simple capability installers.
 *
 * Covers the 5 homogeneous UI-control installers (branding, coordinates,
 * theme-toggle, scale, geolocation): declaration wiring (layer C), the
 * registerGlobals facade write moved out of globals.ui.ts's setupUI (layer B),
 * the createModule factory, and the read-API (isEnabled/getConfig) — deterministic
 * coverage replacing the fragile incidental boot coverage. Replaces the assertions
 * removed from globals/ui.test.js and modules/globals-ui.test.js.
 * (theme-selector deferred out of Lot 2 — its DOM-rendering needs a mount test.)
 */

import { describe, expect, it } from "vitest";

const branding = await import("../../src/capabilities/branding/install.ts");
const brandingCap = await import("../../src/capabilities/branding/branding-capability.ts");
const brandingMod = await import("../../src/capabilities/branding/module.ts");
const brandingFacade = await import("../../src/api/geoleaf.branding.ts");

const coordinates = await import("../../src/capabilities/coordinates/install.ts");
const coordinatesCap = await import("../../src/capabilities/coordinates/coordinates-capability.ts");
const coordinatesMod = await import("../../src/capabilities/coordinates/module.ts");
const coordinatesFacade = await import("../../src/api/geoleaf.coordinates.ts");

const themeToggle = await import("../../src/capabilities/theme-toggle/install.ts");
const themeToggleCap =
    await import("../../src/capabilities/theme-toggle/theme-toggle-capability.ts");
const themeToggleMod = await import("../../src/capabilities/theme-toggle/module.ts");
const themeToggleFacade = await import("../../src/api/geoleaf.theme-toggle.ts");

const scale = await import("../../src/capabilities/scale/install.ts");
const scaleCap = await import("../../src/capabilities/scale/scale-capability.ts");
const scaleMod = await import("../../src/capabilities/scale/module.ts");
const scaleFacade = await import("../../src/api/geoleaf.scale.ts");

const geolocation = await import("../../src/capabilities/geolocation/install.ts");
const geolocationCap = await import("../../src/capabilities/geolocation/geolocation-capability.ts");
const geolocationMod = await import("../../src/capabilities/geolocation/module.ts");
const geolocationFacade = await import("../../src/api/geoleaf.geolocation.ts");

// S2 Lot 8 — theme-selector, the last capability to migrate (its deterministic mount
// coverage now lives in __tests__/capabilities/theme-selector/mount.test.js).
const themeSelector = await import("../../src/capabilities/theme-selector/install.ts");
const themeSelectorCap =
    await import("../../src/capabilities/theme-selector/theme-selector-capability.ts");
const themeSelectorMod = await import("../../src/capabilities/theme-selector/module.ts");
const themeSelectorFacade = await import("../../src/capabilities/theme-selector/theme-selector.ts");

const cases = [
    {
        id: "branding",
        key: "Branding",
        installer: branding.BRANDING_INSTALLER,
        declaration: brandingCap.BRANDING_CAPABILITY,
        Module: brandingMod.BrandingModule,
        facade: brandingFacade.Branding,
        readApi: true,
    },
    {
        id: "coordinates",
        key: "Coordinates",
        installer: coordinates.COORDINATES_INSTALLER,
        declaration: coordinatesCap.COORDINATES_CAPABILITY,
        Module: coordinatesMod.CoordinatesModule,
        facade: coordinatesFacade.Coordinates,
        readApi: true,
    },
    {
        id: "theme-toggle",
        key: "ThemeToggle",
        installer: themeToggle.THEME_TOGGLE_INSTALLER,
        declaration: themeToggleCap.THEME_TOGGLE_CAPABILITY,
        Module: themeToggleMod.ThemeToggleModule,
        facade: themeToggleFacade.ThemeToggle,
        readApi: true,
    },
    {
        id: "scale",
        key: "Scale",
        installer: scale.SCALE_INSTALLER,
        declaration: scaleCap.SCALE_CAPABILITY,
        Module: scaleMod.ScaleModule,
        facade: scaleFacade.Scale,
        readApi: true,
    },
    {
        id: "geolocation",
        key: "Geolocation",
        installer: geolocation.GEOLOCATION_INSTALLER,
        declaration: geolocationCap.GEOLOCATION_CAPABILITY,
        Module: geolocationMod.GeolocationModule,
        facade: geolocationFacade.Geolocation,
        readApi: true,
        hasState: true,
    },
    {
        id: "theme-selector",
        key: "ThemeSelector",
        installer: themeSelector.THEME_SELECTOR_INSTALLER,
        declaration: themeSelectorCap.THEME_SELECTOR_CAPABILITY,
        Module: themeSelectorMod.ThemeSelectorModule,
        facade: themeSelectorFacade.ThemeSelector,
        // No public-api.ts/config.ts on this capability: its facade IS the DOM bar, whose
        // read surface (isInitialized/getThemes/…) is covered by mount.test.js.
        readApi: false,
    },
];

describe.each(cases)("$id installer (capabilities/$id/install)", (c) => {
    it("exposes its capability declaration", () => {
        expect(c.installer.declaration).toBe(c.declaration);
        expect(c.installer.declaration.id).toBe(c.id);
    });

    it(`registerGlobals assigns GeoLeaf.${c.key} (ex-setupUI) and is additive`, () => {
        const gl = { existing: 1 };
        c.installer.registerGlobals(gl);
        expect(gl[c.key]).toBe(c.facade);
        expect(gl.existing).toBe(1);
    });

    it("createModule returns a fresh module instance with the right id", () => {
        const m = c.installer.createModule();
        expect(m).toBeInstanceOf(c.Module);
        expect(m.id).toBe(c.id);
        expect(c.installer.createModule()).not.toBe(m);
    });

    // Deterministic read-API coverage (config/public-api). Without a live config,
    // getConfig() falls back to the capability's built-in DEFAULTS. This replaces the
    // fragile incidental coverage the read-API used to get from a full boot.
    if (c.readApi) {
        it(`facade read-API (isEnabled/getConfig${c.hasState ? "/getState" : ""}) works without a live config`, () => {
            expect(typeof c.facade.isEnabled()).toBe("boolean");
            expect(c.facade.getConfig()).toBeTypeOf("object");
            if (c.hasState) {
                expect(c.facade.getState()).toBeTypeOf("object");
            }
        });
    }
});
