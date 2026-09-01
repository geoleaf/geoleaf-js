/*!
 * @geoleaf-plugins/offline-ui
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview UI Cache Button - Export & Sync Logic Module
 * @description Handles POI export, sync with server, and cache management
 * @author GeoLeaf Team
 * @version 3.0.0
 */

import { Log } from "@geoleaf/host-runtime";
import { StorageContract } from "../../shared/storage-contract.js";
import { ensureEngineReady } from "../../core/engine-ready.js";
import { DOMSecurity } from "../../utils/core-utils.js";
import { getUINotifications } from "@geoleaf/host-runtime";
import { confirmDialog } from "@geoleaf/host-runtime";
import { CacheControl } from "../../cache/cache-control.js";
import { SyncManager } from "../../sync/sync-manager.js";
import { ButtonControl } from "./button-control.js";
import { tLabel as t } from "@geoleaf/host-runtime";

/**
 * Export & Sync Logic Module
 * Handles business logic for cache content, export, and synchronization
 */
const ExportLogic = {
    /**
     * Initialize cache content in modal (Import tab)
     */
    initializeCacheContent() {
        const body = document.getElementById("gl-cache-modal-body");
        if (!body) return;

        // Check if already initialized
        if (body.hasAttribute("data-initialized")) {
            if (Log) Log.info("[CacheButton.ExportLogic] Cache control already initialized");
            // Update status
            const CC = CacheControl as {
                create: (opts?: unknown) => unknown;
                _updateStatus?: () => Promise<void>;
            };
            if (CC._updateStatus) {
                // The try/catch only ever caught a SYNCHRONOUS throw — a rejected
                // promise walked straight past it. Both paths are covered now: the
                // signature is `() => Promise<void>`, which a non-async function can
                // satisfy while still throwing synchronously.
                try {
                    CC._updateStatus().catch((e: unknown) => {
                        if (Log) Log.warn("Error updating status:", e);
                    });
                } catch (e) {
                    if (Log) Log.warn("Error updating status:", e);
                }
            }
            return;
        }

        // Check if module is available
        if (!CacheControl) {
            const p = document.createElement("p");
            p.className = "gl-cache-modal__placeholder";
            p.textContent = "Module de cache non disponible";
            body.appendChild(p);
            if (Log) Log.warn("[CacheButton.ExportLogic] CacheControl unavailable");
            return;
        }

        try {
            // Create cache control
            const cacheControl = CacheControl.create({
                position: "topright",
                collapsed: false,
                collapsible: false,
            });

            if (!cacheControl) {
                const p = document.createElement("p");
                p.className = "gl-cache-modal__placeholder";
                p.textContent = "Unable to create cache control";
                body.appendChild(p);
                return;
            }

            // S2: run the sub-modules against the real map (captured at map-ready)
            // instead of the former `tempMap` hack. onAdd builds its own container,
            // so a null map (modal opened before map-ready) stays harmless.
            const onAdd = cacheControl.onAdd;
            if (!onAdd) return;
            const realMap = ButtonControl.getMap();
            const cacheElement = onAdd.call(cacheControl, realMap);

            cacheElement.className = "gl-cache-control gl-cache-control--modal";

            const header = cacheElement.querySelector(".gl-cache-control__header");
            if (header && header instanceof HTMLElement) {
                header.style.display = "none";
            }

            const bodyContent = cacheElement.querySelector(".gl-cache-control__body");
            if (bodyContent && bodyContent instanceof HTMLElement) {
                bodyContent.style.display = "block";
            }

            // Inject into modal: clear any previous content (e.g. Export tab),
            // then attach the freshly built cache control. Without this append the
            // Import tab stays blank — the control is built but never mounted.
            DOMSecurity.clearElementFast(body);
            body.appendChild(cacheElement);
            body.setAttribute("data-initialized", "true");

            // Store control reference for future updates
            (body as HTMLElement & { _cacheControl?: unknown })._cacheControl = cacheControl;

            if (Log) Log.info("[CacheButton.ExportLogic] Cache control initialized in modal");
        } catch (err) {
            if (Log)
                Log.error(
                    "[CacheButton.ExportLogic] Error during cache control initialization:",
                    err
                );

            // Use textContent for error message (sanitized)
            DOMSecurity.clearElementFast(body);

            const errorP = document.createElement("p");
            errorP.className = "gl-cache-modal__placeholder gl-cache-modal__placeholder--error";
            errorP.textContent = "Erreur: " + (err as Error).message;
            body.appendChild(errorP);
        }
    },

    /**
     * Initialize export content (Export tab)
     */
    initializeExportContent() {
        const body = document.getElementById("gl-cache-modal-body");
        if (!body) return;

        // Reset content
        body.removeAttribute("data-initialized");
        DOMSecurity.clearElementFast(body);

        // Create export interface
        const exportContainer = document.createElement("div");
        exportContainer.className = "gl-cache-export";

        // Header
        const header = document.createElement("div");
        header.className = "gl-cache-export__header";

        const h3 = document.createElement("h3");
        h3.className = "gl-cache-export__title";

        h3.textContent = "📤 Export added POIs";
        header.appendChild(h3);

        const p = document.createElement("p");
        p.className = "gl-cache-export__subtitle";

        p.textContent = "Export the POIs you have added locally to a JSON file.";
        header.appendChild(p);

        exportContainer.appendChild(header);

        // Stats
        const stats = document.createElement("div");
        stats.className = "gl-cache-export__stats";
        exportContainer.appendChild(stats);

        // POI synchronisation — the real section, owned by SyncManager: pending
        // operations broken down by kind, sync button, and the BACKUPS list with
        // its restore button.
        //
        // ⚠️ PLUGINS S7 — this replaces an ad-hoc sync block that used to live in
        // the callback below (a title, a button and a caution line): a second,
        // thinner implementation of the same feature. The real one was built by the
        // CacheControl and then DELETED from the Import tab, so its backups list had
        // never been reachable. Mounting it here is what makes CDC §1.7 ("Liste des
        // sauvegardes disponibles avec bouton de restauration") true.
        //
        // ⚠️ Mounted SYNCHRONOUSLY, outside `getPendingPOIs()`. That read goes
        // through `ensureEngineReady()` → `StorageContract.whenReady()`, which does
        // not settle while the offline engine fails to initialise — and everything
        // inside the callback then never renders. The section owns its own state via
        // `updateStatus()` and has no business waiting on a POI count.
        SyncManager.mount(exportContainer, {
            // A sync empties the queue: the count and the actions are stale the
            // moment it succeeds.
            onSynced: () => this.initializeExportContent(),
        });

        body.appendChild(exportContainer);

        // Fetch stored POIs
        this.getPendingPOIs()
            .then((pois: unknown) => {
                const count = Array.isArray(pois) ? pois.length : 0;

                // Build stats with createElement
                const statsContainer = document.createElement("div");
                statsContainer.className = "gl-cache-export__stats-row";

                const emoji = document.createElement("span");
                emoji.className = "gl-cache-export__stats-icon";

                emoji.textContent = "📊";
                statsContainer.appendChild(emoji);

                const statsText = document.createElement("div");
                const countDiv = document.createElement("div");
                countDiv.className = "gl-cache-export__stats-count";

                countDiv.textContent = String(count);
                statsText.appendChild(countDiv);

                const labelDiv = document.createElement("div");
                labelDiv.className = "gl-cache-export__stats-label";

                labelDiv.textContent = `POI${count > 1 ? "s" : ""} pending synchronization`;
                statsText.appendChild(labelDiv);

                statsContainer.appendChild(statsText);
                stats.appendChild(statsContainer);

                // Action buttons
                if (count > 0) {
                    const actions = document.createElement("div");
                    actions.className = "gl-cache-export__actions";

                    // Export JSON button
                    const exportJsonBtn = document.createElement("button");
                    exportJsonBtn.className = "gl-cache-export__btn gl-cache-export__btn--primary";
                    exportJsonBtn.type = "button";
                    exportJsonBtn.textContent = "📥 Download as JSON";
                    exportJsonBtn.onclick = () => this.exportPOIsAsJSON(pois as unknown[]);
                    actions.appendChild(exportJsonBtn);

                    // Copy to clipboard button
                    const copyBtn = document.createElement("button");
                    copyBtn.className = "gl-cache-export__btn gl-cache-export__btn--secondary";
                    copyBtn.type = "button";
                    copyBtn.textContent = "📋 Copy to clipboard";
                    copyBtn.onclick = () => this.copyPOIsToClipboard(pois as unknown[]);
                    actions.appendChild(copyBtn);

                    // Clear cache button
                    const clearBtn = document.createElement("button");
                    clearBtn.className = "gl-cache-export__btn gl-cache-export__btn--danger";
                    clearBtn.type = "button";
                    clearBtn.textContent = "🗑️ Clear local cache";
                    clearBtn.onclick = () => this.clearLocalPOIs();
                    actions.appendChild(clearBtn);

                    exportContainer.appendChild(actions);
                } else {
                    const emptyState = document.createElement("div");
                    emptyState.className = "gl-cache-export__empty";

                    const emptyIcon = document.createElement("div");
                    emptyIcon.className = "gl-cache-export__empty-icon";

                    emptyIcon.textContent = "📭";
                    emptyState.appendChild(emptyIcon);

                    const emptyText = document.createElement("p");
                    emptyText.textContent = "Aucun POI en attente d'export";
                    emptyState.appendChild(emptyText);

                    exportContainer.appendChild(emptyState);
                }
            })
            .catch((e: unknown) => {
                // IndexedDB read failure: the export panel stays on its placeholder
                // rather than silently swallowing the rejection.
                if (Log) Log.error("[CacheButton.ExportLogic] Failed to read pending POIs:", e);
            });
    },

    /**
     * Get pending POIs from IndexedDB
     * @returns {Promise<Array>} List of POIs
     */
    async getPendingPOIs() {
        // 🛑 THIS FILTER READ A VOCABULARY NOBODY WRITES ANY MORE, SO THE EXPORT
        // RETURNED NOTHING. It kept `entry.type === "add_poi" || "update_poi"` on
        // `getPendingSyncQueue()`. Since the writers moved, `addpoi` and `editor`
        // both go through `Storage.applyEdit()` → outbox, and nothing writes those
        // types into `sync_queue` any more: the export produced an empty list,
        // silently, while the real captures slept in the outbox.
        //
        // ⚠️ The second filter (`status !== "synced"`) was there and it was RIGHT —
        // but it came AFTER a type filter that had already discarded everything. A
        // correct predicate placed behind a dead one never runs, and nothing flags
        // it.
        //
        // The export's question is no longer "which POIs" but "what WORK is still
        // owed to the server" — the outbox knows, and the core joins it to its
        // entity.
        if (!(await ensureEngineReady())) return [];
        try {
            const pending = await StorageContract.DB.listPendingEdits();
            return pending.map((edit) => ({
                ...(edit.feature && typeof edit.feature === "object"
                    ? ((edit.feature as { properties?: Record<string, unknown> }).properties ?? {})
                    : {}),
                _syncOperation: edit.kind,
                _syncStatus: edit.state,
                _syncQueueId: edit.entryId,
                _syncTimestamp: edit.createdAt,
                _layerId: edit.layerId,
                _localId: edit.localId,
                // The geometry goes along: an export of field captures rendering
                // them position-less would not be a backup — already fixed once for
                // the attribute payload.
                _geometry: (edit.feature as { geometry?: unknown } | null)?.geometry ?? null,
            }));
        } catch (error) {
            if (Log) Log.error("Error retrieving POIs:", error);
            return [];
        }
    },

    /**
     * Export POIs as JSON file
     * @param {Array} pois - List of POIs
     */
    exportPOIsAsJSON(pois: unknown[]) {
        try {
            const dataStr = JSON.stringify(pois, null, 2);
            const dataBlob = new Blob([dataStr], { type: "application/json" });
            const url = URL.createObjectURL(dataBlob);

            const link = document.createElement("a");
            link.href = url;
            link.download = `geoleaf-pois-export-${new Date().toISOString().split("T")[0]}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            if (Log)
                Log.info("[CacheButton.ExportLogic] JSON export successful:", pois.length, "POIs");
            getUINotifications()?.success(
                `${t("storage.notif.export.success")} (${pois.length})`,
                4000
            );
        } catch (error) {
            if (Log) Log.error("Error during JSON export:", error);
            getUINotifications()?.error(
                `${t("storage.notif.export.error")}: ${(error as Error).message}`,
                5000
            );
        }
    },

    /**
     * Copy POIs to clipboard
     * @param {Array} pois - List of POIs
     */
    async copyPOIsToClipboard(pois: unknown[]) {
        try {
            const dataStr = JSON.stringify(pois, null, 2);
            await navigator.clipboard.writeText(dataStr);

            if (Log)
                Log.info(
                    "[CacheButton.ExportLogic] Clipboard copy successful:",
                    pois.length,
                    "POIs"
                );
            getUINotifications()?.success(
                `${t("storage.notif.clipboard.success")} (${pois.length})`,
                3000
            );
        } catch (error) {
            if (Log) Log.error("Error during copy:", error);
            getUINotifications()?.error(
                `${t("storage.notif.clipboard.error")}: ${(error as Error).message}`,
                5000
            );
        }
    },

    /**
     * Clear local POI cache
     */
    async clearLocalPOIs() {
        // 🛑 THIS GESTURE CHANGED TARGET, AND THAT IS THE HEART OF THE FIX. It
        // deleted `sync_queue` entries filtered on `entry.type`, WITHOUT ever
        // reading `entry.status`: a never-pushed capture was destroyed on the same
        // footing as a synchronised entry. Then the writers moved to the outbox,
        // and the same filter started deleting nothing at all — the defect went
        // from "it destroys too much" to "it does nothing any more", with nothing
        // turning red.
        //
        // The split is now clean: the `features` store IS the cache (every
        // `synced` entity re-pulls via `pullLayer()`), and the outbox IS the work,
        // which has no other copy. A button announcing "clear the cache" thus
        // touches only the former — and it ANNOUNCES what it preserves, because a
        // displayed tally is a testable assertion where a silent filter
        // re-deletes itself at the next refactor.
        if (!(await ensureEngineReady())) return;

        let cached = 0;
        let pending = 0;
        try {
            const stats = await StorageContract.getStats();
            cached = stats?.features?.count ?? 0;
            pending = stats?.outbox?.count ?? 0;
        } catch (error) {
            if (Log) Log.error("[CacheButton.ExportLogic] Failed to count before purge:", error);
        }

        const ok = await confirmDialog({
            // ⚠️ The original confirmation spoke of "clearing the local POI cache"
            // without saying what it destroyed — CACHE vocabulary, i.e.
            // re-downloadable data, applied to field work. The tally lifts exactly
            // that ambiguity, and the measured target finally makes it true.
            message: `${t("storage.confirm.clearPois.message")}\n\n${t(
                "storage.confirm.clearPois.detail"
            )
                .replace("{cached}", String(cached))
                .replace("{pending}", String(pending))}`,
            confirmLabel: t("storage.btn.delete"),
            cancelLabel: t("storage.btn.cancel"),
            destructive: true,
        });
        if (!ok) return;

        try {
            const { removed, preserved } = await StorageContract.DB.purgeCachedFeatures();

            if (Log) {
                Log.info(
                    `[CacheButton.ExportLogic] Cache purged — ${removed} removed, ${preserved} preserved`
                );
            }
            getUINotifications()?.success(
                `${t("storage.notif.clearPois.success")} (${removed})`,
                3000
            );

            // Refresh display
            this.initializeExportContent();
        } catch (error) {
            if (Log) Log.error("Error clearing cache:", error);
            getUINotifications()?.error(
                `${t("storage.notif.clearPois.error")}: ${(error as Error).message}`,
                5000
            );
        }
    },
};

// ── ESM Export ──
export { ExportLogic };

if (Log) Log.info("[CacheButton.ExportLogic] Module loaded");
