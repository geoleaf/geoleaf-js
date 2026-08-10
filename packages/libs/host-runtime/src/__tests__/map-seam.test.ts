/*!
 * @geoleaf/host-runtime — map-seam tests
 * © 2026 Mattieu Pottier — MIT License
 *
 * Runs under the package default (`environment: "node"`): the seam only reads the
 * `GeoLeaf` namespace off `globalThis`.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { getNativeMap, warnNoCore } from "../map-seam.js";
import type { GeoLeafHost } from "../host.js";

const carrier = globalThis as { GeoLeaf?: GeoLeafHost };

/** Builds a namespace whose `Core.getMap().getNativeMap()` chain yields `native`. */
const mountMap = (native: unknown) => {
    carrier.GeoLeaf = {
        Core: { getMap: () => ({ getNativeMap: () => native }) },
    } as unknown as GeoLeafHost;
};

afterEach(() => {
    delete carrier.GeoLeaf;
    vi.restoreAllMocks();
});

describe("getNativeMap", () => {
    it("returns the handle the adapter exposes", () => {
        const handle = { project: () => undefined };
        mountMap(handle);
        expect(getNativeMap()).toBe(handle);
    });

    it("narrows to the caller's type argument without altering the value", () => {
        type Surface = { getContainer(): string };
        const handle: Surface = { getContainer: () => "#map" };
        mountMap(handle);
        const map = getNativeMap<Surface>();
        expect(map?.getContainer()).toBe("#map");
    });

    it("resolves the whole chain at CALL time — a map registered later is picked up", () => {
        expect(getNativeMap()).toBeNull();
        const handle = {};
        mountMap(handle);
        expect(getNativeMap()).toBe(handle);
    });

    const BROKEN_CHAINS: Array<[string, () => void]> = [
        ["the namespace is absent", () => undefined],
        ["Core is not mounted", () => void (carrier.GeoLeaf = {})],
        [
            "Core.getMap is missing",
            () => void (carrier.GeoLeaf = { Core: {} } as unknown as GeoLeafHost),
        ],
        [
            "no map is registered (getMap → null)",
            () =>
                void (carrier.GeoLeaf = {
                    Core: { getMap: () => null },
                } as unknown as GeoLeafHost),
        ],
        [
            "the adapter exposes no native handle",
            () =>
                void (carrier.GeoLeaf = {
                    Core: { getMap: () => ({}) },
                } as unknown as GeoLeafHost),
        ],
        ["getNativeMap yields undefined", () => mountMap(undefined)],
        ["getNativeMap yields null", () => mountMap(null)],
    ];

    it.each(BROKEN_CHAINS)("returns null when %s", (_why, setup) => {
        setup();
        expect(getNativeMap()).toBeNull();
    });
});

describe("warnNoCore", () => {
    it("returns true and warns when the core is absent", () => {
        const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        expect(warnNoCore("Measure", "startMeasure")).toBe(true);
        expect(spy).toHaveBeenCalledWith(
            "[GeoLeaf.Measure] startMeasure: GeoLeaf core not loaded."
        );
    });

    it("stamps the scope the caller passed — a shared module never signs for a plugin", () => {
        const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        warnNoCore("Print", "exportPdf");
        expect(spy).toHaveBeenCalledWith("[GeoLeaf.Print] exportPdf: GeoLeaf core not loaded.");
    });

    it("returns false and stays silent once the core is present", () => {
        const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        carrier.GeoLeaf = {};
        expect(warnNoCore("Measure", "startMeasure")).toBe(false);
        expect(spy).not.toHaveBeenCalled();
    });

    it("uses console, not the Log seam — the one case it reports is 'no core'", () => {
        // Routing this through `Log` would make it silent exactly when it matters, since
        // `Log` delegates to the core logger that is by definition absent here.
        const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        warnNoCore("Measure", "fn");
        expect(spy).toHaveBeenCalledTimes(1);
    });
});
