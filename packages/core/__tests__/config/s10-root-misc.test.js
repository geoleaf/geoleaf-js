/**
 * Config-contract Phase C / C1 — B1 root family: pwa.installPrompt.
 *
 *   - pwa.installPrompt.enabled → pwa/pwa-manager.ts (opt-in gate)
 *
 * Note: `branding.*` moved out of the B1 root family — reclassified to the in-core
 * `branding` capability (`modules.branding.*`, B7). Its coverage now lives in
 * `__tests__/capabilities/branding/` (extraction roadmap contrôles carte).
 *
 * Consumers: pwa/pwa-manager.ts. Inventory B1.
 */

// pwa-manager delegates to these — mock to assert the routing/gate only.
vi.mock("../../src/capabilities/pwa/install-prompt.js", () => ({
    InstallPrompt: { init: vi.fn() },
}));
vi.mock("../../src/capabilities/pwa/ios-banner.js", () => ({
    IosBanner: { init: vi.fn() },
}));

import { PWAManager } from "../../src/capabilities/pwa/pwa-manager.js";
import { InstallPrompt } from "../../src/capabilities/pwa/install-prompt.js";
import { IosBanner } from "../../src/capabilities/pwa/ios-banner.js";

// ── pwa.installPrompt.enabled ────────────────────────────────────────────────
describe("config B1 — pwa.installPrompt.enabled (pwa/pwa-manager.ts)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("enabled:true (non-iOS) → InstallPrompt.init()", () => {
        vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120" });
        PWAManager.init({ installPrompt: { enabled: true } });
        expect(InstallPrompt.init).toHaveBeenCalledTimes(1);
        expect(IosBanner.init).not.toHaveBeenCalled();
    });

    it("enabled:true on iOS → IosBanner.init()", () => {
        vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)" });
        PWAManager.init({ installPrompt: { enabled: true } });
        expect(IosBanner.init).toHaveBeenCalledTimes(1);
        expect(InstallPrompt.init).not.toHaveBeenCalled();
    });

    it("enabled:false → opt-in gate closed, nothing initialised", () => {
        vi.stubGlobal("navigator", { userAgent: "Chrome" });
        PWAManager.init({ installPrompt: { enabled: false } });
        expect(InstallPrompt.init).not.toHaveBeenCalled();
        expect(IosBanner.init).not.toHaveBeenCalled();
    });

    it("installPrompt absent → nothing initialised", () => {
        vi.stubGlobal("navigator", { userAgent: "Chrome" });
        PWAManager.init({});
        expect(InstallPrompt.init).not.toHaveBeenCalled();
        expect(IosBanner.init).not.toHaveBeenCalled();
    });
});
