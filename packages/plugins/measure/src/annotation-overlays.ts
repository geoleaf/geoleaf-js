/*!
 * @geoleaf-plugins/measure — Annotation overlays (DOM)
 * © 2026 Mattieu Pottier — MIT License
 *
 * Manages position-absolute tooltip overlays (multiline, resizable) anchored
 * to geographic coordinates. Repositioned on every map "move"/"resize" via rAF.
 * https://geoleaf.dev
 */
import type { MeasureConfig, MeasureFeature, MeasureMap, PrintableAnnotation } from "./types.js";
import { _el, _getLabel, applyCssText } from "./internal.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OverlayEntry {
    el: HTMLDivElement;
    lngLat: [number, number];
    feature: MeasureFeature;
    editing: boolean;
    /** ResizeObserver active while the tooltip is in edit mode. */
    _ro?: ResizeObserver;
}

/** Callbacks wired by public-api.ts to keep the engine collection in sync. */
interface AnnotationCallbacks {
    onCreated: (feature: MeasureFeature) => void;
    onMutated: () => void;
    onRemoved: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _map: MeasureMap | null = null;
let _cfg: MeasureConfig | null = null;
let _cbs: AnnotationCallbacks | null = null;
const _overlays = new Map<string, OverlayEntry>();
let _rafPending = false;

// ---------------------------------------------------------------------------
// Positioning
// ---------------------------------------------------------------------------

function _position(entry: OverlayEntry): void {
    if (!_map) return;
    const pt = _map.project([entry.lngLat[0], entry.lngLat[1]]);
    entry.el.style.left = `${pt.x}px`;
    entry.el.style.top = `${pt.y}px`;
}

function _onMove(): void {
    if (_rafPending) return;
    _rafPending = true;
    requestAnimationFrame(() => {
        _rafPending = false;
        for (const entry of _overlays.values()) _position(entry);
    });
}

// ---------------------------------------------------------------------------
// Feature factory
// ---------------------------------------------------------------------------

function _newId(): string {
    return typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function _makeFeature(lngLat: [number, number]): MeasureFeature {
    const id = _newId();
    const props: MeasureFeature["properties"] = {
        measureType: "annotation-tooltip",
        annotationKind: "tooltip",
        label: "",
        createdAt: new Date().toISOString(),
        _id: id,
    };
    if (_cfg) {
        props.widthPx = _cfg.tooltipDefaultSize.width;
        props.heightPx = _cfg.tooltipDefaultSize.height;
    }
    return { type: "Feature", geometry: { type: "Point", coordinates: lngLat }, properties: props };
}

// ---------------------------------------------------------------------------
// DOM element builder
// ---------------------------------------------------------------------------

function _buildEl(feature: MeasureFeature): HTMLDivElement {
    const el = _el("div", "gl-measure-annot-tooltip") as HTMLDivElement;
    el.style.position = "absolute";
    el.style.width = `${(feature.properties.widthPx as number | undefined) ?? 160}px`;
    el.style.height = `${(feature.properties.heightPx as number | undefined) ?? 80}px`;
    const textEl = _el("div");
    textEl.textContent = (feature.properties.label as string) ?? "";
    el.appendChild(textEl);
    return el;
}

// ---------------------------------------------------------------------------
// Edit mode
// ---------------------------------------------------------------------------

function _enterEditMode(id: string): void {
    const entry = _overlays.get(id);
    if (!entry || entry.editing) return;
    entry.editing = true;
    entry.el.classList.add("is-editing");

    entry.el.style.width = `${(entry.feature.properties.widthPx as number | undefined) ?? 160}px`;
    entry.el.style.height = `${(entry.feature.properties.heightPx as number | undefined) ?? 80}px`;
    const ta = _el("textarea");
    ta.value = (entry.feature.properties.label as string) ?? "";
    ta.placeholder = _getLabel("measure.annotation.tooltipPlaceholder");
    applyCssText(
        ta,
        "width:100%;height:100%;box-sizing:border-box;border:none;outline:none;background:transparent;font:inherit;resize:none;"
    );
    // Remove content nodes only — preserve button children (delete button)
    Array.from(entry.el.childNodes)
        .filter((n) => !(n instanceof HTMLButtonElement))
        .forEach((n) => n.remove());
    entry.el.appendChild(ta);
    ta.focus();

    const ro = new ResizeObserver((entries) => {
        for (const re of entries) {
            const { width, height } = re.contentRect;
            entry.feature.properties.widthPx = Math.round(width);
            entry.feature.properties.heightPx = Math.round(height);
        }
    });
    ro.observe(entry.el);
    entry._ro = ro;

    // Commit on outside pointerdown (deferred one tick to skip the triggering event)
    setTimeout(() => {
        const onOutside = (e: PointerEvent) => {
            if (!entry.el.contains(e.target as Node)) {
                document.removeEventListener("pointerdown", onOutside, true);
                _commitEdit(id);
            }
        };
        document.addEventListener("pointerdown", onOutside, true);
    }, 0);
}

function _commitEdit(id: string): void {
    const entry = _overlays.get(id);
    if (!entry || !entry.editing) return;
    entry.editing = false;
    entry.el.classList.remove("is-editing");

    if (entry._ro) {
        entry._ro.disconnect();
        delete entry._ro;
    }

    const ta = entry.el.querySelector("textarea") as HTMLTextAreaElement | null;
    entry.feature.properties.label = ta?.value ?? "";

    // Remove content nodes only — preserve button children (delete button)
    Array.from(entry.el.childNodes)
        .filter((n) => !(n instanceof HTMLButtonElement))
        .forEach((n) => n.remove());
    const textEl = _el("div");
    textEl.textContent = (entry.feature.properties.label as string) ?? "";
    const delBtn = entry.el.querySelector("button");
    if (delBtn) entry.el.insertBefore(textEl, delBtn);
    else entry.el.appendChild(textEl);

    _cbs?.onMutated();
}

// ---------------------------------------------------------------------------
// Drag + click-to-edit interaction
// ---------------------------------------------------------------------------

function _attachInteraction(id: string): void {
    const entry = _overlays.get(id);
    if (!entry) return;

    // Small × delete button (shown on hover)
    const delBtn = _el("button", "gl-measure-annot-del");
    delBtn.textContent = "×";
    delBtn.setAttribute("aria-label", _getLabel("measure.aria.deleteAnnotation"));
    applyCssText(
        delBtn,
        "position:absolute;top:-8px;right:-8px;width:18px;height:18px;border-radius:50%;border:1px solid #ccc;background:#fff;cursor:pointer;font-size:12px;line-height:1;padding:0;display:none;align-items:center;justify-content:center;z-index:1;"
    );
    entry.el.appendChild(delBtn);
    entry.el.addEventListener("mouseenter", () => {
        delBtn.style.display = "flex";
    });
    entry.el.addEventListener("mouseleave", () => {
        delBtn.style.display = "none";
    });
    delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeOverlay(id);
        _cbs?.onRemoved(id);
    });

