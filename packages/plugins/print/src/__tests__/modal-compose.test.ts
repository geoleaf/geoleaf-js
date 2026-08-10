/**
 * Tests for modal-compose.ts — the preview modal's geometry layer (PLUGINS S6).
 *
 * Covers: buildComposeArgs (zones, compose options, bbox, page dimensions) and
 * mapViewport (off-screen sizing + camera), including the superset invariant that
 * keeps the printed scale exact.
 */

import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { installMockGeoLeaf, uninstallMockGeoLeaf } from "./setup.js";
import { buildComposeArgs, mapViewport, type ComposeInputs } from "../modal-compose.js";
import { calcZoom } from "../page-format.js";

const CENTER = { lng: 2.35, lat: 48.875 };

function makeInputs(overrides: Partial<ComposeInputs> = {}): ComposeInputs {
    return {
        format: "A4",
        orientation: "portrait",
        lockedScale: 25_000,
        center: CENTER,
        dpi: 300,
        title: "",
        description: "",
        includeLegend: false,
        includeScale: false,
        includeNorthArrow: false,
        includeAnnotations: false,
        ...overrides,
    };
}

describe("buildComposeArgs", () => {
    beforeEach(() => installMockGeoLeaf());
    afterEach(() => uninstallMockGeoLeaf());

    it("returns null for an unregistered format", () => {
        expect(buildComposeArgs(makeInputs({ format: "NOPE" }))).toBeNull();
    });

    it("resolves page dimensions, swapping them in landscape", () => {
        const portrait = buildComposeArgs(makeInputs())!;
        const landscape = buildComposeArgs(makeInputs({ orientation: "landscape" }))!;

        expect(portrait.widthMm).toBe(210);
        expect(portrait.heightMm).toBe(297);
        expect(landscape.widthMm).toBe(297);
        expect(landscape.heightMm).toBe(210);
    });

    it("opens the title band only for a non-blank title", () => {
        expect(buildComposeArgs(makeInputs({ title: "" }))!.zones.title.height).toBe(0);
        expect(buildComposeArgs(makeInputs({ title: "   " }))!.zones.title.height).toBe(0);
        expect(
            buildComposeArgs(makeInputs({ title: "Carte" }))!.zones.title.height
        ).toBeGreaterThan(0);
    });

    it("opens the footer band only for a non-blank description", () => {
        expect(buildComposeArgs(makeInputs({ description: "" }))!.zones.footer.height).toBe(0);
        expect(
            buildComposeArgs(makeInputs({ description: "Levé de terrain" }))!.zones.footer.height
        ).toBeGreaterThan(0);
    });

    it("opens the legend band when the legend is checked", () => {
        expect(buildComposeArgs(makeInputs({ includeLegend: false }))!.zones.legend.height).toBe(0);
        expect(
            buildComposeArgs(makeInputs({ includeLegend: true }))!.zones.legend.height
        ).toBeGreaterThan(0);
    });

    it("does NOT shrink the map zone for the scale bar or north arrow", () => {
        // Both are painted ON the map zone, not in a band of their own.
        const plain = buildComposeArgs(makeInputs())!;
        const overlaid = buildComposeArgs(
            makeInputs({ includeScale: true, includeNorthArrow: true })
        )!;
        expect(overlaid.zones.map).toEqual(plain.zones.map);
    });

    it("forwards the overlay flags to the composition options", () => {
        const args = buildComposeArgs(
            makeInputs({
                title: "Carte",
                description: "Note",
                includeScale: true,
                includeNorthArrow: true,
                includeLegend: true,
                includeAnnotations: true,
            })
        )!;

        expect(args.composeOpts).toMatchObject({
            title: "Carte",
            description: "Note",
            scaleDenominator: 25_000,
            dpi: 300,
            includeScale: true,
            includeNorthArrow: true,
            includeLegend: true,
            includeAnnotations: true,
            pageSizeMm: { widthMm: 210, heightMm: 297 },
        });
        expect(args.composeOpts.bbox).toBe(args.bbox);
    });

    it("keeps the bbox consistent with the map zone the bands leave", () => {
        // The H1 invariant: ground covered must follow the zone, not the whole page.
        const plain = buildComposeArgs(makeInputs())!;
        const banded = buildComposeArgs(makeInputs({ title: "Carte", includeLegend: true }))!;

        const hPlain = plain.bbox.maxLat - plain.bbox.minLat;
        const hBanded = banded.bbox.maxLat - banded.bbox.minLat;

        expect(banded.zones.map.height).toBeLessThan(plain.zones.map.height);
        expect(hBanded).toBeLessThan(hPlain);
        expect(hBanded / hPlain).toBeCloseTo(banded.zones.map.height / plain.zones.map.height, 3);
    });

    it("derives pixel targets from the zones at the requested DPI", () => {
        const args = buildComposeArgs(makeInputs({ dpi: 300 }))!;
        expect(args.targetPx.map.widthPx).toBe(Math.round((args.zones.map.width / 25.4) * 300));
        expect(args.targetPx.map.heightPx).toBe(Math.round((args.zones.map.height / 25.4) * 300));
    });
});

describe("mapViewport", () => {
    beforeEach(() => installMockGeoLeaf());
    afterEach(() => uninstallMockGeoLeaf());

    it("returns null for an unregistered format", () => {
        expect(mapViewport("NOPE", "portrait", 25_000, CENTER, 300)).toBeNull();
    });

    it("aims the camera with calcZoom and centres it on the emprise", () => {
        const view = mapViewport("A4", "portrait", 25_000, CENTER, 300)!;
        expect(view.center).toEqual([CENTER.lng, CENTER.lat]);
        expect(view.zoom).toBe(calcZoom(25_000, CENTER.lat, 300));
    });

    it("sizes larger for A3 than A4 at the same scale", () => {
        const a4 = mapViewport("A4", "portrait", 25_000, CENTER, 300)!;
        const a3 = mapViewport("A3", "portrait", 25_000, CENTER, 300)!;
        expect(a3.heightPx).toBeGreaterThan(a4.heightPx);
    });

    // ------------------------------------------------------------------
    // The invariant that makes the crop in layout-composer sound.
    // ------------------------------------------------------------------

    it("is a superset of every composed map zone, so a band never forces a re-render", () => {
        const view = mapViewport("A4", "portrait", 25_000, CENTER, 300)!;

        const banded: Array<Partial<ComposeInputs>> = [
            {},
            { title: "Carte" },
            { description: "Note" },
            { includeLegend: true },
            { title: "Carte", description: "Note", includeLegend: true },
        ];

        for (const overrides of banded) {
            const args = buildComposeArgs(makeInputs(overrides))!;
            expect(view.widthPx).toBeGreaterThanOrEqual(args.targetPx.map.widthPx);
            expect(view.heightPx).toBeGreaterThanOrEqual(args.targetPx.map.heightPx);
        }
    });
});
