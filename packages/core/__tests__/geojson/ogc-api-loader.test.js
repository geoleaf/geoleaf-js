/**
 * @tests built-in/geojson/loader/ogc-api-loader
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/utils/geo/wkt-parser.js", () => ({
    wktToGeoJSON: (wkt) => {
        if (wkt === "POINT(1 2)") return { type: "Point", coordinates: [1, 2] };
        return null;
    },
}));

// validateUrl accepts http/https, rejects others
vi.mock("../../src/utils/general/utils-base.js", () => ({
    validateUrl: (url) => {
        if (typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://")))
            return url;
        return null;
    },
    debounce: (fn, _ms) => fn,
}));

// `getLog` moved to di-accessors.js at KERNEL S10 — it must be stubbed at its
// own module or the subject resolves the real logger and this mock goes silent.
const __log = vi.hoisted(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));
vi.mock("../../src/utils/general/di-accessors.js", () => ({
    // ⚠️ STABLE object, not a new one per call. A `() => ({...})` returns a
    // different double at each invocation: the module under test logs into
    // one, the test queries the other, and any message assertion is
    // true-but-empty. Extended on 20/08/2026 to make messages assertable; no
    // existing assertion changes.
    getLog: () => __log,
}));

// ─── Module under test ────────────────────────────────────────────────────────

let fetchOgcApiFeatures;
let setupAutoRefresh;

beforeAll(async () => {
    const mod = await import("../../src/kernel/geojson/loader/ogc-api-loader.ts");
    fetchOgcApiFeatures = mod.fetchOgcApiFeatures;
    setupAutoRefresh = mod.setupAutoRefresh;
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFeatureCollection(features = [], extra = {}) {
    return { type: "FeatureCollection", features, ...extra };
}

function mockFetch(pages) {
    let call = 0;
    global.fetch = vi.fn().mockImplementation(async (_url) => {
        const page = pages[call++] ?? pages[pages.length - 1];
        if (page instanceof Error) throw page;
        return {
            ok: page.ok ?? true,
            status: page.status ?? 200,
            json: async () => page.body,
        };
    });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ogc-api-loader — fetchOgcApiFeatures", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("fetches a single page with no next link", async () => {
        const features = [{ type: "Feature", geometry: null, properties: {} }];
        mockFetch([{ body: makeFeatureCollection(features) }]);

        const result = await fetchOgcApiFeatures({ url: "https://api.example.com/items" });

        expect(result.type).toBe("FeatureCollection");
        expect(result.features).toHaveLength(1);
    });

    it("follows next link to fetch multiple pages", async () => {
        const page1 = makeFeatureCollection(
            [{ type: "Feature", geometry: null, properties: { id: 1 } }],
            { links: [{ rel: "next", href: "https://api.example.com/items?offset=1" }] }
        );
        const page2 = makeFeatureCollection([
            { type: "Feature", geometry: null, properties: { id: 2 } },
        ]);

        mockFetch([{ body: page1 }, { body: page2 }]);

        const result = await fetchOgcApiFeatures({ url: "https://api.example.com/items" });
        expect(result.features).toHaveLength(2);
    });

    it("stops at maxFeatures limit without fetching more pages", async () => {
        const features = Array.from({ length: 5 }, (_, i) => ({
            type: "Feature",
            geometry: null,
            properties: { i },
        }));
        const page1 = makeFeatureCollection(features, {
            links: [{ rel: "next", href: "https://api.example.com/items?offset=5" }],
        });

        mockFetch([{ body: page1 }]);

        const result = await fetchOgcApiFeatures({
            url: "https://api.example.com/items",
            maxFeatures: 3,
        });
        // 🛑 THIS ASSERTION WAS `toBeGreaterThanOrEqual(3)` AND COULD NOT TELL
        // THE DEFECT FROM THE FIX: it passed at 5 (the overshoot) as at 3
        // (the bound). Its comment even documented the overshoot as expected
        // — "all 5 are in". An assertion accepting both answers guards neither.
        expect(result.features.length).toBe(3);
        // Crucially, fetch was called only once (no second page)
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("SIGNALE la coupe — une collection tronquée n'est pas discernable d'une complète sans ça", async () => {
        const features = Array.from({ length: 5 }, (_, i) => ({
            type: "Feature",
            geometry: null,
            properties: { i },
        }));
        mockFetch([
            {
                body: makeFeatureCollection(features, {
                    links: [{ rel: "next", href: "https://api.example.com/items?offset=5" }],
                }),
            },
        ]);

        const result = await fetchOgcApiFeatures({
            url: "https://api.example.com/items",
            maxFeatures: 3,
        });

        // The member carries BOTH numbers: "it was cut" alone does not say by
        // how much the source was missed, and that second half is what makes
        // the signal actionable.
        expect(result.truncated).toEqual({ limit: 3, fetched: 5 });
    });

    it("ne signale RIEN quand le plafond n'a pas mordu — le membre est absent, pas faux", async () => {
        mockFetch([
            { body: makeFeatureCollection([{ type: "Feature", geometry: null, properties: {} }]) },
        ]);

        const result = await fetchOgcApiFeatures({
            url: "https://api.example.com/items",
            maxFeatures: 10,
        });

        // Absent rather than `truncated: false`: a consumer serialising the
        // collection does not carry a field saying nothing, and
        // `if (fc.truncated)` stays the right read.
        expect("truncated" in result).toBe(false);
    });

    it("applies bbox query parameter", async () => {
        mockFetch([{ body: makeFeatureCollection() }]);

        await fetchOgcApiFeatures({
            url: "https://api.example.com/items",
            bbox: [2.0, 48.0, 3.0, 49.0],
        });

        const calledUrl = global.fetch.mock.calls[0][0];
        expect(calledUrl).toContain("bbox=2");
    });

    it("overrides config bbox with the explicit bbox argument", async () => {
        mockFetch([{ body: makeFeatureCollection() }]);

        await fetchOgcApiFeatures(
            { url: "https://api.example.com/items", bbox: [0, 0, 1, 1] },
            undefined,
            [5.0, 45.0, 6.0, 46.0]
        );

        const calledUrl = global.fetch.mock.calls[0][0];
        expect(calledUrl).toContain("bbox=5");
    });

    it("honours AbortSignal and stops pagination", async () => {
        const controller = new AbortController();
        const page1 = makeFeatureCollection([], {
            links: [{ rel: "next", href: "https://api.example.com/items?offset=1" }],
        });

        global.fetch = vi.fn().mockImplementation(async () => {
            controller.abort(); // abort after first call
            return { ok: true, status: 200, json: async () => page1 };
        });

        const result = await fetchOgcApiFeatures(
            { url: "https://api.example.com/items" },
            controller.signal
        );

        // Only one fetch call — loop stopped after abort
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(result.type).toBe("FeatureCollection");
    });

    it("throws on invalid (disallowed) URL", async () => {
        await expect(fetchOgcApiFeatures({ url: "ftp://bad.example.com/items" })).rejects.toThrow(
            /Invalid or disallowed URL/
        );
    });

    it("throws on HTTP error status", async () => {
        mockFetch([{ ok: false, status: 403, body: {} }]);

        await expect(fetchOgcApiFeatures({ url: "https://api.example.com/items" })).rejects.toThrow(
            /HTTP 403/
        );
    });

    it("throws when response is not a FeatureCollection", async () => {
        mockFetch([{ body: { type: "Feature", geometry: null, properties: {} } }]);

        await expect(fetchOgcApiFeatures({ url: "https://api.example.com/items" })).rejects.toThrow(
            /not a valid FeatureCollection/
        );
    });

    it("converts string WKT geometry to GeoJSON using wktToGeoJSON", async () => {
        const features = [{ type: "Feature", geometry: "POINT(1 2)", properties: {} }];
        mockFetch([{ body: makeFeatureCollection(features) }]);

        const result = await fetchOgcApiFeatures({ url: "https://api.example.com/items" });

        expect(result.features[0].geometry).toEqual({ type: "Point", coordinates: [1, 2] });
    });

    it("throws when network request fails", async () => {
        global.fetch = vi.fn().mockRejectedValue(new Error("Network failure"));

        await expect(fetchOgcApiFeatures({ url: "https://api.example.com/items" })).rejects.toThrow(
            /Network error/
        );
    });

    it("appends collectionId to base URL when provided", async () => {
        mockFetch([{ body: makeFeatureCollection() }]);

        await fetchOgcApiFeatures({
            url: "https://api.example.com",
            collectionId: "roads",
        });

        const calledUrl = global.fetch.mock.calls[0][0];
        expect(calledUrl).toContain("/collections/roads/items");
    });

    it("returns empty FeatureCollection on empty page with no next link", async () => {
        mockFetch([{ body: makeFeatureCollection([]) }]);

        const result = await fetchOgcApiFeatures({ url: "https://api.example.com/items" });
        expect(result.features).toHaveLength(0);
    });
});

// ─── setupAutoRefresh ─────────────────────────────────────────────────────────

describe("ogc-api-loader — setupAutoRefresh", () => {
    it("registers moveend listener and invokes reloadFn with viewport bbox", () => {
        const handlers = {};
        const map = {
            on: (event, fn) => {
                handlers[event] = fn;
            },
            off: (event, fn) => {
                if (handlers[event] === fn) delete handlers[event];
            },
            getBounds: () => ({
                getWest: () => 1,
                getSouth: () => 2,
                getEast: () => 3,
                getNorth: () => 4,
            }),
        };

        const reloadFn = vi.fn();
        setupAutoRefresh(
            map,
            { url: "https://api.example.com/items", autoRefresh: true },
            reloadFn
        );

        // Simulate moveend
        handlers["moveend"]?.();

        expect(reloadFn).toHaveBeenCalledWith([1, 2, 3, 4]);
    });

    it("cleanup function removes the moveend listener", () => {
        const handlers = {};
        const map = {
            on: (event, fn) => {
                handlers[event] = fn;
            },
            off: (event, fn) => {
                if (handlers[event] === fn) delete handlers[event];
            },
            getBounds: () => ({
                getWest: () => 0,
                getSouth: () => 0,
                getEast: () => 1,
                getNorth: () => 1,
            }),
        };

        const reloadFn = vi.fn();
        const cleanup = setupAutoRefresh(
            map,
            { url: "https://api.example.com/items", autoRefresh: true },
            reloadFn
        );
        cleanup();

        // After cleanup, listener should be removed
        expect(handlers["moveend"]).toBeUndefined();
    });
});

// ─── Pagination by declared cursor ────────────────────────────────────────────
//
// 🛑 THIS BLOCK DOES NOT USE `mockFetch`. That helper replays the LAST page
// indefinitely (`pages[call++] ?? pages[pages.length - 1]`): served with an
// envelope always carrying a cursor, it does not yield a red test — it
// yields a test THAT NEVER ENDS. Overnight, that is a stuck batch, not a red
// to bisect. The mock below is BOUNDED: it throws at the 4th call, so a loop
// that does not stop fails saying so.
describe("pagination par curseur déclaré", () => {
    /**
     * Serves exactly the pages provided, then THROWS.
     *
     * @param {Array<object>} pages The envelopes to serve, in order.
     */
    function boundedFetch(pages) {
        let call = 0;
        global.fetch = vi.fn().mockImplementation(async () => {
            if (call >= pages.length) {
                throw new Error(
                    `${call + 1}th page requested — the loop did not stop on a missing cursor`
                );
            }
            const page = pages[call++];
            return {
                ok: true,
                status: 200,
                headers: { get: () => "application/geo+json" },
                json: async () => page,
            };
        });
        return () => call;
    }

    const withCursor = (id, cursor) => ({
        type: "FeatureCollection",
        features: [{ type: "Feature", id, geometry: null, properties: {} }],
        ...(cursor ? { pagination: { next_cursor: cursor } } : {}),
    });

    it("suit le chemin pointé déclaré, et s'arrête quand il disparaît", async () => {
        const calls = boundedFetch([
            withCursor(1, "https://example.test/items?cursor=b"),
            withCursor(2, "https://example.test/items?cursor=c"),
            withCursor(3, null),
        ]);

        const result = await fetchOgcApiFeatures({
            url: "https://example.test",
            collectionId: "c",
            cursorPath: "pagination.next_cursor",
        });

        expect(result.features).toHaveLength(3);
        expect(calls()).toBe(3);
    });

    it("sans `cursorPath`, la relation de lien standard reste seule maîtresse", async () => {
        const calls = boundedFetch([
            {
                type: "FeatureCollection",
                features: [{ type: "Feature", id: 1, geometry: null, properties: {} }],
                // A cursor is there, but nothing declares it: it must be IGNORED.
                pagination: { next_cursor: "https://example.test/items?cursor=b" },
            },
        ]);

        const result = await fetchOgcApiFeatures({
            url: "https://example.test",
            collectionId: "c",
        });

        expect(result.features).toHaveLength(1);
        expect(calls()).toBe(1);
    });

    it("une valeur qui n'est pas une URL absolue arrête la pagination et le DIT", async () => {
        // The logging module is mocked at the top of the file: THAT double is
        // the one to query, not the real one — importing it here returns the
        // mock, by construction.
        const warn = __log.warn;
        warn.mockClear();
        const calls = boundedFetch([withCursor(1, "eyJvZmZzZXQiOjEwfQ==")]);

        const result = await fetchOgcApiFeatures({
            url: "https://example.test",
            collectionId: "c",
            cursorPath: "pagination.next_cursor",
        });

        expect(result.features).toHaveLength(1);
        expect(calls()).toBe(1);
        // The path AND the value's start must be named: without them, an
        // integrator who misdeclared their path cannot know which of the two
        // is at fault.
        const said = warn.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
        expect(said).toContain("pagination.next_cursor");
    });
});
