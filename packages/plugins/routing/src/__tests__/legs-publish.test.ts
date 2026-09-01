/**
 * @geoleaf-plugins/routing — per-leg summaries, and geometry publication
 *
 * Both run against the captured corpus rather than against a hand-built route: the pairing and
 * the feature shapes are only worth anything if they hold on what a real engine answers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const _cfg: Record<string, unknown> = {};
vi.mock("@geoleaf/host-runtime", () => ({
    coreConfigGet: () => _cfg,
    // `provider.ts` warns before refusing a provider without a legal notice.
    Log: { warn: () => {}, error: () => {}, info: () => {} },
    // `publish.ts` mounts the attribution in the map container; no map here.
    getNativeMap: () => undefined,
}));

const { legSummaries, stepNumber } = await import("../legs.js");
const { routeFeatures, publishRoute, clearRoute, DEFAULT_LAYER_ID } = await import("../publish.js");
const { normalizeOsrm } = await import("../normalize-osrm.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const OSRM = normalizeOsrm(
    JSON.parse(
        fs.readFileSync(path.resolve(here, "../../fixtures/osrm-reunion-3-waypoints.json"), "utf8")
    )
)!;

describe("legSummaries — the pairing that keeps the off-by-one out of the panel", () => {
    it("returns one summary per leg", () => {
        expect(legSummaries(OSRM)).toHaveLength(OSRM.legs.length);
    });

    it("pairs leg i with waypoints i and i+1", () => {
        const s = legSummaries(OSRM);
        expect(s[0].from).toEqual(OSRM.waypoints[0]);
        expect(s[0].to).toEqual(OSRM.waypoints[1]);
        expect(s[1].from).toEqual(OSRM.waypoints[1]);
        expect(s[1].to).toEqual(OSRM.waypoints[2]);
    });

    it("uses the SNAPPED waypoints, the ones the route actually runs between", () => {
        // A destination clicked in the middle of a block routes from the nearest road. Pairing
        // against the asked-for points would put the leg between two places the route never
        // touched — and the distance would look wrong for a reason nobody could find.
        const s = legSummaries(OSRM);
        for (const leg of s) {
            expect(OSRM.waypoints).toContain(leg.from);
            expect(OSRM.waypoints).toContain(leg.to);
        }
    });

    it("accumulates, so a caller does not have to hold state across rows", () => {
        const s = legSummaries(OSRM);
        expect(s[0].distanceFromStart).toBeCloseTo(s[0].distance, 6);
        expect(s[1].distanceFromStart).toBeCloseTo(s[0].distance + s[1].distance, 6);
        // And the last cumulative value is the route total — the same invariant the corpus pins.
        expect(s[s.length - 1].distanceFromStart).toBeCloseTo(OSRM.distance, 6);
    });

    it("stops rather than emitting a summary with an undefined endpoint", () => {
        // A provider answering more legs than waypoint pairs is malformed. Emitting a half-built
        // summary would move the defect into the panel, where it reads as a routing error.
        const broken = { ...OSRM, waypoints: OSRM.waypoints.slice(0, 1) };
        expect(legSummaries(broken)).toHaveLength(0);
    });

    it("numbers steps from 1, derived from the position", () => {
        expect([0, 1, 2].map(stepNumber)).toEqual([1, 2, 3]);
    });
});

describe("routeFeatures — one layer, roles on the features", () => {
    it("emits the line FIRST, then one point per waypoint", () => {
        const f = routeFeatures(OSRM);
        expect(f[0].geometry.type).toBe("LineString");
        expect(f).toHaveLength(1 + OSRM.waypoints.length);
        for (const p of f.slice(1)) expect(p.geometry.type).toBe("Point");
    });

    it("tells the features apart by `role`, not by layer", () => {
        // A sub-layer per role doubles the MapLibre sources per itinerary, which is the state
        // the `route` capability replaced. One layer, roles on the properties.
        const roles = routeFeatures(OSRM).map((f) => f.properties?.role);
        expect(roles).toEqual(["route", "origin", "via", "destination"]);
    });

    it("carries the index on every waypoint, so a style can label the stops", () => {
        // Feature order is not something a MapLibre style expression can read.
        const pts = routeFeatures(OSRM).slice(1);
        expect(pts.map((f) => f.properties?.index)).toEqual([0, 1, 2]);
        expect(pts.map((f) => f.properties?.step)).toEqual([1, 2, 3]);
    });

    it("carries the totals on the line, so a popup needs no second lookup", () => {
        const line = routeFeatures(OSRM)[0];
        expect(line.properties?.distance).toBe(OSRM.distance);
        expect(line.properties?.provider).toBe("osrm");
    });

    it("emits NO line when the geometry decodes to fewer than two points", () => {
        const f = routeFeatures({ ...OSRM, geometry: "" });
        expect(f.every((x) => x.geometry.type === "Point")).toBe(true);
    });
});

describe("publishRoute — the plugin does not draw, and says so when it cannot publish", () => {
    let setData: ReturnType<typeof vi.fn>;
    let clear: ReturnType<typeof vi.fn>;

    /**
     * Installs a fake layer store.
     *
     * @param known Layer ids the store knows.
     */
    function withStore(known: string[]): void {
        setData = vi.fn();
        clear = vi.fn();
        (globalThis as Record<string, unknown>).GeoLeaf = {
            Layers: { hasLayer: (id: string) => known.includes(id), setData, clear },
        };
    }

    beforeEach(() => {
        delete (globalThis as Record<string, unknown>).GeoLeaf;
    });

    it("writes the features to the configured layer", () => {
        withStore([DEFAULT_LAYER_ID]);
        const res = publishRoute(OSRM);
        expect(res).toEqual({ ok: true, layerId: DEFAULT_LAYER_ID, features: 4 });
        expect(setData).toHaveBeenCalledWith(DEFAULT_LAYER_ID, routeFeatures(OSRM));
    });

    it("REFUSES when the profile declares no such layer, and names it", () => {
        // 🛑 `setData` on an unknown id is not an error the store reports: it simply has nowhere
        // to put the features. An integrator would then see a plugin that computes a route, says
        // nothing and draws nothing, with no way to tell which of the three steps failed.
        withStore(["some-other-layer"]);
        expect(publishRoute(OSRM)).toEqual({
            ok: false,
            reason: "no-such-layer",
            layerId: DEFAULT_LAYER_ID,
        });
        expect(setData).not.toHaveBeenCalled();
    });

    it("refuses when there is no host at all", () => {
        expect(publishRoute(OSRM)).toEqual({
            ok: false,
            reason: "no-layer-store",
            layerId: DEFAULT_LAYER_ID,
        });
    });

    it("empties through `clear`, and refuses on the same two grounds", () => {
        withStore([DEFAULT_LAYER_ID]);
        expect(clearRoute()).toEqual({ ok: true, layerId: DEFAULT_LAYER_ID, features: 0 });
        expect(clear).toHaveBeenCalledWith(DEFAULT_LAYER_ID);

        withStore(["elsewhere"]);
        expect(clearRoute().ok).toBe(false);
    });

    it("creates no MapLibre source and adds no layer — it only ever calls the seam", () => {
        // The whole point of D7: a second rendering pipeline alongside the core's is the debt
        // this replaced. The store fake exposes exactly three methods, and the plugin uses them.
        withStore([DEFAULT_LAYER_ID]);
        publishRoute(OSRM);
        const layers = (globalThis as { GeoLeaf?: { Layers?: object } }).GeoLeaf?.Layers ?? {};
        expect(Object.keys(layers).sort()).toEqual(["clear", "hasLayer", "setData"]);
    });
});
