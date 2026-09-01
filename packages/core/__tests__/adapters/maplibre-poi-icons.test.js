/**
 * Unit tests for maplibre-poi-icons — registerSpriteIcons.
 *
 * Tests all branches: style not loaded, no sprite, no symbols, alias symbols,
 * hasImage skip, empty canvas, null ctx, and successful registration
 * for each SVG shape type (path, circle, line, polyline, polygon, rect, ellipse).
 *
 * Coverage consolidation for adapters/maplibre.
 */

vi.mock("../../src/utils/log/index.js", () => ({
    Log: {
        warn: vi.fn(),
        info: vi.fn(),
    },
}));
import { registerSpriteIcons } from "../../src/adapters/maplibre/maplibre-poi-icons.js";
import { Log } from "../../src/utils/log/index.js";
// ── Canvas / Path2D mocks ────────────────────────────────────────────────────

// jsdom does not implement Path2D — provide a minimal stub
global.Path2D = class Path2D {
    constructor(_d) {}
};

let _mockImageData;

const mockCtx = {
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    ellipse: vi.fn(),
    getImageData: vi.fn(() => _mockImageData),
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
};

// Default: non-empty canvas (some alpha pixel set)
function _makeNonEmptyImageData(size) {
    const d = new Uint8ClampedArray(size * size * 4);
    d[3] = 255; // first pixel alpha = 255
    return { data: d, width: size, height: size };
}

function _makeEmptyImageData(size) {
    return { data: new Uint8ClampedArray(size * size * 4), width: size, height: size };
}

const CANVAS_SIZE = 48; // ICON_SIZE_PX (24) * ICON_PIXEL_RATIO (2)

HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCtx);

// (Modules imported above via static import)

// ── Helpers ──────────────────────────────────────────────────────────────────

function createMockMap({ isLoaded = true } = {}) {
    return {
        isStyleLoaded: vi.fn().mockReturnValue(isLoaded),
        once: vi.fn((event, handler) => {
            // Immediately resolve (simulates styledata event firing)
            if (handler) handler();
        }),
        addImage: vi.fn(),
        hasImage: vi.fn().mockReturnValue(false),
    };
}

function createSpriteEl() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("data-geoleaf-sprite", "profile");
    document.body.appendChild(svg);
    return svg;
}

function createSymbol(id, ...children) {
    const sym = document.createElementNS("http://www.w3.org/2000/svg", "symbol");
    sym.setAttribute("id", id);
    sym.setAttribute("viewBox", "0 0 24 24");
    for (const child of children) {
        sym.appendChild(child);
    }
    return sym;
}

function svgEl(tag, attrs = {}) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) {
        el.setAttribute(k, v);
    }
    return el;
}

// Clean up DOM between tests
afterEach(() => {
    const spriteEls = document.querySelectorAll('svg[data-geoleaf-sprite="profile"]');
    for (const el of spriteEls) el.remove();
    vi.clearAllMocks();
    // Reset to non-empty default
    _mockImageData = _makeNonEmptyImageData(CANVAS_SIZE);
});

beforeEach(() => {
    _mockImageData = _makeNonEmptyImageData(CANVAS_SIZE);
});

// ─── registerSpriteIcons ──────────────────────────────────────────────────────

