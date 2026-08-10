/**
 * @fileoverview Permalink compact encoding — UTF-8 safety and legacy compatibility (B.43).
 *
 * The compact payload was `btoa(JSON.stringify(state))`. `btoa` THROWS on any code point
 * above 255, so a text filter in CJK or Cyrillic — or a single typographic ellipsis —
 * made the encoding fail. The failure was silent where it matters: `startSync._doWrite`
 * catches it (permalink-sync.ts:346), so the URL simply stopped tracking the map with
 * nothing logged and nothing broken on screen.
 *
 * It was reachable WITHOUT asking for it: `shouldCompact` flips automatically past
 * AUTO_COMPACT_THRESHOLD characters, so a profile that never set `mode: "compact"` fell
 * into this path as soon as its state grew.
 *
 * The fix changes the WIRE FORMAT, so it cannot be a substitution: links already emitted
 * carry Latin-1 bytes and must keep resolving. Reading therefore accepts both encodings;
 * writing always uses the new one. These tests pin both halves — a fix that broke legacy
 * links would pass the UTF-8 half alone.
 */

vi.mock("../../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

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

import { readUrl, buildUrl } from "../../../src/capabilities/permalink/permalink-url.js";

function setHash(hash) {
    Object.defineProperty(window, "location", {
        value: { hash, search: "", href: `https://x.test/${hash}` },
        writable: true,
        configurable: true,
    });
}

const CONFIG = { mode: "hash" };
const VIEW = { lat: 48.85, lng: 2.35, zoom: 12 };

/** The pre-B.43 encoder, kept verbatim so "legacy" means legacy and not a paraphrase. */
const legacyEncode = (state) => btoa(JSON.stringify(state));

describe("permalink compact payload — UTF-8 safety (B.43)", () => {
    it.each([
        ["CJK", "東京"],
        ["Cyrillic", "Привет"],
        ["a typographic ellipsis alone", "Rechercher…"],
        ["emoji", "café 🍰"],
    ])("encodes a %s filter instead of throwing", (_label, filter) => {
        expect(() => buildUrl({ ...VIEW, filter }, { mode: "compact" })).not.toThrow();
    });

    it.each([
        ["CJK", "東京"],
        ["Cyrillic", "Привет"],
        ["a typographic ellipsis alone", "Rechercher…"],
        ["emoji", "café 🍰"],
        ["Latin-1 accents", "café"],
        ["plain ASCII", "cafe"],
    ])("round-trips a %s filter through the compact form", (_label, filter) => {
        const url = buildUrl({ ...VIEW, filter }, { mode: "compact" });
        setHash(url);
        expect(readUrl(CONFIG)?.filter).toBe(filter);
    });

    it("round-trips a mixed-script list, not just a scalar", () => {
        const tags = ["東京", "Привет", "café", "plain"];
        const url = buildUrl({ ...VIEW, tags }, { mode: "compact" });
        setHash(url);
        expect(readUrl(CONFIG)?.tags).toEqual(tags);
    });

    it("survives AUTO-compact — the path a profile reaches without asking for it", () => {
        // Long enough to trip AUTO_COMPACT_THRESHOLD in "hash" mode, and non-Latin-1.
        const layers = Array.from({ length: 20 }, (_, i) => `couche-東京-${i}`);
        const url = buildUrl({ ...VIEW, layers }, { mode: "hash" });
        expect(url.startsWith("#gl=")).toBe(true);
        setHash(url);
        expect(readUrl(CONFIG)?.layers).toEqual(layers);
    });
});

describe("permalink compact payload — legacy links keep resolving (B.43)", () => {
    it("reads a legacy ASCII payload", () => {
        setHash("#gl=" + encodeURIComponent(legacyEncode({ ...VIEW, filter: "cafe" })));
        expect(readUrl(CONFIG)?.filter).toBe("cafe");
    });

    it("reads a legacy Latin-1 payload — the bytes the old encoder actually emitted", () => {
        // "café" was accepted by the old btoa and stored as ONE byte (0xE9). Decoded as
        // UTF-8 that byte is invalid, so a naive switch to UTF-8 would break this link.
        const legacy = legacyEncode({ ...VIEW, filter: "café" });
        expect(atob(legacy)).toContain("café"); // pins that it really is Latin-1
        setHash("#gl=" + encodeURIComponent(legacy));
        expect(readUrl(CONFIG)?.filter).toBe("café");
    });

    it("reads a legacy payload carrying every Latin-1 high byte the old encoder allowed", () => {
        const filter = "àâçéèêëîïôùûü°±µ";
        const legacy = legacyEncode({ ...VIEW, filter });
        setHash("#gl=" + encodeURIComponent(legacy));
        expect(readUrl(CONFIG)?.filter).toBe(filter);
    });

    it("still rejects a corrupt payload rather than guessing", () => {
        setHash("#gl=" + encodeURIComponent("not-base64-at-all!!"));
        expect(readUrl(CONFIG)).toBeNull();
    });

    it("still rejects valid base64 that is not JSON", () => {
        setHash("#gl=" + encodeURIComponent(btoa("plain text, not json")));
        expect(readUrl(CONFIG)).toBeNull();
    });
});
