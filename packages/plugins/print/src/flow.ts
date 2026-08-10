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
import { openModal } from "./modal-open.js";
import { _getNativeMap } from "./internal.js";
import type { PrintFlowOptions } from "./types.js";

/**
 * Opens the interactive print flow: emprise selection → preview modal → export.
 * Resolves with the exported Blob, or `null` if the user cancels at any step.
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

        // Selector is created once and re-activated for "Redéfinir l'emprise" loops.
        const selector = createEmpriseSelector(
            container,
            (result: EmpriseResult) => {
                selector.deactivate();
                // Open the preview modal; loop back if the user asks to redefine.
                openModal(result, opts)
                    .then((modalResult) => {
                        if (modalResult === "redefine") {
                            // Re-activate the emprise selector for a new drawing.
                            selector.activate();
                        } else {
                            resolve(modalResult);
                        }
                    })
                    .catch(() => resolve(null));
            },
            () => {
                selector.deactivate();
                resolve(null);
            }
        );
        selector.activate();
    });
}
