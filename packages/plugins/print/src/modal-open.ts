/*!
 * @geoleaf-plugins/print — Preview modal
 *
 * Opens the print preview modal: locked scale, format selector, checkboxes,
 * title/description fields, live re-composition preview, and export buttons.
 * Resolves with the exported Blob, `null` on cancel/close, or `"redefine"` when
 * the user asks to redraw the extent so `flow.ts` can restart.
 *
 * Structure lives in `modal-dom.ts`, geometry in `modal-compose.ts`; this file
 * owns the state and the wiring between them.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import type * as MaplibreGL from "maplibre-gl";
import { getGeoLeaf } from "@geoleaf/host-runtime";
import { OffscreenSession } from "./offscreen-render.js";
import { createComposedCanvas } from "./layout-composer.js";
import { getPrintConfig, type PrintConfig } from "./config.js";
import { _getNativeMap } from "./internal.js";
import { downloadBlob } from "@geoleaf/host-runtime";
import { tryServerFallback, buildServerPayload } from "./server-fallback.js";
import { MODAL_ID, buildModalDom, type ModalDom } from "./modal-dom.js";
import {
    buildComposeArgs,
    mapViewport,
    type ComposeArgs,
    type ComposeInputs,
} from "./modal-compose.js";
import type { EmpriseResult } from "./emprise-selector.js";
import type { ComposedExportOpts, PageOrientation, PrintFlowOptions } from "./types.js";

// ---------------------------------------------------------------------------
// Constants and types
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 150;

/** Return type — internal only, not part of the public API. */
type ModalResult = Blob | null | "redefine";

/** Everything the modal's handlers read and mutate while it is open. */
interface ModalState {
    dom: ModalDom;
    config: PrintConfig;
    emprise: EmpriseResult;
    orientation: PageOrientation;
    /** Selected paper format — changes when the user picks another one. */
    format: string;
    /** Last off-screen capture; null until the session is ready. */
    mapCanvas: HTMLCanvasElement | null;
    session: OffscreenSession | null;
    debounceTimer: ReturnType<typeof setTimeout> | null;
}

/** Signature of a format exporter registered on `GeoLeaf.Print._getExporter`. */
type CanvasExporter = (canvas: HTMLCanvasElement, opts: ComposedExportOpts) => Promise<Blob | null>;

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/** Snapshots the form state into the inputs the geometry layer expects. */
function _composeInputs(state: ModalState): ComposeInputs {
    const { dom, config, emprise } = state;
    return {
        format: state.format,
        orientation: state.orientation,
        lockedScale: emprise.scaleDenominator,
        center: emprise.center,
        dpi: config.dpi,
        title: dom.titleInput.value,
        description: dom.descArea.value,
        includeLegend: dom.legend.input.checked,
        includeScale: dom.scale.input.checked,
        includeNorthArrow: dom.north.input.checked,
        includeAnnotations: dom.annot?.input.checked ?? false,
    };
}

/** Recomposes the page from the cached capture and refreshes the preview image. */
async function _recompose(state: ModalState): Promise<void> {
    if (!state.mapCanvas) return;
    const args = buildComposeArgs(_composeInputs(state));
    if (!args) return;
    const composed = await createComposedCanvas(
        state.mapCanvas,
        args.zones,
        args.targetPx,
        args.composeOpts
    );
    state.dom.previewImg.src = composed.toDataURL("image/jpeg", 0.7);
}

/**
 * Re-renders the map off-screen at the current format, then recomposes.
 * Only a format change needs this — band toggles are pure composition, because
 * the capture is sized as a superset of the composed map zone (see `mapViewport`).
 */