    let _dragged = false;

    entry.el.addEventListener("pointerdown", (e: PointerEvent) => {
        if (entry.editing) return;
        if (e.target instanceof HTMLButtonElement) return;
        e.stopPropagation();

        _dragged = false;
        const startX = e.clientX;
        const startY = e.clientY;
        _map?.dragPan?.disable?.();
        try {
            entry.el.setPointerCapture(e.pointerId);
        } catch {
            /* not all envs support this */
        }

        const onMove = (em: PointerEvent) => {
            if (Math.abs(em.clientX - startX) > 3 || Math.abs(em.clientY - startY) > 3)
                _dragged = true;
            if (!_dragged || !_map) return;
            const rect = (_map.getContainer() as HTMLElement).getBoundingClientRect();
            const ll = _map.unproject([em.clientX - rect.left, em.clientY - rect.top]);
            entry.lngLat = [ll.lng, ll.lat];
            (entry.feature.geometry as GeoJSON.Point).coordinates = [ll.lng, ll.lat];
            _position(entry);
        };

        const onUp = () => {
            _map?.dragPan?.enable?.();
            entry.el.removeEventListener("pointermove", onMove);
            entry.el.removeEventListener("pointerup", onUp);
            if (!_dragged) {
                _enterEditMode(id);
            } else {
                _cbs?.onMutated();
            }
        };

        entry.el.addEventListener("pointermove", onMove);
        entry.el.addEventListener("pointerup", onUp);
    });
}