describe("registerSpriteIcons", () => {
    describe("style loading guard", () => {
        it("awaits styledata event when style is not yet loaded", async () => {
            const map = createMockMap({ isLoaded: false });
            const spriteEl = createSpriteEl();
            spriteEl.appendChild(createSymbol("icon-a", svgEl("path", { d: "M0 0 L24 24" })));
            await registerSpriteIcons(map);
            expect(map.once).toHaveBeenCalledWith("styledata", expect.any(Function));
        });

        it("does not await when style is already loaded", async () => {
            const map = createMockMap({ isLoaded: true });
            const spriteEl = createSpriteEl();
            spriteEl.appendChild(createSymbol("icon-b", svgEl("path", { d: "M0 0 L24 24" })));
            await registerSpriteIcons(map);
            expect(map.once).not.toHaveBeenCalled();
        });
    });

    describe("missing sprite", () => {
        it("warns and returns when sprite is not in the DOM", async () => {
            const map = createMockMap();
            // No sprite appended to document
            await registerSpriteIcons(map);
            expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining("sprite not in DOM"));
            expect(map.addImage).not.toHaveBeenCalled();
        });
    });

    describe("empty sprite", () => {
        it("warns and returns when sprite has no symbol[id] elements", async () => {
            const map = createMockMap();
            createSpriteEl(); // no symbols inside
            await registerSpriteIcons(map);
            expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining("no symbols found"));
            expect(map.addImage).not.toHaveBeenCalled();
        });
    });

    describe("alias symbol skipping", () => {
        it("skips symbols whose children are all <use> elements", async () => {
            const map = createMockMap();
            const spriteEl = createSpriteEl();
            // Alias: all children are <use>
            const useEl = svgEl("use", { href: "#icon-real" });
            spriteEl.appendChild(createSymbol("icon-alias", useEl));
            await registerSpriteIcons(map);
            expect(map.addImage).not.toHaveBeenCalled();
        });
    });

    describe("hasImage skip", () => {
        it("skips symbols already registered in the map", async () => {
            const map = createMockMap();
            map.hasImage.mockReturnValue(true);
            const spriteEl = createSpriteEl();
            spriteEl.appendChild(
                createSymbol("icon-existing", svgEl("path", { d: "M0 0 L24 24" }))
            );
            await registerSpriteIcons(map);
            expect(map.addImage).not.toHaveBeenCalled();
        });
    });

    describe("null canvas context", () => {
        it("skips symbol when getContext returns null", async () => {
            const map = createMockMap();
            HTMLCanvasElement.prototype.getContext.mockReturnValueOnce(null);
            const spriteEl = createSpriteEl();
            spriteEl.appendChild(
                createSymbol("icon-null-ctx", svgEl("path", { d: "M0 0 L24 24" }))
            );
            await registerSpriteIcons(map);
            expect(map.addImage).not.toHaveBeenCalled();
        });
    });

    describe("empty canvas", () => {
        it("skips and warns when rendered canvas has no visible pixels", async () => {
            _mockImageData = _makeEmptyImageData(CANVAS_SIZE);
            const map = createMockMap();
            const spriteEl = createSpriteEl();
            spriteEl.appendChild(
                createSymbol("icon-empty-canvas", svgEl("path", { d: "M0 0 L24 24" }))
            );
            await registerSpriteIcons(map);
            expect(Log.warn).toHaveBeenCalledWith(
                expect.stringContaining("canvas empty after direct render")
            );
            expect(map.addImage).not.toHaveBeenCalled();
        });
    });

    describe("successful registration", () => {
        it("calls map.addImage for each valid symbol", async () => {
            const map = createMockMap();
            const spriteEl = createSpriteEl();
            spriteEl.appendChild(createSymbol("icon-one", svgEl("path", { d: "M0 0 L24 24" })));
            spriteEl.appendChild(
                createSymbol("icon-two", svgEl("circle", { cx: "12", cy: "12", r: "5" }))
            );
            await registerSpriteIcons(map);
            expect(map.addImage).toHaveBeenCalledTimes(2);
            expect(map.addImage).toHaveBeenCalledWith(
                "icon-one",
                expect.objectContaining({ width: CANVAS_SIZE, height: CANVAS_SIZE }),
                expect.objectContaining({ pixelRatio: 2 })
            );
        });

        it("logs info with the count of registered icons and tinted variants", async () => {
            const map = createMockMap();
            const spriteEl = createSpriteEl();
            spriteEl.appendChild(createSymbol("icon-x", svgEl("path", { d: "M0 0 L24 24" })));
            await registerSpriteIcons(map);
            expect(Log.info).toHaveBeenCalledWith(
                expect.stringContaining("1 icon(s) + 0 tinted variant(s) registered")
            );
        });
    });

    describe("SVG shape renderers", () => {
        async function registerSymbolWithChild(childEl) {
            const map = createMockMap();
            const spriteEl = createSpriteEl();
            spriteEl.appendChild(createSymbol("icon-shape", childEl));
            await registerSpriteIcons(map);
            return map;
        }

        it("renders <path> element via fill and stroke", async () => {
            await registerSymbolWithChild(
                svgEl("path", { d: "M0 0 L24 24", stroke: "white", fill: "none" })
            );
            expect(mockCtx.stroke).toHaveBeenCalled();
        });

        it("renders <circle> element via arc()", async () => {
            await registerSymbolWithChild(
                svgEl("circle", { cx: "12", cy: "12", r: "5", stroke: "white", fill: "none" })
            );
            expect(mockCtx.arc).toHaveBeenCalled();
        });

        it("renders <line> element via moveTo/lineTo", async () => {
            await registerSymbolWithChild(
                svgEl("line", { x1: "0", y1: "0", x2: "24", y2: "24", stroke: "white" })
            );
            expect(mockCtx.moveTo).toHaveBeenCalled();
            expect(mockCtx.lineTo).toHaveBeenCalled();
        });

        it("renders <polyline> element via moveTo/lineTo", async () => {
            await registerSymbolWithChild(
                svgEl("polyline", { points: "0,0 12,12 24,0", stroke: "white", fill: "none" })
            );
            expect(mockCtx.moveTo).toHaveBeenCalled();
        });

        it("renders <polygon> element and closes path", async () => {
            await registerSymbolWithChild(
                svgEl("polygon", { points: "0,0 12,12 24,0", stroke: "white", fill: "white" })
            );
            expect(mockCtx.closePath).toHaveBeenCalled();
        });

        it("renders <rect> element via fillRect/strokeRect", async () => {
            await registerSymbolWithChild(
                svgEl("rect", { x: "2", y: "2", width: "20", height: "20", fill: "white" })
            );
            expect(mockCtx.fillRect).toHaveBeenCalled();
        });

        it("renders <ellipse> element via ctx.ellipse()", async () => {
            await registerSymbolWithChild(
                svgEl("ellipse", { cx: "12", cy: "12", rx: "8", ry: "5", fill: "white" })
            );
            expect(mockCtx.ellipse).toHaveBeenCalled();
        });
    });

    describe("color resolution", () => {
        it("resolves currentColor stroke to white", async () => {
            const map = createMockMap();
            const spriteEl = createSpriteEl();
            const sym = createSymbol("icon-cc", svgEl("path", { d: "M0 0 L24 24" }));
            sym.setAttribute("stroke", "currentColor");
            spriteEl.appendChild(sym);
            await registerSpriteIcons(map);
            expect(mockCtx.strokeStyle).toBe("white");
        });

        it("fills with white when fill is currentColor", async () => {
            const map = createMockMap();
            const spriteEl = createSpriteEl();
            const sym = createSymbol(
                "icon-fill-cc",
                svgEl("path", { d: "M0 0 L24 24", fill: "currentColor" })
            );
            spriteEl.appendChild(sym);
            await registerSpriteIcons(map);
            // fill should have been called (fill was resolved to "white")
            expect(mockCtx.fill).toHaveBeenCalled();
        });

        it("skips fill when fill attribute is none", async () => {
            const map = createMockMap();
            const spriteEl = createSpriteEl();
            const sym = createSymbol(
                "icon-no-fill",
                svgEl("path", { d: "M0 0 L24 24", fill: "none", stroke: "white" })
            );
            spriteEl.appendChild(sym);
            await registerSpriteIcons(map);
            // fill() should NOT be called since fill is null
            expect(mockCtx.fill).not.toHaveBeenCalled();
        });
    });
});
