/**
 * Witness — the map starts on the view of the theme the profile starts on.
 *
 * ## What this file pins
 *
 * The extent a map started on used to be the profile's, whatever the theme: `map.bounds`,
 * fitted when the map is created and again at the reveal. A theme may now declare `view`, and
 * the theme the profile starts on decides where the map starts — when the map is CREATED, so
 * that the layers loaded for that theme ask for the area it frames, not for the whole profile
 * first.
 *
 * What does not move with it is pinned too: the navigation limit (`maxBounds`) and the padding
 * stay the profile's, and a theme view the limit would cut short is said in the log.
 *
 * Seen RED, each on its own mutation: the cases that read WHERE the map starts, on a boot that
 * ignored the start theme (`readStartThemeView` answering `null`); the two « navigation limit »
 * cases, on a boot that drew the limit from the start view; the warning, on a boot that kept
 * silent. The padding case does not tell those boots apart — the profile's padding is the same
 * either way — and holds the padding itself.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { CoreMapLifecycle } = await import("../../src/app/boot-modules/core-map-lifecycle.ts");
const { beginBoot } = await import("../../src/app/boot-failure.ts");
const { ensureGeoLeaf } = await import("../../src/utils/general/geoleaf-global.ts");

type Adapter = Parameters<typeof CoreMapLifecycle.init>[0];
type BootConfig = Parameters<typeof CoreMapLifecycle.init>[1];

/** What `GeoLeaf.init` is handed for the map it creates. */
interface CreatedMap {
    center: [number, number];
    zoom: number;
    mapOptions: Record<string, unknown>;
}

const GeoLeaf = ensureGeoLeaf() as unknown as Record<string, unknown>;
const saved = {
    app: GeoLeaf["_app"],
    init: GeoLeaf["init"],
    Config: GeoLeaf["Config"],
    Permalink: GeoLeaf["Permalink"],
};

const PROFILE_BOUNDS = [
    [43, 1],
    [44, 2],
];
/** The profile extent, as the adapter is handed it. */
const PROFILE_EXTENT = { south: 43, west: 1, north: 44, east: 2 };
/** The profile extent widened by the margin of `PROFILE_MAP` — the navigation limit. */
const NAVIGATION_LIMIT = { south: 42.5, west: 0.5, north: 44.5, east: 2.5 };
const PROFILE_PADDING = { top: 60, bottom: 60, left: 40, right: 40 };
const PROFILE_MAP = {
    bounds: PROFILE_BOUNDS,
    padding: [40, 60],
    initialMaxZoom: 10,
    positionFixed: true,
    boundsMargin: 0.5,
};

/** A sector of the profile — corners chosen so that its centre is exact in binary. */
const SECTOR_BOUNDS = [
    [43.25, 1.25],
    [43.75, 1.75],
];
const SECTOR_EXTENT = { south: 43.25, west: 1.25, north: 43.75, east: 1.75 };

const log = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const fakeMap = { fitBounds: vi.fn() };
const init = vi.fn((_options: { map: CreatedMap }) => fakeMap);

/** Boots the map module on a profile `map` block, with the `themes` the profile carries. */
function boot(map: unknown, themes?: unknown) {
    GeoLeaf["Config"] = { getActiveProfile: () => (themes === undefined ? {} : { themes }) };
    CoreMapLifecycle.init({} as Adapter, { map } as unknown as BootConfig);
    const created = init.mock.calls[0]?.[0]?.map;
    if (!created) throw new Error("the map was not created");
    return { created, app: GeoLeaf["_app"] as Record<string, unknown> };
}

beforeEach(() => {
    vi.clearAllMocks();
    beginBoot({ watchdogMs: 0 });
    GeoLeaf["_app"] = { AppLog: log };
    GeoLeaf["init"] = init;
    // The permalink hook is not this file's subject.
    GeoLeaf["Permalink"] = undefined;
});

afterEach(() => {
    GeoLeaf["_app"] = saved.app;
    GeoLeaf["init"] = saved.init;
    GeoLeaf["Config"] = saved.Config;
    GeoLeaf["Permalink"] = saved.Permalink;
});

