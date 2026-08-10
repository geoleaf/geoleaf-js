/**
 * Tests for offscreen-render.ts
 *
 * Covers: captureExtent (happy path, events, mobile DPI bounding),
 * captureViewport, cleanup (map.remove), error paths.
 *
 * maplibre-gl is stubbed on globalThis (matches the UMD runtime pattern).
 * Per-test instance config uses mockReturnValue on the Map constructor spy.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installMockGeoLeaf, uninstallMockGeoLeaf, makeMockMaplibreMap } from "./setup.js";
import type { EmpriseBbox } from "../types.js";
import { captureExtent, captureViewport, OffscreenSession } from "../offscreen-render.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BBOX_PARIS: EmpriseBbox = {
    minLng: 2.25,
    minLat: 48.82,
    maxLng: 2.45,
    maxLat: 48.92,
};

let _mockMapCtor: ReturnType<typeof vi.fn>;
let _mockMap: ReturnType<typeof makeMockMaplibreMap>;

// Vitest 4: `new maplibregl.Map()` cannot use mockReturnValue (constructor mocks
// must be constructable). These helpers wrap a value into a class that returns it.
const ctorReturns = (mock: ReturnType<typeof vi.fn>, value: unknown) =>
    mock.mockImplementation(
        class {
            constructor() {
                return value as object;
            }
        }
    );
const ctorReturnsOnce = (mock: ReturnType<typeof vi.fn>, value: unknown) =>
    mock.mockImplementationOnce(
        class {
            constructor() {
                return value as object;
            }
        }
    );

beforeEach(() => {
    _mockMapCtor = vi.fn();
    vi.stubGlobal("maplibregl", { Map: _mockMapCtor });
    installMockGeoLeaf();
    _mockMap = makeMockMaplibreMap();
    ctorReturns(_mockMapCtor, _mockMap);
});

afterEach(() => {
    uninstallMockGeoLeaf();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// captureExtent — happy path
// ---------------------------------------------------------------------------

describe("captureExtent — happy path", () => {
    it("returns a CaptureResult with the expected shape", async () => {
        const r = await captureExtent(BBOX_PARIS, { format: "A4" });
        expect(r.canvas).toBeInstanceOf(HTMLCanvasElement);
        expect(typeof r.dataUrl).toBe("string");
        expect(r.widthPx).toBeGreaterThan(0);
        expect(r.heightPx).toBeGreaterThan(0);
        expect(r.scaleDenominator).toBeGreaterThan(0);
    });

    it("calls map.remove() after capture (cleanup)", async () => {
        await captureExtent(BBOX_PARIS, { format: "A4" });
        expect(_mockMap.remove).toHaveBeenCalledOnce();
    });

    it("widthPx > heightPx for landscape", async () => {
        const r = await captureExtent(BBOX_PARIS, { format: "A4", orientation: "landscape" });
        expect(r.widthPx).toBeGreaterThan(r.heightPx);
    });

    it("widthPx < heightPx for portrait", async () => {
        const r = await captureExtent(BBOX_PARIS, { format: "A4", orientation: "portrait" });
        expect(r.widthPx).toBeLessThan(r.heightPx);
    });

    it("A3 produces larger pixel dimensions than A4 at the same DPI", async () => {
        const mA4 = makeMockMaplibreMap();
        const mA3 = makeMockMaplibreMap();
        ctorReturnsOnce(_mockMapCtor, mA4);
        ctorReturnsOnce(_mockMapCtor, mA3);

        const rA4 = await captureExtent(BBOX_PARIS, { format: "A4", orientation: "landscape" });
        const rA3 = await captureExtent(BBOX_PARIS, { format: "A3", orientation: "landscape" });
        expect(rA3.widthPx).toBeGreaterThan(rA4.widthPx);
    });

    it("honours a provided scaleDenominator (locked scale)", async () => {
        const locked = 25_000;
        const r = await captureExtent(BBOX_PARIS, { format: "A4", scaleDenominator: locked });
        expect(r.scaleDenominator).toBe(locked);
    });

    it("passes bearing:0, pitch:0 and preserveDrawingBuffer:true to the Map constructor", async () => {
        await captureExtent(BBOX_PARIS, { format: "A4" });
        const opts = _mockMapCtor.mock.calls[0][0];
        expect(opts).toMatchObject({ bearing: 0, pitch: 0, preserveDrawingBuffer: true });
    });

    it("passes transformRequest when nativeMap has _requestManager", async () => {
        const transformFn = vi.fn();
        const mapWithTransform = makeMockMaplibreMap();
        mapWithTransform._requestManager = { _transformRequest: transformFn };
        installMockGeoLeaf({ nativeMap: mapWithTransform });
        ctorReturns(_mockMapCtor, makeMockMaplibreMap());

        await captureExtent(BBOX_PARIS, { format: "A4" });

        const opts = _mockMapCtor.mock.calls[0][0];
        expect(opts.transformRequest).toBe(transformFn);
    });
});

// ---------------------------------------------------------------------------
// captureExtent — idle timeout
// ---------------------------------------------------------------------------

describe("captureExtent — idle timeout", () => {
    it("rejects when the off-screen map never reaches idle within the timeout", async () => {
        vi.useFakeTimers();
        try {
            // Map that never fires 'idle' (once() registers but doesn't call back)
            const noIdleMap = makeMockMaplibreMap();
            noIdleMap.once = vi.fn(); // overrides the auto-fire mock
            ctorReturns(_mockMapCtor, noIdleMap);

            // Attach .catch() BEFORE firing timers to avoid unhandled-rejection warnings
            let captureError: unknown;
            const handled = captureExtent(BBOX_PARIS, { format: "A4" }).catch((e) => {
                captureError = e;
            });

            // Fire all pending timers synchronously (triggers the idle backstop, whatever its
            // value — deliberately NOT restated here: it moved from 30 s to 90 s on 01/08/2026
            // and this comment would have been the ninth stale copy of that number, cf. B-103)
            vi.runAllTimers();
            // Drain the microtask queue so the rejection propagates
            await handled;

            expect(captureError).toBeInstanceOf(Error);
            expect((captureError as Error).message).toMatch(/timed out/);
        } finally {
            vi.useRealTimers();
        }
    });
});

// ---------------------------------------------------------------------------
// captureExtent — events
// ---------------------------------------------------------------------------

describe("captureExtent — print:render events", () => {
    it("emits print:render:start before print:render:end", async () => {
        const fired: string[] = [];
        const onStart = () => fired.push("start");
        const onEnd = () => fired.push("end");
        document.addEventListener("print:render:start", onStart);
        document.addEventListener("print:render:end", onEnd);

        await captureExtent(BBOX_PARIS, { format: "A4" });

        document.removeEventListener("print:render:start", onStart);
        document.removeEventListener("print:render:end", onEnd);

        expect(fired).toContain("start");
        expect(fired).toContain("end");
        expect(fired.indexOf("start")).toBeLessThan(fired.indexOf("end"));
    });

    it("emits print:render:end even when capture throws", async () => {
        // Force getStyle to throw so captureExtent rejects
        const badMap = makeMockMaplibreMap();
        badMap.getStyle = vi.fn(() => {
            throw new Error("style unavailable");
        });
        installMockGeoLeaf({ nativeMap: badMap });

        const endFired: number[] = [];
        const listener = () => endFired.push(1);
        document.addEventListener("print:render:end", listener);

        await expect(captureExtent(BBOX_PARIS, {})).rejects.toThrow("style unavailable");

        document.removeEventListener("print:render:end", listener);
        expect(endFired.length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// captureExtent — mobile DPI bounding
// ---------------------------------------------------------------------------

describe("captureExtent — mobile DPI bounding", () => {
    it("reduces canvas area below maxCanvasPxMobile on a mobile UA", async () => {
        installMockGeoLeaf({ printConfig: { maxCanvasPxMobile: 1_000_000 } });

        const origDesc = Object.getOwnPropertyDescriptor(navigator, "userAgent");
        Object.defineProperty(navigator, "userAgent", {
            value: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0) Mobile",
            configurable: true,
        });

        const r = await captureExtent(BBOX_PARIS, {
            format: "A4",
            orientation: "landscape",
            dpi: 300,
        });

        if (origDesc) Object.defineProperty(navigator, "userAgent", origDesc);

        expect(r.widthPx * r.heightPx).toBeLessThanOrEqual(1_000_000);
    });
});

// ---------------------------------------------------------------------------
// captureViewport
// ---------------------------------------------------------------------------

describe("captureViewport", () => {
    it("returns a valid CaptureResult (delegates to captureExtent)", async () => {
        const r = await captureViewport({ format: "A4" });
        expect(r.widthPx).toBeGreaterThan(0);
        expect(r.scaleDenominator).toBeGreaterThan(0);
    });

    it("calls map.remove() (cleanup)", async () => {
        await captureViewport({ format: "A4" });
        expect(_mockMap.remove).toHaveBeenCalledOnce();
    });

    it("throws when nativeMap is unavailable", async () => {
        uninstallMockGeoLeaf();
        await expect(captureViewport()).rejects.toThrow("map not initialised");
    });
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe("captureExtent — error paths", () => {
    it("throws when nativeMap is unavailable", async () => {
        uninstallMockGeoLeaf();
        await expect(captureExtent(BBOX_PARIS, {})).rejects.toThrow("map not initialised");
    });

    it("calls map.remove() even when getCanvas throws (cleanup)", async () => {
        // Simulate an error inside the try block to verify the finally runs.
        _mockMap.getCanvas = vi.fn(() => {
            throw new Error("getCanvas failed");
        });

        await expect(captureExtent(BBOX_PARIS, { format: "A4" })).rejects.toThrow(
            "getCanvas failed"
        );
        expect(_mockMap.remove).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// OffscreenSession
// ---------------------------------------------------------------------------

describe("OffscreenSession", () => {
    let session: OffscreenSession;

    beforeEach(() => {
        // Add resize and jumpTo to the mock (not in the base mock)
        _mockMap.resize = vi.fn();
        _mockMap.jumpTo = vi.fn();
    });

    afterEach(() => {
        session?.destroy();
    });

    function makeSession(): OffscreenSession {
        return new OffscreenSession(
            { version: 8, sources: {}, layers: [] },
            undefined,
            1240,
            1754,
            [2.35, 48.875],
            12
        );
    }

    it("constructs without throwing", () => {
        expect(() => {
            session = makeSession();
        }).not.toThrow();
    });

    it("waitReady emits print:render:start and print:render:end", async () => {
        const fired: string[] = [];
        document.addEventListener("print:render:start", () => fired.push("start"));
        document.addEventListener("print:render:end", () => fired.push("end"));

        session = makeSession();
        await session.waitReady();

        expect(fired).toContain("start");
        expect(fired).toContain("end");
        expect(fired.indexOf("start")).toBeLessThan(fired.indexOf("end"));
    });

    it("getCanvas returns an HTMLCanvasElement", async () => {
        session = makeSession();
        await session.waitReady();
        const canvas = session.getCanvas();
        expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    });

    it("resize calls map.resize and map.jumpTo", async () => {
        session = makeSession();
        await session.waitReady();
        await session.resize(1754, 1240, [2.35, 48.875], 11);
        expect(_mockMap.resize).toHaveBeenCalled();
        expect(_mockMap.jumpTo).toHaveBeenCalled();
    });

    it("resize emits print:render events", async () => {
        const fired: string[] = [];
        document.addEventListener("print:render:start", () => fired.push("start"));
        document.addEventListener("print:render:end", () => fired.push("end"));

        session = makeSession();
        await session.waitReady();
        fired.length = 0; // reset after waitReady

        await session.resize(1754, 1240, [2.35, 48.875], 11);
        expect(fired).toContain("start");
        expect(fired).toContain("end");
    });

    it("jumpTo calls map.jumpTo", async () => {
        session = makeSession();
        await session.waitReady();
        await session.jumpTo([2.4, 48.9], 13);
        expect(_mockMap.jumpTo).toHaveBeenCalledWith(
            expect.objectContaining({ center: [2.4, 48.9], zoom: 13 })
        );
    });

    it("destroy calls map.remove", async () => {
        session = makeSession();
        await session.waitReady();
        session.destroy();
        expect(_mockMap.remove).toHaveBeenCalled();
    });

    it("getCanvas throws after destroy", async () => {
        session = makeSession();
        await session.waitReady();
        session.destroy();
        expect(() => session.getCanvas()).toThrow("map not ready");
        // Prevent afterEach from calling destroy again
        session = null as unknown as OffscreenSession;
    });

    it("resize is a no-op after destroy", async () => {
        session = makeSession();
        await session.waitReady();
        session.destroy();
        await expect(session.resize(100, 100, [0, 0], 10)).resolves.toBeUndefined();
        session = null as unknown as OffscreenSession;
    });

    it("jumpTo is a no-op after destroy", async () => {
        session = makeSession();
        await session.waitReady();
        session.destroy();
        await expect(session.jumpTo([0, 0], 10)).resolves.toBeUndefined();
        session = null as unknown as OffscreenSession;
    });

    it("_scaleSymbolTextSizes scales text-size for symbol layers (dpi > 96)", async () => {
        _mockMap.getStyle = vi.fn(() => ({
            version: 8,
            sources: {},
            layers: [{ id: "labels", type: "symbol", layout: { "text-size": 12 } }],
        }));
        _mockMap.setLayoutProperty = vi.fn();
        session = makeSession(); // default dpi=300 > SCREEN_DPI=96
        await session.waitReady();
        expect(_mockMap.setLayoutProperty).toHaveBeenCalledWith(
            "labels",
            "text-size",
            expect.closeTo(12 * (300 / 96), 1)
        );
    });

    it("_scaleSymbolTextSizes skips non-symbol layers", async () => {
        _mockMap.getStyle = vi.fn(() => ({
            version: 8,
            sources: {},
            layers: [{ id: "roads", type: "line" }],
        }));
        _mockMap.setLayoutProperty = vi.fn();
        session = makeSession();
        await session.waitReady();
        expect(_mockMap.setLayoutProperty).not.toHaveBeenCalled();
    });

    it("_scaleSymbolTextSizes skips symbol layers without numeric text-size", async () => {
        _mockMap.getStyle = vi.fn(() => ({
            version: 8,
            sources: {},
            layers: [{ id: "labels", type: "symbol", layout: {} }],
        }));
        _mockMap.setLayoutProperty = vi.fn();
        session = makeSession();
        await session.waitReady();
        expect(_mockMap.setLayoutProperty).not.toHaveBeenCalled();
    });
});
