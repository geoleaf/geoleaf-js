/**
 * @geoleaf-plugins/isochrone — origin markers and data credit
 *
 * One marker per origin, gone with the last zone of that origin; one credit element, written as
 * text, gone with the last zone of all.
 */
import { describe, expect, it } from "vitest";

import { AttributionNote } from "../attribution.js";
import type { IsochroneLayer } from "../model.js";
import { OriginMarkers } from "../origin-markers.js";
import { createFakeMap } from "./fake-map.js";

/**
 * A zone with only what a test names set.
 *
 * @param id Its identifier.
 * @param extra Members to override.
 * @returns The zone.
 */
function zone(id: string, extra: Partial<IsochroneLayer> = {}): IsochroneLayer {
    return {
        id,
        origin: [55.45, -20.88],
        mode: "car",
        minutes: 10,
        color: "#3987e5",
        opacity: 0.25,
        visible: true,
        attribution: "© Test data",
        ...extra,
    };
}

describe("OriginMarkers", () => {
    it("puts one marker per origin, at that origin, longitude read first", () => {
        const map = createFakeMap();
        const markers = new OriginMarkers();
        markers.sync(map, [zone("a"), zone("b"), zone("c", { origin: [55.5, -21.1] })]);
        expect([...map.markers.values()].map((m) => [m.lng, m.lat])).toEqual([
            [55.45, -20.88],
            [55.5, -21.1],
        ]);
        // No I18n mounted here: the label resolves to its key.
        expect(map.markers.values().next().value?.options).toEqual({
            className: "gl-isochrone-origin",
            title: "isochrone.origin.label",
        });
    });

    it("keeps the marker while one zone of its origin remains, and takes it with the last", () => {
        const map = createFakeMap();
        const markers = new OriginMarkers();
        markers.sync(map, [zone("a"), zone("b")]);
        markers.sync(map, [zone("b")]);
        expect(map.markers.size).toBe(1);
        expect(map.calls.filter((c) => c === "createMarker")).toHaveLength(1);
        markers.sync(map, []);
        expect(map.markers.size).toBe(0);
    });

    it("forgets its markers when the map is already gone, and starts afresh on the next", () => {
        const markers = new OriginMarkers();
        markers.sync(createFakeMap(), [zone("a")]);
        markers.clear(null);
        const next = createFakeMap();
        markers.sync(next, [zone("a")]);
        expect(next.markers.size).toBe(1);
    });
});

describe("AttributionNote", () => {
    it("writes the credit in the map's container, as text", () => {
        const map = createFakeMap();
        const note = new AttributionNote();
        note.sync(map, [zone("a", { attribution: "<b>© OSM</b>" })]);
        const element = map.container.querySelector(".gl-isochrone-attribution");
        expect(element?.textContent).toBe("<b>© OSM</b>");
        expect(element?.children).toHaveLength(0);
    });

    it("shows each distinct credit once", () => {
        const map = createFakeMap();
        const note = new AttributionNote();
        note.sync(map, [zone("a"), zone("b", { attribution: "© Other" }), zone("c")]);
        expect(map.container.textContent).toBe("© Test data · © Other");
        expect(map.container.children).toHaveLength(1);
    });

    it("takes the credit away once no zone is left", () => {
        const map = createFakeMap();
        const note = new AttributionNote();
        note.sync(map, [zone("a")]);
        note.sync(map, []);
        expect(map.container.children).toHaveLength(0);
    });

    it("moves to the container of a new map", () => {
        const first = createFakeMap();
        const second = createFakeMap();
        const note = new AttributionNote();
        note.sync(first, [zone("a")]);
        note.sync(second, [zone("a")]);
        expect(first.container.children).toHaveLength(0);
        expect(second.container.children).toHaveLength(1);
    });
});
