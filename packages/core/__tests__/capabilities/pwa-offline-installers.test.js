/**
 * Unit tests — S2 Lot 7 installers: pwa + offline (both WITHOUT a createModule).
 *
 * These two are app-global capabilities whose lifecycles are driven by `shared.module`
 * (#7 pwa → #8 offline, untouched by this lot), so their installers carry declaration +
 * registerGlobals only — the `cluster` shape.
 *
 * Two invariants this file locks down:
 *   - **offline must NOT pull the engine eagerly.** The ~9 000-LOC engine is reached only
 *     through the DECLARATION's dynamic `loader` (CapabilityRegistry.ensureLoaded). The
 *     installer's own `loader` field has no consumer → it must stay undefined, and this
 *     file must never statically import `offline-engine-entry`.
 *   - **`geoleaf.sync.ts` self-mounts `GeoLeaf.Sync` at import.** Before this lot its only
 *     static importer in the full bundle was `globals.api.ts`; the offline installer now
 *     carries that edge, so the self-mount stays in the closure (a data plugin registers
 *     its sync handler at its own eval, before boot completes).
 *
 * Loaded via ESM `await import()` — never `require(".ts")`.
 */

import { describe, expect, it } from "vitest";

const pwa = await import("../../src/capabilities/pwa/install.ts");
const pwaCap = await import("../../src/capabilities/pwa/pwa-capability.ts");
const pwaFacade = await import("../../src/api/geoleaf.pwa.ts");

const offline = await import("../../src/capabilities/offline/install.ts");
const offlineCap = await import("../../src/capabilities/offline/offline-capability.ts");
const syncFacade = await import("../../src/api/geoleaf.sync.ts");

const { evaluateGate } = await import("../../src/kernel/api/capability-registry.ts");

const cases = [
    {
        id: "pwa",
        key: "PWA",
        installer: pwa.PWA_INSTALLER,
        declaration: pwaCap.PWA_CAPABILITY,
        facade: pwaFacade.PWA,
    },
    {
        id: "offline",
        key: "Sync",
        installer: offline.OFFLINE_INSTALLER,
        declaration: offlineCap.OFFLINE_CAPABILITY,
        facade: syncFacade.Sync,
    },
];

describe.each(cases)("$id installer (capabilities/$id/install)", (c) => {
    it("exposes its capability declaration", () => {
        expect(c.installer.declaration).toBe(c.declaration);
        expect(c.installer.declaration.id).toBe(c.id);
    });

    it(`registerGlobals assigns GeoLeaf.${c.key} (ex-assignApiFacades) and is additive`, () => {
        const gl = { existing: 1 };
        c.installer.registerGlobals(gl);
        expect(gl[c.key]).toBe(c.facade);
        expect(gl.existing).toBe(1);
    });

    it("declares no createModule (lifecycle driven by shared.module, not the registry)", () => {
        expect(c.installer.createModule).toBeUndefined();
    });

    // Both are opt-in (enableWhenAbsent: false) — an absent key leaves them OFF.
    it("gate is opt-in: absent → disabled, false → disabled, true → enabled", () => {
        const gate = c.declaration.gate;
        expect(gate.enableWhenAbsent).toBe(false);
        expect(evaluateGate(gate, { get: () => undefined })).toBe(false);
        expect(evaluateGate(gate, { get: () => false })).toBe(false);
        expect(evaluateGate(gate, { get: () => true })).toBe(true);
    });
});

describe("offline installer — the engine stays off the boot path", () => {
    it("declares no installer-level loader (the declaration owns the dynamic one)", () => {
        expect(offline.OFFLINE_INSTALLER.loader).toBeUndefined();
        expect(typeof offlineCap.OFFLINE_CAPABILITY.loader).toBe("function");
    });

    it("declares its pwa dependency as introspection metadata", () => {
        expect(offlineCap.OFFLINE_CAPABILITY.dependencies).toContain("pwa");
    });
});

describe("offline installer — GeoLeaf.Sync seam", () => {
    it("self-mounts on the global namespace at import (pre-boot plugin registration)", () => {
        expect(globalThis.GeoLeaf?.Sync).toBeDefined();
        expect(typeof globalThis.GeoLeaf.Sync.registerHandler).toBe("function");
    });

    it("registerGlobals re-assigns the same singleton (idempotent)", () => {
        const gl = {};
        offline.OFFLINE_INSTALLER.registerGlobals(gl);
        offline.OFFLINE_INSTALLER.registerGlobals(gl);
        expect(gl.Sync).toBe(globalThis.GeoLeaf.Sync);
    });

    it("round-trips a sync handler through the seam", () => {
        const handler = { replay: () => {} };
        syncFacade.Sync.registerHandler("test-lot7", handler);
        expect(syncFacade.Sync.getHandler("test-lot7")).toBe(handler);
        expect(syncFacade.Sync.getHandlers()).toContain(handler);
    });
});
