/**
 * @geoleaf-plugins/routing — the entry point from a POI
 *
 * Exercised through the real listener and a dispatched event, not through the helper it calls.
 * What has to be right is the ORDER — filter, close the surface, hand over — and a test that
 * calls the helper alone proves none of it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let _cfg: Record<string, unknown> = {};
vi.mock("@geoleaf/host-runtime", () => ({ coreConfigGet: () => _cfg }));

const { wireEntryPoint, actionId } = await import("../entry-point.js");
const ACTION_ID = actionId();

let unwire: (() => void) | null = null;
let seen: unknown[] = [];
let closed = 0;

/**
 * Dispatches one action event.
 *
 * @param over Fields overriding the defaults.
 */
function fire(over: Record<string, unknown> = {}): void {
    document.dispatchEvent(
        new CustomEvent("geoleaf:popup:action", {
            detail: {
                actionId: ACTION_ID,
                layerId: "poi",
                featureId: 42,
                properties: { name: "Piton des Neiges" },
                lngLat: { lng: 55.4781, lat: -21.0964 },
                close: () => {
                    closed += 1;
                },
                ...over,
            },
        })
    );
}

beforeEach(() => {
    _cfg = {};
    seen = [];
    closed = 0;
    unwire = wireEntryPoint((d) => seen.push(d));
});

afterEach(() => {
    unwire?.();
});

describe("filtering", () => {
    it("acts on its own actionId", () => {
        fire();
        expect(seen).toHaveLength(1);
    });

    it("IGNORES another plugin's actionId, and does not close its surface", () => {
        // 🛑 The surface belongs to whoever's button it is. Closing it here would make a click on
        // an unrelated button dismiss the popup, and the plugin that owns it would never know why.
        fire({ actionId: "tickets:create-request" });
        expect(seen).toHaveLength(0);
        expect(closed).toBe(0);
    });
});

describe("what it builds", () => {
    it("takes the POI as the DESTINATION, with its label", () => {
        fire();
        expect(seen[0]).toEqual({
            coordinates: [55.4781, -21.0964],
            name: "Piton des Neiges",
        });
    });

    it("reads the label from the CONFIGURED property, not a guess", () => {
        // Guessing "the first string property" would name a destination after a status code.
        _cfg = { labelField: "libelle" };
        fire({ properties: { name: "wrong", libelle: "Cilaos" } });
        expect((seen[0] as { name?: string }).name).toBe("Cilaos");
    });

    it("carries NO name when `payloadFields` left the properties empty", () => {
        // ⚠️ This is the shape a profile that forgot `payloadFields` produces: the whitelist is
        // strict and its default goes to confidentiality, so `properties` arrives as `{}`.
        // The destination is still usable — it just has no label, which is what the step list
        // renders as coordinates.
        fire({ properties: {} });
        expect(seen[0]).toEqual({ coordinates: [55.4781, -21.0964] });
    });

    it("refuses an event with no position rather than routing to [0, 0]", () => {
        // [0, 0] is the Gulf of Guinea: a real place, so the route would SUCCEED and take the
        // user to the middle of the Atlantic.
        fire({ lngLat: undefined });
        expect(seen).toHaveLength(0);
    });
});

describe("the surface it closes, and when", () => {
    it("closes the surface the button was in", () => {
        fire();
        expect(closed).toBe(1);
    });

    it("closes BEFORE handing over", () => {
        // The panel that opens next takes focus; closing a popup after something else has
        // claimed focus returns it to nowhere.
        const order: string[] = [];
        unwire?.();
        unwire = wireEntryPoint(() => order.push("handed-over"));
        document.dispatchEvent(
            new CustomEvent("geoleaf:popup:action", {
                detail: {
                    actionId: ACTION_ID,
                    properties: {},
                    lngLat: { lng: 55, lat: -21 },
                    close: () => order.push("closed"),
                },
            })
        );
        expect(order).toEqual(["closed", "handed-over"]);
    });

    it("survives an event whose detail carries no `close`", () => {
        fire({ close: undefined });
        expect(seen).toHaveLength(1);
    });
});

describe("unsubscribing", () => {
    it("stops listening", () => {
        unwire?.();
        unwire = null;
        fire();
        expect(seen).toHaveLength(0);
    });
});
