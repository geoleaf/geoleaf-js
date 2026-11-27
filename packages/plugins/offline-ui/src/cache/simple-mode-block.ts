/*!
 * GeoLeaf Storage - Cache Control, simple mode
 * The one-line state and the storage warning of the field window (`openModal({ mode: "simple" })`).
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import { Log, coreConfigGet, tLabel as t } from "@geoleaf/host-runtime";
import { createElement } from "../utils/dom-helpers.js";
import { StorageContract } from "../shared/storage-contract.js";

import type { CacheControlState } from "./cache-control-types.js";

/** What `getCacheStatus` answers, as far as this line reads it. */
interface StatusLike {
    resourcesCount?: number;
    /** Epoch ms of the last preparation — `null` on a manifest written before it existed. */
    cachedAt?: number | null;
}

/** The time of the last preparation — the clock alone today, the date with it otherwise. */
function _when(at: number): string {
    const date = new Date(at);
    const sameDay = date.toDateString() === new Date().toDateString();
    const options: Intl.DateTimeFormatOptions = sameDay
        ? { timeStyle: "short" }
        : { dateStyle: "short", timeStyle: "short" };
    try {
        return date.toLocaleString(document.documentElement.lang || undefined, options);
    } catch {
        // A `lang` attribute that is not a valid tag — the browser's own locale then.
        return date.toLocaleString(undefined, options);
    }
}

/** Re-reads the cache state and the storage persistence. Never throws. */
async function _refresh(stateEl: HTMLElement, warningEl: HTMLElement): Promise<void> {
    try {
        const profileId = String(coreConfigGet("data.activeProfile", "") ?? "");
        const status = (await StorageContract.CacheManager?.getCacheStatus(
            profileId
        )) as StatusLike | null;
        const ready = (status?.resourcesCount ?? 0) > 0;
        stateEl.setAttribute("data-state", ready ? "ready" : "none");
        stateEl.textContent = !ready
            ? t("storage.simple.none")
            : typeof status?.cachedAt === "number"
              ? // `tLabel`'s second argument is a fallback, not a value: `{0}` is replaced here.
                t("storage.simple.ready").replace("{0}", _when(status.cachedAt))
              : t("storage.simple.readyNoTime");

        // A browser that may evict the zone says so here too: in this mode the pre-departure
        // block, which carries the same sentence, is not shown.
        const check = await StorageContract.preflight();
        warningEl.hidden = check?.persistence !== "bestEffort";
        if (!warningEl.hidden)
            warningEl.textContent = t("storage.preflight.persistence.bestEffort");
    } catch (error: unknown) {
        if (Log) Log.warn("[CacheControl] état du mode simple illisible :", error);
    }
}

/**
 * Builds the state line and the storage warning, at the top of the simple window.
 *
 * It takes the place of the pre-departure refresh (`self._refreshPreflight`), which
 * `updateStatus` calls after every change of the cache: the line follows a download, a stop
 * and a purge without a listener of its own.
 *
 * @param self - The `CacheControl` instance being built.
 * @param bodyEl - `.gl-cache-control__body`.
 */
export function buildSimpleModeBlock(self: CacheControlState, bodyEl: HTMLElement): void {
    const root = createElement("div", "gl-cache-simple", bodyEl);
    const stateEl = createElement("div", "gl-cache-simple__state", root);
    stateEl.setAttribute("role", "status");
    stateEl.setAttribute("aria-live", "polite");
    stateEl.setAttribute("data-state", "none");
    stateEl.textContent = t("storage.simple.none");
    const warningEl = createElement("div", "gl-cache-simple__warning", root);
    warningEl.hidden = true;

    self._refreshPreflight = () => _refresh(stateEl, warningEl);
    void _refresh(stateEl, warningEl);
}
