/**
 * The filter in a permalink, ONE PARAMETER PER FIELD — written, read back, and restored.
 *
 * `field-filters-grammar.test.ts` holds the grammar of one entry. This file holds what the
 * permalink does with it, through the modules a page runs: the capture
 * (`GeoLeaf.Filter.getActiveFilter()` → `gl_f.<id>` parameters), the parse, and the restore
 * (`GeoLeaf.Filter.applyFilter()`).
 *
 * 🛑 THE DEFECTS, each a case below. Ranged by kind in four slots, the filter of a link lost:
 * the second of two fields of the same kind, the upper bound of a range, and the category of
 * a checked sub-category.
 *
 * ⚠️ ONE WRITER, TWO READERS. A capture writes the per-field parameters and nothing else. A
 * link written before — `gl_filter`, `gl_cats`, `gl_tags`, `gl_rating` — is still restored,
 * as it always was.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Permalink } from "../../../src/capabilities/permalink/public-api.js";
import {
    applyState,
    buildUrl,
    readUrl,
    startSync,
} from "../../../src/capabilities/permalink/permalink-sync.js";
import type {
    PermalinkFilterField,
    PermalinkState,
} from "../../../src/capabilities/permalink/types.js";
import type { PermalinkConfig } from "../../../src/kernel/config/geoleaf-config/config-types.js";

const VIEW = { lat: 48, lng: 2, zoom: 10 };
const HASH: PermalinkConfig = { mode: "hash" };

/** The filter fields of the profile under test: two ranges, a text search, tags, a taxonomy. */
const DESCRIPTORS = [
    { id: "recherche", kind: "text" },
    { id: "altitude", kind: "range" },
    { id: "prix", kind: "range" },
    { id: "tags", kind: "tag" },
    { id: "categories", kind: "taxonomy" },
    { id: "accessible", kind: "boolean" },
];

const ACTIVE: PermalinkFilterField[] = [
    { id: "recherche", kind: "text", text: "parc, lac" },
    { id: "altitude", kind: "range", range: { min: 100, max: 500 } },
    { id: "prix", kind: "range", range: { max: 20 } },
    { id: "tags", kind: "tag", values: ["gratuit", "famille"] },
    {
        id: "categories",
        kind: "taxonomy",
        values: ["eau", "foret", "source"],
        subValues: [{ value: "source", category: "eau" }],
    },
    { id: "accessible", kind: "boolean", bool: true },
];

type Globals = { GeoLeaf?: unknown };
const g = globalThis as unknown as Globals;

let applyFilter: ReturnType<typeof vi.fn>;

/** Mounts the narrow `GeoLeaf.Filter` the permalink talks to, holding `active`. */
function mountFilter(active: PermalinkFilterField[] = ACTIVE): void {
    applyFilter = vi.fn();
    g.GeoLeaf = {
        Filter: {
            getActiveFilter: () => ({ fields: active }),
            getConfig: () => ({ fields: DESCRIPTORS }),
            applyFilter,
        },
        ThemeSelector: { getCurrentTheme: () => null },
    };
}

const map = () =>
    ({
        getCenter: () => ({ lat: VIEW.lat, lng: VIEW.lng }),
        getZoom: () => VIEW.zoom,
        setView: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
    }) as never;

/** The URL a capture writes for the mounted filter. */
function captured(config: PermalinkConfig = HASH): string {
    vi.useFakeTimers();
    const replace = vi.spyOn(history, "replaceState").mockImplementation(() => {});
    const m = map() as unknown as { on: ReturnType<typeof vi.fn> };
    const stop = startSync(m as never, config);
    const onMove = m.on.mock.calls.find(([event]) => event === "moveend")?.[1] as () => void;
    onMove();
    vi.advanceTimersByTime(500);
    const url = String(replace.mock.calls.at(-1)?.[2] ?? "");
    stop();
    replace.mockRestore();
    vi.useRealTimers();
    return url;
}

/** The parameters of a URL fragment, decoded. */
const paramsOf = (url: string): Record<string, string> =>
    Object.fromEntries(new URLSearchParams(url.slice(url.indexOf("#") + 1)));

/** Reads a fragment the way a page opened on it does. */
function read(fragment: string, config: PermalinkConfig = HASH): PermalinkState | null {
    window.location.hash = fragment;
    return readUrl(config);
}

