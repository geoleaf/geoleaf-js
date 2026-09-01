/**
 * Integration tests — profile-switcher wiring (capability S1).
 *
 * Checks the three joins a unit test cannot see:
 *   - the installer is actually carried by the shipped preset manifest;
 *   - the installer's shape (declaration / globals / module) matches the contract;
 *   - the REAL layer-manager control emits the panel seam, so the capability has
 *     something to subscribe to (a seam nobody emits would leave every unit test green
 *     while the feature never appears).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { FULL } = await import("../../../src/presets/manifest.full.ts");
const { PROFILE_SWITCHER_INSTALLER } =
    await import("../../../src/capabilities/profile-switcher/install.ts");
const { ProfileSwitcherModule } =
    await import("../../../src/capabilities/profile-switcher/module.ts");
const { LMControl } = await import("../../../src/kernel/layer-manager/control.ts");

describe("preset manifest wiring", () => {
    it("ships the profile-switcher installer", () => {
        expect(FULL.capabilities).toContain(PROFILE_SWITCHER_INSTALLER);
    });

    it("est APPENDU après les capacités préexistantes — l'ordre est observable", () => {
        // Registration order is observable through introspection, and the golden master
        // asserts on it. The invariant is NOT "profile-switcher is the very last entry"
        // — a later sprint appends its own capability behind it, and S2
        // (language-switcher) did exactly that. The invariant is "it was appended, so no
        // PRIOR index moved". `vector-tiles` was the last pre-existing capability when
        // S1 landed.
        const ids = FULL.capabilities.map((c) => c.declaration.id);
        expect(ids.indexOf("profile-switcher")).toBeGreaterThan(ids.indexOf("vector-tiles"));
    });

    it("exposes exactly one declaration id, matching the capability", () => {
        expect(PROFILE_SWITCHER_INSTALLER.declaration.id).toBe("profile-switcher");
    });

    it("mounts GeoLeaf.ProfileSwitcher through registerGlobals", () => {
        const gl = {};
        PROFILE_SWITCHER_INSTALLER.registerGlobals(gl);
        expect(gl.ProfileSwitcher).toBeDefined();
        expect(typeof gl.ProfileSwitcher.list).toBe("function");
        expect(typeof gl.ProfileSwitcher.switchTo).toBe("function");
        expect(typeof gl.ProfileSwitcher.current).toBe("function");
        expect(typeof gl.ProfileSwitcher.isEnabled).toBe("function");
        expect(typeof gl.ProfileSwitcher.getConfig).toBe("function");
    });

    it("builds a module declaring the geojson dependency", () => {
        const mod = PROFILE_SWITCHER_INSTALLER.createModule();
        expect(mod).toBeInstanceOf(ProfileSwitcherModule);
        expect(mod.id).toBe("profile-switcher");
        // Ordering matters: init() must run before the panel seam can first fire.
        expect(mod.dependencies).toContain("geojson");
    });
});

describe("the kernel really emits the panel seam", () => {
    let received;
    const capture = (e) => {
        received = e.detail;
    };

    beforeEach(() => {
        document.body.innerHTML = "";
        received = undefined;
        document.addEventListener("geoleaf:layer-manager:panel", capture);
    });

    afterEach(() => {
        document.removeEventListener("geoleaf:layer-manager:panel", capture);
    });

    it("dispatches geoleaf:layer-manager:panel when the control is added", () => {
        const control = LMControl.create({ title: "Couches", sections: [] });
        control.addTo({ addControl: (el) => ({ remove: () => el.remove() }) });

        expect(received).toBeDefined();
        expect(received.container.classList.contains("gl-layer-manager")).toBe(true);
        expect(received.headerWrapper.classList.contains("gl-layer-manager__header-wrapper")).toBe(
            true
        );
        // The contract the capability relies on: header wrapper is a child of main
        // wrapper, so inserting after it lands outside the body that gets emptied.
        expect(received.headerWrapper.parentElement).toBe(received.mainWrapper);
    });
});
