/**
 * Scale capability — runtime control.
 * Relocated from __tests__/map/scale-control.test.js (extraction roadmap contrôles carte).
 * The former `initScaleControl` (which read `ui.showScale` + `scaleConfig`) is gone — the
 * config reading moved to ScaleLifecycle (tested via __tests__/capabilities/scale/lifecycle
 * indirectly). Only the `ScaleControl` singleton is tested here.
 */

const mockLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const mockOn = vi.fn();
const mockOff = vi.fn();

vi.mock("../../../src/utils/log/index.js", () => ({ Log: mockLog }));

// Load via ESM `import` of the `.js` specifier — the SAME resolution path the app
// uses (public-api.ts → `./scale-control.js`). Under pool:forks + --import tsx + V8,
// a `require(".ts")` here loads a separate CJS script instance whose coverage does
// NOT merge with the app's ESM instance in the full suite (reports ~39% despite this
// file covering ~97% in isolation). Aligning the specifier makes V8 merge correctly.
const { ScaleControl } = await import("../../../src/capabilities/scale/scale-control.js");
const { scaleAtZoom } = await import("../../../src/utils/general/scale-utils.js");

describe("capabilities/scale — ScaleControl", () => {
    let mockMap;

    beforeEach(() => {
        vi.clearAllMocks();
        mockMap = {
            getZoom: vi.fn().mockReturnValue(10),
            getSize: vi.fn().mockReturnValue({ x: 800, y: 600 }),
            getCenter: vi.fn().mockReturnValue({ lat: 48.8, lng: 2.3 }),
            containerPointToLatLng: vi.fn((pt) => ({
                lat: 48.8 + pt[1] / 100000,
                lng: 2.3 + pt[0] / 100000,
            })),
            pointToLatLng: vi.fn(() => ({ lat: 48.8, lng: 2.3 })),
            distance: vi.fn().mockReturnValue(5000),
            on: mockOn,
            off: mockOff,
            setView: vi.fn(),
            addControl: vi.fn(() => ({ remove: vi.fn() })),
            getContainer: vi.fn(() =>
                Object.assign(document.createElement("div"), {
                    getBoundingClientRect: () => ({ height: 600, width: 800 }),
                })
            ),
        };
    });

    describe("export", () => {
        it("exports ScaleControl", () => {
            expect(ScaleControl).toBeDefined();
            expect(typeof ScaleControl.init).toBe("function");
        });
    });

    describe("init", () => {
        it("returns early and logs error when map is null", () => {
            ScaleControl.init(null, {});
            expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining("Map not provided"));
        });

        it("calls _createMainContainer and Log.info when map is valid", () => {
            ScaleControl.init(mockMap, { position: "bottomleft", scaleGraphic: false });
            expect(ScaleControl._map).toBe(mockMap);
            expect(ScaleControl._config.position).toBe("bottomleft");
            expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining("rol initialized"));
        });

        it("adds graphic scale and custom block when scaleGraphic and scaleNumeric true", () => {
            ScaleControl.init(mockMap, {
                position: "bottomleft",
                scaleGraphic: true,
                scaleNumeric: true,
                scaleNivel: true,
            });
            expect(ScaleControl._mainWrapper).toBeDefined();
            expect(ScaleControl._scaleLineMetric).toBeDefined();
            expect(ScaleControl._numericElement).toBeDefined();
            expect(ScaleControl._zoomElement).toBeDefined();
            expect(mockOn).toHaveBeenCalledWith("zoomend", expect.any(Function));
            expect(mockOn).toHaveBeenCalledWith("moveend", expect.any(Function));
            if (ScaleControl._eventHandlers.graphicScaleUpdate) {
                ScaleControl._eventHandlers.graphicScaleUpdate();
            }
            ScaleControl._updateScale();
            expect(ScaleControl._numericElement.textContent).toMatch(/1:|\d/);
            expect(ScaleControl._zoomElement.textContent).toMatch(/Zoom:/);
        });

        it("creates editable scale when scaleNumericEditable true", () => {
            ScaleControl.init(mockMap, {
                scaleGraphic: false,
                scaleNumeric: true,
                scaleNumericEditable: true,
                scaleNivel: true,
            });
            expect(ScaleControl._inputElement).toBeDefined();
            expect(ScaleControl._scalePrefix).toBeDefined();
            expect(ScaleControl._scalePrefix.textContent).toBe("1:");
            ScaleControl._switchToEditMode();
            expect(ScaleControl._inputElement.style.display).toBe("inline-block");
            ScaleControl._inputElement.value = "250000";
            ScaleControl._onScaleInputChange();
            expect(mockMap.setView).toHaveBeenCalled();
            ScaleControl._switchToDisplayMode();
            expect(ScaleControl._inputElement.style.display).toBe("none");
        });

        it("_onScaleInputChange resets display on invalid input", () => {
            ScaleControl.init(mockMap, {
                scaleGraphic: false,
                scaleNumeric: true,
                scaleNumericEditable: true,
            });
            ScaleControl._inputElement.value = "invalid";
            ScaleControl._onScaleInputChange();
            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining("scale format:"),
                expect.any(String)
            );
        });
    });

    describe("_updateScaleLine", () => {
        it("sets scale in km when maxMeters > 1000", () => {
            const scaleLine = document.createElement("div");
            ScaleControl._updateScaleLine(scaleLine, 5000);
            expect(scaleLine.textContent).toMatch(/\d+\s*km/);
            expect(scaleLine.style.width).toBeDefined();
        });

        it("sets scale in m when maxMeters <= 1000", () => {
            const scaleLine = document.createElement("div");
            ScaleControl._updateScaleLine(scaleLine, 500);
            expect(scaleLine.textContent).toMatch(/\d+\s*m/);
        });
    });

    describe("_getRoundNum", () => {
        it("returns round number for scale display", () => {
            expect(ScaleControl._getRoundNum(12)).toBe(10);
            expect(ScaleControl._getRoundNum(2500)).toBe(2000);
        });
    });

    describe("_formatNumber", () => {
        // ⚠️ The original assertion was `toMatch(/\d\s\d/)` on a single
        // value: it passed on `"2 50000"` as on `"250 000"`. Hardened before
        // the regex-free rewrite — a test that cannot tell the two apart does
        // not protect the switch.
        //
        // The first 6 values are the denominators REALLY rendered by the
        // control (`scaleAtZoom` rounds to the integer, scale-utils.ts) at
        // zooms 0/5/10/14/17/22.
        it.each([
            [591658711, "591 658 711"],
            [18489335, "18 489 335"],
            [380585, "380 585"],
            [23787, "23 787"],
            [3181, "3 181"],
            [71, "71"],
            // Grouping bounds — where a naive implementation goes wrong.
            [0, "0"],
            [7, "7"],
            [999, "999"],
            [1000, "1 000"],
            [1000000, "1 000 000"],
            [1234567890, "1 234 567 890"],
        ])("formate %i en « %s »", (input, expected) => {
            expect(ScaleControl._formatNumber(input)).toBe(expected);
        });

        it("le séparateur reste l'espace ASCII que `_onScaleInputChange` sait re-parser", () => {
            // The readout is re-parsed by `input.replace(/\s/g,"") + parseInt`:
            // changing separator would silently break manual scale entry.
            //
            // Localising the separator was MEASURED then CLOSED: the space is
            // the ISO 31-0 recommendation, and 4 of the 6 languages group
            // with ".", which makes "1:250.000" ambiguous for a scale
            // denominator. Not a pending localisation — a settled choice. Do not reopen.
            const out = ScaleControl._formatNumber(250000);
            expect(out).toBe("250 000");
            expect(Number.parseInt(out.replace(/\s/g, ""), 10)).toBe(250000);
        });

        // The guardrail that measurement made necessary: the format↔parse
        // pair must stay reversible. It is what would break first if someone
        // moved to `Intl.NumberFormat` without rewriting the read — the
        // failure mode is SILENT (scale 1:250 set instead of 1:250 000), so
        // it would not show otherwise.
        it.each([250000, 1000, 999, 1234567890, 71, 0])(
            "aller-retour format → parse pour %i (réversibilité, cf. B.26 close)",
            (value) => {
                const rendered = ScaleControl._formatNumber(value);
                expect(Number.parseInt(rendered.replace(/\s/g, ""), 10)).toBe(value);
            }
        );
    });

    describe("destroy", () => {
        it("clears map reference and calls map.off", () => {
            ScaleControl._map = mockMap;
            ScaleControl._eventHandlers = {
                graphicScaleUpdate: vi.fn(),
                numericScaleUpdate: vi.fn(),
            };
            ScaleControl.destroy();
            expect(mockOff).toHaveBeenCalled();
            expect(ScaleControl._map).toBeNull();
        });

        it("removes _mainWrapper from DOM when it has parentNode", () => {
            ScaleControl.init(mockMap, { scaleGraphic: false, scaleNumeric: true });
            const wrapper = ScaleControl._mainWrapper;
            const parent = document.createElement("div");
            parent.appendChild(wrapper);
            ScaleControl.destroy();
            expect(parent.contains(wrapper)).toBe(false);
            expect(ScaleControl._mainWrapper).toBeNull();
        });
    });

    describe("_calculateScale and _calculateZoomFromScale", () => {
        it("_calculateScale uses optional lat and returns rounded scale", () => {
            ScaleControl._map = mockMap;
            const scale1 = ScaleControl._calculateScale(10);
            const scale2 = ScaleControl._calculateScale(10, 48.8);
            expect(typeof scale1).toBe("number");
            expect(scale1).toBeGreaterThan(0);
            expect(scale2).toBe(scale1);
        });

        it("_calculateZoomFromScale returns zoom in 0..22", () => {
            ScaleControl._map = mockMap;
            const zoom = ScaleControl._calculateZoomFromScale(250000);
            expect(zoom).toBeGreaterThanOrEqual(0);
            expect(zoom).toBeLessThanOrEqual(22);
        });

        it("_calculateScale delegates to the kernel scaleAtZoom — single source of truth (S6)", () => {
            ScaleControl._map = mockMap;
            for (const [z, lat] of [
                [5, 0],
                [10, 48.8],
                [14, 60],
                [3, -33.9],
            ]) {
                expect(ScaleControl._calculateScale(z, lat)).toBe(scaleAtZoom(z, lat));
            }
        });
    });
});
