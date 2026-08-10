/*!
 * @geoleaf-plugins/offline-ui
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview UI Cache Button - Modal Manager Module
 * @description Creates and manages cache modal (structure, tabs, navigation)
 * @author GeoLeaf Team
 * @version 3.0.0
 */

import { Log } from "@geoleaf/host-runtime";
import { $create, events } from "../../utils/core-utils.js";
import { createFocusTrap } from "@geoleaf/host-runtime";
import { tLabel as t } from "@geoleaf/host-runtime";

interface ExportLogicLike {
    initializeCacheContent(): void;
    initializeExportContent(): void;
}

/**
 * Structural mirror of host-runtime's `FocusTrap`, declared LOCALLY on purpose.
 *
 * ⚠️ SHIP-SPEC (passage public S1.3): importing the type — `import { createFocusTrap, type
 * FocusTrap }` — put `FocusTrap` in the annotation of `_trap` below, so `tsc` emitted
 * `import { type FocusTrap } from "@geoleaf/host-runtime"` into the PUBLISHED
 * `packages/plugins/offline-ui/dist/types/ui/cache-button/modal-manager.d.ts`. That package is
 * `private: true` and 404 on
 * npm forever: the declaration resolved here through the workspace symlink and nowhere else.
 *
 * ⚠️ And the mechanism is NOT inference — the roadmap said it was, and looking for an
 * inferred type would have sent the reader to the wrong place. `_trap` carries an EXPLICIT
 * `as FocusTrapLike | null`; the leak came from that annotation and from the type import
 * feeding it. Two lines, both written down, neither of them inferred.
 *
 * `createFocusTrap` stays imported as a VALUE: a value import is erased from the emitted
 * declarations, so it leaks nothing. Only types reaching a declaration do.
 */
interface FocusTrapLike {
    activate(): void;
    deactivate(): void;
}
let _ExportLogic: ExportLogicLike | null = null;

/**
 * Modal Manager Module
 * Handles modal creation, opening, closing, and tab switching
 */
