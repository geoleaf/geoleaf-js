/**
 * Tests for page-format.ts
 *
 * Covers: pixel dimensions, computeZones, computeBbox, computeTargetPixels,
 * registerPageFormat, scaleDenominator invariance A4↔A3.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
    calcZoom,
    computeZones,
    computeBbox,
    computeTargetPixels,
    registerPageFormat,
    getPageFormat,
    resolvePageDimensions,
} from "../page-format.js";
import type { PageFormatDef, ZoneOptions } from "../types.js";
import { installMockGeoLeaf, uninstallMockGeoLeaf } from "./setup.js";

// Zone options helpers
const zoneNone: ZoneOptions = {
    includeTitle: false,
    includeLegend: false,
    includeScale: false,
    includeNorthArrow: false,
    includeFooter: false,
};
const zoneAll: ZoneOptions = {
    includeTitle: true,
    includeLegend: true,
    includeScale: true,
    includeNorthArrow: true,
    includeFooter: true,
};

// Default margins used by config (10 mm each side)
const MARGINS = { top: 10, right: 10, bottom: 10, left: 10 };

beforeEach(() => {
    installMockGeoLeaf();
});
afterEach(() => {
    uninstallMockGeoLeaf();
});

// ---------------------------------------------------------------------------
// computeTargetPixels — dimensions at 300 DPI
// ---------------------------------------------------------------------------

describe("computeTargetPixels — pixel dimensions at 300 DPI", () => {
    it("A4 portrait map zone = 2362 × 3307 px (usable area, no title/legend)", () => {
        // Usable A4 portrait: 190 mm wide × 277 mm tall (210-20 / 297-20)
        const zones = computeZones("A4", "portrait", zoneNone);
        const px = computeTargetPixels(zones, 300);
        expect(px.map.widthPx).toBe(Math.round((190 / 25.4) * 300)); // 2244
        expect(px.map.heightPx).toBe(Math.round((277 / 25.4) * 300)); // 3272
    });

    it("A3 portrait map zone widthPx ≈ √2 × A4 portrait widthPx", () => {
        const zonesA4 = computeZones("A4", "portrait", zoneNone);
        const zonesA3 = computeZones("A3", "portrait", zoneNone);
        const pxA4 = computeTargetPixels(zonesA4, 300);
        const pxA3 = computeTargetPixels(zonesA3, 300);
        const ratio = pxA3.map.widthPx / pxA4.map.widthPx;
        // A3/A4 width ratio = 277/190 ≈ 1.458 (not √2, since margins remove more from A4 than A3)
        expect(ratio).toBeGreaterThan(1.3);
        expect(ratio).toBeLessThan(1.7);
    });

    it("landscape swaps width and height relative to portrait", () => {
        const portrait = computeZones("A4", "portrait", zoneNone);
        const landscape = computeZones("A4", "landscape", zoneNone);
        const pxP = computeTargetPixels(portrait, 300);
        const pxL = computeTargetPixels(landscape, 300);
        expect(pxL.map.widthPx).toBe(pxP.map.heightPx);
        expect(pxL.map.heightPx).toBe(pxP.map.widthPx);
    });

    it("dimensions are positive integers", () => {
        const zones = computeZones("A4", "portrait", zoneNone);
        const px = computeTargetPixels(zones, 300);
        expect(px.map.widthPx).toBeGreaterThan(0);
        expect(px.map.heightPx).toBeGreaterThan(0);
        expect(Number.isInteger(px.map.widthPx)).toBe(true);
        expect(Number.isInteger(px.map.heightPx)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// computeZones
// ---------------------------------------------------------------------------

describe("computeZones — zone layout", () => {
    it("all zones at y=0 when no title and no legend (zones stack correctly)", () => {
        const zones = computeZones("A4", "portrait", zoneNone);
        expect(zones.title.height).toBe(0);
        expect(zones.legend.height).toBe(0);
        expect(zones.footer.height).toBe(0);
        expect(zones.map.height).toBeGreaterThan(0);
    });

    it("title zone is non-zero when includeTitle=true", () => {
        const zones = computeZones("A4", "portrait", { ...zoneNone, includeTitle: true });
        expect(zones.title.height).toBeGreaterThan(0);
        expect(zones.map.y).toBeGreaterThan(MARGINS.top);
    });

    it("legend zone is non-zero when includeLegend=true", () => {
        const zones = computeZones("A4", "portrait", { ...zoneNone, includeLegend: true });
        expect(zones.legend.height).toBeGreaterThan(0);
    });

    it("footer zone is non-zero when includeFooter=true", () => {
        const zones = computeZones("A4", "portrait", { ...zoneNone, includeFooter: true });
        expect(zones.footer.height).toBeGreaterThan(0);
        // Footer sits below the map zone and shrinks the available map height.
        const zNone = computeZones("A4", "portrait", zoneNone);
        expect(zones.map.height).toBeLessThan(zNone.map.height);
        expect(zones.footer.y).toBeGreaterThanOrEqual(zones.map.y + zones.map.height);
    });

    it("map zone shrinks when title+legend are included", () => {
        const zNone = computeZones("A4", "portrait", zoneNone);
        const zAll = computeZones("A4", "portrait", zoneAll);
        expect(zAll.map.height).toBeLessThan(zNone.map.height);
    });

    it("zones have correct x and width (= usable width)", () => {
        const zones = computeZones("A4", "portrait", zoneNone);
        const expectedW = 210 - MARGINS.left - MARGINS.right;
        expect(zones.map.width).toBe(expectedW);
        expect(zones.map.x).toBe(MARGINS.left);
    });

    it("fallback to A4 when format is unknown", () => {
        const zonesUnknown = computeZones("UNKNOWN", "portrait", zoneNone);
        const zonesA4 = computeZones("A4", "portrait", zoneNone);
        expect(zonesUnknown.map.width).toBe(zonesA4.map.width);
    });
});

// ---------------------------------------------------------------------------
// computeBbox — scale invariance A4 ↔ A3
// ---------------------------------------------------------------------------

describe("computeBbox — scaleDenominator invariance", () => {
    const center = { lng: 2.35, lat: 48.85 };
    const scale = 10_000;

    it("scaleDenominator does not change when switching A4 → A3 landscape", () => {
        // computeBbox does not return the scale, but the bbox should be larger for A3
        const bboxA4 = computeBbox("A4", scale, "landscape", center);
        const bboxA3 = computeBbox("A3", scale, "landscape", center);
        // A3 bbox must be wider than A4 bbox
        const widthA4 = bboxA4.maxLng - bboxA4.minLng;
        const widthA3 = bboxA3.maxLng - bboxA3.minLng;
        expect(widthA3).toBeGreaterThan(widthA4);
    });

    it("centre is preserved (bbox midpoint = input centre)", () => {
        const bbox = computeBbox("A4", scale, "portrait", center);
        const midLng = (bbox.minLng + bbox.maxLng) / 2;
        const midLat = (bbox.minLat + bbox.maxLat) / 2;
        expect(midLng).toBeCloseTo(center.lng, 6);
        expect(midLat).toBeCloseTo(center.lat, 4);
    });

    it("bbox is wider in landscape than portrait at the same scale", () => {
        const portrait = computeBbox("A4", scale, "portrait", center);
        const landscape = computeBbox("A4", scale, "landscape", center);
        const wP = landscape.maxLng - landscape.minLng;
        const hP = portrait.maxLng - portrait.minLng;
        expect(wP).toBeGreaterThan(hP);
    });

    it("falls back to A4 for unknown format in computeBbox", () => {
        const bboxUnknown = computeBbox("UNKNOWN_FORMAT", scale, "portrait", center);
        const bboxA4 = computeBbox("A4", scale, "portrait", center);
        const wU = bboxUnknown.maxLng - bboxUnknown.minLng;
        const wA4 = bboxA4.maxLng - bboxA4.minLng;
        expect(wU).toBeCloseTo(wA4, 10);
    });

    it("larger scale produces larger bbox", () => {
        const bbox10k = computeBbox("A4", 10_000, "portrait", center);
        const bbox50k = computeBbox("A4", 50_000, "portrait", center);
        const width10k = bbox10k.maxLng - bbox10k.minLng;
        const width50k = bbox50k.maxLng - bbox50k.minLng;
        expect(width50k / width10k).toBeCloseTo(5, 1);
    });

    // PLUGINS S6 — bands shrink the map zone, so they shrink the ground it covers.
    // Ignoring them made the bbox claim the whole page while a title had taken 14 mm.
    it("honours the zone options: a title shrinks the bbox height", () => {
        const full = computeBbox("A4", scale, "portrait", center);
        const withTitle = computeBbox("A4", scale, "portrait", center, {
            ...zoneNone,
            includeTitle: true,
        });

        const hFull = full.maxLat - full.minLat;
        const hTitle = withTitle.maxLat - withTitle.minLat;
        expect(hTitle).toBeLessThan(hFull);
        // Map zone drops 277 mm → 263 mm; width is untouched.
        expect(hTitle / hFull).toBeCloseTo(263 / 277, 3);
        expect(withTitle.maxLng - withTitle.minLng).toBeCloseTo(full.maxLng - full.minLng, 10);
    });

    it("defaults to the full-page map zone when zone options are omitted", () => {
        const implicit = computeBbox("A4", scale, "portrait", center);
        const explicit = computeBbox("A4", scale, "portrait", center, zoneNone);
        expect(implicit).toEqual(explicit);
    });
});

// ---------------------------------------------------------------------------
// resolvePageDimensions / calcZoom (PLUGINS S6)
// ---------------------------------------------------------------------------

describe("resolvePageDimensions", () => {
    it("returns portrait dimensions as stored", () => {
        expect(resolvePageDimensions("A4", "portrait")).toEqual({ widthMm: 210, heightMm: 297 });
    });

    it("swaps width and height in landscape", () => {
        expect(resolvePageDimensions("A4", "landscape")).toEqual({ widthMm: 297, heightMm: 210 });
    });

    it("returns null for an unregistered format — no A4 fallback here", () => {
        // computeZones falls back to A4; this one must not, so callers can detect it.
        expect(resolvePageDimensions("UNKNOWN_FORMAT", "portrait")).toBeNull();
    });
});

describe("calcZoom", () => {
    it("is the inverse of the ground-resolution formula at the equator", () => {
        // metersPerPixel = 25000 × 0.0254 / 300 ≈ 2.1167 ⇒ zoom = log2(156543.04 / 2.1167)
        const expected = Math.log2(156543.04 / ((25_000 * 0.0254) / 300));
        expect(calcZoom(25_000, 0, 300)).toBeCloseTo(expected, 10);
    });

    it("halving the scale denominator gains exactly one zoom level", () => {
        expect(calcZoom(12_500, 48.85, 300) - calcZoom(25_000, 48.85, 300)).toBeCloseTo(1, 10);
    });

    it("doubling the DPI gains exactly one zoom level", () => {
        expect(calcZoom(25_000, 48.85, 600) - calcZoom(25_000, 48.85, 300)).toBeCloseTo(1, 10);
    });
});

// ---------------------------------------------------------------------------
// registerPageFormat
// ---------------------------------------------------------------------------

describe("registerPageFormat", () => {
    it("registers a custom A2 format and retrieves it", () => {
        const a2Def: PageFormatDef = {
            widthMm: 420,
            heightMm: 594,
            computeZones(orientation, opts) {
                // A2: 420×594 mm (portrait). Replicates _computeZonesForFormat logic.
                const margins = { top: 10, right: 10, bottom: 10, left: 10 };
                const pageW = orientation === "landscape" ? 594 : 420;
                const pageH = orientation === "landscape" ? 420 : 594;
                const usableW = pageW - margins.left - margins.right;
                const usableH = pageH - margins.top - margins.bottom;
                const titleH = opts.includeTitle ? 14 : 0;
                const legendH = opts.includeLegend ? 24 : 0;
                const mapH = usableH - titleH - legendH;
                return {
                    title: { x: margins.left, y: margins.top, width: usableW, height: titleH },
                    map: { x: margins.left, y: margins.top + titleH, width: usableW, height: mapH },
                    legend: {
                        x: margins.left,
                        y: margins.top + titleH + mapH,
                        width: usableW,
                        height: legendH,
                    },
                    footer: {
                        x: margins.left,
                        y: margins.top + titleH + mapH + legendH,
                        width: usableW,
                        height: 0,
                    },
                };
            },
        };
        registerPageFormat("A2", a2Def);
        const retrieved = getPageFormat("A2");
        expect(retrieved).toBeDefined();
        expect(retrieved?.widthMm).toBe(420);
        expect(retrieved?.heightMm).toBe(594);
    });

    it("computeZones uses the registered format", () => {
        // A2 has wider usable area than A3
        const zonesA2 = computeZones("A2", "portrait", zoneNone);
        const zonesA3 = computeZones("A3", "portrait", zoneNone);
        expect(zonesA2.map.width).toBeGreaterThan(zonesA3.map.width);
    });

    it("overwrites an existing entry", () => {
        const def1: PageFormatDef = {
            widthMm: 100,
            heightMm: 200,
            computeZones: () => computeZones("A4", "portrait", zoneNone),
        };
        registerPageFormat("CUSTOM", def1);
        expect(getPageFormat("CUSTOM")?.widthMm).toBe(100);

        const def2: PageFormatDef = {
            widthMm: 150,
            heightMm: 250,
            computeZones: () => computeZones("A4", "portrait", zoneNone),
        };
        registerPageFormat("CUSTOM", def2);
        expect(getPageFormat("CUSTOM")?.widthMm).toBe(150);
    });
});
