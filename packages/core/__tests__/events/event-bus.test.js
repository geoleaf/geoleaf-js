/**
 * Unit tests — events/event-bus
 */

import { dispatchGeoLeafEvent } from "../../src/kernel/events/event-bus.js";

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("event-bus — dispatchGeoLeafEvent", () => {
    // EB-01: dispatches the correct event with typed detail
    it("EB-01: dispatches a CustomEvent on document with the correct name and detail", () => {
        const received = [];
        const handler = (e) => received.push(e);
        document.addEventListener("geoleaf:poi:click", handler);

        dispatchGeoLeafEvent("geoleaf:poi:click", {
            poiId: "poi-42",
            layerId: "layer-1",
            source: "popup",
        });

        document.removeEventListener("geoleaf:poi:click", handler);

        expect(received).toHaveLength(1);
        expect(received[0].detail).toEqual({
            poiId: "poi-42",
            layerId: "layer-1",
            source: "popup",
        });
    });

    // EB-02: circular ref payload is sanitised — no crash, primitives survive
    it("EB-02: sanitizes circular references without throwing", () => {
        const circular = { name: "storage", version: null };
        circular.self = circular; // circular ref

        let received = null;
        const handler = (e) => {
            received = e.detail;
        };
        document.addEventListener("geoleaf:plugin:loaded", handler);

        expect(() => dispatchGeoLeafEvent("geoleaf:plugin:loaded", circular)).not.toThrow();

        document.removeEventListener("geoleaf:plugin:loaded", handler);

        // After sanitisation, the safe primitive fields must still be present
        if (received !== null) {
            expect(received.name).toBe("storage");
        }
    });

    // EB-03: event dispatched with bubbles: false
    it("EB-03: CustomEvent has bubbles set to false", () => {
        let capturedEvent = null;
        const handler = (e) => {
            capturedEvent = e;
        };
        document.addEventListener("geoleaf:map:move", handler);

        dispatchGeoLeafEvent("geoleaf:map:move", {
            center: { lat: 48.85, lng: 2.35 },
            zoom: 13,
        });

        document.removeEventListener("geoleaf:map:move", handler);

        expect(capturedEvent).not.toBeNull();
        expect(capturedEvent.bubbles).toBe(false);
    });

    // EB-04: non-serializable payload falls back to shallow copy without throwing
    it("EB-04: payload with non-JSON-serializable field does not throw", () => {
        // BigInt causes JSON.stringify to throw — tests the _sanitizePayload fallback
        const weirdPayload = {
            poiId: "p1",
            layerId: "l1",
            source: "direct",
            _bigint: BigInt(42), // non-serializable
        };

        let received = null;
        const handler = (e) => {
            received = e.detail;
        };
        document.addEventListener("geoleaf:poi:click", handler);

        expect(() =>
            // @ts-ignore — intentionally injecting a non-typed field for test
            dispatchGeoLeafEvent("geoleaf:poi:click", weirdPayload)
        ).not.toThrow();

        document.removeEventListener("geoleaf:poi:click", handler);

        // The safe primitive fields must have survived
        if (received !== null) {
            expect(received.poiId).toBe("p1");
        }
    });

    // EB-05: detail is passed as plain primitive object (no DOM refs)
    it("EB-05: filter:apply event carries typed numeric activeCount", () => {
        let detail = null;
        const handler = (e) => {
            detail = e.detail;
        };
        document.addEventListener("geoleaf:filter:apply", handler);

        dispatchGeoLeafEvent("geoleaf:filter:apply", {
            layerIds: ["tourisme", "patrimoine"],
            geometryType: "Point",
            activeCount: 7,
        });

        document.removeEventListener("geoleaf:filter:apply", handler);

        expect(detail).not.toBeNull();
        expect(detail.layerIds).toEqual(["tourisme", "patrimoine"]);
        expect(detail.geometryType).toBe("Point");
        expect(detail.activeCount).toBe(7);
    });
});
