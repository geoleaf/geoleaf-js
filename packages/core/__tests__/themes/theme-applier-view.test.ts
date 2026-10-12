/**
 * Activating a theme that declares a view moves the camera to it — before its layers load.
 *
 * ## What this file pins
 *
 * The theme applier never touched the camera: switching theme changed what was shown, never
 * where. A theme may now declare `view`, and applying it frames the map on that view —
 *
 * - WITHOUT animation and BEFORE the layers: a layer loaded by extent then asks for the area
 *   the theme frames, once. An animated move would have it ask for the area being left first;
 * - with the profile's padding, read off the configuration at that moment;
 * - not at all for a theme that declares no view, which leaves the camera where it is;
 * - not at all under `keepView`, which the boot and the permalink pass: the first starts the
 *   map on the view itself, the second restores a view of its own.
 *
 * Seen RED: the framing cases on an applier that did not frame, and the `keepView` case on an
 * applier that framed regardless.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ThemeViewDeclaration } from "../../src/kernel/config/view-extent.js";

const mocks = vi.hoisted(() => ({
    /** The order the camera and the layers were touched in. */
    order: [] as string[],
    map: null as { fitBounds: ReturnType<typeof vi.fn>; setView: ReturnType<typeof vi.fn> } | null,
    padding: undefined as unknown,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/utils/log/index.js", () => ({ Log: mocks.log }));
vi.mock("../../src/api/geoleaf.core.js", () => ({ Core: { getMap: () => mocks.map } }));
vi.mock("../../src/kernel/config/config-primitives.js", () => ({
    Config: {
        get: (path: string) => (path === "map.padding" ? mocks.padding : undefined),
        Profile: { getActiveProfileConfig: () => ({ performance: {} }) },
    },
}));
vi.mock("../../src/api/geoleaf.legend.js", () => ({
    Legend: { showLoadingOverlay: vi.fn(), hideLoadingOverlay: vi.fn() },
}));
vi.mock("../../src/api/geoleaf.layer-manager.js", () => ({ LayerManager: { refresh: vi.fn() } }));
vi.mock("../../src/kernel/geojson/core.js", () => ({ GeoJSONCore: {} }));

const { ThemeApplierCore } = await import("../../src/kernel/themes/theme-applier/core.js");
const { frameThemeView } = await import("../../src/kernel/themes/theme-applier/view.js");

const SECTOR_VIEW: ThemeViewDeclaration = {
    bounds: [
        [43.25, 1.25],
        [43.75, 1.75],
    ],
};
const SECTOR_EXTENT = { south: 43.25, west: 1.25, north: 43.75, east: 1.75 };
const SPOT_VIEW: ThemeViewDeclaration = { center: [43.25, 1.75], zoom: 13 };

const LAYERS = [{ id: "roads" }];

beforeEach(() => {
    vi.clearAllMocks();
    mocks.order.length = 0;
    mocks.padding = undefined;
    mocks.map = {
        fitBounds: vi.fn(() => mocks.order.push("camera")),
        setView: vi.fn(() => mocks.order.push("camera")),
    };
    ThemeApplierCore._currentThemeId = null;
    ThemeApplierCore._hideAllLayers = vi.fn(() => {
        mocks.order.push("hide");
    });
    ThemeApplierCore._applyLayerConfig = vi.fn(() => {
        mocks.order.push("layer");
        return Promise.resolve();
    });
    ThemeApplierCore._syncLegendVisibility = vi.fn();
});

