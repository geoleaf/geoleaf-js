/**
 * Unit tests — Events public facade (GeoLeaf.events)
 */

import { Events } from "../../src/api/geoleaf.events.js";

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("GeoLeaf.events facade", () => {
    // EV-01: on() registers listener; handler receives CustomEvent with typed detail
    it("EV-01: on() registers a listener that receives the dispatched event detail", () => {
        const received = [];
        const handler = (e) => received.push(e.detail);

        Events.on("geoleaf:poi:click", handler);

        document.dispatchEvent(
            new CustomEvent("geoleaf:poi:click", {
                detail: { poiId: "abc", layerId: "layer-0", source: "direct" },
            })
        );

        Events.off("geoleaf:poi:click", handler);

        expect(received).toHaveLength(1);
        expect(received[0].poiId).toBe("abc");
        expect(received[0].source).toBe("direct");
    });

    // EV-02: off() removes the listener — no further calls after removal
    it("EV-02: off() removes the listener so subsequent events are not received", () => {
        const calls = [];
        const handler = (e) => calls.push(e.detail);

        Events.on("geoleaf:filter:apply", handler);
        Events.off("geoleaf:filter:apply", handler);

        document.dispatchEvent(
            new CustomEvent("geoleaf:filter:apply", {
                detail: { layerIds: ["l1"], activeCount: 3 },
            })
        );

        expect(calls).toHaveLength(0);
    });

    // EV-03: once() fires exactly once then removes itself
    it("EV-03: once() fires exactly once; subsequent events are ignored", () => {
        const calls = [];
        const handler = (e) => calls.push(e.detail);

        Events.once("geoleaf:layer:toggle", handler);

        const payload = { layerId: "lyr", visible: true, source: "user" };
        document.dispatchEvent(new CustomEvent("geoleaf:layer:toggle", { detail: payload }));
        document.dispatchEvent(new CustomEvent("geoleaf:layer:toggle", { detail: payload }));

        expect(calls).toHaveLength(1);
    });
});
