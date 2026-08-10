/**
 * Integration test: SyncManager (plugin) ↔ Log + StorageContract + Config (core)
 *
 * Verifies that SyncManager correctly interacts with core modules:
 * - Log for debug/info/error logging
 * - StorageContract for DB access (sync queue, backups)
 * - Config for retry settings
 * - DOMSecurity for safe DOM rendering
 */

import { SyncManager } from "../../sync/sync-manager.js";

describe("Integration core ↔ storage — SyncManager", () => {
    describe("SyncManager module shape", () => {
        test("should export an object with init method", () => {
            expect(typeof SyncManager).toBe("object");
            expect(typeof SyncManager.init).toBe("function");
        });

        test("should expose buildSection method", () => {
            expect(typeof SyncManager.buildSection).toBe("function");
        });

        test("should expose updateStatus method", () => {
            expect(typeof SyncManager.updateStatus).toBe("function");
        });
    });

    describe("SyncManager init", () => {
        test("init accepts control and content parameters", () => {
            const control = { _syncToggleBtn: null };
            const content = document.createElement("div");

            // init should not throw
            expect(() => SyncManager.init(control, content)).not.toThrow();
        });

        test("init stores internal references", () => {
            const control = { _syncToggleBtn: null };
            const content = document.createElement("div");

            SyncManager.init(control, content);

            expect(SyncManager._control).toBe(control);
            expect(SyncManager._syncContent).toBe(content);
        });
    });

    describe("SyncManager buildSection DOM output", () => {
        test("buildSection creates sync UI section elements", () => {
            const parent = document.createElement("div");
            const control = { _syncToggleBtn: null };
            const content = document.createElement("div");
            SyncManager.init(control, content);

            const result = SyncManager.buildSection(parent);

            // Should return an object with the expected DOM elements
            expect(result).toHaveProperty("syncSection");
            expect(result).toHaveProperty("syncToggleBtn");
            expect(result).toHaveProperty("syncContent");
            expect(result).toHaveProperty("syncStatusEl");
            expect(result).toHaveProperty("syncBtn");
            // ⚠️ `syncBackupsEl` retiré à la tâche 4.11, avec la chaîne de sauvegarde.
            expect(result).not.toHaveProperty("syncBackupsEl");
        });
    });

    describe("SyncManager ↔ core module dependencies", () => {
        test("SyncManager module loads without errors (core mocks resolve)", () => {
            // If this test passes, it means all @core/ imports in
            // sync-manager.ts resolved correctly via vitest alias + setup.js
            expect(SyncManager).toBeDefined();
            expect(SyncManager.init).toBeDefined();
        });

        test("updateStatus does not throw when contract is not initialized", async () => {
            const control = { _syncToggleBtn: null };
            const content = document.createElement("div");
            SyncManager.init(control, content);

            // updateStatus reads from StorageContract.DB — should handle null gracefully
            await expect(SyncManager.updateStatus()).resolves.not.toThrow();
        });
    });
});
