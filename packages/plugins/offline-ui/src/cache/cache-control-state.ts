/*!
 * GeoLeaf Storage - Cache Control State
 * State updates, progress tracking, and delegation to external modules.
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import { Log } from "@geoleaf/host-runtime";
import { coreConfigGet } from "@geoleaf/host-runtime";
import { StorageContract } from "../shared/storage-contract.js";
import { LayerSelectorCore } from "./layer-selector/core.js";
import { getUINotifications } from "@geoleaf/host-runtime";
import { confirmDialog } from "@geoleaf/host-runtime";
import { tLabel as t } from "@geoleaf/host-runtime";

import type { CacheControlState, CacheProgressDetail } from "./cache-control-types.js";

const ConfigGet = { get: coreConfigGet };

// ─── Status ──────────────────────────────────────────────────────────

/** Updates cache status from CacheManager. */
export async function updateStatus(self: CacheControlState): Promise<void> {
    if (!StorageContract.isPluginLoaded() || !StorageContract.CacheManager) {
        if (Log) Log.warn("[CacheControl] CacheManager not available");
        return;
    }

    try {
        const profileId = String(ConfigGet.get("data.activeProfile", "") ?? "");
        const status = (await StorageContract.CacheManager.getCacheStatus(profileId)) as {
            resourcesCount: number;
            size: number;
        } | null;
        const quota = await StorageContract.CacheManager.getStorageQuota();

        // DOM elements
        const profileEl = document.getElementById("gl-cache-profile");
        const stateEl = document.getElementById("gl-cache-state");
        const sizeEl = document.getElementById("gl-cache-size");
        const quotaEl = document.getElementById("gl-cache-quota");

        if (profileEl) profileEl.textContent = profileId || "-";

        if (status && status.resourcesCount > 0) {
            if (stateEl) {
                stateEl.textContent = " \u2705 Downloaded";
                stateEl.style.color = "#22c55e";
            }
            if (sizeEl) {
                const sizeMB = ((status.size || 0) / 1024 / 1024).toFixed(2);
                sizeEl.textContent = `${sizeMB} MB`;
            }
            if (self._clearBtn) self._clearBtn.disabled = false;
        } else {
            if (stateEl) {
                stateEl.textContent = " \u274C Not downloaded";
                stateEl.style.color = "#ef4444";
            }
            if (sizeEl) sizeEl.textContent = "0 MB";
            if (self._clearBtn) self._clearBtn.disabled = true;
        }

        if (quotaEl) {
            const usedMB = (quota.usage / 1024 / 1024).toFixed(2);
            const totalMB = (quota.quota / 1024 / 1024).toFixed(2);
            const percentage = quota.percentage.toFixed(1);
            quotaEl.textContent = `${usedMB} MB / ${totalMB} MB (${percentage}%)`;
        }
    } catch (error) {
        if (Log) Log.error(`[CacheControl] Failed to update status: ${(error as Error).message}`);
    }
}

// ─── Progress ────────────────────────────────────────────────────────

/** Updates the progress bar. */
export function updateProgress(self: CacheControlState, progress: CacheProgressDetail): void {
    if (!self._progressEl || !self._progressFill || !self._progressText || !progress) return;

    const cur = progress.current ?? 0;
    const tot = progress.total ?? 1;
    let percent: number;
    if (progress.downloadedSize != null && progress.totalSize != null && progress.totalSize > 0) {
        percent = Math.round((progress.downloadedSize / progress.totalSize) * 100);
    } else {
        percent = Math.round((cur / tot) * 100);
    }
    self._progressFill.style.width = percent + "%";

    let text = `${cur} / ${tot} files`;

    // Append downloaded / total size
    if (progress.downloadedSize && progress.totalSize) {
        const downloadedMB = (progress.downloadedSize / 1024 / 1024).toFixed(1);
        const totalMB = (progress.totalSize / 1024 / 1024).toFixed(1);
        text += ` \u2022 ${downloadedMB}/${totalMB} MB`;
    }

    // Instantaneous speed
    if (progress.speed) {
        const speedMB = (progress.speed / 1024 / 1024).toFixed(2);
        text += ` \u2022 ${speedMB} MB/s`;
    }

    // Remaining time (with validation)
    if (progress.eta && progress.eta > 0 && progress.eta < 86400) {
        // Max 24h
    }

    self._progressText!.textContent = text;
}

/** Updates clear progress. */
export function updateClearProgress(self: CacheControlState, progress: CacheProgressDetail): void {
    if (!self._progressEl || !self._progressFill || !self._progressText) return;
    const cur = progress.current ?? 0;
    const tot = progress.total ?? 1;
    const percentage = (cur / tot) * 100;
    self._progressFill.style.width = percentage.toFixed(1) + "%";

    let text = `Deleting: ${cur} / ${tot} files`;
    if (percentage < 100) {
        text += ` (${percentage.toFixed(0)}%)`;
    } else {
        text = "\u2705 Deletion complete";
    }

    self._progressText.textContent = text;
}

// ─── Action handlers (delegation) ───────────────────────────────────

// Download / clear / sync commands are wired directly to DownloadHandler /
// SyncManager by the assembler (cache-control.ts) since S6.6 — kept out of here
// so this module stays a pure status/progress view. Restore is owned by SyncManager.

/** Handles download stop. */
export function handleStop(self: CacheControlState): void {
    if (!StorageContract.isPluginLoaded() || !StorageContract.CacheManager) return;
    void confirmDialog({
        message: t("storage.confirm.stopDownload.message"),
        confirmLabel: t("storage.btn.confirm"),
        cancelLabel: t("storage.btn.cancel"),
        destructive: true,
    }).then((ok) => {
        if (!ok) return;
        try {
            StorageContract.CacheManager.cancelDownload();
            if (self._progressText) self._progressText.textContent = "\u23F9\uFE0F Stopping...";
        } catch (error) {
            if (Log)
                Log.error(`[CacheControl] Failed to stop download: ${(error as Error).message}`);
        }
    });
}

/** Handles the download cancelled event. */
export function handleCancelled(self: CacheControlState): void {
    if (self._progressText) self._progressText.textContent = "\u23F9\uFE0F Download stopped";
    if (self._progressFill) self._progressFill.style.backgroundColor = "#ef4444";

    if (self._downloadBtn) {
        self._downloadBtn.disabled = false;
        const textEl = self._downloadBtn.querySelector(".gl-btn__text");
        if (textEl) textEl.textContent = "Download profile";
    }

    setTimeout(() => {
        if (self._progressEl) self._progressEl.style.display = "none";
        if (self._progressFill) {
            self._progressFill.style.width = "0%";
            self._progressFill.style.backgroundColor = "";
        }
    }, 3000);

    self._updateStatus().catch((e: unknown) =>
        Log?.error("[CacheControl] Error updating status after stop:", e)
    );
    getUINotifications()?.warning?.("Download stopped", 3000);
}

// Select-all handling lives in the layer-selector itself (row-rendering →
// selection-cache); the control no longer proxies it (dead path removed S6.6).

/** Populates the layer selection section. Delegates to LayerSelectorCore. */
export async function populateLayerSelection(): Promise<void> {
    if (LayerSelectorCore) {
        await LayerSelectorCore.populate();
    }
}
