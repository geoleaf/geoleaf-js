/**
 * Tests for annotation-overlays.ts — tooltip overlays anchored to geographic coordinates.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installMockGeoLeaf, uninstallMockGeoLeaf, makeMockMaplibreMap } from "./setup.js";
import { getMeasureConfig } from "../config.js";
import {
    initAnnotationOverlays,
    createOverlay,
    createOverlayFromFeature,
    removeOverlay,
    clearAllOverlays,
    getPrintableAnnotations,
} from "../annotation-overlays.js";
import type { MeasureFeature } from "../types.js";

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

let map: ReturnType<typeof makeMockMaplibreMap>;
let container: HTMLElement;
const LNGLAT: [number, number] = [2.35, 48.85];
const ON_CREATED = vi.fn();
const ON_MUTATED = vi.fn();
const ON_REMOVED = vi.fn();

function setup() {
    const gl = installMockGeoLeaf();
    map = gl._nativeMap;
    container = map.getContainer();
    const cfg = getMeasureConfig();
    initAnnotationOverlays(map, cfg, {
        onCreated: ON_CREATED,
        onMutated: ON_MUTATED,
        onRemoved: ON_REMOVED,
    });
}

beforeEach(() => {
    vi.useFakeTimers();
    setup();
    ON_CREATED.mockReset();
    ON_MUTATED.mockReset();
    ON_REMOVED.mockReset();
});

afterEach(() => {
    clearAllOverlays();
    uninstallMockGeoLeaf();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createOverlay — tooltip", () => {
    it("appends an element with the tooltip class to the map container", () => {
        createOverlay(LNGLAT);
        expect(container.querySelector(".gl-measure-annot-tooltip")).not.toBeNull();
    });

    it("positions the element using map.project", () => {
        createOverlay(LNGLAT);
        expect(map.project).toHaveBeenCalledWith(LNGLAT);
    });

    it("calls onCreated with a Point Feature having annotationKind=tooltip", () => {
        createOverlay(LNGLAT);
        expect(ON_CREATED).toHaveBeenCalledOnce();
        const f = ON_CREATED.mock.calls[0][0] as MeasureFeature;
        expect(f.geometry.type).toBe("Point");
        expect(f.properties.annotationKind).toBe("tooltip");
        expect(f.properties._id).toBeDefined();
    });

    it("sets widthPx and heightPx on the Feature from tooltipDefaultSize", () => {
        createOverlay(LNGLAT);
        const f = ON_CREATED.mock.calls[0][0] as MeasureFeature;
        expect(typeof f.properties.widthPx).toBe("number");
        expect(typeof f.properties.heightPx).toBe("number");
    });

    it("enters edit mode immediately (textarea visible)", () => {
        createOverlay(LNGLAT);
        expect(container.querySelector("textarea")).not.toBeNull();
    });

    it("ResizeObserver callback updates widthPx and heightPx on the feature", () => {
        let capturedCb: ResizeObserverCallback | null = null;
        const OrigRO = (globalThis as any).ResizeObserver;
        (globalThis as any).ResizeObserver = class {
            constructor(cb: ResizeObserverCallback) {
                capturedCb = cb;
            }
            observe() {}
            unobserve() {}
            disconnect() {}
        };

        const feature = createOverlay(LNGLAT);
        (globalThis as any).ResizeObserver = OrigRO;

        expect(capturedCb).not.toBeNull();
        capturedCb!(
            [{ contentRect: { width: 200, height: 120 } } as ResizeObserverEntry],
            {} as ResizeObserver
        );

        expect(feature.properties.widthPx).toBe(200);
        expect(feature.properties.heightPx).toBe(120);
    });
});

describe("createOverlayFromFeature", () => {
    it("restores a tooltip overlay without entering edit mode", () => {
        const feature: MeasureFeature = {
            type: "Feature",
            geometry: { type: "Point", coordinates: LNGLAT },
            properties: {
                measureType: "annotation-tooltip",
                annotationKind: "tooltip",
                label: "restored",
                widthPx: 160,
                heightPx: 80,
                createdAt: new Date().toISOString(),
                _id: "test-restore-id",
            },
        };
        createOverlayFromFeature(feature);
        // No textarea (not in edit mode)
        expect(container.querySelector("textarea")).toBeNull();
        // Text is displayed
        const el = container.querySelector(".gl-measure-annot-tooltip");
        expect(el?.textContent).toContain("restored");
    });

    it("auto-assigns _id if missing", () => {
        const feature: MeasureFeature = {
            type: "Feature",
            geometry: { type: "Point", coordinates: LNGLAT },
            properties: {
                measureType: "annotation-tooltip",
                annotationKind: "tooltip",
                label: "",
                widthPx: 160,
                heightPx: 80,
                createdAt: new Date().toISOString(),
            },
        };
        createOverlayFromFeature(feature);
        expect(feature.properties._id).toBeDefined();
        expect(container.querySelector(".gl-measure-annot-tooltip")).not.toBeNull();
    });

    it("migrates legacy annotation-label features to tooltip", () => {
        const feature: MeasureFeature = {
            type: "Feature",
            geometry: { type: "Point", coordinates: LNGLAT },
            properties: {
                measureType: "annotation-label" as any,
                annotationKind: "label" as any,
                label: "old label",
                createdAt: new Date().toISOString(),
                _id: "legacy-id",
            },
        };
        createOverlayFromFeature(feature);
        expect(feature.properties.annotationKind).toBe("tooltip");
        expect(feature.properties.measureType).toBe("annotation-tooltip");
        expect(container.querySelector(".gl-measure-annot-tooltip")).not.toBeNull();
    });
});

describe("edit mode — tooltip commit", () => {
    it("commits text on outside pointerdown and calls onMutated", () => {
        const feature = createOverlay(LNGLAT);
        const ta = container.querySelector("textarea") as HTMLTextAreaElement;
        ta.value = "outside commit";

        vi.runAllTimers();
        document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

        expect(feature.properties.label).toBe("outside commit");
        expect(ON_MUTATED).toHaveBeenCalled();
    });

    it("hides textarea and shows text after commit", () => {
        createOverlay(LNGLAT);
        const ta = container.querySelector("textarea") as HTMLTextAreaElement;
        ta.value = "done";
        vi.runAllTimers();
        document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

        expect(container.querySelector("textarea")).toBeNull();
        const el = container.querySelector(".gl-measure-annot-tooltip");
        expect(el?.textContent).toContain("done");
    });
});

describe("reposition on map move", () => {
    it("calls map.project again when the 'move' event fires", () => {
        createOverlay(LNGLAT);
        const callsBefore = (map.project as ReturnType<typeof vi.fn>).mock.calls.length;

        map._fireEvent("move");
        vi.runAllTimers();

        const callsAfter = (map.project as ReturnType<typeof vi.fn>).mock.calls.length;
        expect(callsAfter).toBeGreaterThan(callsBefore);
    });
});

describe("drag interaction", () => {
    it("updates lngLat on drag and calls onMutated", () => {
        const feature = createOverlay(LNGLAT);
        // Commit edit by triggering outside pointerdown (textarea value not needed here)
        vi.runAllTimers();
        document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        ON_MUTATED.mockReset();

        const el = container.querySelector(".gl-measure-annot-tooltip") as HTMLElement;

        vi.spyOn(map, "unproject").mockReturnValue({ lng: 3.0, lat: 49.0 });
        vi.spyOn(map, "getContainer").mockReturnValue(
            Object.assign(container, { getBoundingClientRect: () => ({ left: 0, top: 0 }) })
        );

        el.dispatchEvent(
            new PointerEvent("pointerdown", { clientX: 100, clientY: 100, bubbles: true })
        );
        el.dispatchEvent(
            new PointerEvent("pointermove", { clientX: 110, clientY: 110, bubbles: true })
        );
        el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));

        expect(map.dragPan.disable).toHaveBeenCalled();
        expect(map.dragPan.enable).toHaveBeenCalled();
        expect((feature.geometry as GeoJSON.Point).coordinates).toEqual([3.0, 49.0]);
        expect(ON_MUTATED).toHaveBeenCalled();
    });

    it("tap without drag (< 3 px) enters edit mode instead of moving", () => {
        createOverlay(LNGLAT);
        // Commit any current edit first
        vi.runAllTimers();
        document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

        const el = container.querySelector(".gl-measure-annot-tooltip") as HTMLElement;
        // Tap: pointerdown + pointerup without pointermove
        el.dispatchEvent(
            new PointerEvent("pointerdown", { clientX: 50, clientY: 50, bubbles: true })
        );
        el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
        // Should enter edit mode (textarea visible)
        expect(el.querySelector("textarea")).not.toBeNull();
    });
});

describe("removeOverlay", () => {
    it("removes the DOM element and does not appear in getPrintableAnnotations", () => {
        const feature = createOverlay(LNGLAT);
        const id = feature.properties._id as string;

        removeOverlay(id);

        expect(container.querySelector(".gl-measure-annot-tooltip")).toBeNull();
        expect(getPrintableAnnotations()).toHaveLength(0);
    });
});

describe("clearAllOverlays", () => {
    it("removes all DOM elements and empties the overlay map", () => {
        createOverlay(LNGLAT);
        createOverlay([3.0, 49.0]);
        clearAllOverlays();
        expect(container.querySelectorAll(".gl-measure-annot-tooltip")).toHaveLength(0);
        expect(getPrintableAnnotations()).toHaveLength(0);
    });
});

describe("getPrintableAnnotations", () => {
    it("returns the correct descriptor for a tooltip", () => {
        createOverlay(LNGLAT);
        const ta = container.querySelector("textarea") as HTMLTextAreaElement;
        ta.value = "test";
        vi.runAllTimers();
        document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

        const anns = getPrintableAnnotations();
        expect(anns).toHaveLength(1);
        expect(anns[0]).toMatchObject({
            kind: "tooltip",
            lngLat: LNGLAT,
            text: "test",
            anchor: "bottom",
        });
        expect(typeof anns[0].widthPx).toBe("number");
        expect(typeof anns[0].heightPx).toBe("number");
    });
});

describe("delete button", () => {
    it("calls onRemoved with the feature _id when × is clicked", () => {
        const feature = createOverlay(LNGLAT);
        const id = feature.properties._id as string;
        // Commit edit to exit edit mode
        vi.runAllTimers();
        document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

        const el = container.querySelector(".gl-measure-annot-tooltip") as HTMLElement;
        el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

        const delBtn = el.querySelector("button") as HTMLButtonElement;
        expect(delBtn).not.toBeNull();
        delBtn.click();

        expect(ON_REMOVED).toHaveBeenCalledWith(id);
        expect(container.querySelector(".gl-measure-annot-tooltip")).toBeNull();
    });

    it("labels itself through i18n, not with a hardcoded string (PLUGINS S5)", () => {
        createOverlay(LNGLAT);
        vi.runAllTimers();
        document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

        const el = container.querySelector(".gl-measure-annot-tooltip") as HTMLElement;
        el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        const delBtn = el.querySelector("button") as HTMLButtonElement;

        // The mock resolver echoes the key back, so seeing the key proves the lookup
        // happened. The CDC §2.11 rule is "aucun libellé en dur dans le code"; this one
        // was hardcoded French, so a non-French UI showed "Supprimer".
        expect(delBtn.getAttribute("aria-label")).toBe("measure.aria.deleteAnnotation");
    });

    // -----------------------------------------------------------------------
    // Reachability with a finger — the × used to be revealed by `mouseenter` ALONE,
    // so on a touch screen it was simply unreachable while dragging and editing the
    // same annotation worked. Visibility is now `hovered || editing`.
    // -----------------------------------------------------------------------

    /** Commits any edit opened by `createOverlay`, leaving a settled overlay. */
    function settle(): HTMLElement {
        vi.runAllTimers();
        document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        return container.querySelector(".gl-measure-annot-tooltip") as HTMLElement;
    }

    it("🛑 a tap reveals the × WITHOUT any hover — the only path a finger has", () => {
        createOverlay(LNGLAT);
        const el = settle();
        const delBtn = el.querySelector("button") as HTMLButtonElement;
        expect(delBtn.style.display).toBe("none");

        // Tap: pointerdown + pointerup under the 3 px threshold → edit mode.
        el.dispatchEvent(
            new PointerEvent("pointerdown", { clientX: 50, clientY: 50, bubbles: true })
        );
        el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));

        // No `mouseenter` was ever dispatched — that is the whole point.
        expect(delBtn.style.display).toBe("flex");
    });

    it("hides the × again once the edit is committed and the pointer is elsewhere", () => {
        createOverlay(LNGLAT);
        const el = settle();
        const delBtn = el.querySelector("button") as HTMLButtonElement;

        el.dispatchEvent(
            new PointerEvent("pointerdown", { clientX: 50, clientY: 50, bubbles: true })
        );
        el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
        expect(delBtn.style.display).toBe("flex");

        vi.runAllTimers();
        document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        expect(delBtn.style.display).toBe("none");
    });

    it("🛑 but KEEPS it visible after commit when the cursor is still over the bubble", () => {
        createOverlay(LNGLAT);
        const el = settle();
        const delBtn = el.querySelector("button") as HTMLButtonElement;

        // The mouse is on the bubble and stays there across the whole edit cycle. A plain
        // `display:none` on commit would make the button vanish under the cursor — the
        // regression the `hovered || editing` disjunction exists to prevent.
        el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        el.dispatchEvent(
            new PointerEvent("pointerdown", { clientX: 50, clientY: 50, bubbles: true })
        );
        el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
        vi.runAllTimers();
        document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

        expect(delBtn.style.display).toBe("flex");
    });
});

describe("pointercancel", () => {
    it("🛑 restores map panning — otherwise the map stays undraggable for good", () => {
        createOverlay(LNGLAT);
        vi.runAllTimers();
        document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        const el = container.querySelector(".gl-measure-annot-tooltip") as HTMLElement;
        map.dragPan.enable.mockReset();

        el.dispatchEvent(
            new PointerEvent("pointerdown", { clientX: 50, clientY: 50, bubbles: true })
        );
        expect(map.dragPan.disable).toHaveBeenCalled();

        el.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));
        expect(map.dragPan.enable).toHaveBeenCalled();
    });

    it("does NOT open edit mode — a gesture taken away is not a tap", () => {
        createOverlay(LNGLAT);
        vi.runAllTimers();
        document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        const el = container.querySelector(".gl-measure-annot-tooltip") as HTMLElement;
        expect(el.querySelector("textarea")).toBeNull();

        // Same event sequence a tap would produce, only the ending differs.
        el.dispatchEvent(
            new PointerEvent("pointerdown", { clientX: 50, clientY: 50, bubbles: true })
        );
        el.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));

        expect(el.querySelector("textarea")).toBeNull();
    });
});
