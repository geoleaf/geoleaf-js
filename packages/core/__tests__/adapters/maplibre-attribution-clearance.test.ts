/**
 * @tests adapters/maplibre/maplibre-attribution-clearance — the lift reaches the map's HOST.
 *
 * The mobile toolbar is a SIBLING of the map container: a variable set on the container alone
 * never reached it, and its bottom chevron covered the scale bar the expanded credit had pushed up.
 */
import { describe, expect, it } from "vitest";
import { watchAttributionClearance } from "../../src/adapters/maplibre/maplibre-attribution-clearance.js";

const rect = (l: number, t: number, w: number, h: number) =>
    ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h, x: l, y: t }) as DOMRect;

describe("watchAttributionClearance", () => {
    it("sets --gl-attrib-clearance on the map container AND on its host", () => {
        const host = document.createElement("main");
        const container = document.createElement("div");
        host.append(container);
        document.body.append(host);
        const attrib = document.createElement("div");
        attrib.className = "maplibregl-ctrl-attrib";
        const corner = document.createElement("div");
        corner.className = "maplibregl-ctrl-bottom-left";
        container.append(attrib, corner);
        container.getBoundingClientRect = () => rect(0, 0, 412, 840);
        attrib.getBoundingClientRect = () => rect(10, 785, 392, 44);
        corner.getBoundingClientRect = () => rect(0, 760, 200, 60);

        const handlers: Record<string, () => void> = {};
        const map = {
            getContainer: () => container,
            on: (type: string, fn: () => void) => {
                handlers[type] = fn;
            },
            off: () => undefined,
        };
        watchAttributionClearance(map);
        handlers["load"]!();

        expect(container.style.getPropertyValue("--gl-attrib-clearance")).toBe("61px");
        expect(host.style.getPropertyValue("--gl-attrib-clearance")).toBe("61px");
        host.remove();
    });
});
