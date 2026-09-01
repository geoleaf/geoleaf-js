/**
 * Tests for recap-box.ts
 * Covers: initRecapBox, renderRecap, clearRecap, XSS safety.
 * PLUGINS S5: renderRecapFromSession, menu-open gating, and the engine wiring —
 * the box was never reachable before this sprint, so none of it had coverage.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
    initRecapBox,
    renderRecap,
    clearRecap,
    renderRecapFromSession,
    setRecapMenuOpen,
    destroyRecapBox,
} from "../recap-box.js";
import { getMeasureConfig } from "../config.js";
import { initLayers } from "../draw-layers.js";
import {
    initEngine,
    startSession,
    addVertex,
    closeAsPolygon,
    finishSession,
    cancelSession,
    clearEngineCollection,
} from "../measure-engine.js";
import { installMockGeoLeaf, uninstallMockGeoLeaf, makeMockMaplibreMap } from "./setup.js";

describe("recap-box", () => {
    let container: HTMLElement;

    beforeEach(() => {
        installMockGeoLeaf();
        container = document.createElement("div");
        document.body.appendChild(container);
        initRecapBox(container);
    });

    afterEach(() => {
        container.remove();
        uninstallMockGeoLeaf();
    });

    // -------------------------------------------------------------------------
    // initRecapBox
    // -------------------------------------------------------------------------

    it("creates .gl-measure-recap inside the given container", () => {
        expect(container.querySelector(".gl-measure-recap")).not.toBeNull();
    });

    it("recap box is initially hidden", () => {
        const recap = container.querySelector(".gl-measure-recap")!;
        expect(recap.classList.contains("gl-measure-recap--hidden")).toBe(true);
    });

    it("creates a table with thead", () => {
        expect(container.querySelector(".gl-measure-recap__table thead")).not.toBeNull();
    });

    // -------------------------------------------------------------------------
    // renderRecap
    // -------------------------------------------------------------------------

    it("renderRecap shows the recap box", () => {
        renderRecap([{ index: 1, coordStr: "2.35, 48.85", lengthStr: "100 m" }], {
            perimeterStr: "100 m",
        });
        const recap = container.querySelector(".gl-measure-recap")!;
        expect(recap.classList.contains("gl-measure-recap--hidden")).toBe(false);
    });

    it("renderRecap creates one tbody row per RecapRow", () => {
        renderRecap(
            [
                { index: 1, coordStr: "2.35, 48.85", lengthStr: "86 m" },
                { index: 2, coordStr: "2.36, 48.86", lengthStr: "142 m" },
                { index: 3, coordStr: "2.37, 48.87", lengthStr: "53 m" },
            ],
            { perimeterStr: "281 m" }
        );
        const rows = container.querySelectorAll(".gl-measure-recap__table tbody tr");
        expect(rows.length).toBe(3);
    });

    it("renderRecap sets correct cell text values", () => {
        renderRecap([{ index: 1, coordStr: "2.35, 48.85", lengthStr: "86 m" }], {
            perimeterStr: "86 m",
        });
        const cells = container.querySelectorAll(
            ".gl-measure-recap__table tbody tr:first-child td"
        );
        expect(cells[0].textContent).toBe("1");
        expect(cells[1].textContent).toBe("2.35, 48.85");
        expect(cells[2].textContent).toBe("86 m");
    });

    it("renderRecap shows perimeter in tfoot", () => {
        renderRecap([{ index: 1, coordStr: "2.35, 48.85", lengthStr: "86 m" }], {
            perimeterStr: "86 m",
        });
        const tfoot = container.querySelector(".gl-measure-recap__table tfoot");
        expect(tfoot!.textContent).toContain("86 m");
    });

    it("renderRecap includes area string in tfoot when provided", () => {
        renderRecap([{ index: 1, coordStr: "2.35, 48.85", lengthStr: "86 m" }], {
            perimeterStr: "268 m",
            areaStr: "0.42 ha",
        });
        const tfoot = container.querySelector(".gl-measure-recap__table tfoot");
        expect(tfoot!.textContent).toContain("268 m");
        expect(tfoot!.textContent).toContain("0.42 ha");
    });

    it("calling renderRecap twice replaces previous rows", () => {
        renderRecap([{ index: 1, coordStr: "A", lengthStr: "10 m" }], { perimeterStr: "10 m" });
        renderRecap(
            [
                { index: 1, coordStr: "B", lengthStr: "20 m" },
                { index: 2, coordStr: "C", lengthStr: "30 m" },
            ],
            { perimeterStr: "50 m" }
        );
        const rows = container.querySelectorAll(".gl-measure-recap__table tbody tr");
        expect(rows.length).toBe(2);
        expect(rows[0].querySelector("td")!.textContent).toBe("1");
    });

    // -------------------------------------------------------------------------
    // clearRecap
    // -------------------------------------------------------------------------

    it("clearRecap hides the recap box", () => {
        renderRecap([{ index: 1, coordStr: "2.35, 48.85", lengthStr: "100 m" }], {
            perimeterStr: "100 m",
        });
        clearRecap();
        const recap = container.querySelector(".gl-measure-recap")!;
        expect(recap.classList.contains("gl-measure-recap--hidden")).toBe(true);
    });

    it("clearRecap empties tbody rows", () => {
        renderRecap([{ index: 1, coordStr: "2.35, 48.85", lengthStr: "100 m" }], {
            perimeterStr: "100 m",
        });
        clearRecap();
        const rows = container.querySelectorAll(".gl-measure-recap__table tbody tr");
        expect(rows.length).toBe(0);
    });

    // -------------------------------------------------------------------------
    // XSS safety
    // -------------------------------------------------------------------------

    it("does not interpret HTML in coordStr (XSS safety)", () => {
        const xss = '<img src=x onerror="window.__xss=1">';
        renderRecap([{ index: 1, coordStr: xss, lengthStr: "10 m" }], { perimeterStr: "10 m" });
        const cell = container.querySelector<HTMLElement>(
            ".gl-measure-recap__table tbody td:nth-child(2)"
        )!;
        // textContent should contain the literal string, no img element
        expect(cell.textContent).toBe(xss);
        expect(container.querySelector("img")).toBeNull();
        expect((globalThis as any).__xss).toBeUndefined();
    });

    // -------------------------------------------------------------------------
    // renderRecapFromSession — PLUGINS S5
    // -------------------------------------------------------------------------

    const UNITS = { distance: "m", area: "m2" } as const;
    const DECIMALS = { distance: 0, area: 0 };

    // ~1 km apart on the equator-ish parallel of Paris, so the metre formatting is stable.
    const V1: [number, number] = [2.3, 48.85];
    const V2: [number, number] = [2.31, 48.85];
    const V3: [number, number] = [2.31, 48.86];

    function rowCells(): string[][] {
        return [...container.querySelectorAll(".gl-measure-recap__table tbody tr")].map((tr) =>
            [...tr.querySelectorAll("td")].map((td) => td.textContent ?? "")
        );
    }

    it("renders one row per vertex", () => {
        renderRecapFromSession([V1, V2, V3], false, UNITS, DECIMALS);
        expect(rowCells().length).toBe(3);
    });

    it("leaves the first vertex without a length — it has no incoming segment", () => {
        renderRecapFromSession([V1, V2, V3], false, UNITS, DECIMALS);
        const cells = rowCells();
        expect(cells[0][2]).toBe("");
        expect(cells[1][2]).not.toBe("");
        expect(cells[2][2]).not.toBe("");
    });

    it("formats coordinates as 'lng ; lat' with 5 decimals", () => {
        renderRecapFromSession([V1], false, UNITS, DECIMALS);
        expect(rowCells()[0][1]).toBe("2.30000 ; 48.85000");
    });

    it("shows the cumulative distance as the total for an open line", () => {
        renderRecapFromSession([V1, V2], false, UNITS, DECIMALS);
        const tfoot = container.querySelector(".gl-measure-recap__table tfoot")!;
        // The single segment length is also the total.
        expect(tfoot.textContent).toContain(rowCells()[1][2]);
    });

    it("adds an area to the total for a closed ring", () => {
        renderRecapFromSession([V1, V2, V3], true, UNITS, DECIMALS);
        const tfoot = container.querySelector(".gl-measure-recap__table tfoot")!;
        expect(tfoot.textContent).toContain("m²");
    });

    it("does not add an area for an open line", () => {
        renderRecapFromSession([V1, V2, V3], false, UNITS, DECIMALS);
        const tfoot = container.querySelector(".gl-measure-recap__table tfoot")!;
        expect(tfoot.textContent).not.toContain("m²");
    });

    it("counts the closing edge in the perimeter without giving it a row", () => {
        renderRecapFromSession([V1, V2, V3], false, UNITS, DECIMALS);
        const open = container.querySelector(".gl-measure-recap__table tfoot")!.textContent;
        renderRecapFromSession([V1, V2, V3], true, UNITS, DECIMALS);
        const closed = container.querySelector(".gl-measure-recap__table tfoot")!.textContent;
        // Same three rows either way, but the ring's perimeter is longer.
        expect(rowCells().length).toBe(3);
        expect(closed).not.toBe(open);
    });

    it("a ring of fewer than 3 vertices is treated as an open line", () => {
        renderRecapFromSession([V1, V2], true, UNITS, DECIMALS);
        const tfoot = container.querySelector(".gl-measure-recap__table tfoot")!;
        expect(tfoot.textContent).not.toContain("m²");
    });

    it("hides the box when the session has no vertices", () => {
        renderRecapFromSession([V1, V2], false, UNITS, DECIMALS);
        renderRecapFromSession([], false, UNITS, DECIMALS);
        const recap = container.querySelector(".gl-measure-recap")!;
        expect(recap.classList.contains("gl-measure-recap--hidden")).toBe(true);
        expect(rowCells().length).toBe(0);
    });

    // -------------------------------------------------------------------------
    // setRecapMenuOpen — PLUGINS S5
    // -------------------------------------------------------------------------

    it("closing the menu hides the box but keeps its rows", () => {
        renderRecapFromSession([V1, V2], false, UNITS, DECIMALS);
        setRecapMenuOpen(false);
        const recap = container.querySelector(".gl-measure-recap")!;
        expect(recap.classList.contains("gl-measure-recap--hidden")).toBe(true);
        // The measurement is still running — the rows must survive.
        expect(rowCells().length).toBe(2);
    });

    it("reopening the menu restores a box that still has rows", () => {
        renderRecapFromSession([V1, V2], false, UNITS, DECIMALS);
        setRecapMenuOpen(false);
        setRecapMenuOpen(true);
        const recap = container.querySelector(".gl-measure-recap")!;
        expect(recap.classList.contains("gl-measure-recap--hidden")).toBe(false);
    });

    it("opening the menu does not reveal an empty box", () => {
        setRecapMenuOpen(true);
        const recap = container.querySelector(".gl-measure-recap")!;
        expect(recap.classList.contains("gl-measure-recap--hidden")).toBe(true);
    });

    // -------------------------------------------------------------------------
    // destroyRecapBox — PLUGINS S5
    // -------------------------------------------------------------------------

    it("renderRecap after destroyRecapBox is a no-op rather than a throw", () => {
        destroyRecapBox();
        expect(() =>
            renderRecap([{ index: 1, coordStr: "A", lengthStr: "1 m" }], { perimeterStr: "1 m" })
        ).not.toThrow();
    });

    it("clearRecap after destroyRecapBox is a no-op rather than a throw", () => {
        destroyRecapBox();
        expect(() => clearRecap()).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// Engine → recap wiring — PLUGINS S5
//
// This is the part that was missing: recap-box.ts was complete and correct from the start,
// but no production code ever called it. These tests pin the calls, not
// the rendering, so a future purge of the wiring fails loudly.
// ---------------------------------------------------------------------------

describe("measure-engine drives the recap box", () => {
    let container: HTMLElement;

    const A: [number, number] = [2.3, 48.85];
    const B: [number, number] = [2.31, 48.85];
    const C: [number, number] = [2.31, 48.86];

    function rows(): number {
        return container.querySelectorAll(".gl-measure-recap__table tbody tr").length;
    }

    function isHidden(): boolean {
        return container
            .querySelector(".gl-measure-recap")!
            .classList.contains("gl-measure-recap--hidden");
    }

    beforeEach(() => {
        const nativeMap = makeMockMaplibreMap();
        installMockGeoLeaf({ nativeMap });
        initLayers(nativeMap);
        initEngine(getMeasureConfig());
        container = document.createElement("div");
        document.body.appendChild(container);
        initRecapBox(container);
    });

    afterEach(() => {
        clearEngineCollection();
        destroyRecapBox();
        container.remove();
        uninstallMockGeoLeaf();
    });

    it("addVertex adds a recap row and reveals the box", () => {
        startSession("line");
        addVertex(A);
        expect(rows()).toBe(1);
        expect(isHidden()).toBe(false);
        addVertex(B);
        expect(rows()).toBe(2);
    });

    it("closeAsPolygon appends an area to the total", () => {
        startSession("polygon");
        addVertex(A);
        addVertex(B);
        addVertex(C);
        const openTotal = container.querySelector(".gl-measure-recap__table tfoot")!.textContent;
        closeAsPolygon();
        const closedTotal = container.querySelector(".gl-measure-recap__table tfoot")!.textContent;
        // The engine runs on the default "auto" units, so assert on the perimeter—area
        // join rather than a unit symbol.
        expect(openTotal).not.toContain(" — ");
        expect(closedTotal).toContain(" — ");
    });

    it("finishSession clears the box — it mirrors the ACTIVE measurement", () => {
        startSession("line");
        addVertex(A);
        addVertex(B);
        finishSession();
        expect(rows()).toBe(0);
        expect(isHidden()).toBe(true);
    });

    it("cancelSession clears the box", () => {
        startSession("line");
        addVertex(A);
        addVertex(B);
        cancelSession();
        expect(rows()).toBe(0);
        expect(isHidden()).toBe(true);
    });

    it("clearEngineCollection clears the box — the clearAll contract of the CDC", () => {
        startSession("line");
        addVertex(A);
        addVertex(B);
        clearEngineCollection();
        expect(rows()).toBe(0);
        expect(isHidden()).toBe(true);
    });
});