describe("CoreMapLifecycle — the start theme declares an extent", () => {
    const themes = {
        defaultTheme: "sector",
        themes: [{ id: "general" }, { id: "sector", view: { bounds: SECTOR_BOUNDS } }],
    };

    it("creates the map on the centre of the theme's extent, then fits it", () => {
        const { created } = boot(PROFILE_MAP, themes);

        expect(created.center).toEqual([43.5, 1.5]);
        expect(fakeMap.fitBounds).toHaveBeenCalledTimes(1);
        expect(fakeMap.fitBounds.mock.calls[0]?.[0]).toEqual(SECTOR_EXTENT);
    });

    it("keeps the profile's padding around it, and does not animate", () => {
        boot(PROFILE_MAP, themes);

        expect(fakeMap.fitBounds.mock.calls[0]?.[1]).toEqual({
            padding: PROFILE_PADDING,
            animate: false,
            maxZoom: 10,
        });
    });

    it("hands the reveal the theme's extent to re-fit, with the profile's padding", () => {
        const { app } = boot(PROFILE_MAP, themes);

        expect(app["_startBounds"]).toEqual(SECTOR_EXTENT);
        expect(app["_profilePadding"]).toEqual(PROFILE_PADDING);
    });

    it("🛑 leaves the navigation limit on the PROFILE extent", () => {
        const { created } = boot(PROFILE_MAP, themes);

        expect(created.mapOptions["maxBounds"]).toEqual(NAVIGATION_LIMIT);
    });

    it("is the first theme's view when the profile declares no default", () => {
        const { created } = boot(PROFILE_MAP, {
            themes: [{ id: "sector", view: { bounds: SECTOR_BOUNDS } }, { id: "general" }],
        });

        expect(created.center).toEqual([43.5, 1.5]);
        expect(fakeMap.fitBounds.mock.calls[0]?.[0]).toEqual(SECTOR_EXTENT);
    });

    it("frames a profile positioned by centre and zoom too, with the default padding", () => {
        const { app } = boot({ center: [43.9, 1.9], zoom: 8 }, themes);

        expect(fakeMap.fitBounds.mock.calls[0]?.[0]).toEqual(SECTOR_EXTENT);
        expect(fakeMap.fitBounds.mock.calls[0]?.[1]).toMatchObject({
            padding: { top: 50, bottom: 50, left: 50, right: 50 },
            animate: false,
        });
        expect(app["_startBounds"]).toEqual(SECTOR_EXTENT);
    });
});

describe("CoreMapLifecycle — the start theme declares a centre and a zoom", () => {
    const themes = {
        defaultTheme: "spot",
        themes: [{ id: "spot", view: { center: [43.25, 1.75], zoom: 13 } }],
    };

    it("creates the map there, and fits nothing", () => {
        const { created } = boot(PROFILE_MAP, themes);

        expect(created.center).toEqual([43.25, 1.75]);
        expect(created.zoom).toBe(13);
        expect(fakeMap.fitBounds).not.toHaveBeenCalled();
    });

    it("hands the reveal nothing to re-fit", () => {
        const { app } = boot(PROFILE_MAP, themes);

        expect(app["_startBounds"]).toBeNull();
    });

    it("🛑 leaves the navigation limit on the PROFILE extent", () => {
        const { created } = boot(PROFILE_MAP, themes);

        expect(created.mapOptions["maxBounds"]).toEqual(NAVIGATION_LIMIT);
    });
});

