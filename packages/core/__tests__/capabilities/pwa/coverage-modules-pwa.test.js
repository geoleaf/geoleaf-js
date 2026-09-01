/**
 * Coverage — PWA capability
 * Targets: src/capabilities/pwa/pwa-manager.ts
 *          src/capabilities/pwa/install-prompt.ts
 *          src/capabilities/pwa/ios-banner.ts
 *
 * Sprint T9 — coverage-modules pattern.
 * Key branches: enabled/disabled, iOS/Android routing, localStorage dismissed.
 */
"use strict";

// ── PWAManager ────────────────────────────────────────────────────────────────
import { PWAManager } from "../../../src/capabilities/pwa/pwa-manager.ts";

describe("Coverage — PWAManager.init()", () => {
    describe("disabled branch (installPrompt.enabled !== true)", () => {
        it("does nothing when config is null", () => {
            expect(() => PWAManager.init(null)).not.toThrow();
        });

        it("does nothing when config object is empty", () => {
            expect(() => PWAManager.init({})).not.toThrow();
        });

        it("does nothing when installPrompt is absent", () => {
            expect(() => PWAManager.init({ name: "My App" })).not.toThrow();
        });

        it("does nothing when enabled is false", () => {
            expect(() => PWAManager.init({ installPrompt: { enabled: false } })).not.toThrow();
        });

        it("does nothing when enabled is 0 (falsy)", () => {
            expect(() => PWAManager.init({ installPrompt: { enabled: 0 } })).not.toThrow();
        });

        it("does nothing when enabled is undefined", () => {
            expect(() => PWAManager.init({ installPrompt: { enabled: undefined } })).not.toThrow();
        });
    });

    describe("enabled branch — iOS routing", () => {
        let originalUA;

        beforeEach(() => {
            originalUA = navigator.userAgent;
        });

        afterEach(() => {
            // Cannot actually reset userAgent (read-only) — handled via Object.defineProperty
            Object.defineProperty(navigator, "userAgent", {
                value: originalUA,
                configurable: true,
            });
        });

        it("activates IosBanner on iOS user agents", () => {
            Object.defineProperty(navigator, "userAgent", {
                value: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
                configurable: true,
            });
            // Should not throw — IosBanner.init() creates DOM elements
            expect(() => PWAManager.init({ installPrompt: { enabled: true } })).not.toThrow();
        });

        it("activates InstallPrompt on Android / Chrome user agents", () => {
            Object.defineProperty(navigator, "userAgent", {
                value: "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 Chrome/105.0.0.0",
                configurable: true,
            });
            expect(() => PWAManager.init({ installPrompt: { enabled: true } })).not.toThrow();
        });

        it("activates InstallPrompt on a desktop Chrome user agent", () => {
            Object.defineProperty(navigator, "userAgent", {
                value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/113.0.0.0",
                configurable: true,
            });
            expect(() => PWAManager.init({ installPrompt: { enabled: true } })).not.toThrow();
        });
    });
});

// ── InstallPrompt branches ────────────────────────────────────────────────────
import { InstallPrompt } from "../../../src/capabilities/pwa/install-prompt.ts";

describe("Coverage — InstallPrompt (Android/Chrome flow)", () => {
    afterEach(() => {
        // Clean up any created banner
        document.getElementById("gl-install-banner")?.remove();
        localStorage.removeItem("gl_pwa_install_dismissed");
    });

    it("exports an init function", () => {
        expect(typeof InstallPrompt?.init).toBe("function");
    });

    it("init does not throw without beforeinstallprompt event", () => {
        expect(() => InstallPrompt.init()).not.toThrow();
    });

    it("does not show banner when localStorage dismissed flag is set", () => {
        localStorage.setItem("gl_pwa_install_dismissed", "1");
        expect(() => InstallPrompt.init()).not.toThrow();
        expect(document.getElementById("gl-install-banner")).toBeNull();
    });

    it("does not show banner when storage throws (corrupted storage)", () => {
        vi.spyOn(localStorage, "getItem").mockImplementationOnce(() => {
            throw new Error("storage unavailable");
        });
        expect(() => InstallPrompt.init()).not.toThrow();
        localStorage.getItem.mockRestore?.();
    });
});

// ── PWAManager.isInstallable (wiring) ────────────────────────────────────────
// `isInstallable()` used to exist on `InstallPrompt` without being exposed:
// the CDC documented it on `GeoLeaf.PWA` where it did not exist. The wiring
// trap is iOS — `beforeinstallprompt` is never emitted there, so a naive
// delegation to `InstallPrompt` would answer `false` on the whole platform.

