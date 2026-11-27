/**
 * The handle sizes a profile sets reach the drawing engine.
 *
 * `vertexHandleSize` and `midpointHandleSize` were bounded in `config.ts` and read nowhere: the
 * sizes were literals, while ED-06 called them adjustable.
 */
import { afterEach, describe, expect, it } from "vitest";
import { buildSelectStyles } from "../drawing/styles.js";

const g = globalThis as { GeoLeaf?: unknown };
const colors = { accent: "#2563eb", white: "#ffffff" } as Parameters<typeof buildSelectStyles>[0];

afterEach(() => {
    delete g.GeoLeaf;
});

describe("buildSelectStyles — handle sizes", () => {
    it("takes the profile's sizes", () => {
        g.GeoLeaf = {
            Config: {
                get: (k: string, d?: unknown) =>
                    k === "modules.editor" ? { vertexHandleSize: 14, midpointHandleSize: 9 } : d,
            },
        };
        const s = buildSelectStyles(colors);
        expect(s.selectionPointWidth).toBe(14);
        expect(s.midPointWidth).toBe(9);
    });

    it("keeps 8 and 5 when the profile says nothing", () => {
        const s = buildSelectStyles(colors);
        expect(s.selectionPointWidth).toBe(8);
        expect(s.midPointWidth).toBe(5);
    });
});
