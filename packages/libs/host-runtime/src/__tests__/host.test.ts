/*!
 * @geoleaf/host-runtime — tests
 * © 2026 Mattieu Pottier — MIT License
 */
import { describe, it, expect, afterEach } from "vitest";
import { getGeoLeaf, ensureGeoLeaf, type GeoLeafHost } from "../index.js";

type Carrier = { GeoLeaf?: GeoLeafHost };
const carrier = globalThis as Carrier;

/**
 * The suite runs under `environment: "node"`, so `window` is absent — which is what
 * leaves getGeoLeaf's second lookup unexercised. Installing a *distinct* carrier on
 * `globalThis.window` reaches it: `globalThis.GeoLeaf` stays unset, so the function
 * falls through to the window branch instead of short-circuiting on the first one.
 */
type WindowCarrier = { window?: Carrier };
const withWindow = (value: Carrier): void => {
    (globalThis as WindowCarrier).window = value;
};

afterEach(() => {
    delete carrier.GeoLeaf;
    delete (globalThis as WindowCarrier).window;
});

describe("getGeoLeaf", () => {
    it("returns undefined before the namespace is assembled", () => {
        expect(getGeoLeaf()).toBeUndefined();
    });

    it("returns the namespace once present on globalThis", () => {
        const ns: GeoLeafHost = { Config: { get: () => 42 } };
        carrier.GeoLeaf = ns;
        expect(getGeoLeaf()).toBe(ns);
    });

    it("falls back to window when globalThis carries no namespace", () => {
        const ns: GeoLeafHost = { UI: {} };
        withWindow({ GeoLeaf: ns });
        expect(carrier.GeoLeaf).toBeUndefined();
        expect(getGeoLeaf()).toBe(ns);
    });

    it("prefers globalThis over window when both carry a namespace", () => {
        const onGlobal: GeoLeafHost = { UI: {} };
        const onWindow: GeoLeafHost = { UI: {} };
        carrier.GeoLeaf = onGlobal;
        withWindow({ GeoLeaf: onWindow });
        expect(getGeoLeaf()).toBe(onGlobal);
    });

    it("returns undefined when window exists but carries no namespace", () => {
        withWindow({});
        expect(getGeoLeaf()).toBeUndefined();
    });
});

describe("ensureGeoLeaf", () => {
    it("creates an empty namespace when absent", () => {
        expect(carrier.GeoLeaf).toBeUndefined();
        const ns = ensureGeoLeaf();
        expect(ns).toEqual({});
        expect(carrier.GeoLeaf).toBe(ns);
    });

    it("is idempotent — returns the existing namespace", () => {
        const existing: GeoLeafHost = { UI: {} };
        carrier.GeoLeaf = existing;
        expect(ensureGeoLeaf()).toBe(existing);
    });

    it("lets a plugin mount its façade onto the tail", () => {
        const ns = ensureGeoLeaf();
        ns.Measure = { getPrintableAnnotations: () => [] };
        expect(getGeoLeaf()?.Measure).toBeDefined();
    });
});

// `coreConfigGet` lives in the same module but has its own suite — see core-config.test.ts.
