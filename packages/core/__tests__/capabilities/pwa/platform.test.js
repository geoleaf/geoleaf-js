/**
 * Tests for modules/utils/general/platform — shared iOS / UA detection (S7.2).
 *
 * The iOS sniff used to be duplicated (bare regex in pwa-manager, UA + standalone in
 * ios-banner). It now lives here once; these tests pin both helpers so the two PWA
 * call sites cannot drift.
 */
import { describe, it, expect, afterEach } from "vitest";
import { isIOS, isIOSInstallable } from "../../../src/capabilities/pwa/platform.js";

const realUA = navigator.userAgent;

function setUA(value) {
    Object.defineProperty(navigator, "userAgent", { value, configurable: true });
}
function setStandalone(value) {
    Object.defineProperty(navigator, "standalone", { value, configurable: true });
}

afterEach(() => {
    setUA(realUA);
    setStandalone(undefined);
});

describe("isIOS()", () => {
    it("is true for iPhone / iPad / iPod user agents", () => {
        setUA("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari");
        expect(isIOS()).toBe(true);
        setUA("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari");
        expect(isIOS()).toBe(true);
        setUA("Mozilla/5.0 (iPod touch; CPU iPhone OS 17_0 like Mac OS X) Safari");
        expect(isIOS()).toBe(true);
    });

    it("is false for a desktop / Android user agent", () => {
        setUA("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome");
        expect(isIOS()).toBe(false);
        setUA("Mozilla/5.0 (Linux; Android 14) Chrome");
        expect(isIOS()).toBe(false);
    });
});

describe("isIOSInstallable()", () => {
    it("is true on iOS Safari that is not already installed", () => {
        setUA("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari");
        setStandalone(false);
        expect(isIOSInstallable()).toBe(true);
    });

    it("is false when already running as an installed PWA (standalone)", () => {
        setUA("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari");
        setStandalone(true);
        expect(isIOSInstallable()).toBe(false);
    });

    it("is false on a non-iOS platform regardless of standalone", () => {
        setUA("Mozilla/5.0 (Linux; Android 14) Chrome");
        setStandalone(false);
        expect(isIOSInstallable()).toBe(false);
    });
});