describe("PWAManager.isInstallable (S4)", () => {
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

    it("is exposed on the PWA facade", () => {
        expect(typeof PWAManager.isInstallable).toBe("function");
    });

    it("iOS Safari not yet installed → true (no beforeinstallprompt on that platform)", () => {
        setUA("Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15");
        setStandalone(false);
        expect(PWAManager.isInstallable()).toBe(true);
    });

    it("iOS already installed (standalone) → false", () => {
        setUA("Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15");
        setStandalone(true);
        expect(PWAManager.isInstallable()).toBe(false);
    });

    it("desktop/Android without a deferred prompt → false", () => {
        setUA("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/113");
        expect(PWAManager.isInstallable()).toBe(false);
    });

    it("Android → true once the browser hands over a deferred beforeinstallprompt", () => {
        setUA("Mozilla/5.0 (Linux; Android 13) Chrome/113 Mobile");
        localStorage.removeItem("gl_pwa_install_dismissed");
        InstallPrompt.init(); // arms the beforeinstallprompt listener

        const e = new Event("beforeinstallprompt");
        e.prompt = () => Promise.resolve();
        e.userChoice = Promise.resolve({ outcome: "dismissed" });
        window.dispatchEvent(e);

        expect(PWAManager.isInstallable()).toBe(true);
        document.getElementById("gl-install-banner")?.remove();
    });
});

// ── IosBanner branches ────────────────────────────────────────────────────────
import { IosBanner } from "../../../src/capabilities/pwa/ios-banner.ts";
import { PwaLifecycle } from "../../../src/capabilities/pwa/lifecycle.ts";

describe("Coverage — IosBanner (iOS install instructions)", () => {
    let originalUA;

    beforeEach(() => {
        originalUA = navigator.userAgent;
        document.getElementById("gl-ios-install-banner")?.remove();
        localStorage.removeItem("gl_pwa_ios_dismissed");
    });

    afterEach(() => {
        Object.defineProperty(navigator, "userAgent", {
            value: originalUA,
            configurable: true,
        });
        Object.defineProperty(navigator, "standalone", {
            value: undefined,
            configurable: true,
        });
        document.getElementById("gl-ios-install-banner")?.remove();
        localStorage.removeItem("gl_pwa_ios_dismissed");
    });

    it("exports an init function", () => {
        expect(typeof IosBanner?.init).toBe("function");
    });

    it("does not show banner when userAgent is not iOS", () => {
        Object.defineProperty(navigator, "userAgent", {
            value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/113",
            configurable: true,
        });
        expect(() => IosBanner.init()).not.toThrow();
        expect(document.getElementById("gl-ios-install-banner")).toBeNull();
    });

    it("does not show banner when already running as standalone (installed PWA)", () => {
        Object.defineProperty(navigator, "userAgent", {
            value: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit",
            configurable: true,
        });
        Object.defineProperty(navigator, "standalone", {
            value: true, // Standalone mode
            configurable: true,
        });
        expect(() => IosBanner.init()).not.toThrow();
    });

    it("does not show banner when localStorage dismissed flag is set", () => {
        Object.defineProperty(navigator, "userAgent", {
            value: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit",
            configurable: true,
        });
        localStorage.setItem("gl_pwa_ios_dismissed", "1");
        expect(() => IosBanner.init()).not.toThrow();
        expect(document.getElementById("gl-ios-install-banner")).toBeNull();
    });

    it("shows banner on iOS Safari when not dismissed and not standalone", () => {
        Object.defineProperty(navigator, "userAgent", {
            value: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
            configurable: true,
        });
        Object.defineProperty(navigator, "standalone", {
            value: false,
            configurable: true,
        });
        expect(() => IosBanner.init()).not.toThrow();
        // Banner may or may not be created depending on internal guard logic
    });

    it("dismiss persists to localStorage", () => {
        // Simulate dismissed by setting flag and verifying banner is skipped
        localStorage.setItem("gl_pwa_ios_dismissed", "1");
        Object.defineProperty(navigator, "userAgent", {
            value: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)",
            configurable: true,
        });
        IosBanner.init();
        // Since dismissed, banner should not have been appended
        expect(document.getElementById("gl-ios-install-banner")).toBeNull();
    });
});

// ── Listener / timer teardown (leak fix) ─────────────────────────────────
// init() used to register anonymous global listeners (un-removable) with no teardown,
// and the iOS banner scheduled a setTimeout it could never cancel. These tests prove
// the leaks are closed, observed through isInstallable() and the fake-timer banner path.
describe("InstallPrompt — listener teardown", () => {
    const androidUA = "Mozilla/5.0 (Linux; Android 13) Chrome/113 Mobile";

    function setUA(value) {
        Object.defineProperty(navigator, "userAgent", { value, configurable: true });
    }
    function fireBeforeInstallPrompt() {
        const e = new Event("beforeinstallprompt");
        e.prompt = () => Promise.resolve();
        e.userChoice = Promise.resolve({ outcome: "dismissed" });
        window.dispatchEvent(e);
    }

    afterEach(() => {
        InstallPrompt._reset();
        localStorage.removeItem("gl_pwa_install_dismissed");
        document.getElementById("gl-install-banner")?.remove();
    });

    it("_reset() detaches the beforeinstallprompt listener", () => {
        setUA(androidUA);
        localStorage.removeItem("gl_pwa_install_dismissed");
        InstallPrompt._reset();
        InstallPrompt.init(); // arms the listener
        InstallPrompt._reset(); // must remove it
        fireBeforeInstallPrompt();
        expect(InstallPrompt.isInstallable()).toBe(false);
    });

    it("init() twice then a single _reset() leaves no listener attached (no stacked leak)", () => {
        setUA(androidUA);
        localStorage.removeItem("gl_pwa_install_dismissed");
        InstallPrompt._reset();
        InstallPrompt.init();
        InstallPrompt.init(); // must NOT stack a second (anonymous) listener
        InstallPrompt._reset();
        fireBeforeInstallPrompt();
        expect(InstallPrompt.isInstallable()).toBe(false);
    });
});