describe("frameThemeView — the camera move", () => {
    it("fits the extent of a `bounds` view, without animation", () => {
        expect(frameThemeView(SECTOR_VIEW)).toBe(true);

        expect(mocks.map?.fitBounds).toHaveBeenCalledTimes(1);
        const [extent, options] = mocks.map?.fitBounds.mock.calls[0] ?? [];
        expect(extent).toEqual(SECTOR_EXTENT);
        expect(options).toMatchObject({ animate: false });
        expect(mocks.map?.setView).not.toHaveBeenCalled();
    });

    it("keeps the profile's padding around it — the four edges, as declared", () => {
        mocks.padding = { top: 40, bottom: 120, left: 40, right: 40 };

        frameThemeView(SECTOR_VIEW);

        expect(mocks.map?.fitBounds.mock.calls[0]?.[1]).toMatchObject({
            padding: { top: 40, bottom: 120, left: 40, right: 40 },
        });
    });

    it("keeps 50 pixels on every edge when the profile declares no padding", () => {
        frameThemeView(SECTOR_VIEW);

        expect(mocks.map?.fitBounds.mock.calls[0]?.[1]).toMatchObject({
            padding: { top: 50, bottom: 50, left: 50, right: 50 },
        });
    });

    it("stands on the point of a `center` view, at its zoom", () => {
        expect(frameThemeView(SPOT_VIEW)).toBe(true);

        expect(mocks.map?.setView).toHaveBeenCalledWith({ lat: 43.25, lng: 1.75 }, 13);
        expect(mocks.map?.fitBounds).not.toHaveBeenCalled();
    });

    it("moves nothing for a theme without a view", () => {
        expect(frameThemeView(undefined)).toBe(false);

        expect(mocks.map?.fitBounds).not.toHaveBeenCalled();
        expect(mocks.map?.setView).not.toHaveBeenCalled();
    });

    it("moves nothing, and does not throw, when no map exists", () => {
        mocks.map = null;

        expect(frameThemeView(SECTOR_VIEW)).toBe(false);
    });

    it("logs a move the engine refuses, and reports it — the theme must still apply", () => {
        mocks.map?.fitBounds.mockImplementation(() => {
            throw new Error("map destroyed");
        });

        expect(frameThemeView(SECTOR_VIEW)).toBe(false);
        expect(mocks.log.warn).toHaveBeenCalledTimes(1);
    });
});

describe("applyTheme — a theme that declares a view", () => {
    it("🛑 moves the camera BEFORE it hides and loads the layers", async () => {
        await ThemeApplierCore.applyTheme({ id: "sector", layers: LAYERS, view: SECTOR_VIEW });

        expect(mocks.order).toEqual(["camera", "hide", "layer"]);
    });

    it("frames a `center` view the same way", async () => {
        await ThemeApplierCore.applyTheme({ id: "spot", layers: LAYERS, view: SPOT_VIEW });

        expect(mocks.order).toEqual(["camera", "hide", "layer"]);
        expect(mocks.map?.setView).toHaveBeenCalledTimes(1);
    });

    it("🛑 leaves the camera alone under `keepView`, and still applies the layers", async () => {
        await ThemeApplierCore.applyTheme(
            { id: "sector", layers: LAYERS, view: SECTOR_VIEW },
            { keepView: true }
        );

        expect(mocks.order).toEqual(["hide", "layer"]);
        expect(ThemeApplierCore.getCurrentThemeId()).toBe("sector");
    });

    it("still applies the theme when the engine refuses the move", async () => {
        mocks.map?.fitBounds.mockImplementation(() => {
            throw new Error("map destroyed");
        });

        await ThemeApplierCore.applyTheme({ id: "sector", layers: LAYERS, view: SECTOR_VIEW });

        expect(mocks.order).toEqual(["hide", "layer"]);
        expect(ThemeApplierCore.getCurrentThemeId()).toBe("sector");
    });
});

describe("applyTheme — a theme that declares no view", () => {
    it("leaves the camera where it is", async () => {
        await ThemeApplierCore.applyTheme({ id: "general", layers: LAYERS });

        expect(mocks.order).toEqual(["hide", "layer"]);
    });
});

describe("applyTheme — what a framing does NOT announce", () => {
    const heard: string[] = [];
    const onMapReady = () => heard.push("geoleaf:map:ready");

    beforeEach(() => {
        heard.length = 0;
        vi.useFakeTimers();
        document.addEventListener("geoleaf:map:ready", onMapReady);
    });

    afterEach(() => {
        document.removeEventListener("geoleaf:map:ready", onMapReady);
        vi.useRealTimers();
    });

    it("emits no `geoleaf:map:ready`: a framed theme is not a new map", async () => {
        await ThemeApplierCore.applyTheme({ id: "sector", layers: LAYERS, view: SECTOR_VIEW });
        // Well past the delays the legacy fit on the layers' bounds waited before announcing.
        vi.advanceTimersByTime(5000);

        expect(heard).toEqual([]);
    });
});
