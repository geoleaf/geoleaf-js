/**
 * Unit tests — `kernel-exports.ts` (kernel surface barrel, at 0%).
 *
 * A re-export file (facades + utilities) + one evaluated:
 * `Utils = createUtilsNamespace()`. Importing it covers the lines; what is
 * verified is that the announced surface is really exposed.
 */
import { describe, test, expect } from "vitest";

import * as kx from "../src/kernel-exports.js";

describe("kernel-exports — surface publique", () => {
    test("expose les façades haut niveau", () => {
        for (const name of ["Core", "GeoLeafAPI", "UI", "LayerManager", "Events", "Config"]) {
            expect(kx[name], name).toBeTruthy();
        }
    });

    test("GeoLeafAPI EST le namespace vivant, pas un objet quelconque", () => {
        // ⚠️ `toBeTruthy()` above says almost nothing about `GeoLeafAPI`:
        // `{}` is truthy. That was without consequence while
        // `kernel/api/geoleaf-api.ts` assembled the API; since it only
        // re-exports the namespace, the IDENTITY carries the contract — what
        // is re-exported must be the global object itself, so anything
        // another module mounts on it later is visible here.
        expect(kx.GeoLeafAPI).toBe(globalThis.GeoLeaf);
    });

    test("expose les utilitaires (Log, Errors, CONSTANTS, Utils, applyCssText)", () => {
        expect(kx.Log).toBeTruthy();
        expect(kx.Errors).toBeTruthy();
        expect(kx.CONSTANTS).toBeTruthy();
        expect(kx.Utils).toBeTruthy();
        expect(typeof kx.applyCssText).toBe("function");
    });

    test("expose les sous-modules API du registre", () => {
        expect(kx.PluginRegistry).toBeTruthy();
        expect(typeof kx.showBootInfo).toBe("function");
    });

    // Public API review — `CapabilityRegistry` was exported by the
    // `kernel/api/index.ts` barrel and reachable by NO public channel:
    // neither here, nor on the global. A plugin could only declare a
    // capability through `GeoLeaf.plugins.registerCapability(decl)`,
    // untyped. The test bears on the `ICapabilityRegistry` contract's
    // methods, not the object's mere presence: the announced surface must be
    // there, not an empty symbol.
    //
    // ⚠️ 6 → 8 (`noteInstaller` + `getAllStatuses`). The count is in the
    // test's NAME because the loop is additive: it would have stayed green
    // describing a stale surface. No gate can see that — it is the "up to
    // you" line of the documentation rule, and why the number is written
    // here rather than derived.
    test("expose CapabilityRegistry avec les 8 méthodes de ICapabilityRegistry", () => {
        expect(kx.CapabilityRegistry).toBeTruthy();
        const methods = [
            "register",
            "isEnabled",
            "isLoaded",
            "ensureLoaded",
            "getSchema",
            "getAllSchemas",
            "noteInstaller",
            "getAllStatuses",
        ];
        // The count is asserted, not only the names: that is what makes the
        // list above falsifiable if the contract grows without this test knowing.
        expect(methods).toHaveLength(8);
        for (const method of methods) {
            expect(typeof kx.CapabilityRegistry[method], method).toBe("function");
        }
    });
});
