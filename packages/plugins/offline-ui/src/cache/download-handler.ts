/*!
 * @geoleaf-plugins/offline-ui
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Cache download and clear management
 */

import { Log } from "@geoleaf/host-runtime";
import { coreConfigGet } from "@geoleaf/host-runtime";
import { StorageContract } from "../shared/storage-contract.js";
import { ensureEngineReady } from "../core/engine-ready.js";
import { getUINotifications } from "@geoleaf/host-runtime";
import { confirmDialog } from "@geoleaf/host-runtime";
import { toMB, toGB } from "../utils/core-utils.js";
import { tLabel as t } from "@geoleaf/host-runtime";

/**
 * ⚠️ `formatBytes` STAYS LOCAL — it is not the core's `formatFileSize`.
 * It has no KB tier and ignores precision, so the two render differently
 * (already documented on `core-utils.formatFileSize`). Only `toMB`/`toGB`
 * were true duplicates and they now come from the core namespace.
 */
const FormatUtils = {
    formatBytes: (bytes: number) => {
        if (!bytes) return "0 B";
        const mb = bytes / 1024 / 1024;
        return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(2)} MB`;
    },
};

/**
 * The core accessors return an EMPTY STRING when no core is on the page, which
 * `??` does not catch — only `||` does. Every call site goes through these two
 * helpers so the guard cannot be forgotten at one of them.
 */
const _mb = (bytes: number): string => toMB(bytes) || (bytes / 1024 / 1024).toFixed(1);
const _gb = (bytes: number): string => toGB(bytes) || (bytes / 1024 / 1024 / 1024).toFixed(2);

/**
 * @class DownloadHandler
 * @description Cache download and clear handler
 */
interface DownloadHandlerElements {
    progressEl: HTMLElement;
    progressFill: HTMLElement;
    progressText: HTMLElement;
    downloadBtn: HTMLButtonElement;
    clearBtn: HTMLButtonElement;
}

/** One progress tick emitted by `CacheManager.cacheProfile`. */
interface DownloadProgress {
    percentage?: number;
    current?: number;
    total?: number;
    downloadedSize?: number;
    estimatedTotalSize?: number;
}

const DownloadHandler = {
    _control: null as { _updateStatus?: () => Promise<void> } | null,
    _progressEl: null as HTMLElement | null,
    _progressFill: null as HTMLElement | null,
    _progressText: null as HTMLElement | null,
    _downloadBtn: null as HTMLButtonElement | null,
    _clearBtn: null as HTMLButtonElement | null,

    init(control: { _updateStatus?: () => Promise<void> }, elements: DownloadHandlerElements) {
        this._control = control;
        this._progressEl = elements.progressEl;
        this._progressFill = elements.progressFill;
        this._progressText = elements.progressText;
        this._downloadBtn = elements.downloadBtn;
        this._clearBtn = elements.clearBtn;

        if (Log) Log.debug("[DownloadHandler] Module initialized");
    },

    /**
     * Handles profile download
     */
    handleDownload: async function () {
        // Defer until the in-core offline engine is ready (loaded + IndexedDB open).
        // When offline is disabled the engine never loads → inform instead of hanging.
        if (!(await ensureEngineReady())) {
            getUINotifications()?.error(t("storage.notif.offline.unavailable"), 5000);
            return;
        }

        const profileId = coreConfigGet("data.activeProfile", "") as string;
        if (!profileId) {
            getUINotifications()?.error(t("storage.notif.noProfile"), 3000);
            return;
        }

        try {
            // Load selection and total size
            const selection = await this._loadSelection(profileId);
            const totalSize = Number(
                (selection as { totalEstimatedSize?: number })?.totalEstimatedSize ?? 0
            );
            const totalSizeMB = _mb(totalSize);

            if (!(await this._checkQuota(totalSize))) return;

            this._downloadBtn!.disabled = true;
            const btnText = this._downloadBtn!.querySelector(".gl-btn__text");
            if (btnText) btnText.textContent = t("storage.download.inProgress");
            this._progressEl!.style.display = "block";
            this._progressFill!.style.width = "0%";
            this._progressText!.textContent = `${t("storage.download.inProgress")} ${totalSizeMB} MB`;

            if (Log)
                Log.info(
                    `[DownloadHandler] Starting download for profile: ${profileId} (${totalSizeMB} MB)`
                );

            // Download
            const result = await StorageContract.CacheManager.cacheProfile(profileId, {
                onProgress: (progress: DownloadProgress) => this._updateProgressUI(progress),
                selection: selection,
            });

            if (this._progressFill) this._progressFill.style.width = "100%";
            const resourceCount =
                (result as { resourcesCount?: number; total?: number; cached?: unknown[] })
                    .resourcesCount ??
                (result as { total?: number }).total ??
                (result as { cached?: unknown[] }).cached?.length ??
                0;
            if (this._progressText)
                this._progressText.textContent = `✅ ${resourceCount} ${t("storage.download.done")}`;

            const sizeStr = FormatUtils.formatBytes(
                (result as { totalSize?: number }).totalSize ?? 0
            );
            getUINotifications()?.success(
                `${t("storage.notif.download.success")} : ${sizeStr}`,
                4000
            );

            setTimeout(() => {
                if (this._progressEl) this._progressEl.style.display = "none";
                if (this._progressFill) this._progressFill.style.width = "0%";
            }, 3000);

            // Force a delay to let IndexedDB settle
            await new Promise((resolve) => setTimeout(resolve, 500));

            // Update status via parent control
            if (this._control && this._control._updateStatus) {
                await this._control._updateStatus();
            }

            const layerSelector = StorageContract.Cache?.LayerSelector;
            if (layerSelector) {
                await layerSelector.refreshCacheIcons();
            }
        } catch (error: unknown) {
            const errorMsg = this._formatDownloadError(error);

            if (Log) Log.error(`[DownloadHandler] Download failed: ${errorMsg}`);

            if (this._progressText)
                this._progressText.textContent = `❌ ${t("storage.download.error")} : ${errorMsg}`;

            getUINotifications()?.error(`${t("storage.notif.download.error")} : ${errorMsg}`, 5000);

            setTimeout(() => {
                if (this._progressEl) this._progressEl.style.display = "none";
            }, 3000);
        } finally {
            if (this._downloadBtn) {
                this._downloadBtn.disabled = false;
                const label = this._downloadBtn.querySelector(".gl-btn__text");
                if (label) label.textContent = t("storage.download.btn");
            }
        }
    },

    /**
     * Handles cache clear
     */
    handleClear: async function () {
        // Defer until the engine is ready; no-op when offline is disabled.
        if (!(await ensureEngineReady())) {
            return;
        }

        const profileId = coreConfigGet("data.activeProfile", "") as string;
        if (!profileId) {
            return;
        }

        // Confirmation
        const ok = await confirmDialog({
            message: t("storage.confirm.deleteCache.message"),
            confirmLabel: t("storage.btn.delete"),
            cancelLabel: t("storage.btn.cancel"),
            destructive: true,
        });
        if (!ok) return;

        try {
            if (this._clearBtn) this._clearBtn.disabled = true;
            if (this._downloadBtn) this._downloadBtn.disabled = true;
            const clearBtnText = this._clearBtn?.querySelector(".gl-btn__text");
            if (clearBtnText) clearBtnText.textContent = t("storage.download.clearing");

            if (this._progressEl) this._progressEl.style.display = "block";
            if (this._progressFill) this._progressFill.style.width = "0%";
            if (this._progressText) this._progressText.textContent = t("storage.download.deleting");

            if (Log) Log.info(`[DownloadHandler] Clearing cache for profile: ${profileId}`);

            const deleted = await StorageContract.CacheManager.clearCache(profileId);

            getUINotifications()?.success(
                `${t("storage.notif.clear.success")} : ${deleted} ${t("storage.notif.resourcesDeleted")}`,
                3000
            );

            // Update status via parent control
            if (this._control && this._control._updateStatus) {
                await this._control._updateStatus();
            }

            // Refresh cache icons
            if (StorageContract.Cache?.LayerSelector) {
                await StorageContract.Cache.LayerSelector.refreshCacheIcons();
            }
        } catch (error: unknown) {
            if (Log) Log.error(`[DownloadHandler] Clear failed: ${(error as Error).message}`);

            getUINotifications()?.error(
                `${t("storage.notif.clear.error")} : ${(error as Error).message}`,
                5000
            );
        } finally {
            const clearBtnText = this._clearBtn?.querySelector(".gl-btn__text");
            if (clearBtnText) clearBtnText.textContent = t("storage.download.clearBtn");
            if (this._downloadBtn) this._downloadBtn.disabled = false;

            setTimeout(() => {
                if (this._progressEl) this._progressEl.style.display = "none";
                if (this._progressFill) this._progressFill.style.width = "0%";
            }, 2000);
        }
    },

    /**
     * Verifies the browser has room for the download.
     *
     * @returns `true` to proceed. `false` means the user was told why not and
     * the download must be abandoned — a quota that cannot be read is NOT a
     * refusal, the download proceeds and fails later if it really does not fit.
     * @private
     */
    async _checkQuota(totalSize: number): Promise<boolean> {
        // ⚠️ Read RAW rather than through `StorageContract.CacheManager.getStorageQuota()`,
        // which this package already uses elsewhere — and the reason is the `null` below, not
        // an oversight. That reader returns zeros when the browser cannot answer, which is
        // indistinguishable from "quota nought". Here the two must stay apart: an unreadable
        // quota proceeds, a quota of zero refuses. Routing this through it would turn every
        // unreadable quota into a refused download.
        //
        // 🛑 And the measurement is ORIGIN-WIDE in every one of these readers: `availableSpace`
        // below is what the whole origin has left, not what this cache may claim.
        let quotaInfo: StorageEstimate | null = null;
        try {
            if (navigator.storage && navigator.storage.estimate) {
                quotaInfo = await navigator.storage.estimate();
            }
        } catch (e) {
            console.warn("[DownloadHandler] Could not get storage quota:", e);
        }
        if (!quotaInfo) return true;

        const availableSpace = (quotaInfo.quota ?? 0) - (quotaInfo.usage ?? 0);
        if (totalSize <= availableSpace) return true;

        const totalSizeGB = _gb(totalSize);
        const availableGB = _gb(availableSpace);
        const shortageGB = _gb(totalSize - availableSpace);

        getUINotifications()?.error(
            `${t("storage.notif.disk.insufficient")} — ` +
                `${availableGB} GB / ${totalSizeGB} GB (−${shortageGB} GB)`,
            6000
        );
        if (Log)
            Log.error(
                `[DownloadHandler] Insufficient storage: needs ${totalSizeGB} GB, available ${availableGB} GB`
            );
        return false;
    },

    /**
     * Reflects one progress tick on the bar and its label.
     * @private
     */
    _updateProgressUI(progress: DownloadProgress): void {
        const percentage = progress.percentage ?? 0;
        const current = progress.current ?? 0;
        const total = progress.total ?? 0;

        if (this._progressFill) this._progressFill.style.width = `${percentage}%`;
        if (!this._progressText) return;

        const pct = Number(percentage).toFixed(0);
        if (progress.downloadedSize != null && progress.estimatedTotalSize != null) {
            const downloadedMB = (progress.downloadedSize / 1024 / 1024).toFixed(1);
            const totalMB = (progress.estimatedTotalSize / 1024 / 1024).toFixed(1);
            this._progressText.textContent = `${t("storage.download.inProgress")} ${current}/${total} • ${downloadedMB}/${totalMB} MB (${pct}%)`;
        } else {
            this._progressText.textContent = `${t("storage.download.inProgress")} ${current}/${total} ${t("storage.download.resources")} (${pct}%)`;
        }
    },

    /**
     * Turns a download failure into a message the user can act on. The two
     * special cases are memory exhaustion, which reads as a bug unless it names
     * the profile knobs that cause it.
     * @private
     */
    _formatDownloadError(error: unknown): string {
        const err = error as Error;
        const message = err?.message;

        if (message?.includes("Maximum call stack size exceeded")) {
            return t("storage.download.err.tooLarge");
        }
        if (message?.includes("Out of memory")) {
            return t("storage.download.err.outOfMemory");
        }
        return message ?? String(error);
    },

    /**
     * Loads the layer selection from storage
     * @private
     */
    async _loadSelection(profileId: string): Promise<Record<string, unknown> | null> {
        try {
            const Storage = StorageContract.Cache?.Storage;
            if (!Storage) {
                console.warn("[DownloadHandler] Storage not available");
                return null;
            }

            const selection = await Storage.loadLayerSelection(profileId);
            return selection;
        } catch (error) {
            if (Log) Log.error("[DownloadHandler] Failed to load selection:", error);
            return null;
        }
    },
};

// Exposition du module
if (Log) Log.debug("[DownloadHandler] Module loaded");

export { DownloadHandler };