/** Restores a state with the filter panel mounted, and returns what the filter was handed. */
function restored(state: PermalinkState, config: PermalinkConfig = HASH): PermalinkFilterField[] {
    document.body.innerHTML = '<div id="gl-filter-panel"></div>';
    applyState(state, map(), config);
    document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));
    const call = applyFilter.mock.calls.at(-1)?.[0] as
        { fields: PermalinkFilterField[] } | undefined;
    return call?.fields ?? [];
}

beforeEach(() => {
    mountFilter();
});

afterEach(() => {
    delete g.GeoLeaf;
    document.body.innerHTML = "";
    window.location.hash = "";
    vi.useRealTimers();
});

/** The active fields named, in declaration order — a subset keeps the link under the length
 *  at which it turns compact (`gl=<base64>`), where no parameter can be read by eye. */
const only = (...ids: string[]): PermalinkFilterField[] => ACTIVE.filter((f) => ids.includes(f.id));

describe("a capture writes one parameter per field", () => {
    it("🛑 two fields of the same kind each have their own", () => {
        mountFilter(only("altitude", "prix"));
        const params = paramsOf(captured());
        expect(params["gl_f.altitude"]).toBe("100..500");
        expect(params["gl_f.prix"]).toBe("..20");
    });

    it("🛑 a range carries its upper bound, and a taxonomy field its sub-categories", () => {
        mountFilter(only("altitude", "categories"));
        const params = paramsOf(captured());
        expect(params["gl_f.altitude"]).toBe("100..500");
        expect(params["gl_f.categories"]).toBe("eau,foret,source");
        expect(params["gl_f.categories.sub"]).toBe("eau/source");
    });

    it("🛑 writes no by-kind slot any more — one writer", () => {
        mountFilter(only("recherche", "tags", "prix"));
        const params = paramsOf(captured());
        expect(params["gl_f.recherche"]).toBe("parc, lac");
        expect(params["gl_f.tags"]).toBe("gratuit,famille");
        expect(params["gl_f.prix"]).toBe("..20");
        for (const slot of ["gl_filter", "gl_cats", "gl_tags", "gl_rating"]) {
            expect(params, slot).not.toHaveProperty(slot);
        }
    });

    it("leaves out a kind the permalink does not carry", () => {
        mountFilter(only("recherche", "accessible"));
        const params = paramsOf(captured());
        // The witness: the capture did write — the absence below is not an empty URL's.
        expect(params["gl_f.recherche"]).toBe("parc, lac");
        expect(params).not.toHaveProperty("gl_f.accessible");
    });

    it("🛑 honours the whitelist by KIND: an excluded facet excludes the fields of that kind", () => {
        const params = paramsOf(captured({ mode: "hash", fields: ["filter", "rating"] }));
        expect(
            Object.keys(params)
                .filter((k) => k.startsWith("gl_f."))
                .sort()
        ).toEqual(["gl_f.altitude", "gl_f.prix", "gl_f.recherche"]);
    });

    it("writes nothing when the filter is idle", () => {
        mountFilter([]);
        const params = paramsOf(captured());
        expect(params).toHaveProperty("gl_lat");
        expect(Object.keys(params).some((k) => k.startsWith("gl_f."))).toBe(false);
    });

    it("a long filter turns the link compact, as any long state always did", () => {
        const params = paramsOf(captured());
        expect(Object.keys(params)).toEqual(["gl"]);
    });
});

