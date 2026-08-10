/**
 * The tinted raster pass — how taxonomy recolours an icon without SDF.
 *
 * MapLibre's `icon-color` only works on SDF images, and this pipeline registers
 * plain rasters. But it rasterises them ITSELF, from the sprite's `<symbol>` DOM,
 * baking `currentColor` to white. So a tint is just a second raster of the same
 * symbol with a different colour, registered under its own image id.
 *
 * The pass lives INSIDE `registerSpriteIcons` on purpose: `setStyle()` (a basemap
 * swap) empties MapLibre's image store, and the adapter recovers by calling this
 * function again. Variants registered at a call site would be gone for good, and
 * every tinted icon would vanish the first time the user changes the background map.
 */

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
import { registerSpriteIcons } from "../../src/adapters/maplibre/maplibre-poi-icons.js";
import { Log } from "../../src/utils/log/index.js";

global.Path2D = class Path2D {
    constructor(_d) {}
};

const CANVAS_SIZE = 48; // ICON_SIZE_PX (24) × ICON_PIXEL_RATIO (2)

const mockCtx = {
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    ellipse: vi.fn(),
    getImageData: vi.fn(() => {
        const d = new Uint8ClampedArray(CANVAS_SIZE * CANVAS_SIZE * 4);
        d[3] = 255; // one opaque pixel → "not empty"
        return { data: d, width: CANVAS_SIZE, height: CANVAS_SIZE };
    }),
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
};
HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCtx);

function createMockMap() {
    const registered = new Set();
    return {
        isStyleLoaded: () => true,
        once: (_e, h) => h?.(),
        addImage: vi.fn((id) => registered.add(id)),
        hasImage: vi.fn((id) => registered.has(id)),
        _registered: registered,
    };
}

function svgEl(tag, attrs = {}) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
}

function createSymbol(id, ...children) {
    const sym = svgEl("symbol", { id, viewBox: "0 0 24 24" });
    for (const c of children) sym.appendChild(c);
    return sym;
}

/** Builds the injected sprite and mounts the taxonomy seam. */
function setup({ symbols = [], variants = [], symbolPrefix = "t-" } = {}) {
    document.body.innerHTML = "";
    const sprite = svgEl("svg", { "data-geoleaf-sprite": "profile" });
    for (const s of symbols) sprite.appendChild(s);
    document.body.appendChild(sprite);

    globalThis.GeoLeaf = {
        Taxonomy: {
            getIcons: () => ({ symbolPrefix }),
            getIconVariants: () => variants,
        },
    };
    return createMockMap();
}

afterEach(() => {
    delete globalThis.GeoLeaf;
    vi.clearAllMocks();
});

