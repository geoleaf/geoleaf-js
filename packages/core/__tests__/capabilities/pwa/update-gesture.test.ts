/**
 * `GeoLeaf.PWA.isUpdateWaiting()` and `GeoLeaf.PWA.applyUpdate()` — the public half of an
 * update that waits.
 *
 * The facts live in `kernel/storage/sw-register.ts`, and are tested there
 * (`storage/sw-update-waiting.test.ts`). What is pinned here is that the facade PUBLISHES
 * them: `SWRegister` is on no namespace, and a host has no other way to ask the question or
 * to answer it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { PWA } from "../../../src/capabilities/pwa/public-api.js";
import { SWRegister } from "../../../src/kernel/storage/index.js";

afterEach(() => {
    vi.restoreAllMocks();
});

describe("GeoLeaf.PWA — the update that waits", () => {
    it("🛑 isUpdateWaiting() answers what the registration knows", () => {
        const waiting = vi.spyOn(SWRegister, "isUpdateWaiting");
        waiting.mockReturnValue(true);
        expect(PWA.isUpdateWaiting()).toBe(true);
        waiting.mockReturnValue(false);
        expect(PWA.isUpdateWaiting()).toBe(false);
    });

    it("🛑 applyUpdate() makes the gesture, and says whether there was one to make", () => {
        const apply = vi.spyOn(SWRegister, "applyUpdate").mockReturnValue(true);
        expect(PWA.applyUpdate()).toBe(true);
        expect(apply).toHaveBeenCalledTimes(1);
        apply.mockReturnValue(false);
        expect(PWA.applyUpdate()).toBe(false);
    });

    it("both are quiet no-ops on a page that registered no worker", () => {
        expect(PWA.isUpdateWaiting()).toBe(false);
        expect(PWA.applyUpdate()).toBe(false);
    });
});
