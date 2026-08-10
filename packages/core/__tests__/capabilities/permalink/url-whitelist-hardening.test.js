/**
 * @fileoverview Permalink URL — `fields` whitelist enforcement + parser hardening.
 *
 * Covers roadmap entries B.37 (the `fields` whitelist was never consulted on the
 * compact path, neither on read nor on write) and B.42 (`lat`/`lng`/`zoom` are
 * structurally mandatory — they are declared as such instead of being offered as
 * inert whitelist entries), plus the three hardening asymmetries of the same
 * surface: `gl_rating` bypassing `validateNumber`, an empty `gl_lat=` slipping
 * through the `=== null` guard, and list ELEMENTS never being length-capped.
 */

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

vi.mock("../../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Faithful in-test replica of the real security validators (same contract as the
// other permalink suites): validateNumber rejects non-finite and out-of-range.
// B.12 — complet par construction (voir security/permalink-injection.test.js).
vi.mock("../../../src/kernel/security/index.js", async (importActual) => ({
    ...(await importActual()),
    validateCoordinates(lat, lng) {
        if (!Number.isFinite(lat) || !Number.isFinite(lng))
            throw new RangeError("Coordinates must be finite");
        if (lat < -90 || lat > 90) throw new RangeError(`Latitude out of range: ${lat}`);
        if (lng < -180 || lng > 180) throw new RangeError(`Longitude out of range: ${lng}`);
        return [lat, lng];
    },
    validateNumber(value, min = -Infinity, max = Infinity) {
        const num = Number(value);
        if (!Number.isFinite(num) || num < min || num > max) return null;
        return num;
    },
}));

import {
    readUrl,
    buildUrl,
    MAX_TEXT_LEN,
} from "../../../src/capabilities/permalink/permalink-url.js";
import { DEFAULT_PERMALINK_FIELDS } from "../../../src/capabilities/permalink/constants.js";
import { PERMALINK_CAPABILITY } from "../../../src/capabilities/permalink/permalink-capability.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function setHash(hash) {
    Object.defineProperty(window, "location", {
        writable: true,
        value: { ...window.location, hash: `#${hash}`, search: "" },
    });
}

/** Full whitelist — every optional facet allowed. */
const ALL = { mode: "hash", fields: [...DEFAULT_PERMALINK_FIELDS] };

/** State carrying every optional facet, used to prove what a restricted config drops. */
const RICH_STATE = {
    lat: 48.85,
    lng: 2.35,
    zoom: 12,
    layers: ["l1"],
    shownLayers: ["s1"],
    filter: "cafe",
    categories: ["c1"],
    tags: ["t1"],
    rating: 3,
    theme: "night",
};

/**
 * Decode the compact payload the way `readUrl` does — `URLSearchParams.toString()`
 * percent-encodes the base64 (`=` → `%3D`), so the raw fragment cannot be fed to atob.
 */
function decodeCompact(url) {
    return JSON.parse(atob(new URLSearchParams(url.slice(1)).get("gl")));
}

afterEach(() => {
    Object.defineProperty(window, "location", {
        writable: true,
        value: { hash: "", search: "", pathname: "/", origin: "http://localhost" },
    });
});

// ── B.37 — the `fields` whitelist on the compact path ─────────────────────────

describe("B.37 — compact READ honours the `fields` whitelist", () => {
    it("drops every facet absent from `fields` when decoding a forged compact URL", () => {
        setHash(`gl=${btoa(JSON.stringify(RICH_STATE))}`);

        const state = readUrl({ mode: "compact", fields: ["layers"] });

        expect(state).not.toBeNull();
        // The view state is mandatory and always restored.
        expect(state.lat).toBe(48.85);
        expect(state.zoom).toBe(12);
        // The single whitelisted facet survives…
        expect(state.layers).toEqual(["l1"]);
        // …every other one is dropped, exactly as on the verbose path.
        expect(state.shownLayers).toBeUndefined();
        expect(state.filter).toBeUndefined();
        expect(state.categories).toBeUndefined();
        expect(state.tags).toBeUndefined();
        expect(state.rating).toBeUndefined();
        expect(state.theme).toBeUndefined();
    });

    it("an empty whitelist decodes to the view state only", () => {
        setHash(`gl=${btoa(JSON.stringify(RICH_STATE))}`);

        const state = readUrl({ mode: "compact", fields: [] });

        expect(state).toEqual({ lat: 48.85, lng: 2.35, zoom: 12 });
    });

    it("a compact URL cannot smuggle a facet the verbose path would have refused", () => {
        // Same restricted config, same payload, two encodings → same parsed state.
        const config = { mode: "hash", fields: ["theme"] };

        setHash(`gl=${btoa(JSON.stringify(RICH_STATE))}`);
        const fromCompact = readUrl(config);

        setHash("gl_lat=48.85&gl_lng=2.35&gl_zoom=12&gl_filter=cafe&gl_theme=night&gl_tags=t1");
        const fromVerbose = readUrl(config);

        expect(fromCompact.filter).toBe(fromVerbose.filter);
        expect(fromCompact.tags).toEqual(fromVerbose.tags);
        expect(fromCompact.theme).toBe("night");
    });
});

