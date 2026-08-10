/**
 * Unit tests — S2 Lot 6 installer: permalink (+ its `share` sub-feature).
 *
 * Two peculiarities this lot introduces, both asserted here:
 *   - the capability owns NO module of its own (two boot hooks drive it) — the
 *     `createModule` it declares is SHARE's module ;
 *   - share's gate is a SUB-KEY of permalink's config (`modules.permalink.share.enabled`,
 *     opt-out), so the installer carries a `moduleGate` — the contract field added in
 *     this lot, evaluated by `evaluateGate()` with the same semantics as a declaration
 *     gate (registerPresetModules). A profile disabling permalink keeps its share module,
 *     exactly as the legacy boot block did.
 *
 * Loaded via ESM `await import()` — never `require(".ts")` (second, non-merged V8
 * instance under forks + tsx + V8 coverage). `share-qr` imports `qrcode-generator`
 * dynamically, so no module mock is needed here.
 */

import { describe, expect, it } from "vitest";

const permalink = await import("../../src/capabilities/permalink/install.ts");
const permalinkCap = await import("../../src/capabilities/permalink/permalink-capability.ts");
const permalinkConfig = await import("../../src/capabilities/permalink/config.ts");
const permalinkFacade = await import("../../src/api/geoleaf.permalink.ts");
const shareFacade = await import("../../src/api/geoleaf.share.ts");
const shareConfig = await import("../../src/capabilities/permalink/share/config.ts");
const shareMod = await import("../../src/capabilities/permalink/share/module.ts");
const { evaluateGate } = await import("../../src/kernel/api/capability-registry.ts");

const INSTALLER = permalink.PERMALINK_INSTALLER;

describe("permalink installer (capabilities/permalink/install)", () => {
    it("exposes its capability declaration", () => {
        expect(INSTALLER.declaration).toBe(permalinkCap.PERMALINK_CAPABILITY);
        expect(INSTALLER.declaration.id).toBe("permalink");
    });

    it("registerGlobals assigns GeoLeaf.Permalink (ex-globals.api) + GeoLeaf.Share (ex-globals.ui)", () => {
        const gl = { existing: 1 };
        INSTALLER.registerGlobals(gl);
        expect(gl.Permalink).toBe(permalinkFacade.Permalink);
        expect(gl.Share).toBe(shareFacade.Share);
        expect(gl.existing).toBe(1);
    });

    it("createModule returns SHARE's module — permalink itself owns none (two boot hooks)", () => {
        const m = INSTALLER.createModule();
        expect(m).toBeInstanceOf(shareMod.ShareModule);
        expect(m.id).toBe("share");
        expect(INSTALLER.createModule()).not.toBe(m);
    });

    it("carries the share mobile toolbar icon, gated on the sub-key", () => {
        const m = INSTALLER.createModule();
        expect(m.ui.mobileIcon.profileKey).toBe("modules.permalink.share.enabled");
        expect(m.ui.mobileIcon.action).toBe("share");
    });

    // Deterministic read-API coverage (both config readers fall back to their DEFAULTS
    // without a live Config) — replaces the incidental coverage globals.api/ui provided.
    it("config readers work without a live config", () => {
        expect(permalinkConfig.getPermalinkConfig()).toEqual({ enabled: true, mode: "hash" });
        expect(shareConfig.getShareConfig()).toEqual({ enabled: true });
    });
});

describe("permalink installer — moduleGate (share is a sub-feature)", () => {
    const gate = INSTALLER.moduleGate;

    it("gates the module on the share sub-key, not on the capability's own gate", () => {
        expect(gate).toEqual({
            configPath: "modules.permalink.share.enabled",
            enableWhenAbsent: true,
        });
        expect(permalinkCap.PERMALINK_CAPABILITY.gate.configPath).toBe("modules.permalink.enabled");
    });

    // Same three branches the legacy boot block had (`!== false` on a pre-merge config).
    it("is opt-out: absent key → enabled", () => {
        expect(evaluateGate(gate, { get: () => undefined })).toBe(true);
    });

    it("explicit false → disabled", () => {
        expect(evaluateGate(gate, { get: () => false })).toBe(false);
    });

    it("explicit true → enabled", () => {
        expect(evaluateGate(gate, { get: () => true })).toBe(true);
    });

    it("stays enabled when the permalink capability itself is disabled (legacy parity)", () => {
        const config = {
            get: (key) => (key === "modules.permalink.enabled" ? false : undefined),
        };
        expect(evaluateGate(gate, config)).toBe(true);
        expect(evaluateGate(permalinkCap.PERMALINK_CAPABILITY.gate, config)).toBe(false);
    });
});