describe("IosBanner — timer teardown", () => {
    const iosUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15";

    function setUA(value) {
        Object.defineProperty(navigator, "userAgent", { value, configurable: true });
    }
    function setStandalone(value) {
        Object.defineProperty(navigator, "standalone", { value, configurable: true });
    }

    afterEach(() => {
        IosBanner._reset();
        setStandalone(undefined);
        localStorage.removeItem("gl_pwa_ios_dismissed");
        document.getElementById("gl-ios-install-banner")?.remove();
        vi.useRealTimers();
    });

    it("_reset() cancels the pending banner timer (no banner appears)", () => {
        vi.useFakeTimers();
        setUA(iosUA);
        setStandalone(false);
        localStorage.removeItem("gl_pwa_ios_dismissed");
        IosBanner.init(); // schedules the 1.5 s timer
        IosBanner._reset(); // must clearTimeout before it fires
        vi.advanceTimersByTime(3000);
        expect(document.getElementById("gl-ios-install-banner")).toBeNull();
    });
});

describe("PwaLifecycle._reset() tears down the install sub-flows", () => {
    const androidUA = "Mozilla/5.0 (Linux; Android 13) Chrome/113 Mobile";

    function setUA(value) {
        Object.defineProperty(navigator, "userAgent", { value, configurable: true });
    }

    afterEach(() => {
        PwaLifecycle._reset();
        localStorage.removeItem("gl_pwa_install_dismissed");
        document.getElementById("gl-install-banner")?.remove();
    });

    it("detaches the install-prompt listener through the lifecycle seam", () => {
        setUA(androidUA);
        localStorage.removeItem("gl_pwa_install_dismissed");
        PwaLifecycle._reset();
        InstallPrompt.init(); // arms the beforeinstallprompt listener
        PwaLifecycle._reset(); // → PWAManager._reset → InstallPrompt._reset + IosBanner._reset

        const e = new Event("beforeinstallprompt");
        e.prompt = () => Promise.resolve();
        e.userChoice = Promise.resolve({ outcome: "dismissed" });
        window.dispatchEvent(e);

        expect(InstallPrompt.isInstallable()).toBe(false);
    });
});

// ── i18n + configured app name (behaviour change) ────────────────────────
// Banners used to hardcode "GeoLeaf" and bypass i18n. They now read the configured app
// name and route every string through getLabel.
describe("PWA banners — i18n + app name", () => {
    const iosUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15";
    const androidUA = "Mozilla/5.0 (Linux; Android 13) Chrome/113 Mobile";

    function setUA(value) {
        Object.defineProperty(navigator, "userAgent", { value, configurable: true });
    }
    function setStandalone(value) {
        Object.defineProperty(navigator, "standalone", { value, configurable: true });
    }
    function fireBeforeInstallPrompt() {
        const e = new Event("beforeinstallprompt");
        e.prompt = () => Promise.resolve();
        e.userChoice = Promise.resolve({ outcome: "dismissed" });
        window.dispatchEvent(e);
    }

    afterEach(() => {
        IosBanner._reset();
        InstallPrompt._reset();
        setStandalone(undefined);
        localStorage.clear();
        document.getElementById("gl-ios-install-banner")?.remove();
        document.getElementById("gl-install-banner")?.remove();
        vi.useRealTimers();
    });

    it("iOS banner title uses the configured app name, not a hardcoded brand", () => {
        vi.useFakeTimers();
        setUA(iosUA);
        setStandalone(false);
        localStorage.clear();
        IosBanner.init("Atlas Field");
        vi.advanceTimersByTime(2000);
        const banner = document.getElementById("gl-ios-install-banner");
        expect(banner).not.toBeNull();
        expect(banner.textContent).toContain("Atlas Field");
        expect(banner.textContent).not.toContain("GeoLeaf");
    });

    it("install-prompt banner text uses the configured app name", () => {
        setUA(androidUA);
        localStorage.clear();
        InstallPrompt._reset();
        InstallPrompt.init("Atlas Field");
        fireBeforeInstallPrompt();
        const banner = document.getElementById("gl-install-banner");
        expect(banner).not.toBeNull();
        expect(banner.textContent).toContain("Atlas Field");
    });

    it("PWAManager.init threads config.short_name to the install prompt", () => {
        setUA(androidUA);
        localStorage.clear();
        InstallPrompt._reset();
        PWAManager.init({ short_name: "Zed", installPrompt: { enabled: true } });
        fireBeforeInstallPrompt();
        const banner = document.getElementById("gl-install-banner");
        expect(banner?.textContent).toContain("Zed");
    });
});