describe("B.37 — compact WRITE honours the `fields` whitelist", () => {
    it("explicit compact mode serialises only the whitelisted facets", () => {
        const url = buildUrl(RICH_STATE, { mode: "compact", fields: ["layers"] });

        expect(url).toMatch(/^#gl=/);
        const decoded = decodeCompact(url);
        expect(decoded.lat).toBe(48.85);
        expect(decoded.layers).toEqual(["l1"]);
        expect(decoded.filter).toBeUndefined();
        expect(decoded.theme).toBeUndefined();
        expect(decoded.categories).toBeUndefined();
        expect(decoded.tags).toBeUndefined();
        expect(decoded.rating).toBeUndefined();
        expect(decoded.shownLayers).toBeUndefined();
    });

    it("AUTO-compact (long URL, mode hash) serialises only the whitelisted facets", () => {
        // 20 long ids push the verbose param string past AUTO_COMPACT_THRESHOLD (200),
        // so the compact branch is taken WITHOUT `mode: "compact"`.
        const manyLayers = Array.from({ length: 20 }, (_, i) => `very-long-layer-name-${i}`);
        const url = buildUrl(
            { ...RICH_STATE, layers: manyLayers },
            { mode: "hash", fields: ["layers"] }
        );

        expect(url).toMatch(/^#gl=/);
        const decoded = decodeCompact(url);
        expect(decoded.layers).toEqual(manyLayers);
        expect(decoded.filter).toBeUndefined();
        expect(decoded.theme).toBeUndefined();
        expect(decoded.rating).toBeUndefined();
    });

    it("round-trip: what a restricted config writes, it reads back identically", () => {
        const config = { mode: "compact", fields: ["categories", "tags"] };
        const url = buildUrl(RICH_STATE, config);
        setHash(url.slice(1));

        expect(readUrl(config)).toEqual({
            lat: 48.85,
            lng: 2.35,
            zoom: 12,
            categories: ["c1"],
            tags: ["t1"],
        });
    });
});

// ── Hardening 1 — `gl_rating` must go through validateNumber ──────────────────

describe("hardening — rating is validated like every other numeric field", () => {
    it("rejects an infinite gl_rating (verbose path)", () => {
        setHash("gl_lat=48.85&gl_lng=2.35&gl_zoom=12&gl_rating=Infinity");

        const state = readUrl(ALL);

        expect(state).not.toBeNull();
        expect(state.rating).toBeUndefined();
    });

    it("rejects an infinite rating smuggled through the compact payload (1e400)", () => {
        // JSON.parse('1e400') yields Infinity — the compact path never re-validated it.
        setHash(`gl=${btoa('{"lat":48.85,"lng":2.35,"zoom":12,"rating":1e400}')}`);

        const state = readUrl(ALL);

        expect(state).not.toBeNull();
        expect(state.rating).toBeUndefined();
    });

    it("still accepts a plain positive rating on both paths", () => {
        setHash("gl_lat=48.85&gl_lng=2.35&gl_zoom=12&gl_rating=3.5");
        expect(readUrl(ALL).rating).toBe(3.5);

        setHash(`gl=${btoa(JSON.stringify({ lat: 48.85, lng: 2.35, zoom: 12, rating: 4 }))}`);
        expect(readUrl(ALL).rating).toBe(4);
    });
});

// ── Hardening 2 — present-but-empty view params ───────────────────────────────

describe("hardening — an empty view param is not a zero", () => {
    it("rejects `gl_lat=` instead of silently recentring on 0,0", () => {
        setHash("gl_lat=&gl_lng=2.35&gl_zoom=12");

        expect(readUrl(ALL)).toBeNull();
    });

    it("rejects `gl_lng=` and `gl_zoom=` the same way", () => {
        setHash("gl_lat=48.85&gl_lng=&gl_zoom=12");
        expect(readUrl(ALL)).toBeNull();

        setHash("gl_lat=48.85&gl_lng=2.35&gl_zoom=");
        expect(readUrl(ALL)).toBeNull();
    });

    it("rejects a whitespace-only view param", () => {
        setHash("gl_lat=%20&gl_lng=2.35&gl_zoom=12");

        expect(readUrl(ALL)).toBeNull();
    });

    it("still accepts a legitimate zero latitude", () => {
        setHash("gl_lat=0&gl_lng=0&gl_zoom=0");

        expect(readUrl(ALL)).toEqual({ lat: 0, lng: 0, zoom: 0 });
    });
});

// ── Hardening 3 — list ELEMENTS are length-capped, not just counted ───────────

describe("hardening — list elements are capped at MAX_TEXT_LEN", () => {
    it("caps each verbose list element (layers / shownLayers / categories / tags)", () => {
        const huge = "x".repeat(500);
        setHash(
            `gl_lat=48.85&gl_lng=2.35&gl_zoom=12&gl_layers=${huge},ok` +
                `&gl_shown=${huge}&gl_cats=${huge}&gl_tags=${huge}`
        );

        const state = readUrl(ALL);

        expect(state.layers[0].length).toBe(MAX_TEXT_LEN);
        expect(state.layers[1]).toBe("ok");
        expect(state.shownLayers[0].length).toBe(MAX_TEXT_LEN);
        expect(state.categories[0].length).toBe(MAX_TEXT_LEN);
        expect(state.tags[0].length).toBe(MAX_TEXT_LEN);
    });

    it("caps each compact list element too", () => {
        const huge = "y".repeat(5000);
        setHash(
            `gl=${btoa(
                JSON.stringify({
                    lat: 48.85,
                    lng: 2.35,
                    zoom: 12,
                    layers: [huge, "ok"],
                    shownLayers: [huge],
                    categories: [huge],
                    tags: [huge],
                })
            )}`
        );

        const state = readUrl(ALL);

        expect(state.layers[0].length).toBe(MAX_TEXT_LEN);
        expect(state.layers[1]).toBe("ok");
        expect(state.shownLayers[0].length).toBe(MAX_TEXT_LEN);
        expect(state.categories[0].length).toBe(MAX_TEXT_LEN);
        expect(state.tags[0].length).toBe(MAX_TEXT_LEN);
    });
});

// ── B.42 — `lat` / `lng` / `zoom` are mandatory, not whitelistable ────────────

describe("B.42 — the view triple is declared mandatory, not offered as inert enum values", () => {
    it("DEFAULT_PERMALINK_FIELDS lists only the seven optional facets", () => {
        expect([...DEFAULT_PERMALINK_FIELDS]).toEqual([
            "layers",
            "shownLayers",
            "filter",
            "categories",
            "tags",
            "rating",
            "theme",
        ]);
    });

    it("the capability schema no longer offers lat/lng/zoom in the fields enum", () => {
        const schema = PERMALINK_CAPABILITY.configSchema.fields;
        expect(schema.items.enum).not.toContain("lat");
        expect(schema.items.enum).not.toContain("lng");
        expect(schema.items.enum).not.toContain("zoom");
        expect(schema.default).not.toContain("lat");
    });

    it("the view state is serialised and parsed even with an empty whitelist", () => {
        const url = buildUrl({ lat: 48.85, lng: 2.35, zoom: 12 }, { mode: "hash", fields: [] });
        expect(url).toContain("gl_lat=");
        expect(url).toContain("gl_lng=");
        expect(url).toContain("gl_zoom=");

        setHash(url.slice(1));
        expect(readUrl({ mode: "hash", fields: [] })).toEqual({
            lat: 48.85,
            lng: 2.35,
            zoom: 12,
        });
    });
});
