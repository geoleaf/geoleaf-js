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
        // 🛑 TÂCHE 4.10 — CE FILTRE LISAIT UN VOCABULAIRE QUE PLUS PERSONNE N'ÉCRIT, ET
        // L'EXPORT NE RENDAIT DONC RIEN. Il gardait `entry.type === "add_poi" ||
        // "update_poi"` sur `getPendingSyncQueue()`. Depuis 4.4b/4.7, `addpoi` et `editor`
        // passent tous deux par `Storage.applyEdit()` → outbox, et plus rien n'écrit ces
        // types dans `sync_queue` : l'export sortait donc une liste vide, en silence,
        // pendant que les vraies saisies dormaient dans l'outbox.
        //
        // ⚠️ Le second filtre (`status !== "synced"`) était bien là et il était JUSTE — mais
        // il venait APRÈS un filtre de type qui avait déjà tout écarté. Un prédicat correct
        // placé derrière un prédicat mort ne s'exécute jamais, et rien ne le signale.
        //
        // La question de l'export n'est plus « quels POI » mais « quel TRAVAIL est encore dû
        // au serveur » — l'outbox le sait, et le core la joint à son entité.
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
                // La géométrie part avec : un export de saisies de terrain qui les rendrait
                // sans position ne serait pas une sauvegarde, ce que S3 avait déjà corrigé
                // une fois sur la charge attributaire.
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
        // 🛑 TÂCHE 4.10 / B-115 — CE GESTE A CHANGÉ DE CIBLE, ET C'EST LE FOND DE LA
        // CORRECTION. Il supprimait des entrées de `sync_queue` filtrées sur `entry.type`,
        // SANS jamais lire `entry.status` : une saisie jamais poussée était détruite au même
        // titre qu'une entrée synchronisée. Puis 4.4b a déplacé les écrivains vers l'outbox,
        // et le même filtre s'est mis à ne plus rien supprimer du tout — le défaut est passé
        // de « il détruit trop » à « il ne fait plus rien », sans que rien ne rougisse.
        //
        // Depuis 4.1, le partage est net : le magasin `features` EST le cache (chaque entité
        // `synced` se re-rapatrie par `pullLayer()`), et l'outbox EST le travail, qui n'a
        // aucune autre copie. Un bouton qui annonce « vider le cache » ne touche donc que le
        // premier — et il ANNONCE ce qu'il préserve, parce qu'un décompte affiché est une
        // assertion testable là où un filtre silencieux se re-supprime au prochain refactor.
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
            // ⚠️ La confirmation d'origine parlait de « vider le cache des POI locaux » sans
            // dire ce qu'elle détruisait — vocabulaire de CACHE, c'est-à-dire de données
            // re-téléchargeables, appliqué à du travail de terrain. Le décompte lève
            // exactement cette ambiguïté, et la cible mesurée le rend enfin vrai.
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
