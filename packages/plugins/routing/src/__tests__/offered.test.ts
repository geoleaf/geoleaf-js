/**
 * @geoleaf-plugins/routing — whether the plugin is offered at all.
 *
 * Read by the kernel at render (slot and pane). Two refusals were measured: `enabled: false`
 * switched nothing off, and a profile without the route layer offered a route it could not draw.
 */
import { afterEach, describe, expect, it } from "vitest";
import { isRoutingOffered } from "../offered.js";

const g = globalThis as { GeoLeaf?: unknown };

/** Plants a core whose config answers `values` and whose active profile declares `layers`. */
function plant(values: Record<string, unknown>, layers?: { id: string }[]) {
    g.GeoLeaf = {
        Config: {
            get: (k: string, d?: unknown) => (k in values ? values[k] : d),
            getActiveProfile: () => (layers ? { layers } : null),
        },
    };
}

afterEach(() => {
    delete g.GeoLeaf;
});

describe("isRoutingOffered", () => {
    it("withholds routing when the profile switches it off", () => {
        plant({ "modules.routing.enabled": false }, [{ id: "routing-route" }]);
        expect(isRoutingOffered()).toBe(false);
    });

    it("withholds routing when the profile does not declare the route layer", () => {
        plant({}, [{ id: "sites" }]);
        expect(isRoutingOffered()).toBe(false);
    });

    it("offers routing when the layer is declared — the configured one, not only the default", () => {
        plant({}, [{ id: "routing-route" }]);
        expect(isRoutingOffered()).toBe(true);
        plant({ "modules.routing": { layerId: "my-route" } }, [{ id: "my-route" }]);
        expect(isRoutingOffered()).toBe(true);
    });

    it("offers routing while no declared list can be read — unknown is not absent", () => {
        plant({});
        expect(isRoutingOffered()).toBe(true);
    });
});