async function _rerender(state: ModalState): Promise<void> {
    if (!state.session) return;
    const view = mapViewport(
        state.format,
        state.orientation,
        state.emprise.scaleDenominator,
        state.emprise.center,
        state.config.dpi
    );
    if (!view) return;
    await state.session.resize(view.widthPx, view.heightPx, view.center, view.zoom);
    state.mapCanvas = state.session.getCanvas();
    await _recompose(state);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Calls the exporter registered for the given format.
 * Returns null when no exporter is found or when the exporter fails with a
 * non-security error. Re-throws DOMException (SecurityError) so the caller can
 * detect a tainted canvas and activate the server fallback.
 */
async function _tryExport(
    format: string,
    canvas: HTMLCanvasElement,
    opts: ComposedExportOpts
): Promise<Blob | null> {
    const exporter = (
        getGeoLeaf()?.Print as
            { _getExporter?(format: string): CanvasExporter | undefined } | undefined
    )?._getExporter?.(format);
    if (typeof exporter !== "function") {
        console.warn(`[GeoLeaf.Print] No exporter registered for format "${format}".`);
        return null;
    }
    try {
        return await exporter(canvas, opts);
    } catch (err) {
        // Re-throw SecurityError so the caller can try the server fallback.
        if (err instanceof DOMException) throw err;
        console.warn(`[GeoLeaf.Print] Exporter "${format}" failed:`, err);
        return null;
    }
}

/** Server-side re-render, used when the local canvas is tainted by a non-CORS tile source. */
async function _serverFallback(
    state: ModalState,
    args: ComposeArgs,
    format: string,
    nativeMap: MaplibreGL.Map | null
): Promise<Blob | null> {
    const { config, dom } = state;
    if (!config.serverEndpoint || !nativeMap) {
        const msg =
            getGeoLeaf()?.I18n?.getLabel?.("print.error.tainted") ??
            "Export impossible : certains fonds de carte ne supportent pas le CORS.";
        console.warn("[GeoLeaf.Print]", msg);
        return null;
    }
    const payload = buildServerPayload(
        nativeMap,
        args.bbox,
        {
            format: state.format,
            orientation: state.orientation,
            dpi: config.dpi,
            margins: config.margins,
        },
        {
            title: dom.titleInput.value,
            description: dom.descArea.value,
            includeLegend: dom.legend.input.checked,
            includeScale: dom.scale.input.checked,
            includeNorthArrow: dom.north.input.checked,
        },
        format
    );
    return tryServerFallback(payload, config);
}

/** Composes at full quality then hands the canvas to the format exporter. */
async function _runExport(
    state: ModalState,
    args: ComposeArgs,
    format: string,
    nativeMap: MaplibreGL.Map | null
): Promise<Blob | null> {
    const composed = await createComposedCanvas(
        state.mapCanvas!,
        args.zones,
        args.targetPx,
        args.composeOpts
    );
    const exportOpts: ComposedExportOpts = {
        format,
        orientation: state.orientation,
        widthMm: args.widthMm,
        heightMm: args.heightMm,
        quality: state.config.jpgQuality,
    };
    try {
        return await _tryExport(format, composed, exportOpts);
    } catch {
        // DOMException (SecurityError) = tainted canvas.
        return _serverFallback(state, args, format, nativeMap);
    }
}

/** Downloads the exported blob under a filename derived from the title. */
async function _download(state: ModalState, blob: Blob, format: string): Promise<void> {
    const slug = (state.dom.titleInput.value.trim() || "carte")
        .replace(/[^a-zA-Z0-9À-ɏ_-]/g, "_")
        .slice(0, 80);
    await downloadBlob(blob, `${slug}.${format === "pdf" ? "pdf" : "jpg"}`);
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

/** Binds every semantic listener on the (already built) modal tree. */
function _wireInteractions(
    state: ModalState,
    nativeMap: MaplibreGL.Map | null,
    close: (result: ModalResult) => void
): void {
    const { dom } = state;

    dom.overlay.onclick = () => close(null);
    dom.closeBtn.onclick = () => close(null);
    dom.redefineLink.onclick = (e) => {
        e.preventDefault();
        close("redefine");
    };

    dom.titleInput.addEventListener("input", () => void _recompose(state));
    dom.descArea.addEventListener("input", () => void _recompose(state));

    for (const chk of [dom.legend, dom.scale, dom.north, dom.annot]) {
        chk?.input.addEventListener("change", () => void _recompose(state));
    }

    dom.formatSelect.addEventListener("change", () => {
        state.format = dom.formatSelect.value;
        if (state.debounceTimer) clearTimeout(state.debounceTimer);
        state.debounceTimer = setTimeout(() => void _rerender(state), DEBOUNCE_MS);
    });

    for (const { format, btn } of dom.exportButtons) {
        btn.onclick = async () => {
            // Nothing captured yet — the click is a no-op, the modal stays open.
            if (!state.mapCanvas) return;
            const args = buildComposeArgs(_composeInputs(state));
            if (!args) return;
            const blob = await _runExport(state, args, format, nativeMap);
            if (blob) await _download(state, blob, format);
            close(blob);
        };
    }
}

/** Creates the off-screen session, waits for tiles, then paints the first preview. */
async function _bootSession(
    state: ModalState,
    nativeMap: MaplibreGL.Map | null,
    onUnknownFormat: () => void
): Promise<void> {
    const view = mapViewport(
        state.format,
        state.orientation,
        state.emprise.scaleDenominator,
        state.emprise.center,
        state.config.dpi
    );
    if (!view) {
        onUnknownFormat();
        return;
    }

    const style = nativeMap?.getStyle?.() ?? {};
    const transformRequest = (
        nativeMap as { _requestManager?: { _transformRequest?: unknown } } | null
    )?._requestManager?._transformRequest;

    state.session = new OffscreenSession(
        style,
        transformRequest,
        view.widthPx,
        view.heightPx,
        view.center,
        view.zoom,
        state.config.dpi
    );
    await state.session.waitReady();
    state.mapCanvas = state.session.getCanvas();
    await _recompose(state);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Opens the print preview modal.
 * Returns the exported Blob, `null` on cancel/close, or `"redefine"` when the
 * user clicks « Redéfinir l'emprise ».
 */
export async function openModal(
    empriseResult: EmpriseResult,
    opts: PrintFlowOptions
): Promise<ModalResult> {
    const config = getPrintConfig();
    const gl = getGeoLeaf();
    const nativeMap = _getNativeMap();
    const getLabel = gl?.I18n?.getLabel ?? ((k: string) => k);
    const format = opts.defaultFormat ?? config.defaultFormat;

    // Remove any stale modal
    document.getElementById(MODAL_ID)?.remove();

    const dom = buildModalDom({
        getLabel,
        config,
        opts,
        lockedScale: empriseResult.scaleDenominator,
        currentFormat: format,
        hasLegend: !!gl?.Legend?.getAllLayers,
        hasMeasure: !!gl?.plugins?.isLoaded?.("measure"),
    });

    const state: ModalState = {
        dom,
        config,
        emprise: empriseResult,
        orientation: empriseResult.orientation,
        format,
        mapCanvas: null,
        session: null,
        debounceTimer: null,
    };

    return new Promise<ModalResult>((resolve) => {
        function _spinnerShow(): void {
            dom.spinner.style.display = "flex";
        }
        function _spinnerHide(): void {
            dom.spinner.style.display = "none";
        }
        function _keyHandler(e: KeyboardEvent): void {
            if (e.key === "Escape") {
                e.preventDefault();
                close(null);
            }
        }

        function close(result: ModalResult): void {
            if (state.debounceTimer) clearTimeout(state.debounceTimer);
            state.session?.destroy();
            state.session = null;
            document.removeEventListener("keydown", _keyHandler);
            document.removeEventListener("geoleaf:print:render:start", _spinnerShow);
            document.removeEventListener("geoleaf:print:render:end", _spinnerHide);
            document.getElementById(MODAL_ID)?.remove();
            document.body.classList.remove("gl-print-modal-open");
            resolve(result);
        }

        // Registered before the session is created — it emits geoleaf:print:render:start.
        document.addEventListener("geoleaf:print:render:start", _spinnerShow);
        document.addEventListener("geoleaf:print:render:end", _spinnerHide);
        document.addEventListener("keydown", _keyHandler);

        _wireInteractions(state, nativeMap, close);

        document.body.appendChild(dom.modal);
        document.body.classList.add("gl-print-modal-open");
        requestAnimationFrame(() => dom.titleInput.focus());

        void _bootSession(state, nativeMap, () => close(null));
    });
}
