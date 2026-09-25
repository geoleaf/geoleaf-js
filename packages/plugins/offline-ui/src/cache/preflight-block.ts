/*!
 * @geoleaf-plugins/offline-ui
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * "Can I leave?" — the pre-departure check, shown where the device is prepared.
 *
 * The facts are the core's, read in one call (`GeoLeaf.Storage.preflight()`, core ≥ 3.10.0):
 * whether the browser keeps this origin's data, each layer that declares something to pull and
 * whether it is on the device, what the last preparation left out, and a verdict. This block
 * says them next to the download — the one place a user comes to before going off-network.
 *
 * ## What it is NOT
 *
 * ⚠️ **Not a second judge.** The verdict and each layer's status come from the core as they
 * are; the only thing decided here is how loudly a status is shown (`data-alert`). A block
 * that re-derived "ready" would one day disagree with the core, and the user would not know
 * which to believe.
 *
 * ⚠️ **Not shown on an older core.** Without the member there is no check to give: the block
 * stays hidden rather than inventing one.
 *
 * ## Staying current
 *
 * Re-read when the control updates its status — which it does once a download has fully
 * resolved, pull included — and on the events that change its facts: the cache cleared, the
 * queue moving, the network coming and going. Listeners go through `self._eventCleanups`, for
 * the reason `sync-status-block.ts` gives: the modal never calls `onRemove`, and every round
 * trip through the Export tab rebuilds this body.
 */

import { Log } from "@geoleaf/host-runtime";
import { createElement } from "../utils/dom-helpers.js";
import { StorageContract } from "../shared/storage-contract.js";

import type { CacheControlState } from "./cache-control-types.js";
import type { PreflightReport } from "@geoleaf/core/contracts/sync.contract.js";

/**
 * Document events after which the check is re-read.
 *
 * 🛑 **`geoleaf:cache:completed` is NOT among them, and was.** The downloader emits it when the
 * RESOURCES are in — before `cacheProfile` pulls the entities and writes their state — so the
 * check re-read there showed a layer just downloaded as never downloaded, and nothing re-read
 * it afterwards (measured on the shipped bundle, `e2e/61`). The end of a download is caught by
 * the control's own status update instead (`self._refreshPreflight`, called by `updateStatus`
 * once `cacheProfile` has resolved).
 */
const REFRESH_EVENTS = [
    "geoleaf:cache:cleared",
    "geoleaf:offline:outbox-queued",
    "geoleaf:offline:outbox-drained",
];

/** Layer statuses shown as an alert: the layer's entities are not on the device. */
const ALERT = new Set(["declaredNeverPulled", "pullFailed"]);

/** Resolves a label, interpolating `{0}` — `getLabel`, not `tLabel` (see `sync-status-block.ts`). */
function t(key: string, ...args: string[]): string {
    const fn = (
        globalThis as {
            GeoLeaf?: { I18n?: { getLabel?(k: string, ...a: string[]): string } };
        }
    ).GeoLeaf?.I18n?.getLabel;
    return fn ? fn(key, ...args) : key;
}

/** A layer's display label from the active profile, else its id. */
function _layerLabel(layerId: string): string {
    const profile = (
        globalThis as {
            GeoLeaf?: {
                Config?: {
                    getActiveProfile?(): { layers?: Array<{ id?: string; label?: string }> };
                };
            };
        }
    ).GeoLeaf?.Config?.getActiveProfile?.();
    return profile?.layers?.find((l) => l.id === layerId)?.label ?? layerId;
}

/** Writes the check into an already-built block. */
function _paint(root: HTMLElement, check: PreflightReport): void {
    root.hidden = false;
    // Spelled out literally, never `dataset.*`: purgecss extracts selectors from the SOURCE.
    root.setAttribute("data-verdict", check.verdict);
    const find = (cls: string) => root.querySelector<HTMLElement>(`.gl-cache-preflight__${cls}`);

    const verdict = find("verdict");
    if (verdict) verdict.textContent = t(`storage.preflight.verdict.${check.verdict}`);

    const persistence = find("persistence");
    if (persistence) {
        persistence.setAttribute("data-persistence", check.persistence);
        persistence.textContent = t(`storage.preflight.persistence.${check.persistence}`);
    }

    const list = find("layers");
    if (list) {
        list.textContent = "";
        for (const l of check.layers) {
            const row = createElement("li", "gl-cache-preflight__layer", list);
            row.setAttribute("data-layer-id", l.layerId);
            row.setAttribute("data-status", l.status);
            row.setAttribute("data-alert", ALERT.has(l.status) ? "true" : "false");
            row.textContent = `${_layerLabel(l.layerId)} — ${t(`storage.preflight.layer.${l.status}`)}`;
        }
        list.hidden = check.layers.length === 0;
    }

    const tiles = find("tiles");
    if (tiles) {
        const trace = check.preparation?.tiles;
        const lines: string[] = [];
        if (trace && trace.skippedZooms.length > 0) {
            const zooms = trace.skippedZooms.map((z) => `${z.source} z${z.zoom}`).join(", ");
            lines.push(t("storage.preflight.tiles.skipped", zooms));
        }
        if (trace?.capped) lines.push(t("storage.preflight.tiles.capped"));
        const failed = check.preparation?.failedResources ?? 0;
        if (failed > 0) lines.push(t("storage.preflight.failed", String(failed)));
        tiles.textContent = lines.join(" · ");
        tiles.hidden = lines.length === 0;
    }
}

/** Re-reads the check and repaints. Never throws: a stale panel beats a lost one. */
async function _refresh(root: HTMLElement): Promise<void> {
    try {
        const check = await StorageContract.preflight();
        if (check) _paint(root, check);
        else root.hidden = true;
    } catch (error: unknown) {
        if (Log) Log.warn("[CacheControl] pré-vol illisible :", error);
    }
}

/**
 * Builds the block and appends it — right after the sync-status block, above STATUT.
 *
 * @param self - The `CacheControl` instance being built.
 * @param bodyEl - `.gl-cache-control__body`.
 */
export function buildPreflightBlock(self: CacheControlState, bodyEl: HTMLElement): void {
    const root = createElement("div", "gl-cache-preflight", bodyEl);
    root.setAttribute("role", "status");
    root.setAttribute("aria-live", "polite");
    root.hidden = true;

    const head = createElement("div", "gl-cache-preflight__head", root);
    const title = createElement("span", "gl-cache-preflight__title", head);
    title.textContent = t("storage.preflight.title");
    createElement("span", "gl-cache-preflight__verdict", head);
    createElement("div", "gl-cache-preflight__persistence", root);
    createElement("ul", "gl-cache-preflight__layers", root);
    const tiles = createElement("div", "gl-cache-preflight__tiles", root);
    tiles.hidden = true;

    self._refreshPreflight = () => _refresh(root);
    const onChange = () => void _refresh(root);
    for (const name of REFRESH_EVENTS) {
        document.addEventListener(name, onChange);
        self._eventCleanups.push(() => document.removeEventListener(name, onChange));
    }
    for (const name of ["online", "offline"]) {
        window.addEventListener(name, onChange);
        self._eventCleanups.push(() => window.removeEventListener(name, onChange));
    }

    void _refresh(root);
}
