/**
 * Witness — the Quick Start of both READMEs, run against the facade.
 *
 * ## What this file pins
 *
 * The first example of `README.md` and of `packages/core/README.md` passed `Core.init` the
 * `{ map: { target } }` shape, which only `GeoLeaf.init()` normalises, and put no engine on
 * `globalThis.maplibregl`: it returned `null` twice over, with a log line nobody reading a
 * README runs. The documentation gate refuses both shapes since (DOCS-CORE-INIT and
 * DOCS-NPM-ENGINE, `scripts/validate-docs-examples.cjs`) — it is what reddened on the
 * README. This file proves what that gate asserts: the old example returns `null`, the second
 * defect alone still returns `null`, and the corrected example boots.
 *
 * The code was right all along — these cases are green on it. A documentation defect reddens
 * in the gate that reads the documentation, not here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/kernel/events/event-bus.ts", () => ({ dispatchGeoLeafEvent: vi.fn() }));
vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

type CoreFacade = (typeof import("../../src/kernel/map/facade.js"))["Core"];
type InitOptions = NonNullable<Parameters<CoreFacade["init"]>[0]>;

/** The README example before the fix — the shape `GeoLeaf.init()` accepts, not `Core.init`. */
const README_BEFORE = { map: { target: "map", center: [46.5, 2.5], zoom: 6 } };
/** The corrected call. */
const README_AFTER: InitOptions = { mapId: "map", center: [46.5, 2.5], zoom: 6 };

const globals = globalThis as unknown as Record<string, unknown>;

let Core: CoreFacade;
let logError: ReturnType<typeof vi.fn>;
let container: HTMLDivElement;
let MapCtor: ReturnType<typeof vi.fn>;

/** The fake map the constructor hands back: only what `MaplibreAdapter.init()` touches. */
function fakeMap(): Record<string, unknown> {
    return {
        on: vi.fn(),
        off: vi.fn(),
        once: vi.fn(),
        remove: vi.fn(),
        getCenter: vi.fn(() => ({ lat: 46.5, lng: 2.5 })),
        getZoom: vi.fn(() => 6),
        fitBounds: vi.fn(),
        getContainer: vi.fn(() => container),
    };
}

/** What the corrected README does, with a constructable stand-in for MapLibre's namespace. */
function putEngineOnTheGlobal(): void {
    Object.assign(globalThis, { maplibregl: { Map: MapCtor } });
}

beforeEach(async () => {
    container = document.createElement("div");
    container.id = "map";
    document.body.appendChild(container);

    // Vitest 4: `new maplibregl.Map(...)` needs a constructable mock — a class returning the fake,
    // handed to `vi.fn` directly (`mockImplementation` is typed for plain functions only).
    MapCtor = vi.fn(
        class {
            constructor() {
                return fakeMap();
            }
        }
    );

    vi.resetModules();
    ({ Core } = await import("../../src/kernel/map/facade.ts"));
    const { Log } = await import("../../src/utils/log/index.js");
    logError = Log.error as unknown as ReturnType<typeof vi.fn>;
});

afterEach(() => {
    container.remove();
    document.body.classList.remove("gl-theme-light", "gl-theme-dark");
    delete globals["maplibregl"];
});

describe("Quick Start — README.md and packages/core/README.md", () => {
    it("the example before the fix returns null: `Core.init` reads `mapId`, not `map.target`", () => {
        putEngineOnTheGlobal();

        const adapter = Core.init(README_BEFORE as unknown as InitOptions);

        expect(adapter).toBeNull();
        expect(logError).toHaveBeenCalledWith("[GeoLeaf.Core] init() requires options.mapId");
        expect(MapCtor).not.toHaveBeenCalled();
    });

    it("with `mapId` but no engine on `globalThis.maplibregl`, it still returns null", () => {
        const adapter = Core.init(README_AFTER);

        expect(adapter).toBeNull();
        expect(logError).toHaveBeenCalledWith(
            '[GeoLeaf.Core] init failed for "map":',
            expect.stringContaining("maplibregl")
        );
    });

    it("the corrected example boots: engine on the global, then `mapId`", () => {
        putEngineOnTheGlobal();

        const adapter = Core.init(README_AFTER);

        expect(adapter).not.toBeNull();
        expect(adapter?.isReady()).toBe(true);
        // `center` is [lat, lng] in GeoLeaf and [lng, lat] for MapLibre.
        expect(MapCtor).toHaveBeenCalledWith(
            expect.objectContaining({ container, center: [2.5, 46.5], zoom: 6 })
        );
        Core.destroy("map");
    });
});
