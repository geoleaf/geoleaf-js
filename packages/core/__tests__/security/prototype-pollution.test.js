/**
 * @file prototype-pollution.test.js
 * @description Prototype-pollution coverage for the config normalization pipeline.
 *
 * ⚠️ Rewritten. This file used to test `_safeAssign()`,
 * a helper in config/normalization.ts that lost its last production caller to a perf
 * change on 2026-02-18 (commit 15cc5cf7 — the per-POI object copy was dropped) and was
 * removed with it. Worse, the file MOCKED `ConfigStore.setValueByPath` — the sink
 * the pipeline actually writes through — so it asserted on a function nobody called while
 * the real write path went unguarded. That asymmetry is why the hole survived.
 *
 * It now drives the real chain end to end, with NO ConfigStore mock:
 *   normalizePoiWithMapping -> mapRawPoiToNormalized -> ConfigStore.setValueByPath
 * `targetPath` is attacker-shaped here on purpose: those keys come from a profile's
 * mapping.json, i.e. from a config file rather than from the code.
 */

const mockLog = vi.hoisted(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

vi.mock("../../src/utils/log/index.js", () => ({ Log: mockLog }));

// NO mock for built-in/config/storage.js — exercising the real sink is the point.
import { ConfigNormalizer } from "../../src/kernel/config/normalization.js";

/** A raw POI shaped like a GBIF/OurAirports record, plus the payload a hostile map would graft. */
const rawPoi = () => ({
    ref_id: "a1",
    ref_name: "Point A",
    lat: 48.85,
    lon: 2.35,
    payload: "PWNED",
});

/** mapping.json contract: `{ <sourceId>: { mapping } }` (ANO-083, per-source blocks). */
const mappingConfig = (mapping) => ({ evil: { source: "evil", mapping } });

const LEGIT = {
    id: "ref_id",
    title: "ref_name",
    "location.lat": "lat",
    "location.lng": "lon",
};

afterEach(() => {
    vi.clearAllMocks();
    // Scrub anything a failing assertion may have leaked into the global prototype.
    delete Object.prototype.polluted;
    delete Object.prototype.injected;
    delete Object.prototype.owned;
});

describe("Prototype pollution — profile mapping.json cannot graft properties onto POIs", () => {
    it("refuses a __proto__ segment while still applying the legitimate mapping", () => {
        const [poi] = ConfigNormalizer.normalizePoiWithMapping(
            [rawPoi()],
            mappingConfig({ ...LEGIT, "__proto__.polluted": "payload" })
        );

        // The legitimate half of the mapping must keep working — a guard that also
        // breaks valid profiles would be caught here.
        expect(poi.id).toBe("a1");
        expect(poi.title).toBe("Point A");
        expect(poi.location).toEqual({ lat: 48.85, lng: 2.35 });

        // Scoped injection: before the fix, `poi.polluted` inherited "PWNED".
        expect(poi.polluted).toBeUndefined();
        expect(Object.getPrototypeOf(poi)).toBe(Object.prototype);
        expect({}.polluted).toBeUndefined();
    });

    it("refuses a __proto__ segment nested under the attributes bag", () => {
        const [poi] = ConfigNormalizer.normalizePoiWithMapping(
            [rawPoi()],
            mappingConfig({ ...LEGIT, "attributes.__proto__.injected": "payload" })
        );

        expect(poi.attributes.injected).toBeUndefined();
        expect(Object.getPrototypeOf(poi.attributes)).toBe(Object.prototype);
        expect({}.injected).toBeUndefined();
    });

    it("refuses constructor/prototype segments", () => {
        const [poi] = ConfigNormalizer.normalizePoiWithMapping(
            [rawPoi()],
            mappingConfig({ ...LEGIT, "constructor.prototype.owned": "payload" })
        );

        expect(poi.owned).toBeUndefined();
        expect(Object.prototype.owned).toBeUndefined();
        expect({}.owned).toBeUndefined();
    });

    it("refuses a single-segment __proto__ path (skips the descent loop)", () => {
        const [poi] = ConfigNormalizer.normalizePoiWithMapping(
            [rawPoi()],
            mappingConfig({ ...LEGIT, __proto__: "payload" })
        );

        expect(poi.id).toBe("a1");
        expect(Object.getPrototypeOf(poi)).toBe(Object.prototype);
    });

    it("leaves a fully legitimate mapping untouched", () => {
        const [poi] = ConfigNormalizer.normalizePoiWithMapping(
            [rawPoi()],
            mappingConfig({ ...LEGIT, "attributes.kind": "payload" })
        );

        expect(poi.attributes.kind).toBe("PWNED");
        expect(mockLog.warn).not.toHaveBeenCalledWith(
            "[GeoLeaf.Config.Storage] Prototype pollution attempt blocked",
            expect.anything()
        );
    });

    it("logs the blocked attempt once per offending path, not once per segment", () => {
        ConfigNormalizer.normalizePoiWithMapping(
            [rawPoi()],
            mappingConfig({ ...LEGIT, "constructor.prototype.owned": "payload" })
        );

        const blocked = mockLog.warn.mock.calls.filter(
            ([msg]) => msg === "[GeoLeaf.Config.Storage] Prototype pollution attempt blocked"
        );
        expect(blocked).toHaveLength(1);
    });
});