describe("tinted variants", () => {
    it("registers one image per (icon × tint) pair, next to the raw one", async () => {
        const map = setup({
            symbols: [createSymbol("t-building", svgEl("path", { d: "M0 0 L24 24" }))],
            variants: [{ svgId: "building", symbolId: "t-building--6a1b9a", color: "#6a1b9a" }],
        });

        await registerSpriteIcons(map);

        // The raw (white) image, and the tinted one.
        expect(map._registered.has("t-building")).toBe(true);
        expect(map._registered.has("t-building--6a1b9a")).toBe(true);
        expect(map.addImage).toHaveBeenCalledTimes(2);
    });

    it("rasterises the glyph in the tint, not in white", async () => {
        const map = setup({
            symbols: [
                // stroke="currentColor" is what every shipped sprite uses.
                createSymbol("t-icon", svgEl("path", { d: "M0 0 L24 24" })),
            ],
            variants: [{ svgId: "icon", symbolId: "t-icon--ff0000", color: "#ff0000" }],
        });

        await registerSpriteIcons(map);

        // The raw pass paints white, the variant pass paints the tint. The last
        // symbol rendered is the variant.
        expect(mockCtx.strokeStyle).toBe("#ff0000");
    });

    it("leaves explicit colours in the SVG alone — multi-colour icons stay multi-colour", async () => {
        const map = setup({
            symbols: [
                createSymbol(
                    "t-multi",
                    svgEl("path", { d: "M0 0 L24 24", stroke: "#123456" }) // explicit, not currentColor
                ),
            ],
            variants: [{ svgId: "multi", symbolId: "t-multi--ff0000", color: "#ff0000" }],
        });

        await registerSpriteIcons(map);
        expect(mockCtx.strokeStyle).toBe("#123456");
    });

    it("skips a variant already in the atlas (dedup per tint, not per icon)", async () => {
        const map = setup({
            symbols: [createSymbol("t-icon", svgEl("path", { d: "M0 0" }))],
            variants: [
                { svgId: "icon", symbolId: "t-icon--aaa", color: "#aaa" },
                { svgId: "icon", symbolId: "t-icon--bbb", color: "#bbb" },
            ],
        });
        map._registered.add("t-icon--aaa"); // already there

        await registerSpriteIcons(map);

        const ids = map.addImage.mock.calls.map((c) => c[0]);
        expect(ids).not.toContain("t-icon--aaa");
        expect(ids).toContain("t-icon--bbb");
    });

    it("warns, and carries on, when a variant names a symbol the sprite lacks", async () => {
        const map = setup({
            symbols: [createSymbol("t-real", svgEl("path", { d: "M0 0" }))],
            variants: [{ svgId: "ghost", symbolId: "t-ghost--fff", color: "#fff" }],
        });

        await registerSpriteIcons(map);

        expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining("t-ghost--fff"));
        expect(map._registered.has("t-real")).toBe(true); // the raw pass still ran
    });

    it("does nothing extra when the taxonomy seam is absent (Lite)", async () => {
        const map = setup({ symbols: [createSymbol("t-icon", svgEl("path", { d: "M0 0" }))] });
        delete globalThis.GeoLeaf;

        await registerSpriteIcons(map);

        expect(map.addImage).toHaveBeenCalledTimes(1);
        expect(map.addImage).toHaveBeenCalledWith(
            "t-icon",
            expect.objectContaining({ width: CANVAS_SIZE }),
            expect.objectContaining({ pixelRatio: 2 })
        );
    });
});

describe("<use> resolution", () => {
    it("renders an alias symbol's target instead of drawing nothing", async () => {
        // `sprite_rail.svg` aliases `…-gare_tgv` onto a shared glyph this way. Before
        // this, such an icon rendered in the popup (the DOM <use> resolves) and was
        // blank on the map (the canvas walk skipped it).
        const map = setup({
            symbols: [
                createSymbol("t-real", svgEl("path", { d: "M0 0 L24 24" })),
                createSymbol("t-alias", svgEl("use", { href: "#t-real" })),
            ],
            variants: [{ svgId: "alias", symbolId: "t-alias--ff0000", color: "#ff0000" }],
        });

        await registerSpriteIcons(map);

        // The alias resolved to a real path, so the canvas had pixels and the image
        // was registered rather than warned away.
        expect(map._registered.has("t-alias--ff0000")).toBe(true);
        expect(mockCtx.stroke).toHaveBeenCalled();
    });

    it("survives a <use> that points at nothing", async () => {
        const map = setup({
            symbols: [createSymbol("t-broken", svgEl("use", { href: "#nowhere" }))],
            variants: [{ svgId: "broken", symbolId: "t-broken--fff", color: "#fff" }],
        });

        await expect(registerSpriteIcons(map)).resolves.not.toThrow();
    });
});

describe("basemap swap", () => {
    it("re-registers the tinted variants when the image store is emptied", async () => {
        const map = setup({
            symbols: [createSymbol("t-icon", svgEl("path", { d: "M0 0" }))],
            variants: [{ svgId: "icon", symbolId: "t-icon--f00", color: "#f00" }],
        });

        await registerSpriteIcons(map);
        expect(map._registered.has("t-icon--f00")).toBe(true);

        // setStyle() drops every addImage'd image; the adapter calls us again.
        map._registered.clear();
        map.addImage.mockClear();
        await registerSpriteIcons(map);

        expect(map._registered.has("t-icon--f00")).toBe(true);
    });
});