describe("a link is read back and restored field by field", () => {
    it("🛑 round trip: what was captured is what the filter is handed", () => {
        const url = captured();
        const state = read(url.slice(url.indexOf("#")));
        expect(state?.fieldFilters).toBeDefined();

        // Everything but the boolean, which the permalink does not carry.
        expect(restored(state as PermalinkState)).toEqual(ACTIVE.slice(0, 5));
    });

    it("🛑 survives the compact encoding too", () => {
        const url = captured({ mode: "compact" });
        expect(paramsOf(url)).toHaveProperty("gl");
        const state = read(url.slice(url.indexOf("#")), { mode: "compact" });
        expect(restored(state as PermalinkState, { mode: "compact" })).toEqual(ACTIVE.slice(0, 5));
    });

    it("restores nothing for a field the link does not name", () => {
        const state = read("#gl_lat=48&gl_lng=2&gl_zoom=10&gl_f.prix=..20");
        expect(restored(state as PermalinkState)).toEqual([
            { id: "prix", kind: "range", range: { max: 20 } },
        ]);
    });

    it("🛑 a forged link cannot drive a field whose kind the profile excluded", () => {
        const config: PermalinkConfig = { mode: "hash", fields: ["filter"] };
        const state = read(
            "#gl_lat=48&gl_lng=2&gl_zoom=10&gl_f.recherche=lac&gl_f.tags=gratuit&gl_f.prix=..5",
            config
        );
        expect(restored(state as PermalinkState, config)).toEqual([
            { id: "recherche", kind: "text", text: "lac" },
        ]);
    });

    it("🛑 drops every per-field entry when the whitelist holds no filter facet", () => {
        const config: PermalinkConfig = { mode: "hash", fields: ["layers", "theme"] };
        const state = read("#gl_lat=48&gl_lng=2&gl_zoom=10&gl_f.recherche=lac", config);
        expect(state?.fieldFilters).toBeUndefined();
        expect(buildUrl({ ...VIEW, fieldFilters: { recherche: "lac" } }, config)).not.toContain(
            "gl_f."
        );
    });

    it("🛑 never takes a parameter name that would reach the prototype", () => {
        const state = read("#gl_lat=48&gl_lng=2&gl_zoom=10&gl_f.__proto__=x&gl_f.recherche=lac");
        expect(state?.fieldFilters).toEqual({ recherche: "lac" });
        expect(({} as Record<string, unknown>)["recherche"]).toBeUndefined();
    });
});

describe("a link written before is still restored — the second reader", () => {
    const OLD =
        "#gl_lat=48&gl_lng=2&gl_zoom=10&gl_filter=lac&gl_cats=eau,foret&gl_tags=gratuit&gl_rating=3";

    it("reads the four by-kind slots, and no per-field entry", () => {
        const state = read(OLD);
        expect(state).toMatchObject({
            filter: "lac",
            categories: ["eau", "foret"],
            tags: ["gratuit"],
            rating: 3,
        });
        expect(state?.fieldFilters).toBeUndefined();
    });

    it("🛑 restores them as it always did — every field of a kind gets that kind's slot", () => {
        expect(restored(read(OLD) as PermalinkState)).toEqual([
            { id: "recherche", kind: "text", text: "lac" },
            { id: "altitude", kind: "range", range: { min: 3 } },
            { id: "prix", kind: "range", range: { min: 3 } },
            { id: "tags", kind: "tag", values: ["gratuit"] },
            { id: "categories", kind: "taxonomy", values: ["eau", "foret"] },
        ]);
    });

    it("a state holding the old slots is still written as it was — `buildUrl` of an explicit state", () => {
        const url = buildUrl({ ...VIEW, filter: "lac", rating: 3 }, HASH);
        expect(paramsOf(url)).toMatchObject({ gl_filter: "lac", gl_rating: "3" });
    });

    it("🛑 per-field entries, when present, are the whole filter — the two are never mixed", () => {
        const state = read(`${OLD}&gl_f.prix=..20`);
        expect(restored(state as PermalinkState)).toEqual([
            { id: "prix", kind: "range", range: { max: 20 } },
        ]);
    });
});

describe("through the public facade", () => {
    it("🛑 `applyStoredState` restores under the facade's own whitelist", () => {
        Permalink._reset();
        Permalink.init({ mode: "hash", fields: ["rating"] });
        window.location.hash = "#gl_lat=48&gl_lng=2&gl_zoom=10&gl_f.recherche=lac&gl_f.prix=..20";
        Permalink.readAndStore();
        document.body.innerHTML = '<div id="gl-filter-panel"></div>';

        Permalink.applyStoredState(map());
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));

        expect(applyFilter).toHaveBeenCalledWith({
            fields: [{ id: "prix", kind: "range", range: { max: 20 } }],
        });
        expect(Permalink.getState()?.fieldFilters).toEqual({ recherche: "lac", prix: "..20" });
        Permalink._reset();
    });
});