const ModalManager = {
    _eventCleanups: [] as (() => void)[],
    _trap: null as FocusTrapLike | null,

    _setExportLogic(ref: ExportLogicLike) {
        _ExportLogic = ref;
    },

    /**
     * Open cache modal
     */
    openModal() {
        if (Log) Log.info("[CacheButton.ModalManager] Ouverture du modal de cache");

        // Create modal if it doesn't exist
        let modal = document.getElementById("gl-cache-modal");
        if (!modal) {
            modal = this.createModal();
        }

        // Show modal
        modal.style.display = "flex";

        // Trap focus inside the modal content for keyboard/a11y (Tab cycling).
        const content = modal.querySelector<HTMLElement>(".gl-cache-modal__content");
        if (content) {
            this._trap?.deactivate();
            this._trap = createFocusTrap(content);
            this._trap.activate();
        }

        // Initialize cache content in modal (delegate to ExportLogic)
        if (_ExportLogic) {
            _ExportLogic.initializeCacheContent();
        }
    },

    /**
     * Create modal HTML structure
     * @returns {HTMLElement} Modal element
     */
    createModal() {
        const modal = $create("div", {
            id: "gl-cache-modal",
            className: "gl-cache-modal",
        });

        // Background overlay
        const overlay = $create("div", {
            className: "gl-cache-modal__overlay",
        });
        modal.appendChild(overlay);

        // Content container
        const content = $create("div", {
            className: "gl-cache-modal__content",
        });

        // Header
        const header = $create("div", {
            className: "gl-cache-modal__header",
        });

        const title = $create("h2", {
            className: "gl-cache-modal__title",
        });
        const iconSpan = $create("span", {
            style: { marginRight: "8px" },
            textContent: "💾",
        });
        title.appendChild(iconSpan);
        title.appendChild(document.createTextNode(t("storage.modal.title")));
        header.appendChild(title);

        const closeBtn = $create("button", {
            className: "gl-cache-modal__close",
            type: "button",
            textContent: "✕",
            title: t("storage.modal.close"),
            attributes: { "aria-label": t("storage.modal.close") },
            onClick: () => this.closeModal(),
        });
        header.appendChild(closeBtn);

        content.appendChild(header);

        // Navigation tabs
        const tabs = $create("div", {
            className: "gl-cache-modal__tabs",
        });

        const importTab = $create("button", {
            className: "gl-cache-modal__tab gl-cache-modal__tab--active",
            type: "button",
            textContent: t("storage.modal.tab.import"),
        });
        importTab.dataset.tab = "import";
        importTab.onclick = () => this.switchTab("import");
        tabs.appendChild(importTab);

        const exportTab = $create("button", {
            className: "gl-cache-modal__tab",
            type: "button",
            textContent: t("storage.modal.tab.export"),
        });
        exportTab.dataset.tab = "export";
        exportTab.onclick = () => this.switchTab("export");
        tabs.appendChild(exportTab);

        content.appendChild(tabs);

        // Modal body (where content will be injected)
        const body = $create("div", {
            id: "gl-cache-modal-body",
            className: "gl-cache-modal__body",
        });
        content.appendChild(body);

        modal.appendChild(content);
        document.body.appendChild(modal);

        // Close on overlay click
        overlay.onclick = () => this.closeModal();

        // Close with Escape key - avec cleanup tracking
        // events: imported from event-listener-manager.js
        if (events) {
            const cleanup = events.on(
                document,
                "keydown",
                (e: Event) => {
                    if ((e as KeyboardEvent).key === "Escape" && modal.style.display === "flex") {
                        this.closeModal();
                    }
                },
                false,
                "ModalManager.escapeKey"
            );
            if (typeof cleanup === "function") this._eventCleanups.push(cleanup);
        } else {
            // Fallback sans cleanup
            if (Log)
                Log.warn(
                    "[ModalManager] EventListenerManager not available - listener will not be cleaned up"
                );
            document.addEventListener("keydown", (e) => {
                if (e.key === "Escape" && modal.style.display === "flex") {
                    this.closeModal();
                }
            });
        }

        return modal;
    },

    /**
     * Close cache modal
     */
    closeModal() {
        this._trap?.deactivate();
        this._trap = null;
        const modal = document.getElementById("gl-cache-modal");
        if (modal) {
            modal.style.display = "none";
        }
        if (Log) Log.info("[CacheButton.ModalManager] Modal closed");
    },

    /**
     * Removes the modal from the DOM and releases its event listeners.
     */
    destroy() {
        // Cleanup event listeners
        if (this._eventCleanups && this._eventCleanups.length > 0) {
            this._eventCleanups.forEach((cleanup: () => void) => {
                if (typeof cleanup === "function") cleanup();
            });
            this._eventCleanups = [];
            if (Log) Log.info("[ModalManager] Event listeners cleaned up");
        }

        // Remove modal from DOM
        const modal = document.getElementById("gl-cache-modal");
        if (modal && modal.parentNode) {
            modal.parentNode.removeChild(modal);
        }
    },

    /**
     * Switches the active tab of the modal.
     * @param tabName - Tab name ('import' or 'export')
     */
    switchTab(tabName: string) {
        if (Log) Log.info("[CacheButton.ModalManager] Changement d'onglet:", tabName);

        const tabs = document.querySelectorAll(".gl-cache-modal__tab");
        tabs.forEach((tab: Element) => {
            const el = tab as HTMLElement;
            if (el.dataset?.tab === tabName) {
                el.classList.add("gl-cache-modal__tab--active");
            } else {
                el.classList.remove("gl-cache-modal__tab--active");
            }
        });

        // Update content (delegate to ExportLogic)
        if (!_ExportLogic) {
            if (Log) Log.error("[CacheButton.ModalManager] ExportLogic non disponible");
            return;
        }

        if (tabName === "import") {
            _ExportLogic.initializeCacheContent();
        } else if (tabName === "export") {
            _ExportLogic.initializeExportContent();
        }
    },
};

// ── ESM Export ──
export { ModalManager };

if (Log) Log.info("[CacheButton.ModalManager] Module loaded");