// 🛑 `map.initialMaxZoom` WAS READ AND CAPPED NOTHING. It gave the zoom the map is created
// at, which the fit on the extent replaced at once — so a profile framing a single street
// started at street level whatever the key said, while three public pages promised a ceiling.
describe("CoreMapLifecycle — `map.initialMaxZoom` caps the start framing", () => {
    const UNCAPPED = { bounds: PROFILE_BOUNDS, padding: [40, 60] };

    it("caps the fit on the profile extent, and hands the reveal the same ceiling", () => {
        const { app } = boot({ ...UNCAPPED, initialMaxZoom: 9 });

        expect(fakeMap.fitBounds.mock.calls[0]?.[1]).toMatchObject({ maxZoom: 9 });
        expect(app["_startMaxZoom"]).toBe(9);
    });

    it("caps the fit on the START THEME's extent too — the ceiling is the profile's", () => {
        const { app } = boot(
            { ...UNCAPPED, initialMaxZoom: 9 },
            { themes: [{ id: "sector", view: { bounds: SECTOR_BOUNDS } }] }
        );

        expect(fakeMap.fitBounds.mock.calls[0]?.[0]).toEqual(SECTOR_EXTENT);
        expect(fakeMap.fitBounds.mock.calls[0]?.[1]).toMatchObject({ maxZoom: 9 });
        expect(app["_startMaxZoom"]).toBe(9);
    });

    // The fallback of the CREATION zoom (`maxZoom`, then 12) must not become a ceiling: a
    // profile that declares no such key would start further out than it always has.
    it.each([
        ["the key is absent", UNCAPPED],
        ["only `maxZoom` is declared", { ...UNCAPPED, maxZoom: 11 }],
        ["the key is not a number", { ...UNCAPPED, initialMaxZoom: "9" }],
    ])("🛑 caps nothing when %s", (_label, map) => {
        const { app } = boot(map);

        expect(fakeMap.fitBounds).toHaveBeenCalledTimes(1);
        expect(fakeMap.fitBounds.mock.calls[0]?.[1]).not.toHaveProperty("maxZoom");
        expect(app["_startMaxZoom"]).toBeNull();
    });

    it("hands the reveal no ceiling when the map starts on a centre and a zoom", () => {
        const { app } = boot(
            { ...UNCAPPED, initialMaxZoom: 9 },
            { themes: [{ id: "spot", view: { center: [43.25, 1.75], zoom: 13 } }] }
        );

        expect(fakeMap.fitBounds).not.toHaveBeenCalled();
        expect(app["_startMaxZoom"]).toBeNull();
    });
});

describe("CoreMapLifecycle — the start theme declares no view", () => {
    it.each([
        ["no theme at all", undefined],
        ["a start theme without a view", { themes: [{ id: "general" }] }],
        [
            "a view on ANOTHER theme than the one it starts on",
            {
                defaultTheme: "general",
                themes: [{ id: "general" }, { id: "sector", view: { bounds: SECTOR_BOUNDS } }],
            },
        ],
        [
            "a start theme whose view cannot be used",
            { themes: [{ id: "general", view: { zoom: 13 } }] },
        ],
    ])("starts on the profile extent — %s", (_label, themes) => {
        const { created, app } = boot(PROFILE_MAP, themes);

        expect(created.center).toEqual([43.5, 1.5]);
        expect(created.zoom).toBe(10);
        expect(fakeMap.fitBounds.mock.calls[0]?.[0]).toEqual(PROFILE_EXTENT);
        expect(app["_startBounds"]).toEqual(PROFILE_EXTENT);
    });
});

describe("CoreMapLifecycle — a theme view the navigation limit would cut short", () => {
    /** The warnings that name a theme view outside the profile extent. */
    function outsideWarnings(): string[] {
        return log.warn.mock.calls
            .map((call) => String(call[0]))
            .filter((message) => message.includes("Theme view outside the profile extent"));
    }

    const far = { id: "far", view: { center: [48.8, 2.3], zoom: 11 } };
    const sector = { id: "sector", view: { bounds: SECTOR_BOUNDS } };

    it("is named in the log, under `positionFixed`", () => {
        boot(PROFILE_MAP, { defaultTheme: "sector", themes: [sector, far] });

        expect(outsideWarnings()).toHaveLength(1);
        expect(outsideWarnings()[0]).toContain("far");
        expect(outsideWarnings()[0]).not.toContain("sector");
    });

    it("is not, when it stays inside the extent WIDENED by the margin", () => {
        const withinMargin = {
            id: "edge",
            view: {
                bounds: [
                    [43.5, 1.5],
                    [44.25, 2.25],
                ],
            },
        };
        boot(PROFILE_MAP, { themes: [sector, withinMargin] });

        expect(outsideWarnings()).toEqual([]);
    });

    it("is not, without `positionFixed` — nothing limits the navigation then", () => {
        boot({ ...PROFILE_MAP, positionFixed: false }, { themes: [sector, far] });

        expect(outsideWarnings()).toEqual([]);
    });
});
