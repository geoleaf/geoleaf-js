/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Basemap Selector module for LayerManager
 * Handles the basemap selector
 *
 * DEPENDENCIES:
 * - GeoLeaf.Log (optional)
 * - GeoLeaf.Baselayers (optional, for getActiveId and setBaseLayer)
 *
 * EXPOSE:
 * - GeoLeaf._LayerManagerBasemapSelector
 */

import { Log } from "../../utils/log/index.js";
import { Baselayers } from "../../api/geoleaf.baselayers.js";
import { domCreate } from "../../utils/general/dom-helpers.js";
import { getLabel } from "../../utils/i18n/i18n.js";
import { registerLifecycleTeardown } from "../shared/lifecycle.js";

interface BasemapSectionItem {
    id: string;
    label?: string;
}

/**
 * The basemap block of a layer-manager panel, as the selector renders it.
 *
 * `items` is optional: a section without entries renders nothing rather than an empty select.
 */
export interface BasemapSection {
    /** The basemaps offered, in display order. */
    items?: BasemapSectionItem[];
}

interface BasemapSelectorInstance {
    _externalHandler?: (e: CustomEvent<{ key?: string }>) => void;
    render(section: BasemapSection, sectionEl: HTMLElement): void;
    _attachChangeHandler(select: HTMLSelectElement): void;
    _attachExternalListener(select: HTMLSelectElement): void;
    destroy(): void;
}

const _LayerManagerBasemapSelector: BasemapSelectorInstance = {
    render(section: BasemapSection, sectionEl: HTMLElement) {
        if (!section || !sectionEl) return;

        const container = domCreate(
            "div",
            "gl-layer-manager__items gl-layer-manager__basemap-select",
            sectionEl
        );

        const select = domCreate(
            "select",
            "gl-layer-manager__basemap-select__select",
            container
        ) as HTMLSelectElement;
        // WCAG 2.1 AA (4.1.2 Name, Role, Value): basemap <select> has no
        // associated <label>; expose an accessible name for screen readers.
        select.setAttribute("aria-label", getLabel("aria.layer.basemap_select"));

        if (Array.isArray(section.items)) {
            section.items.forEach((item) => {
                if (!item?.id) return;
                const opt = document.createElement("option");
                opt.value = item.id;
                opt.textContent = item.label || item.id;
                select.appendChild(opt);
            });
        }

        try {
            const activeKey =
                Baselayers && typeof Baselayers.getActiveKey === "function"
                    ? Baselayers.getActiveKey()
                    : null;
            if (activeKey) {
                select.value = activeKey;
            }
        } catch {
            // ignore
        }

        this._attachChangeHandler(select);
        this._attachExternalListener(select);
    },

    _attachChangeHandler(select: HTMLSelectElement) {
        const handler = (ev: Event) => {
            ev.stopPropagation();
            try {
                const val = select.value;
                if (Baselayers && typeof Baselayers.setBaseLayer === "function") {
                    Baselayers.setBaseLayer(val, {});
                }
            } catch (err) {
                if (Log) Log.warn("Error during basemap change from legend:", err);
            }
        };

        select.addEventListener("change", handler);
    },

    _attachExternalListener(select: HTMLSelectElement) {
        if (typeof document !== "undefined") {
            if (this._externalHandler) {
                document.removeEventListener(
                    "geoleaf:basemap:change",
                    this._externalHandler as EventListener
                );
            }
            this._externalHandler = (e: CustomEvent<{ key?: string }>) => {
                try {
                    if (e?.detail?.key) {
                        select.value = e.detail.key;
                    }
                } catch {
                    // ignore
                }
            };
            document.addEventListener(
                "geoleaf:basemap:change",
                this._externalHandler as EventListener
            );
        }
    },

    destroy() {
        if (this._externalHandler) {
            document.removeEventListener(
                "geoleaf:basemap:change",
                this._externalHandler as EventListener
            );
            // `delete`, not `= undefined`: "no handler" is the ABSENCE of the property, which is
            // what the `if (this._externalHandler)` guard above tests for.
            delete this._externalHandler;
        }
    },
};

const BasemapSelector = _LayerManagerBasemapSelector;

// Self-register the teardown so Core.destroy() detaches the document-level
// `geoleaf:basemap:change` listener `_attachExternalListener` installs. Mirrors
// `shared.ts` — without it, `destroy()` had no caller and every create/destroy
// cycle left one more listener on `document`.
registerLifecycleTeardown(() => BasemapSelector.destroy());

export { BasemapSelector };
