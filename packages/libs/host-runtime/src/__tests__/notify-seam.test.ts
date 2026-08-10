/*!
 * @geoleaf/host-runtime — notify-seam tests
 * © 2026 Mattieu Pottier — MIT License
 *
 * Runs under the package default (`environment: "node"`): the seam only reads
 * `globalThis`, it never touches the DOM.
 */
import { describe, it, expect, afterEach } from "vitest";
import { getUINotifications, type UINotificationsSeam } from "../notify-seam.js";

type Carrier = { GeoLeaf?: { _UINotifications?: UINotificationsSeam } };
const carrier = globalThis as Carrier;

/** Minimal renderer standing in for the `toast-renderer` capability. */
const stubSeam = (): UINotificationsSeam => ({
    show: () => null,
    success: () => null,
    error: () => null,
    warning: () => null,
    info: () => null,
    dismiss: () => undefined,
    clearAll: () => undefined,
});

afterEach(() => {
    delete carrier.GeoLeaf;
});

describe("getUINotifications", () => {
    it("returns undefined when the namespace is absent", () => {
        expect(getUINotifications()).toBeUndefined();
    });

    it("returns undefined when the toast-renderer capability is disabled", () => {
        carrier.GeoLeaf = {};
        expect(getUINotifications()).toBeUndefined();
    });

    it("returns the live renderer once the capability mounted it", () => {
        const seam = stubSeam();
        carrier.GeoLeaf = { _UINotifications: seam };
        expect(getUINotifications()).toBe(seam);
    });

    it("resolves at call time, not at import time", () => {
        expect(getUINotifications()).toBeUndefined();
        const seam = stubSeam();
        carrier.GeoLeaf = { _UINotifications: seam };
        expect(getUINotifications()).toBe(seam);
    });

    it("lets callers optional-chain into a silent no-op when absent", () => {
        expect(() => getUINotifications()?.success("hello")).not.toThrow();
    });
});
