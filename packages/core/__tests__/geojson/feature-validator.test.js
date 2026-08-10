/**
 */
vi.mock("../../src/utils/log/index.js", () => ({
    Log: { warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
import { FeatureValidator } from "../../src/kernel/geojson/feature-validator.ts";

describe("geojson/feature-validator", () => {
    describe("validateFeature", () => {
        it("returns valid for feature with Point and name", () => {
            const r = FeatureValidator.validateFeature({
                type: "Feature",
                geometry: { type: "Point", coordinates: [2, 48] },
                properties: { name: "Test" },
            });
            expect(r.valid).toBe(true);
            expect(r.errors).toHaveLength(0);
        });
        it("returns invalid when type is not Feature", () => {
            const r = FeatureValidator.validateFeature({ type: "x", geometry: {}, properties: {} });
            expect(r.valid).toBe(false);
        });
        it("returns invalid when geometry missing", () => {
            const r = FeatureValidator.validateFeature({
                type: "Feature",
                geometry: null,
                properties: { title: "X" },
            });
            expect(r.valid).toBe(false);
        });
        it("returns invalid when properties missing name/title/label", () => {
            const r = FeatureValidator.validateFeature({
                type: "Feature",
                geometry: { type: "Point", coordinates: [0, 0] },
                properties: {},
            });
            expect(r.valid).toBe(false);
        });
        it("accepts title as name", () => {
            const r = FeatureValidator.validateFeature({
                type: "Feature",
                geometry: { type: "Point", coordinates: [0, 0] },
                properties: { title: "A" },
            });
            expect(r.valid).toBe(true);
        });
        // Warnings (duration_min, rating, color, opacity, weight, distance_km) do not invalidate;
        // validateFeature returns { valid: true, errors: [] } and does not surface validateProperties warnings.
        it("warns when distance_km is negative (feature still valid)", () => {
            const r = FeatureValidator.validateFeature({
                type: "Feature",
                geometry: { type: "Point", coordinates: [0, 0] },
                properties: { name: "X", distance_km: -1 },
            });
            expect(r.valid).toBe(true);
        });
        it("warns when rating out of 0-5 (feature still valid)", () => {
            const r = FeatureValidator.validateFeature({
                type: "Feature",
                geometry: { type: "Point", coordinates: [0, 0] },
                properties: { name: "X", rating: 10 },
            });
            expect(r.valid).toBe(true);
        });
        it("warns when color invalid format (feature still valid)", () => {
            const r = FeatureValidator.validateFeature({
                type: "Feature",
                geometry: { type: "Point", coordinates: [0, 0] },
                properties: { name: "X", color: "nothex" },
            });
            expect(r.valid).toBe(true);
        });
        it("warns when duration_min not a number (feature still valid)", () => {
            const r = FeatureValidator.validateFeature({
                type: "Feature",
                geometry: { type: "Point", coordinates: [0, 0] },
                properties: { name: "X", duration_min: "30" },
            });
            expect(r.valid).toBe(true);
        });
        it("warns when opacity out of 0-1 (feature still valid)", () => {
            const r = FeatureValidator.validateFeature({
                type: "Feature",
                geometry: { type: "Point", coordinates: [0, 0] },
                properties: { name: "X", opacity: 1.5 },
            });
            expect(r.valid).toBe(true);
        });
        it("warns when weight negative (feature still valid)", () => {
            const r = FeatureValidator.validateFeature({
                type: "Feature",
                geometry: { type: "Point", coordinates: [0, 0] },
                properties: { name: "X", weight: -1 },
            });
            expect(r.valid).toBe(true);
        });
    });
    describe("validateGeometry", () => {
        it("accepts LineString", () => {
            const r = FeatureValidator.validateGeometry(
                {
                    type: "LineString",
                    coordinates: [
                        [0, 0],
                        [1, 1],
                    ],
                },
                "id1"
            );
            expect(r.valid).toBe(true);
        });
        it("accepts Polygon", () => {
            const r = FeatureValidator.validateGeometry(
                {
                    type: "Polygon",
                    coordinates: [
                        [
                            [0, 0],
                            [1, 0],
                            [1, 1],
                            [0, 0],
                        ],
                    ],
                },
                "id1"
            );
            expect(r.valid).toBe(true);
        });
        it("rejects null geometry", () => {
            const r = FeatureValidator.validateGeometry(null, "id1");
            expect(r.valid).toBe(false);
        });
        it("rejects coordinates not array", () => {
            const r = FeatureValidator.validateGeometry(
                { type: "Point", coordinates: "not-array" },
                "id1"
            );
            expect(r.valid).toBe(false);
        });
        it("rejects invalid geometry type", () => {
            const r = FeatureValidator.validateGeometry(
                { type: "MultiPoint", coordinates: [[0, 0]] },
                "id1"
            );
            expect(r.valid).toBe(false);
            expect(r.errors.some((e) => e.field === "geometry.type")).toBe(true);
        });
        it("rejects missing geometry.type", () => {
            const r = FeatureValidator.validateGeometry({ coordinates: [0, 0] }, "id1");
            expect(r.valid).toBe(false);
        });
        it("rejects empty coordinates array", () => {
            const r = FeatureValidator.validateGeometry({ type: "Point", coordinates: [] }, "id1");
            expect(r.valid).toBe(false);
        });
    });
    describe("validateFeatureCollection", () => {
        it("returns validFeatures for FeatureCollection", () => {
            const coll = {
                type: "FeatureCollection",
                features: [
                    {
                        type: "Feature",
                        geometry: { type: "Point", coordinates: [0, 0] },
                        properties: { name: "A" },
                    },
                ],
            };
            const r = FeatureValidator.validateFeatureCollection(coll);
            expect(r.validFeatures).toHaveLength(1);
            expect(r.errors).toHaveLength(0);
        });
        it("returns error when collection is null", () => {
            const r = FeatureValidator.validateFeatureCollection(null);
            expect(r.validFeatures).toHaveLength(0);
            expect(r.errors.length).toBeGreaterThan(0);
        });
        it("accepts array of features", () => {
            const arr = [
                {
                    type: "Feature",
                    geometry: { type: "Point", coordinates: [0, 0] },
                    properties: { name: "A" },
                },
            ];
            const r = FeatureValidator.validateFeatureCollection(arr);
            expect(r.validFeatures).toHaveLength(1);
        });
        it("validates and rejects invalid feature in collection", () => {
            const coll = {
                type: "FeatureCollection",
                features: [
                    {
                        type: "Feature",
                        geometry: { type: "Point", coordinates: [0, 0] },
                        properties: { name: "Ok" },
                    },
                    { type: "Feature", geometry: null, properties: { name: "Bad" } },
                ],
            };
            const r = FeatureValidator.validateFeatureCollection(coll);
            expect(r.validFeatures).toHaveLength(1);
            expect(r.errors.length).toBeGreaterThan(0);
        });
        it("accepts single feature object (not FeatureCollection or array)", () => {
            const single = {
                type: "Feature",
                geometry: { type: "Point", coordinates: [0, 0] },
                properties: { name: "Only" },
            };
            const r = FeatureValidator.validateFeatureCollection(single);
            expect(r.validFeatures).toHaveLength(1);
            expect(r.errors).toHaveLength(0);
        });
    });

    // ── URL / email property validation ───────────────────────────────────────
    //
    // These go through validateProperties() directly, NOT validateFeature():
    // URL/email problems are `severity: "warning"` and leave `valid: true`, so
    // validateFeature() never surfaces them (see feature-validator.ts, validateFeature).
    //
    // Assertions target `field` and `severity` — never `message`, so that
    // translating the message strings cannot break this suite.
    describe("validateProperties — URL fields", () => {
        const errsFor = (props) =>
            FeatureValidator.validateProperties({ name: "X", ...props }, "id1").errors;
        const urlErrs = (link) => errsFor({ link }).filter((e) => e.field === "properties.link");

        it.each([
            ["absolute https", "https://example.com/a.png"],
            ["absolute http", "http://example.com/a.png"],
            ["root-relative path", "/img/a.png"],
            ["same-dir relative path", "./a.png"],
            ["parent-dir relative path", "../a.png"],
            ["protocol-relative URL", "//cdn.example.com/a.png"],
            ["data:image URL", "data:image/png;base64,iVBORw0KGgo="],
            ["mailto: scheme", "mailto:contact@example.com"],
            ["tel: scheme", "tel:+33123456789"],
            ["surrounding whitespace", "  https://example.com/a.png  "],
        ])("accepts %s", (_label, link) => {
            expect(urlErrs(link)).toHaveLength(0);
        });

        it.each([
            ["scheme-less host (missing-protocol typo)", "example.com"],
            ["bare word", "foo"],
            ["empty string", ""],
        ])("warns on %s", (_label, link) => {
            const errs = urlErrs(link);
            expect(errs).toHaveLength(1);
            expect(errs[0].severity).toBe("warning");
        });

        // Security lock (KERNEL S6). Before delegating to the canonical security
        // validator, this file was the only URL check in the repo WITHOUT a protocol
        // whitelist: `new URL("javascript:alert(1)")` parses, so a dangerous
        // `properties.link` was accepted silently. These must never go back to green
        // without a warning.
        it.each([
            ["javascript:", "javascript:alert(1)"],
            ["vbscript:", "vbscript:msgbox(1)"],
            ["data:text/html", "data:text/html,<script>alert(1)</script>"],
            ["file://", "file:///etc/passwd"],
        ])("warns on the dangerous %s scheme", (_label, link) => {
            const errs = urlErrs(link);
            expect(errs).toHaveLength(1);
            expect(errs[0].severity).toBe("warning");
        });

        it("ignores a non-string link", () => {
            expect(urlErrs(42)).toHaveLength(0);
        });

        it("ignores an absent link", () => {
            expect(errsFor({})).toHaveLength(0);
        });

        it.each(["photo", "url"])("applies the same rules to the %s field", (field) => {
            expect(errsFor({ [field]: "https://example.com/a.png" })).toHaveLength(0);
            const errs = errsFor({ [field]: "example.com" });
            expect(errs).toHaveLength(1);
            expect(errs[0].field).toBe(`properties.${field}`);
        });

        it("reports each invalid URL field independently", () => {
            const errs = errsFor({ link: "foo", photo: "bar", url: "baz" });
            expect(errs.map((e) => e.field).sort()).toEqual([
                "properties.link",
                "properties.photo",
                "properties.url",
            ]);
        });

        it("keeps the result valid — URL problems are warnings only", () => {
            const r = FeatureValidator.validateProperties({ name: "X", link: "foo" }, "id1");
            expect(r.valid).toBe(true);
            expect(r.errors[0].severity).toBe("warning");
        });
    });

    describe("validateProperties — email field", () => {
        const emailErrs = (email) =>
            FeatureValidator.validateProperties({ name: "X", email }, "id1").errors.filter(
                (e) => e.field === "properties.email"
            );

        it("accepts a well-formed address", () => {
            expect(emailErrs("a@b.co")).toHaveLength(0);
        });

        it.each([
            ["no @", "abc"],
            ["no TLD dot", "a@b"],
            ["embedded whitespace", "a b@c.d"],
        ])("warns on %s", (_label, email) => {
            const errs = emailErrs(email);
            expect(errs).toHaveLength(1);
            expect(errs[0].severity).toBe("warning");
        });

        it("ignores a non-string email", () => {
            expect(emailErrs(42)).toHaveLength(0);
        });
    });
});
