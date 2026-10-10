/*!
 * @geoleaf-plugins/offline-ui
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * « Export the log » — the application's recent journal, handed over as a file.
 *
 * 🛑 **THE ONE WHO SEES THE DEFECT IS THE ONE IN THE FIELD.** The core keeps a bounded,
 * redacted record of what it logged (`GeoLeaf.Log.getEntries()`), and exports it as a JSON
 * document (`GeoLeaf.Log.exportDiagnostic()`). Until this block, the only control that
 * offered it was the boot failure screen: once the application had started, the journal was
 * reachable through a console and nothing else — on a tablet, by nobody.
 *
 * ## Why here
 *
 * No profile key and no weight at boot: this plugin's window is where a device is prepared
 * and where "what did not leave?" is asked, and it is opened on demand. A button in the
 * core's toolbar would have cost every application a control most never press.
 *
 * ⚠️ **What the file holds is the core's decision, not this block's.** The record is already
 * bounded and redacted where it is written; this block adds nothing to it and reads nothing
 * else.
 */

import { Log, getUINotifications, tLabel as t } from "@geoleaf/host-runtime";
import { createElement } from "../utils/dom-helpers.js";

/** The core's log, reduced to its export. Read at CLICK time: it may mount after this module. */
function _exportDiagnostic(): (() => string) | null {
    const log = (globalThis as { GeoLeaf?: { Log?: { exportDiagnostic?(): string } } }).GeoLeaf
        ?.Log;
    const exportDiagnostic = log?.exportDiagnostic;
    // Called ON the log: the method reads its own record.
    return typeof exportDiagnostic === "function" ? () => exportDiagnostic.call(log) : null;
}

/** Hands a text over as a JSON file. */
function _download(text: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    // Colons and dots are not welcome in a file name on every system.
    link.download = `geoleaf-log-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // After the click has been handled: revoked at once, some engines cancel the download.
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Builds the block and appends it — last in the window, under everything it helps explain.
 *
 * @param bodyEl - `.gl-cache-control__body`.
 */
export function buildLogExportBlock(bodyEl: HTMLElement): void {
    const root = createElement("div", "gl-cache-log-export", bodyEl);
    const hint = createElement("span", "gl-cache-log-export__hint", root);
    hint.textContent = t("storage.log.hint");
    const button = createElement("button", "gl-cache-log-export__btn", root);
    button.type = "button";
    button.textContent = t("storage.log.export");
    button.addEventListener("click", () => {
        const exportDiagnostic = _exportDiagnostic();
        if (!exportDiagnostic) {
            // An older core keeps no exportable record: said, rather than a dead button.
            getUINotifications()?.warning(t("storage.log.unavailable"), 5000);
            return;
        }
        try {
            _download(exportDiagnostic());
            getUINotifications()?.success(t("storage.log.exported"), 3000);
        } catch (error: unknown) {
            if (Log) Log.warn("[CacheControl] export du journal en échec :", error);
            getUINotifications()?.error(t("storage.log.exportFailed"), 5000);
        }
    });
}