// ---------------------------------------------------------------------------
// Core creation
// ---------------------------------------------------------------------------

function _createEntry(feature: MeasureFeature, editOnCreate: boolean): void {
    const map = _map;
    if (!map) return;
    const lngLat = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
    const id = feature.properties._id as string;
    const el = _buildEl(feature);
    const entry: OverlayEntry = { el, lngLat, feature, editing: false };
    _overlays.set(id, entry);
    map.getContainer().appendChild(el);
    _position(entry);
    _attachInteraction(id);
    if (editOnCreate) _enterEditMode(id);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Initialises the overlay system. Must be called before createOverlay(). */
export function initAnnotationOverlays(
    map: MeasureMap,
    cfg: MeasureConfig,
    callbacks: AnnotationCallbacks
): void {
    _map = map;
    _cfg = cfg;
    _cbs = callbacks;
    map.on("move", _onMove);
    map.on("resize", _onMove);
}

/**
 * Creates a new tooltip annotation overlay at the given coordinate,
 * enters edit mode immediately, and calls callbacks.onCreated.
 */
export function createOverlay(lngLat: [number, number]): MeasureFeature {
    const feature = _makeFeature(lngLat);
    _createEntry(feature, true);
    _cbs?.onCreated(feature);
    return feature;
}

/**
 * Restores an annotation overlay from a persisted Feature without entering edit mode.
 * Used during localStorage boot restoration. Legacy "label" features are migrated to "tooltip".
 */
export function createOverlayFromFeature(feature: MeasureFeature): void {
    if (!feature.properties._id) feature.properties._id = _newId();
    // Migrate old annotation-label features saved before this change
    if (feature.properties.annotationKind === "label") {
        feature.properties.annotationKind = "tooltip";
        feature.properties.measureType = "annotation-tooltip";
        if (!feature.properties.widthPx)
            feature.properties.widthPx = _cfg?.tooltipDefaultSize.width ?? 160;
        if (!feature.properties.heightPx)
            feature.properties.heightPx = _cfg?.tooltipDefaultSize.height ?? 80;
    }
    _createEntry(feature, false);
}

/** Removes a single overlay by its feature _id. */
export function removeOverlay(id: string): void {
    const entry = _overlays.get(id);
    if (!entry) return;
    if (entry._ro) {
        entry._ro.disconnect();
    }
    entry.el.remove();
    _overlays.delete(id);
}

/** Removes all annotation overlays from the DOM. */
export function clearAllOverlays(): void {
    for (const entry of _overlays.values()) {
        if (entry._ro) {
            entry._ro.disconnect();
        }
        entry.el.remove();
    }
    _overlays.clear();
}

/**
 * Returns printable annotation descriptors for use by the print plugin canvas renderer.
 */
export function getPrintableAnnotations(): PrintableAnnotation[] {
    const result: PrintableAnnotation[] = [];
    for (const entry of _overlays.values()) {
        const widthPx = entry.feature.properties.widthPx as number | undefined;
        const heightPx = entry.feature.properties.heightPx as number | undefined;
        result.push({
            kind: "tooltip",
            lngLat: [entry.lngLat[0], entry.lngLat[1]],
            text: (entry.feature.properties.label as string) ?? "",
            anchor: "bottom",
            // Le defaut de ces deux dimensions (`?? 160`) appartient au plugin PRINT, pas a
            // measure : le hisser ici ferait traverser une constante de mise en page a une
            // frontiere de paquet. Insertion conditionnelle.
            ...(widthPx !== undefined && { widthPx }),
            ...(heightPx !== undefined && { heightPx }),
        });
    }
    return result;
}
