/**
 * Tests for modal-open.ts
 *
 * Covers: modal opens, Échap closes, overlay click closes,
 * "Redéfinir" returns "redefine", checkbox change triggers recompose without
 * re-render, format change triggers session.resize.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMockGeoLeaf, uninstallMockGeoLeaf } from "./setup.js";

// ---------------------------------------------------------------------------
// Module mocks (hoisted) — vi.mock factories are hoisted to the top of the
// file so all referenced variables must be created via vi.hoisted().
// ---------------------------------------------------------------------------

const { createComposedCanvasMock, _mockSessionInstance } = vi.hoisted(() => ({
    createComposedCanvasMock: vi.fn(),
    _mockSessionInstance: {
        waitReady: vi.fn(),
        resize: vi.fn(),
        jumpTo: vi.fn(),
        getCanvas: vi.fn(),
        destroy: vi.fn(),
    },
}));

const { downloadBlobMock, tryServerFallbackMock, buildServerPayloadMock } = vi.hoisted(() => ({
    downloadBlobMock: vi.fn().mockResolvedValue(undefined),
    tryServerFallbackMock: vi.fn().mockResolvedValue(null),
    buildServerPayloadMock: vi.fn().mockReturnValue({}),
}));

vi.mock("../offscreen-render.js", () => ({
    // Vitest 4: `new OffscreenSession()` needs a constructable mock (class returning the fake).
    OffscreenSession: vi.fn().mockImplementation(
        class {
            constructor() {
                return _mockSessionInstance;
            }
        } as unknown as (...args: unknown[]) => unknown
    ),
}));

vi.mock("../layout-composer.js", () => ({
    createComposedCanvas: createComposedCanvasMock,
    registerSlot: vi.fn(),
}));

vi.mock("../overlays/scale-overlay.js", () => ({ drawScaleOverlay: vi.fn() }));
vi.mock("../overlays/north-arrow.js", () => ({
    drawNorthArrow: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../overlays/legend-inline.js", () => ({ drawLegendInline: vi.fn().mockResolvedValue(0) }));
vi.mock("@geoleaf/host-runtime", async (importActual) => ({
    ...(await importActual<typeof import("@geoleaf/host-runtime")>()),
    downloadBlob: downloadBlobMock,
}));
vi.mock("../server-fallback.js", () => ({
    tryServerFallback: tryServerFallbackMock,
    buildServerPayload: buildServerPayloadMock,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { openModal } from "../modal-open.js";
import type { EmpriseResult } from "../emprise-selector.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEmpriseResult(): EmpriseResult {
    return {
        bbox: { minLng: 2.3, minLat: 48.85, maxLng: 2.4, maxLat: 48.9 },
        scaleDenominator: 25_000,
        orientation: "landscape",
        center: { lng: 2.35, lat: 48.875 },
    };
}

function flushMicrotasks(): Promise<void> {
    return new Promise((r) => setTimeout(r, 0));
}

function _mockComposedCanvas(): HTMLCanvasElement {
    return document.createElement("canvas");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("openModal", () => {
    beforeEach(() => {
        installMockGeoLeaf();
        vi.clearAllMocks();
        _mockSessionInstance.waitReady.mockResolvedValue(undefined);
        _mockSessionInstance.resize.mockResolvedValue(undefined);
        _mockSessionInstance.getCanvas.mockImplementation(() => document.createElement("canvas"));
        createComposedCanvasMock.mockImplementation(async () => _mockComposedCanvas());
    });

    afterEach(() => {
        uninstallMockGeoLeaf();
        // Remove any leftover modal from DOM
        document.getElementById("gl-print-modal")?.remove();
        document.body.classList.remove("gl-print-modal-open");
    });

    it("mounts the modal into document.body", async () => {
        openModal(makeEmpriseResult(), {});
        await flushMicrotasks();
        expect(document.getElementById("gl-print-modal")).not.toBeNull();
    });

    it("adds gl-print-modal-open to body", async () => {
        openModal(makeEmpriseResult(), {});
        await flushMicrotasks();
        expect(document.body.classList.contains("gl-print-modal-open")).toBe(true);
    });

    it("resolves null on Escape key", async () => {
        const promise = openModal(makeEmpriseResult(), {});
        await flushMicrotasks();

        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        const result = await promise;
        expect(result).toBeNull();
    });

    it("resolves null on overlay click", async () => {
        const promise = openModal(makeEmpriseResult(), {});
        await flushMicrotasks();

        const overlay = document.querySelector(".gl-print-modal__overlay") as HTMLElement;
        expect(overlay).not.toBeNull();
        overlay.click();
        const result = await promise;
        expect(result).toBeNull();
    });

    it("resolves null on close button click", async () => {
        const promise = openModal(makeEmpriseResult(), {});
        await flushMicrotasks();

        const closeBtn = document.querySelector(".gl-print-modal__close") as HTMLButtonElement;
        expect(closeBtn).not.toBeNull();
        closeBtn.click();
        const result = await promise;
        expect(result).toBeNull();
    });

    it("resolves 'redefine' when redefine link is clicked", async () => {
        const promise = openModal(makeEmpriseResult(), {});
        await flushMicrotasks();

        const link = document.querySelector(".gl-print-redefine") as HTMLAnchorElement;
        expect(link).not.toBeNull();
        link.click();
        const result = await promise;
        expect(result).toBe("redefine");
    });

    it("removes the modal and body class on close", async () => {
        const promise = openModal(makeEmpriseResult(), {});
        await flushMicrotasks();

        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await promise;
        expect(document.getElementById("gl-print-modal")).toBeNull();
        expect(document.body.classList.contains("gl-print-modal-open")).toBe(false);
    });

    it("calls createComposedCanvas on initial render (no session.resize after construction)", async () => {
        openModal(makeEmpriseResult(), {});
        await flushMicrotasks();
        await flushMicrotasks(); // allow initial IIFE to complete

        expect(createComposedCanvasMock).toHaveBeenCalled();
        // resize is NOT called by the constructor path (only jumpTo/waitReady)
        expect(_mockSessionInstance.resize).not.toHaveBeenCalled();
    });

    it("calls createComposedCanvas but NOT session.resize when a checkbox changes", async () => {
        openModal(makeEmpriseResult(), {});
        await flushMicrotasks();
        await flushMicrotasks();

        const callsBefore = createComposedCanvasMock.mock.calls.length;
        const resizeCallsBefore = _mockSessionInstance.resize.mock.calls.length;

        // Toggle the scale checkbox
        const scaleCheckbox = document.getElementById("gl-print-chk-scale") as HTMLInputElement;
        expect(scaleCheckbox).not.toBeNull();
        scaleCheckbox.checked = !scaleCheckbox.checked;
        scaleCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
        await flushMicrotasks();

        expect(createComposedCanvasMock.mock.calls.length).toBeGreaterThan(callsBefore);
        expect(_mockSessionInstance.resize.mock.calls.length).toBe(resizeCallsBefore);
    });

    it("calls createComposedCanvas but NOT session.resize when title input changes", async () => {
        openModal(makeEmpriseResult(), {});
        await flushMicrotasks();
        await flushMicrotasks();

        const callsBefore = createComposedCanvasMock.mock.calls.length;

        const titleInput = document.getElementById("gl-print-title") as HTMLInputElement;
        expect(titleInput).not.toBeNull();
        titleInput.value = "New title";
        titleInput.dispatchEvent(new Event("input", { bubbles: true }));
        await flushMicrotasks();

        expect(createComposedCanvasMock.mock.calls.length).toBeGreaterThan(callsBefore);
        expect(_mockSessionInstance.resize).not.toHaveBeenCalled();
    });

    it("calls session.resize when format select changes (after debounce)", async () => {
        openModal(makeEmpriseResult(), {});
        await flushMicrotasks();
        await flushMicrotasks();

        const select = document.querySelector(".gl-print-format-select") as HTMLSelectElement;
        expect(select).not.toBeNull();

        // Change to A3
        select.value = "A3";
        select.dispatchEvent(new Event("change", { bubbles: true }));

        // Flush debounce (150ms)
        await new Promise((r) => setTimeout(r, 200));
        await flushMicrotasks();

        expect(_mockSessionInstance.resize).toHaveBeenCalled();
    });

    it("destroys the session on close", async () => {
        const promise = openModal(makeEmpriseResult(), {});
        await flushMicrotasks();

        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await promise;
        expect(_mockSessionInstance.destroy).toHaveBeenCalled();
    });

    // ------------------------------------------------------------------
    // Annotations checkbox — conditional on plugin-measure
    // ------------------------------------------------------------------

    it("does NOT render the annotations checkbox when measure plugin is absent", async () => {
        // Default mock has no GeoLeaf.plugins — measure is not loaded
        openModal(makeEmpriseResult(), {});
        await flushMicrotasks();

        const annotCheckbox = document.getElementById("gl-print-chk-annot");
        expect(annotCheckbox).toBeNull();
    });

    it("renders the annotations checkbox when measure plugin is loaded", async () => {
        // Inject plugins.isLoaded returning true for "measure"
        (globalThis as any).GeoLeaf.plugins = {
            isLoaded: vi.fn((id: string) => id === "measure"),
        };

        openModal(makeEmpriseResult(), {});
        await flushMicrotasks();

        const annotCheckbox = document.getElementById("gl-print-chk-annot");
        expect(annotCheckbox).not.toBeNull();
    });

    it("annotations checkbox defaults to checked (config.includeAnnotations = true by default)", async () => {
        (globalThis as any).GeoLeaf.plugins = {
            isLoaded: vi.fn((id: string) => id === "measure"),
        };

        openModal(makeEmpriseResult(), {});
        await flushMicrotasks();

        const annotCheckbox = document.getElementById("gl-print-chk-annot") as HTMLInputElement;
        expect(annotCheckbox).not.toBeNull();
        expect(annotCheckbox.checked).toBe(true);
    });

    it("annotations checkbox change triggers recompose without session.resize", async () => {
        (globalThis as any).GeoLeaf.plugins = {
            isLoaded: vi.fn((id: string) => id === "measure"),
        };

        openModal(makeEmpriseResult(), {});
        await flushMicrotasks();
        await flushMicrotasks();

        const callsBefore = createComposedCanvasMock.mock.calls.length;
        const resizeBefore = _mockSessionInstance.resize.mock.calls.length;

        const annotCheckbox = document.getElementById("gl-print-chk-annot") as HTMLInputElement;
        expect(annotCheckbox).not.toBeNull();
        annotCheckbox.checked = !annotCheckbox.checked;
        annotCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
        await flushMicrotasks();

        expect(createComposedCanvasMock.mock.calls.length).toBeGreaterThan(callsBefore);
        expect(_mockSessionInstance.resize.mock.calls.length).toBe(resizeBefore);
    });

    // ------------------------------------------------------------------
    // Spinner (print:render:start / print:render:end events)
    // ------------------------------------------------------------------

    it("spinner becomes visible on print:render:start event", async () => {
        openModal(makeEmpriseResult(), {});
        await flushMicrotasks();
        const spinner = document.querySelector(".gl-print-spinner") as HTMLElement;
        expect(spinner).not.toBeNull();
        document.dispatchEvent(new CustomEvent("print:render:start"));
        expect(spinner.style.display).toBe("flex");
    });

    it("spinner is hidden on print:render:end event", async () => {
        openModal(makeEmpriseResult(), {});
        await flushMicrotasks();
        const spinner = document.querySelector(".gl-print-spinner") as HTMLElement;
        document.dispatchEvent(new CustomEvent("print:render:start"));
        document.dispatchEvent(new CustomEvent("print:render:end"));
        expect(spinner.style.display).toBe("none");
    });

    // ------------------------------------------------------------------
    // Export button — cachedMapCanvas guard and happy path
    // ------------------------------------------------------------------

    it("export button is a no-op when cachedMapCanvas is not yet set", async () => {
        openModal(makeEmpriseResult(), {});
        // Do NOT flush — cachedMapCanvas is null at this point
        const btn = document.querySelector(".gl-print-btn--pdf") as HTMLButtonElement;
        expect(btn).not.toBeNull();
        btn.click();
        // No extra compose call should have happened
        expect(createComposedCanvasMock).not.toHaveBeenCalled();
    });

    it("export button triggers compose + downloadBlob when exporter is registered", async () => {
        (globalThis as any).GeoLeaf = {
            ...(globalThis as any).GeoLeaf,
            Print: {
                _getExporter: vi.fn(
                    () => async () => new Blob(["pdf"], { type: "application/pdf" })
                ),
            },
        };
        downloadBlobMock.mockClear();

        const promise = openModal(makeEmpriseResult(), {});
        await flushMicrotasks();
        await flushMicrotasks(); // initial render done, cachedMapCanvas set

        const callsBefore = createComposedCanvasMock.mock.calls.length;
        const btn = document.querySelector(".gl-print-btn--pdf") as HTMLButtonElement;
        expect(btn).not.toBeNull();
        btn.click();

        await flushMicrotasks();
        await flushMicrotasks();
        await flushMicrotasks();

        const result = await promise;
        expect(createComposedCanvasMock.mock.calls.length).toBeGreaterThan(callsBefore);
        expect(downloadBlobMock).toHaveBeenCalled();
        expect(result).toBeInstanceOf(Blob);
    });

    it("resolves null when the exporter fails with a non-security error", async () => {
        (globalThis as any).GeoLeaf = {
            ...(globalThis as any).GeoLeaf,
            Print: {
                _getExporter: vi.fn(() => async () => {
                    throw new Error("jsPDF exploded");
                }),
            },
        };
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        tryServerFallbackMock.mockClear();

        const promise = openModal(makeEmpriseResult(), {});
        await flushMicrotasks();
        await flushMicrotasks();

        (document.querySelector(".gl-print-btn--pdf") as HTMLButtonElement).click();
        await flushMicrotasks();
        await flushMicrotasks();
        await flushMicrotasks();

        const result = await promise;
        // A plain error is not a tainted canvas — no server round-trip.
        expect(tryServerFallbackMock).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('Exporter "pdf" failed'),
            expect.any(Error)
        );
        expect(result).toBeNull();
        warn.mockRestore();
    });

    it("closes with null when the requested paper format is not registered", async () => {
        const promise = openModal(makeEmpriseResult(), { defaultFormat: "NOT_A_FORMAT" });
        await flushMicrotasks();
        await flushMicrotasks();

        const result = await promise;
        expect(result).toBeNull();
        expect(document.getElementById("gl-print-modal")).toBeNull();
    });

    // ------------------------------------------------------------------
    // Tainted canvas → server fallback
    // ------------------------------------------------------------------

    /** Installs an exporter that fails the way a non-CORS tile source makes it fail. */
    function _installTaintedExporter(): void {
        (globalThis as any).GeoLeaf = {
            ...(globalThis as any).GeoLeaf,
            Print: {
                _getExporter: vi.fn(() => async () => {
                    throw new DOMException("Tainted canvas", "SecurityError");
                }),
            },
        };
    }

    it("falls back to the server when the canvas is tainted and an endpoint is configured", async () => {
        installMockGeoLeaf({ printConfig: { serverEndpoint: "https://print.example/render" } });
        _installTaintedExporter();
        const serverBlob = new Blob(["pdf"], { type: "application/pdf" });
        tryServerFallbackMock.mockResolvedValueOnce(serverBlob);
        downloadBlobMock.mockClear();

        const promise = openModal(makeEmpriseResult(), {});
        await flushMicrotasks();
        await flushMicrotasks();

        (document.querySelector(".gl-print-btn--pdf") as HTMLButtonElement).click();
        await flushMicrotasks();
        await flushMicrotasks();
        await flushMicrotasks();

        const result = await promise;
        expect(buildServerPayloadMock).toHaveBeenCalled();
        expect(tryServerFallbackMock).toHaveBeenCalled();
        expect(downloadBlobMock).toHaveBeenCalled();
        expect(result).toBe(serverBlob);
    });

    it("warns and resolves null on a tainted canvas when no endpoint is configured", async () => {
        installMockGeoLeaf(); // no serverEndpoint
        _installTaintedExporter();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        tryServerFallbackMock.mockClear();

        const promise = openModal(makeEmpriseResult(), {});
        await flushMicrotasks();
        await flushMicrotasks();

        (document.querySelector(".gl-print-btn--pdf") as HTMLButtonElement).click();
        await flushMicrotasks();
        await flushMicrotasks();
        await flushMicrotasks();

        const result = await promise;
        expect(tryServerFallbackMock).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith("[GeoLeaf.Print]", expect.stringContaining("CORS"));
        expect(result).toBeNull();
        warn.mockRestore();
    });

    it("export button calls _close(null) when no exporter is registered", async () => {
        // installMockGeoLeaf does not set GeoLeaf.Print → no exporter found
        const promise = openModal(makeEmpriseResult(), {});
        await flushMicrotasks();
        await flushMicrotasks();

        const btn = document.querySelector(".gl-print-btn--pdf") as HTMLButtonElement;
        expect(btn).not.toBeNull();
        btn.click();

        await flushMicrotasks();
        await flushMicrotasks();
        await flushMicrotasks();

        const result = await promise;
        expect(result).toBeNull();
    });
});
