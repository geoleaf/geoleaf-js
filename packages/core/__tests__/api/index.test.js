/**
 * Phase 60 — Step 2.4: src/kernel/api/index.ts (0% → 60%)
 * Barrel export : APIController, APIFactoryManager, APIInitializationManager, APIModuleManager, PluginRegistry, BootInfo, showBootInfo
 */
import * as api from "../../src/kernel/api/index.js";

describe("api/index (step 2.4)", () => {
    it("exporte APIController, APIFactoryManager, APIInitializationManager, APIModuleManager", () => {
        expect(api.APIController).toBeDefined();
        expect(api.APIFactoryManager).toBeDefined();
        expect(api.APIInitializationManager).toBeDefined();
        expect(api.APIModuleManager).toBeDefined();
    });
    it("exporte PluginRegistry, BootInfo et showBootInfo", () => {
        expect(api.PluginRegistry).toBeDefined();
        expect(api.BootInfo).toBeDefined();
        expect(typeof api.showBootInfo).toBe("function");
    });
});
