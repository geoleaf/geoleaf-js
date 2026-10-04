/*!
 * @geoleaf-plugins/print — Print flow orchestrator
 *
 * Chains: emprise selector → preview modal → export.
 * The loop allows the user to "Redéfinir l'emprise" without leaving the flow.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import { createEmpriseSelector, type EmpriseResult } from "./emprise-selector.js";
import { closeOpenModal, openModal } from "./modal-open.js";
import { _getNativeMap } from "./internal.js";
import type { PrintFlowOptions } from "./types.js";

/** One cancel function per flow still open — what {@link closePrintFlows} runs. */
const _openFlows = new Set<() => void>();

/**
 * Opens the interactive print flow: emprise selection → preview modal → export.
 * Resolves with the exported Blob, or `null` if the user cancels at any step — or if the
 * application is unmounted while the flow is open.
 *
 * @param opts - Optional flow configuration (format, DPI, title…).
 */
export function openPrintFlow(opts: PrintFlowOptions = {}): Promise<Blob | null> {
    return new Promise<Blob | null>((resolve) => {
        const nativeMap = _getNativeMap();
        if (!nativeMap) {
            console.warn("[GeoLeaf.Print] openPrintFlow: map not initialised");
            return resolve(null);
        }
        const container: HTMLElement | undefined = nativeMap.getContainer?.();
        if (!container) {
            console.warn("[GeoLeaf.Print] openPrintFlow: map container not found");
            return resolve(null);
        }

        let done = false;
        /**
         * Ends the flow, once: the selector's overlay leaves the map container — it was only
         * hidden, so every flow left one behind — and the promise resolves.
         */
        const finish = (result: Blob | null): void => {
            if (done) return;
            done = true;
            _openFlows.delete(cancel);
            selector.destroy();
            resolve(result);
        };
        /** Ends the flow from outside, whatever step it is at. */
        const cancel = (): void => {
            closeOpenModal();
            finish(null);
        };

        // Selector is created once and re-activated for "Redéfinir l'emprise" loops.
        const selector = createEmpriseSelector(
            container,
            (result: EmpriseResult) => {
                selector.deactivate();
                // Open the preview modal; loop back if the user asks to redefine.
                openModal(result, opts)
                    .then((modalResult) => {
                        if (done) return;
                        if (modalResult === "redefine") {
                            // Re-activate the emprise selector for a new drawing.
                            selector.activate();
                        } else {
                            finish(modalResult);
                        }
                    })
                    .catch(() => finish(null));
            },
            () => finish(null)
        );
        _openFlows.add(cancel);
        selector.activate();
    });
}

/**
 * Closes every print flow still open — the area selector, or the preview modal — and resolves
 * each with `null`, as a cancel does.
 *
 * Called when the application is torn down (`GeoLeaf.mount()`'s `unmount()`, through the module
 * the entry registers). The selector is an overlay in the map container with listeners on
 * `document`; the modal is a child of `<body>`: an application unmounted with a flow open left
 * both in the page, the selector still catching every click over the place the map had been.
 */
export function closePrintFlows(): void {
    for (const cancel of [..._openFlows]) cancel();
}
