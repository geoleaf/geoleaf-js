/**
 * @fileoverview Permalink URL parameter injection tests.
 * Validates that XSS payloads, prototype pollution, and DoS via URL params
 * are properly rejected by the permalink parsing system.
 */

// ── Hoisted mocks ──

const mockLog = vi.hoisted(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

vi.mock("../../src/utils/log/index.js", () => ({ Log: mockLog }));

// Use real security functions (we are testing that they actually protect)
// Complete by construction: the `validateCoordinates` replica stays the
// override, the barrel's 16 other exports become real again.
vi.mock("../../src/kernel/security/index.js", async (importActual) => ({
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

// ⚠️ Two `vi.mock()`s aiming at `kernel/geojson/visibility-manager.js` and
// `kernel/geojson/shared.js` lived here. They were DEAD: the only module
// under test, `capabilities/permalink/permalink-url.ts`, imports only
// `kernel/security/index.js`, config types and its own neighbours — no
// edge towards `geojson/`. Remnants of the permalink ↔ DOM-filter
// decoupling (scraping and ghost-injection removed, `permalink-restore`
// reduced to layer visibility). Removed rather than rewired: unlike the
// `coverage-modules-themes` mocks — same campaign, wrong path towards a
// REALLY imported target —, there is nothing to isolate here.

import { readUrl, MAX_TEXT_LEN } from "../../src/capabilities/permalink/permalink-url.js";

// ── Helpers ──

// B.42: the view triple (lat/lng/zoom) is no longer whitelistable — it is mandatory
// and always parsed. Listing it here was harmless (the entries were ignored) but read
// as if the view were opt-in. This is the full set of facets `fields` actually gates.
const DEFAULT_CONFIG = {
    mode: "hash",
    fields: ["layers", "shownLayers", "filter", "categories", "tags", "rating", "theme"],
};

function setHash(hash) {
    Object.defineProperty(window, "location", {
        writable: true,
        value: { ...window.location, hash: `#${hash}`, search: "" },
    });
}

describe("Permalink Injection Tests — Security Audit", () => {
    afterEach(() => {
        vi.clearAllMocks();
        // Reset location
        Object.defineProperty(window, "location", {
            writable: true,
            value: { hash: "", search: "", origin: "http://localhost" },
        });
    });

    // ── 1. XSS in numeric fields (lat/lng/zoom) ──

    describe("numeric field injection", () => {
        test("rejects <script> in gl_lat", () => {
            setHash("gl_lat=<script>alert(1)</script>&gl_lng=2.35&gl_zoom=12");
            const result = readUrl(DEFAULT_CONFIG);
            expect(result).toBeNull();
        });

        test("rejects NaN in gl_lat", () => {
            setHash("gl_lat=NaN&gl_lng=2.35&gl_zoom=12");
            const result = readUrl(DEFAULT_CONFIG);
            expect(result).toBeNull();
        });

        test("rejects Infinity in gl_lng", () => {
            setHash("gl_lat=48.85&gl_lng=Infinity&gl_zoom=12");
            const result = readUrl(DEFAULT_CONFIG);
            expect(result).toBeNull();
        });

        test("rejects out-of-range latitude (91)", () => {
            setHash("gl_lat=91&gl_lng=2.35&gl_zoom=12");
            const result = readUrl(DEFAULT_CONFIG);
            expect(result).toBeNull();
        });

        test("rejects out-of-range longitude (-181)", () => {
            setHash("gl_lat=48.85&gl_lng=-181&gl_zoom=12");
            const result = readUrl(DEFAULT_CONFIG);
            expect(result).toBeNull();
        });

        test("rejects zoom > 28", () => {
            setHash("gl_lat=48.85&gl_lng=2.35&gl_zoom=99");
            const result = readUrl(DEFAULT_CONFIG);
            expect(result).toBeNull();
        });

        test("accepts valid coordinates", () => {
            setHash("gl_lat=48.8566&gl_lng=2.3522&gl_zoom=12");
            const result = readUrl(DEFAULT_CONFIG);
            expect(result).not.toBeNull();
            expect(result.lat).toBe(48.8566);
            expect(result.lng).toBe(2.3522);
            expect(result.zoom).toBe(12);
        });
    });

    // ── 2. XSS in text fields (filter, theme) ──

    describe("text field injection", () => {
        test("truncates XSS payload in gl_filter to MAX_TEXT_LEN", () => {
            const xss = "<img src=x onerror=alert(1)>";
            setHash(`gl_lat=48.85&gl_lng=2.35&gl_zoom=12&gl_filter=${encodeURIComponent(xss)}`);
            const result = readUrl(DEFAULT_CONFIG);
            expect(result).not.toBeNull();
            // Filter stores the raw string but caps at 200 chars
            expect(result.filter.length).toBeLessThanOrEqual(MAX_TEXT_LEN);
        });

        test("truncates long filter to 200 chars", () => {
            const longStr = "a".repeat(500);
            setHash(`gl_lat=48.85&gl_lng=2.35&gl_zoom=12&gl_filter=${longStr}`);
            const result = readUrl(DEFAULT_CONFIG);
            expect(result).not.toBeNull();
            expect(result.filter.length).toBe(MAX_TEXT_LEN);
        });

        test("truncates XSS in gl_theme", () => {
            setHash(
                `gl_lat=48.85&gl_lng=2.35&gl_zoom=12&gl_theme=${encodeURIComponent('"><script>alert(1)</script>')}`
            );
            const result = readUrl(DEFAULT_CONFIG);
            expect(result).not.toBeNull();
            expect(result.theme.length).toBeLessThanOrEqual(MAX_TEXT_LEN);
        });
    });

    // ── 3. XSS in array fields (layers, categories) ──

    describe("array field injection", () => {
        test("filters out empty layer IDs from split", () => {
            setHash("gl_lat=48.85&gl_lng=2.35&gl_zoom=12&gl_layers=layer1,,layer2,");
            const result = readUrl(DEFAULT_CONFIG);
            expect(result).not.toBeNull();
            expect(result.layers).toEqual(["layer1", "layer2"]);
        });

        test("caps layers array at 100 entries", () => {
            const manyLayers = Array.from({ length: 150 }, (_, i) => `layer_${i}`).join(",");
            setHash(`gl_lat=48.85&gl_lng=2.35&gl_zoom=12&gl_layers=${manyLayers}`);
            const result = readUrl(DEFAULT_CONFIG);
            expect(result).not.toBeNull();
            expect(result.layers.length).toBe(100);
        });

        test("XSS payload in layer ID is stored as string (no execution)", () => {
            setHash(
                `gl_lat=48.85&gl_lng=2.35&gl_zoom=12&gl_layers=${encodeURIComponent("<script>alert(1)</script>")},normal_layer`
            );
            const result = readUrl(DEFAULT_CONFIG);
            expect(result).not.toBeNull();
            // Layer IDs are stored as strings — the XSS is only dangerous if injected into DOM
            // Permalink system does NOT inject layer IDs into innerHTML
            expect(result.layers).toContain("normal_layer");
        });

        test("caps categories at 100", () => {
            const manyCats = Array.from({ length: 150 }, (_, i) => `cat_${i}`).join(",");
            setHash(`gl_lat=48.85&gl_lng=2.35&gl_zoom=12&gl_cats=${manyCats}`);
            const result = readUrl(DEFAULT_CONFIG);
            expect(result).not.toBeNull();
            expect(result.categories.length).toBe(100);
        });
    });

    // ── 4. Compact mode (base64 JSON) injection ──

    describe("compact mode injection", () => {
        test("rejects corrupt base64", () => {
            setHash("gl=!!!not-base64!!!");
            const result = readUrl(DEFAULT_CONFIG);
            expect(result).toBeNull();
        });

        test("rejects invalid JSON in base64", () => {
            setHash(`gl=${btoa("not json at all")}`);
            const result = readUrl(DEFAULT_CONFIG);
            expect(result).toBeNull();
        });

        test("rejects base64 with missing required fields", () => {
            setHash(`gl=${btoa(JSON.stringify({ lat: 48.85 }))}`);
            const result = readUrl(DEFAULT_CONFIG);
            expect(result).toBeNull();
        });

        test("rejects base64 with out-of-range coordinates", () => {
            setHash(`gl=${btoa(JSON.stringify({ lat: 999, lng: 2.35, zoom: 12 }))}`);
            const result = readUrl(DEFAULT_CONFIG);
            expect(result).toBeNull();
        });

        test("accepts valid compact state", () => {
            const state = { lat: 48.85, lng: 2.35, zoom: 12, layers: ["layer1"] };
            setHash(`gl=${btoa(JSON.stringify(state))}`);
            const result = readUrl(DEFAULT_CONFIG);
            expect(result).not.toBeNull();
            expect(result.lat).toBe(48.85);
            expect(result.layers).toEqual(["layer1"]);
        });

        test("truncates text fields from compact mode", () => {
            const state = { lat: 48.85, lng: 2.35, zoom: 12, filter: "x".repeat(500) };
            setHash(`gl=${btoa(JSON.stringify(state))}`);
            const result = readUrl(DEFAULT_CONFIG);
            expect(result).not.toBeNull();
            expect(result.filter.length).toBe(MAX_TEXT_LEN);
        });

        test("caps layer arrays from compact mode", () => {
            const state = {
                lat: 48.85,
                lng: 2.35,
                zoom: 12,
                layers: Array.from({ length: 150 }, (_, i) => `l${i}`),
            };
            setHash(`gl=${btoa(JSON.stringify(state))}`);
            const result = readUrl(DEFAULT_CONFIG);
            expect(result).not.toBeNull();
            expect(result.layers.length).toBe(100);
        });

        test("filters non-string entries in layers array from compact mode", () => {
            const state = {
                lat: 48.85,
                lng: 2.35,
                zoom: 12,
                layers: ["ok", 42, null, true, "also_ok"],
            };
            setHash(`gl=${btoa(JSON.stringify(state))}`);
            const result = readUrl(DEFAULT_CONFIG);
            expect(result).not.toBeNull();
            expect(result.layers).toEqual(["ok", "also_ok"]);
        });
    });

    // ── 5. Prototype pollution via compact mode ──

    describe("prototype pollution via compact permalink", () => {
        test("__proto__ in compact JSON does not pollute Object.prototype", () => {
            const malicious = '{"lat":48.85,"lng":2.35,"zoom":12,"__proto__":{"polluted":true}}';
            setHash(`gl=${btoa(malicious)}`);
            readUrl(DEFAULT_CONFIG);
            expect(Object.prototype.polluted).toBeUndefined();
        });

        test("constructor.prototype in compact JSON does not pollute", () => {
            const malicious =
                '{"lat":48.85,"lng":2.35,"zoom":12,"constructor":{"prototype":{"polluted":true}}}';
            setHash(`gl=${btoa(malicious)}`);
            readUrl(DEFAULT_CONFIG);
            expect(Object.prototype.polluted).toBeUndefined();
        });
    });

    // ── 6. Rating field injection ──

    describe("rating field injection", () => {
        test("rejects non-numeric rating", () => {
            setHash("gl_lat=48.85&gl_lng=2.35&gl_zoom=12&gl_rating=<script>");
            const result = readUrl(DEFAULT_CONFIG);
            expect(result).not.toBeNull();
            expect(result.rating).toBeUndefined();
        });

        test("rejects negative rating", () => {
            setHash("gl_lat=48.85&gl_lng=2.35&gl_zoom=12&gl_rating=-5");
            const result = readUrl(DEFAULT_CONFIG);
            expect(result).not.toBeNull();
            expect(result.rating).toBeUndefined();
        });

        test("rejects zero rating", () => {
            setHash("gl_lat=48.85&gl_lng=2.35&gl_zoom=12&gl_rating=0");
            const result = readUrl(DEFAULT_CONFIG);
            expect(result).not.toBeNull();
            expect(result.rating).toBeUndefined();
        });

        test("accepts valid positive rating", () => {
            setHash("gl_lat=48.85&gl_lng=2.35&gl_zoom=12&gl_rating=3.5");
            const result = readUrl(DEFAULT_CONFIG);
            expect(result).not.toBeNull();
            expect(result.rating).toBe(3.5);
        });
    });

    // ── 7. Edge cases ──

    describe("edge cases", () => {
        test("returns null for empty hash", () => {
            setHash("");
            const result = readUrl(DEFAULT_CONFIG);
            expect(result).toBeNull();
        });

        test("returns null for hash with only #", () => {
            Object.defineProperty(window, "location", {
                writable: true,
                value: { hash: "#", search: "", origin: "http://localhost" },
            });
            const result = readUrl(DEFAULT_CONFIG);
            expect(result).toBeNull();
        });

        test("returns null when required fields missing", () => {
            setHash("gl_lat=48.85");
            const result = readUrl(DEFAULT_CONFIG);
            expect(result).toBeNull();
        });
    });
});
