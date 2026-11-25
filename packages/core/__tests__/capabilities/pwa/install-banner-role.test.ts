/**
 * The Android install prompt is a complementary region, named — not the page's `banner`.
 *
 * `role="banner"` is the landmark of the PAGE header, unique by contract: the install prompt
 * declared itself as one, so a screen reader listed a second page header, the one of a toast-like
 * strip. The iOS sheet already declared `complementary` with a name; the two now agree.
 * Red on the code before the fix: `banner`.
 */
import { describe, it, expect, afterEach } from "vitest";
import { InstallPrompt } from "../../../src/capabilities/pwa/install-prompt.js";

afterEach(() => {
    InstallPrompt._reset();
    document.getElementById("gl-install-banner")?.remove();
    try {
        localStorage.removeItem("gl_pwa_install_dismissed");
    } catch {
        /* storage unavailable: nothing to clean */
    }
});

describe("bannière d'installation Android", () => {
    it("rôle complementary, nommée — pas le repère banner", () => {
        InstallPrompt.init("GeoLeaf");
        const event = new Event("beforeinstallprompt", { cancelable: true });
        Object.assign(event, { prompt: () => Promise.resolve(), userChoice: Promise.resolve() });
        dispatchEvent(event);

        const banner = document.getElementById("gl-install-banner");
        expect(banner).not.toBeNull();
        expect(banner?.getAttribute("role")).toBe("complementary");
        expect(banner?.getAttribute("aria-label")).toMatch(/GeoLeaf/);
    });
});
