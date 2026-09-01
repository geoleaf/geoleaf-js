/**
 * @file b60-notifications-mounted.test.js
 * @description Non-regression test — `GeoLeaf.UI.Notifications` and the six
 * `UI.show*` shortcuts are REALLY mounted after the boot.
 *
 * Why this test exists (29/07/2026)
 * ------------------------------------------
 * These seven members were **declared in `global.d.ts`** — hence visible to
 * any integrator compiling against the published types — **taught in two npm
 * tarball documents**, and **never mounted**. The code building them
 * nonetheless existed, complete, in `kernel/ui/ui-api.ts`: it lived behind
 * an `if (_g.GeoLeaf._UINotifications)` evaluated at **module body**, while
 * `_UINotifications`'s only writer is `toast-renderer`'s installer, called
 * **at boot**. The condition was therefore always false.
 *
 * ⚠️ **What made the defect invisible for so long is the NEIGHBOURING
 * block.** `ui-api.ts` carried the same trap on the theme methods — and that
 * one had been caught in `globals.ui.ts`, with a comment precisely
 * diagnosing the mechanism. `UI.applyTheme` therefore worked, which left
 * nothing to suspect about the twin still dead twelve lines below.
 *
 * ## What this test verifies, and why in this order
 *
 *  1. the starting state (nothing mounted) — without it, a test passing on a
 *     namespace already populated by another file would prove nothing;
 *  2. the mounting AFTER `setupUIKernel()`, **without a `_UINotifications`
 *     writer** — the case that tells a real mounting from a mere re-exposure
 *     of the capability: delegation is lazy, so the members must exist even
 *     when the capability is absent from the build, and degrade to no-op
 *     rather than throw;
 *  3. the effective delegation when the capability is there.
 *
 * Point 2 is the heart: it is what failed, and what a future refactor would break.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { setupUIKernel } from "../../src/globals/globals.ui.js";

describe("les 7 membres de notification existent après le boot", () => {
    beforeEach(() => {
        globalThis.GeoLeaf = { UI: {} };
    });

    it("ne les monte PAS avant setupUIKernel (état de départ)", () => {
        expect(globalThis.GeoLeaf.UI.Notifications).toBeUndefined();
    });

    it("les monte tous après setupUIKernel, MÊME sans écrivain de _UINotifications", () => {
        setupUIKernel();
        const ui = globalThis.GeoLeaf.UI;
        for (const k of [
            "Notifications",
            "showNotification",
            "showSuccess",
            "showError",
            "showWarning",
            "showInfo",
            "clearNotifications",
        ]) {
            expect(ui[k], `GeoLeaf.UI.${k} absent`).toBeDefined();
        }
        // Lazy delegation: without the capability, the call degrades to no-op instead of throwing.
        expect(() => ui.showInfo("x")).not.toThrow();
        expect(ui.showInfo("x")).toBeUndefined();
    });

    it("délègue réellement quand la capacité est là", () => {
        setupUIKernel();
        const seen = [];
        globalThis.GeoLeaf._UINotifications = {
            info: (m) => {
                seen.push(m);
                return "ok";
            },
        };
        expect(globalThis.GeoLeaf.UI.showInfo("hello")).toBe("ok");
        expect(seen).toEqual(["hello"]);
    });
});
