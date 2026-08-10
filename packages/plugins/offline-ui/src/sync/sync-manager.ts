/*!
 * @geoleaf-plugins/offline-ui
 * © 2026 Mattieu Pottier — MIT License
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Panneau « DONNÉES SAISIES » — le statut des éditions encore dues au serveur.
 *
 * Construit la section repliable, la câble, et rend le décompte que
 * `POISyncHandler.getSyncSummary()` produit depuis l'outbox. Le bouton de synchronisation
 * manuelle passe par `processSyncQueue()`, c'est-à-dire par le drain du core.
 *
 * ⚠️ **Ce module rendait un SECOND emplacement jusqu'au 04/08/2026** — une liste de
 * sauvegardes avec ses boutons de restauration. Elle est retirée à la tâche 4.11 : son
 * magasin `sync_backups` n'avait plus d'écrivain depuis 4.4b, donc la liste était vide par
 * construction, et le rempart qu'elle prétendait offrir contre une purge d'origine vivait
 * dans la base que cette purge détruit.
 */

import { Log } from "@geoleaf/host-runtime";
import { DOMSecurity } from "../utils/core-utils.js";
import { getPoiSyncHandler } from "../core/sync-seam.js";
import { getUINotifications } from "@geoleaf/host-runtime";
import { confirmDialog } from "@geoleaf/host-runtime";
import { tLabel as t } from "@geoleaf/host-runtime";

interface SyncManagerControl {
    _syncToggleBtn?: HTMLButtonElement | null;
}

interface SyncSectionElements {
    syncSection: HTMLElement;
    syncToggleBtn: HTMLButtonElement;
    syncContent: HTMLElement;
    syncStatusEl: HTMLElement;
    syncMessageEl: HTMLElement;
    syncBtn: HTMLButtonElement;
}

interface SyncManagerState {
    _control: SyncManagerControl | null;
    _syncContent: HTMLElement | null;
    _syncStatusEl: HTMLElement | null;
    _syncMessageEl: HTMLElement | null;
    _syncBtn: HTMLButtonElement | null;
    _syncToggleBtn: HTMLButtonElement | null;
}

interface SyncManagerThis extends SyncManagerState {
    /** Set by `mount()`: re-renders the host view after a successful sync. */
    _onSynced: (() => void) | null;
    buildSection(parentEl: HTMLElement): SyncSectionElements;
    init(control: SyncManagerControl, syncContent: HTMLElement | null): void;
    updateStatus(): Promise<void>;
    _renderSyncStatus(): Promise<void>;
    handleToggle(): void;
    handleSync(): Promise<void>;
}

