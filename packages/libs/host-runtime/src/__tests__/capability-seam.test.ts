/*!
 * @geoleaf/host-runtime — capability-seam tests
 * © 2026 Mattieu Pottier — MIT License
 *
 * The core's introspection is stood in for by the rows it returns. The case that matters most is
 * the one that hides nothing: before the boot, the list is empty, and a plugin must not read that
 * as "absent".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    capabilityAvailability,
    isCapabilityOn,
    warnCapabilityMissing,
} from "../capability-seam.js";
import { Log } from "../log-seam.js";

type Row = { id: string; embarked: boolean; enabled: boolean };
const carrier = globalThis as { GeoLeaf?: unknown };

function mount(rows: Row[] | undefined): void {
    carrier.GeoLeaf =
        rows === undefined ? {} : { Introspection: { getCapabilityStatus: () => rows } };
}

afterEach(() => {
    delete carrier.GeoLeaf;
    vi.restoreAllMocks();
});

describe("capabilityAvailability", () => {
    it("is unknown without an introspection, and before the boot declares anything", () => {
        mount(undefined);
        expect(capabilityAvailability("offline")).toBe("unknown");
        mount([]);
        expect(capabilityAvailability("offline")).toBe("unknown");
    });

    it("is absent when the core knows its capabilities and this one is not among them", () => {
        mount([{ id: "legend", embarked: true, enabled: true }]);
        expect(capabilityAvailability("offline")).toBe("absent");
    });

    it("tells on from off — the profile's verdict, dependencies included by the core", () => {
        mount([
            { id: "offline", embarked: true, enabled: false },
            { id: "geolocation", embarked: true, enabled: true },
        ]);
        expect(capabilityAvailability("offline")).toBe("off");
        expect(capabilityAvailability("geolocation")).toBe("on");
    });
});

describe("isCapabilityOn", () => {
    it("withholds only on a positive answer — unknown keeps the control", () => {
        mount([]);
        expect(isCapabilityOn("offline")).toBe(true);
        mount([{ id: "legend", embarked: true, enabled: true }]);
        expect(isCapabilityOn("offline")).toBe(false);
    });
});

describe("warnCapabilityMissing", () => {
    it("warns once per plugin and capability, naming why", () => {
        const warn = vi.spyOn(Log, "warn").mockImplementation(() => {});
        mount([{ id: "legend", embarked: true, enabled: true }]);
        warnCapabilityMissing("routing", "geolocation");
        warnCapabilityMissing("routing", "geolocation");
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]![0])).toMatch(/geolocation.*not in this bundle/);
    });
});
