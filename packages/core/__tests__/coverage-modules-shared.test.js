/**
 * Campagne de tests unitaires — modules shared (storage-contract, constants)
 */

import { StorageContract } from "../src/kernel/shared/storage-contract.js";
import { CONSTANTS } from "../src/utils/constants/constants.js";

describe("Coverage — StorageContract", () => {
    it("isAvailable returns false when not initialized", () => {
        expect(StorageContract.isAvailable()).toBe(false);
    });
    it("DB getter returns null when not initialized", () => {
        expect(StorageContract.DB).toBeNull();
    });
    it("init then isAvailable returns true when storage has isAvailable", () => {
        StorageContract.init({ isAvailable: () => true });
        expect(StorageContract.isAvailable()).toBe(true);
        StorageContract.init(null);
    });
    it("init then DB returns storage.DB", () => {
        const db = {};
        StorageContract.init({ DB: db });
        expect(StorageContract.DB).toBe(db);
        StorageContract.init(null);
    });
});

describe("Coverage — CONSTANTS", () => {
    it("CONSTANTS is defined and has keys", () => {
        expect(CONSTANTS).toBeDefined();
        expect(typeof CONSTANTS).toBe("object");
        expect(Object.keys(CONSTANTS).length).toBeGreaterThan(0);
    });
});
