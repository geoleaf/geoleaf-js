import { describe, it, expect } from "vitest";
import {
    detectConverter,
    isKmz,
    getSupportedExtensions,
    registerConverter,
} from "../format-detector.js";
import type { IFileConverter } from "../converters/i-converter.js";

describe("format-detector", () => {
    it("detects .gpx → GPX converter", () => {
        expect(detectConverter("track.gpx")?.formatName).toBe("GPX");
    });

    it("detects .kml → KML converter", () => {
        expect(detectConverter("places.kml")?.formatName).toBe("KML");
    });

    it("detects .kmz → KML converter (KMZ handled separately)", () => {
        expect(detectConverter("archive.kmz")?.formatName).toBe("KML");
    });

    it("detects .csv → CSV converter", () => {
        expect(detectConverter("data.csv")?.formatName).toBe("CSV");
    });

    it("detects .tsv → CSV converter", () => {
        expect(detectConverter("data.tsv")?.formatName).toBe("CSV");
    });

    it("detects .topojson → TopoJSON converter", () => {
        expect(detectConverter("map.topojson")?.formatName).toBe("TopoJSON");
    });

    it("returns null for unknown extension", () => {
        expect(detectConverter("file.xyz")).toBeNull();
    });

    it("returns null for files without extension", () => {
        expect(detectConverter("noextension")).toBeNull();
    });

    it("is case insensitive", () => {
        expect(detectConverter("Track.GPX")?.formatName).toBe("GPX");
        expect(detectConverter("DATA.CSV")?.formatName).toBe("CSV");
    });

    it("isKmz returns true for .kmz", () => {
        expect(isKmz("file.kmz")).toBe(true);
        expect(isKmz("file.KMZ")).toBe(true);
    });

    it("isKmz returns false for non-kmz", () => {
        expect(isKmz("file.kml")).toBe(false);
    });

    it("getSupportedExtensions returns all registered extensions", () => {
        const exts = getSupportedExtensions();
        expect(exts).toContain(".gpx");
        expect(exts).toContain(".kml");
        expect(exts).toContain(".kmz");
        expect(exts).toContain(".csv");
        expect(exts).toContain(".tsv");
        expect(exts).toContain(".topojson");
    });

    it("registerConverter allows adding a custom format", () => {
        const custom: IFileConverter = {
            formatName: "Custom",
            convert: () => ({ data: { type: "FeatureCollection", features: [] }, warnings: [] }),
        };
        registerConverter(".custom", custom);
        expect(detectConverter("file.custom")?.formatName).toBe("Custom");
    });
});
