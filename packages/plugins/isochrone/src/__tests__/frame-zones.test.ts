/**
 * @geoleaf-plugins/isochrone — computed zones are framed when they are not readable.
 *
 * « Zones ajoutées : 3 » and a map that showed only the marker: 5 to 15 minutes on foot make a
 * few pixels at the scale the map opens at.
 */
import { describe, expect, it, vi } from "vitest";
import { frameZonesIfUnreadable } from "../frame-zones.js";
import type { IsochroneGeometry } from "../model.js";

const square = (w: number, s: number, e: number, n: number): IsochroneGeometry =>
    ({
        type: "Polygon",
        coordinates: [
            [
                [w, s],
                [e, s],
                [e, n],
                [w, n],
                [w, s],
            ],
        ],
    }) as IsochroneGeometry;

const view = { west: 0, south: 0, east: 10, north: 10 };

describe("frameZonesIfUnreadable", () => {
    it("frames zones that are a speck in the view", () => {
        const fitBounds = vi.fn();
        expect(
            frameZonesIfUnreadable({ getBounds: () => view, fitBounds }, [square(5, 5, 5.2, 5.2)])
        ).toBe(true);
        expect(fitBounds).toHaveBeenCalledWith(
            { west: 5, south: 5, east: 5.2, north: 5.2 },
            expect.anything()
        );
    });

    it("frames zones that leave the view", () => {
        const fitBounds = vi.fn();
        expect(
            frameZonesIfUnreadable({ getBounds: () => view, fitBounds }, [square(8, 8, 12, 12)])
        ).toBe(true);
    });

    it("leaves readable zones alone", () => {
        const fitBounds = vi.fn();
        expect(
            frameZonesIfUnreadable({ getBounds: () => view, fitBounds }, [square(2, 2, 6, 6)])
        ).toBe(false);
        expect(fitBounds).not.toHaveBeenCalled();
    });

    it("spans every zone, MultiPolygon included", () => {
        const multi = {
            type: "MultiPolygon",
            coordinates: [
                [
                    [
                        [1, 1],
                        [2, 1],
                        [2, 2],
                        [1, 1],
                    ],
                ],
                [
                    [
                        [7, 7],
                        [8, 7],
                        [8, 8],
                        [7, 7],
                    ],
                ],
            ],
        } as unknown as IsochroneGeometry;
        const fitBounds = vi.fn();
        frameZonesIfUnreadable({ fitBounds }, [multi]);
        expect(fitBounds.mock.calls[0]![0]).toEqual({ west: 1, south: 1, east: 8, north: 8 });
    });

    it("does nothing on an adapter without fitBounds", () => {
        expect(frameZonesIfUnreadable({}, [square(5, 5, 5.2, 5.2)])).toBe(false);
    });
});

describe("frameZonesIfUnreadable — what covers the map", () => {
    const rect = (l: number, t: number, w: number, h: number) =>
        ({
            left: l,
            top: t,
            right: l + w,
            bottom: t + h,
            width: w,
            height: h,
            x: l,
            y: t,
        }) as DOMRect;

    /** A 1440 × 900 map, the isochrone window floating at its left, x 60 → 380. */
    function stage(): HTMLElement {
        document.body.innerHTML = "";
        const container = document.createElement("div");
        container.getBoundingClientRect = () => rect(0, 0, 1440, 900);
        const panel = document.createElement("section");
        panel.className = "gl-isochrone__panel";
        panel.getBoundingClientRect = () => rect(60, 80, 320, 500);
        panel.getClientRects = () => [rect(60, 80, 320, 500)] as unknown as DOMRectList;
        document.body.append(container, panel);
        return container;
    }

    /** Longitude 0..10 onto x 0..1440, latitude 10..0 onto y 0..900. */
    const latLngToPoint = ({ lat, lng }: { lat: number; lng: number }) => ({
        x: (lng / 10) * 1440,
        y: ((10 - lat) / 10) * 900,
    });

    it("pads the left edge by the window that covers it", () => {
        const container = stage();
        const fitBounds = vi.fn();
        // Zones out of the view's east edge: framed.
        frameZonesIfUnreadable(
            { getBounds: () => view, getContainer: () => container, latLngToPoint, fitBounds },
            [square(1, 4, 12, 6)]
        );
        const padding = fitBounds.mock.calls[0]![1].padding as { left: number; right: number };
        expect(padding.left).toBeGreaterThanOrEqual(380);
        expect(padding.right).toBeLessThan(100);
    });

    it("frames zones that are in the view but under the window", () => {
        const container = stage();
        const fitBounds = vi.fn();
        // x 144 → 432 on screen: inside the canvas, mostly under the window.
        expect(
            frameZonesIfUnreadable(
                { getBounds: () => view, getContainer: () => container, latLngToPoint, fitBounds },
                [square(1, 3, 3, 7)]
            )
        ).toBe(true);
    });

    it("leaves zones alone in the uncovered part of the map", () => {
        const container = stage();
        const fitBounds = vi.fn();
        expect(
            frameZonesIfUnreadable(
                { getBounds: () => view, getContainer: () => container, latLngToPoint, fitBounds },
                [square(5, 3, 8, 7)]
            )
        ).toBe(false);
        expect(fitBounds).not.toHaveBeenCalled();
    });
});