const SyncManager = {
    _control: null as SyncManagerControl | null,
    _syncContent: null as HTMLElement | null,
    _syncStatusEl: null as HTMLElement | null,
    _syncMessageEl: null as HTMLElement | null,
    _syncBtn: null as HTMLButtonElement | null,
    _syncToggleBtn: null as HTMLButtonElement | null,
    _onSynced: null as (() => void) | null,

    /**
     * Builds the section into `parentEl`, wires it, and kicks off its first render.
     *
     * PLUGINS S7 — this is the ONLY supported way to put the section on screen.
     * It used to be built by `cache-control-dom.buildSyncSection()` during the
     * CacheControl's `buildStructure()`, with the six element references stored on
     * the control and the two click handlers bound from `cache-control-events`.
     * That path then had `export-logic` DELETE the section from the Import tab, so
     * the pending-operations detail — specified in the CDC §2.10 — never reached the
     * DOM. Owning the wiring here means the host only has to say WHERE, and cannot
     * end up half-connected.
     *
     * ⚠️ Cette phrase citait aussi « the backups list » (CDC §1.7). La liste est retirée
     * avec la chaîne de sauvegarde (tâche 4.11) : son magasin n'avait plus d'écrivain
     * depuis 4.4b, donc elle n'affichait plus rien à faire remonter au DOM.
     *
     * Safe to call again on a re-render: the previous nodes go away with their
     * container, and the listeners attached to them go with the nodes.
     *
     * @param this - The sync-manager singleton; the method is invoked bound to it, so the
     *   receiver is part of the signature and TSD-02 counts it as a parameter.
     * @param parentEl - container the section is appended to.
     * @param opts.onSynced - called after a successful sync, so the host can
     *   refresh whatever else it shows about the queue (a POI count, actions…).
     *   Passed in rather than imported to keep this module free of its hosts.
     */
    mount(this: SyncManagerThis, parentEl: HTMLElement, opts?: { onSynced?: () => void }): void {
        const elements = this.buildSection(parentEl);

        this._onSynced = opts?.onSynced ?? null;
        this.init({ _syncToggleBtn: elements.syncToggleBtn }, elements.syncContent);

        elements.syncToggleBtn.addEventListener("click", () => this.handleToggle());
        elements.syncBtn.addEventListener("click", () => {
            void this.handleSync();
        });

        void this.updateStatus().catch((error: unknown) => {
            if (Log) Log.error("[SyncManager] Initial status render failed:", error);
        });
    },

    init(this: SyncManagerThis, control: SyncManagerControl, syncContent: HTMLElement | null) {
        this._control = control;
        this._syncContent = syncContent;

        if (syncContent) {
            this._syncStatusEl = syncContent.querySelector(
                "#gl-cache-sync-status"
            ) as HTMLElement | null;
            this._syncMessageEl = syncContent.querySelector(
                "#gl-cache-sync-message"
            ) as HTMLElement | null;
            this._syncBtn = syncContent.querySelector(
                "#gl-cache-sync-btn"
            ) as HTMLButtonElement | null;
        }

        if (control._syncToggleBtn) {
            this._syncToggleBtn = control._syncToggleBtn;
        }

        if (Log) Log.debug("[SyncManager] Module initialized");
    },

    buildSection(this: SyncManagerThis, parentEl: HTMLElement): SyncSectionElements {
        const syncSection = document.createElement("div");
        syncSection.className = "gl-cache-sync";
        parentEl.appendChild(syncSection);

        const syncHeader = document.createElement("div");
        syncHeader.className = "gl-cache-sync__header";
        syncSection.appendChild(syncHeader);

        const headerTitle = document.createElement("div");
        headerTitle.className = "gl-cache-sync__title";
        syncHeader.appendChild(headerTitle);
        const iconSpan = document.createElement("span");
        iconSpan.className = "gl-cache-sync__icon";
        iconSpan.textContent = "📄";
        const labelSpan = document.createElement("span");
        labelSpan.className = "gl-cache-sync__label";
        labelSpan.textContent = t("storage.sync.title");
        headerTitle.appendChild(iconSpan);
        headerTitle.appendChild(labelSpan);

        const syncToggleBtn = document.createElement("button");
        syncToggleBtn.className = "gl-cache-sync__toggle";
        syncHeader.appendChild(syncToggleBtn);
        syncToggleBtn.type = "button";
        syncToggleBtn.textContent = "▼";
        syncToggleBtn.setAttribute("aria-label", t("storage.sync.toggle"));

        const syncContent = document.createElement("div");
        syncContent.className = "gl-cache-sync__content";
        syncSection.appendChild(syncContent);
        syncContent.style.display = "block";

        const syncStatusEl = document.createElement("div");
        syncStatusEl.className = "gl-cache-sync__status";
        syncContent.appendChild(syncStatusEl);
        syncStatusEl.id = "gl-cache-sync-status";
        const loadingP = document.createElement("p");
        loadingP.className = "gl-cache-sync__placeholder";
        loadingP.textContent = t("storage.sync.loading");
        syncStatusEl.appendChild(loadingP);

        const syncMessageEl = document.createElement("div");
        syncMessageEl.className = "gl-cache-sync__message";
        syncContent.appendChild(syncMessageEl);
        syncMessageEl.id = "gl-cache-sync-message";
        syncMessageEl.style.display = "none";

        const syncBtn = document.createElement("button");
        syncBtn.className = "gl-btn gl-btn--primary gl-cache-btn";
        syncContent.appendChild(syncBtn);
        syncBtn.id = "gl-cache-sync-btn";
        const btnIcon = document.createElement("span");
        btnIcon.className = "gl-btn__icon";
        btnIcon.textContent = "🔄";
        const btnText = document.createElement("span");
        btnText.className = "gl-btn__text";
        btnText.textContent = t("storage.sync.btn");
        syncBtn.appendChild(btnIcon);
        syncBtn.appendChild(btnText);
        syncBtn.disabled = true;

        return {
            syncSection,
            syncToggleBtn,
            syncContent,
            syncStatusEl,
            syncMessageEl,
            syncBtn,
        };
    },

    handleToggle(this: SyncManagerThis) {
        if (!this._syncContent) return;

        const isCollapsed = this._syncContent.style.display === "none";
        this._syncContent.style.display = isCollapsed ? "block" : "none";

        if (this._syncToggleBtn) {
            this._syncToggleBtn.textContent = isCollapsed ? "▼" : "▲";
        }
    },

    /**
     * Rend le statut des opérations en attente.
     *
     * ⚠️ **Cette méthode rendait DEUX emplacements jusqu'au 04/08/2026** — le statut, et une
     * liste de sauvegardes. Le second est retiré avec la chaîne de sauvegarde (tâche 4.11) :
     * son magasin n'avait plus d'écrivain depuis 4.4b, donc la liste était vide par
     * construction. Le `finally` qui l'entourait — posé au S7 parce que quatre sorties
     * laissaient le libellé « chargement… » à l'écran pour de bon — disparaît avec elle : il
     * n'a plus de second emplacement à sauver.
     */
    async updateStatus(this: SyncManagerThis) {
        await this._renderSyncStatus();
    },

    async _renderSyncStatus(this: SyncManagerThis) {
        const POISyncHandler = getPoiSyncHandler();
        if (!POISyncHandler) {
            if (this._syncStatusEl) {
                DOMSecurity.clearElementFast(this._syncStatusEl);
                const p = document.createElement("p");
                p.className = "gl-cache-sync__placeholder";
                p.textContent = t("storage.sync.unavailable");
                this._syncStatusEl.appendChild(p);
            }
            return;
        }

        try {
            const summary = await POISyncHandler.getSyncSummary?.();
            if (!summary) return;

            if (summary.total === 0) {
                if (this._syncStatusEl) {
                    DOMSecurity.clearElementFast(this._syncStatusEl);
                    const p = document.createElement("p");
                    p.className = "gl-cache-sync__placeholder";
                    p.textContent = `✅ ${t("storage.sync.upToDate")}`;
                    this._syncStatusEl.appendChild(p);
                }
                if (this._syncMessageEl) this._syncMessageEl.style.display = "none";
                if (this._syncBtn) this._syncBtn.disabled = true;
            } else {
                if (this._syncStatusEl) {
                    DOMSecurity.clearElementFast(this._syncStatusEl);

                    const summaryBox = document.createElement("div");
                    summaryBox.className = "gl-cache-sync__summary";

                    const summaryTitle = document.createElement("p");
                    summaryTitle.className = "gl-cache-sync__summary-title";
                    summaryTitle.textContent = `📋 ${t("storage.sync.pending.title")}`;
                    summaryBox.appendChild(summaryTitle);

                    const summaryList = document.createElement("ul");
                    summaryList.className = "gl-cache-sync__summary-list";

                    if (summary.add > 0) {
                        const li = document.createElement("li");
                        const strong = document.createElement("strong");
                        strong.textContent = String(summary.add);
                        li.appendChild(strong);
                        li.appendChild(
                            document.createTextNode(` ${t("storage.sync.pending.add")}`)
                        );
                        summaryList.appendChild(li);
                    }
                    if (summary.update > 0) {
                        const li = document.createElement("li");
                        const strong = document.createElement("strong");
                        strong.textContent = String(summary.update);
                        li.appendChild(strong);
                        li.appendChild(
                            document.createTextNode(` ${t("storage.sync.pending.update")}`)
                        );
                        summaryList.appendChild(li);
                    }
                    if (summary.delete > 0) {
                        const li = document.createElement("li");
                        const strong = document.createElement("strong");
                        strong.textContent = String(summary.delete);
                        li.appendChild(strong);
                        li.appendChild(
                            document.createTextNode(` ${t("storage.sync.pending.delete")}`)
                        );
                        summaryList.appendChild(li);
                    }

                    summaryBox.appendChild(summaryList);
                    this._syncStatusEl.appendChild(summaryBox);
                }

                if (this._syncMessageEl) {
                    DOMSecurity.clearElementFast(this._syncMessageEl);

                    const warningP = document.createElement("p");
                    warningP.className = "gl-cache-sync__warning";

                    const clauses: string[] = [];
                    if (summary.add > 0)
                        clauses.push(`${summary.add} ${t("storage.sync.pending.add")}`);
                    if (summary.update > 0)
                        clauses.push(`${summary.update} ${t("storage.sync.pending.update")}`);
                    if (summary.delete > 0)
                        clauses.push(`${summary.delete} ${t("storage.sync.pending.delete")}`);

                    warningP.textContent =
                        `⚠️ ${t("storage.sync.warn.intro")} ${clauses.join(", ")} ` +
                        t("storage.sync.warn.outro");
                    this._syncMessageEl.appendChild(warningP);
                    this._syncMessageEl.style.display = "block";
                }
                if (this._syncBtn) this._syncBtn.disabled = false;
            }
        } catch (error) {
            if (Log) Log.error("[SyncManager] Failed to update sync status:", error);
            if (this._syncStatusEl) {
                DOMSecurity.clearElementFast(this._syncStatusEl);
                const errorP = document.createElement("p");
                errorP.className = "gl-cache-sync__placeholder gl-cache-sync__placeholder--error";
                errorP.textContent = `❌ ${t("storage.sync.loadError")}`;
                this._syncStatusEl.appendChild(errorP);
            }
        }
    },

    /**
     * Runs the queue against the server.
     *
     * ⚠️ PLUGINS S7 — the three guards below (`POISyncHandler` absent, offline,
     * empty queue) used to return SILENTLY here, while the Export tab's own
     * `handleSyncWithServer()` told the user why nothing happened. That second
     * implementation is gone and this one absorbed its guards; dropping them
     * would have been a regression for the user, not a simplification.
     */
    async handleSync(this: SyncManagerThis) {
        const POISyncHandler = getPoiSyncHandler();
        if (!POISyncHandler) {
            getUINotifications()?.error(t("storage.notif.sync.unavailable"), 5000);
            return;
        }

        if (!navigator.onLine) {
            getUINotifications()?.warning(t("storage.notif.sync.offline"), 4000);
            return;
        }

        const summary = await POISyncHandler.getSyncSummary?.();
        if (!summary || summary.total === 0) {
            getUINotifications()?.info?.(t("storage.notif.sync.empty"), 3000);
            return;
        }

        const ok = await confirmDialog({
            message: t("storage.confirm.sync.message"),
            confirmLabel: t("storage.btn.confirm"),
            cancelLabel: t("storage.btn.cancel"),
            destructive: false,
        });
        if (!ok) return;

        const notif = getUINotifications();

        try {
            if (this._syncBtn) {
                this._syncBtn.disabled = true;
                const textEl = this._syncBtn.querySelector(".gl-btn__text");
                if (textEl) textEl.textContent = t("storage.sync.btn.running");
            }

            const results = await POISyncHandler.processSyncQueue?.();
            if (Log) Log.info("[SyncManager] Sync completed:", results);

            const synced = results?.synced ?? 0;
            const failed = results?.failed ?? 0;
            const skipped = (results as { skipped?: number } | undefined)?.skipped ?? 0;

            if (failed > 0) {
                notif?.warning?.(
                    `${t("storage.notif.sync.done")} — ✅ ${synced} / ❌ ${failed} / ⏩ ${skipped}`,
                    6000
                );
            } else {
                notif?.success?.(`${t("storage.notif.sync.done")} (${synced})`, 4000);
            }

            await this.updateStatus();
            document.dispatchEvent(new CustomEvent("geoleaf:poi:synced", { detail: results }));

            // Lets the host refresh what IT shows about the queue (POI count,
            // export actions). Called after `updateStatus()` so a host that
            // re-renders us does so against an already-settled queue.
            this._onSynced?.();
        } catch (error) {
            if (Log) Log.error("[SyncManager] Sync failed:", error);
            notif?.error?.(`${t("storage.notif.sync.error")} : ${(error as Error).message}`, 5000);
        } finally {
            if (this._syncBtn) {
                this._syncBtn.disabled = false;
                const textEl = this._syncBtn.querySelector(".gl-btn__text");
                if (textEl) textEl.textContent = t("storage.sync.btn");
            }
        }
    },
};

if (Log) Log.debug("[SyncManager] Module loaded");

export { SyncManager };
