/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Branding capability — runtime control.
 *
 * Displays a customisable branding text overlay on the map. Relocated verbatim
 * from `modules/built-in/ui/branding.ts` (in-core capability reclassification);
 * the only change is the config source: `modules.branding` via `getBrandingConfig()`
 * instead of the former app-global root `branding` key.
 */
"use strict";

import { Log } from "../../utils/log/index.js";
import { getLabel } from "../../utils/i18n/i18n.js";
import { domCreate } from "../../utils/general/dom-helpers.js";
import { blockMapPropagation } from "../../utils/controls/propagation-blocker.js";
import { getBrandingConfig } from "./config.js";
import { DEFAULT_BRANDING_POSITION } from "./constants.js";
import type { BrandingControl, BrandingMapLike, BrandingOptions } from "./types.js";

const CONTEXT = "[GeoLeaf.Branding]";

const Branding: BrandingControl = {
    _map: null,
    _controlHandle: null,
    _container: null,
    _cleanups: [] as (() => void)[],
    _options: {
        // Same source as the schema's advertised default and the config reader's
        // applied one (`constants.ts`) — this seed used to be a third, independent
        // copy of the literal (B.24).
        position: DEFAULT_BRANDING_POSITION,
        text: getLabel("ui.branding.default_text"),
    },

    /**
     * Initializes the branding overlay.
     * @param map - Map adapter instance
     * @param options - Configuration overrides
     */
    init(map: BrandingMapLike, options: Partial<BrandingOptions> = {}) {
        try {
            if (!map) {
                throw new Error("A map instance is required.");
            }

            this._map = map;
            this._options = Object.assign({}, this._options, options);

            // Source: modules.branding (capability config). The capability gate
            // (`modules.branding.enabled`) already decided registration — no `enabled`
            // re-check here (the lifecycle runs only when the capability is enabled).
            const cfg = getBrandingConfig();

            // Empty text → silent (configured-but-empty overlay renders nothing).
            if (cfg.text === "") {
                Log.info(`${CONTEXT} Branding text empty — nothing displayed.`);
                return;
            }

            if (cfg.text) this._options.text = cfg.text;
            if (cfg.position) this._options.position = cfg.position;

            this._createControl();

            Log.info(`${CONTEXT} Capability initialized successfully.`);
        } catch (err) {
            Log.error(`${CONTEXT} Error during initialization:`, (err as Error).message);
        }
    },

    /**
     * Creates the branding control and adds it to the map.
     * @private
     */
    _createControl() {
        try {
            // Build the container element
            const container = domCreate("div", "gl-branding");

            // Block map event propagation on this control
            this._cleanups = [];
            blockMapPropagation(container, this._cleanups);

            // Create the text display element
            const brandingElement = domCreate("div", "gl-branding__content", container);

            // SAFE: textContent prevents XSS
            brandingElement.textContent = this._options.text;

            // Store reference for direct access
            this._container = container;

            // Add to map via adapter — returns a handle with remove()
            this._controlHandle = this._map!.addControl(container, this._options.position);

            Log.info(`${CONTEXT} Branding control created and added to the map.`);
        } catch (err) {
            Log.error(`${CONTEXT} Error creating branding control:`, (err as Error).message);
        }
    },

    /**
     * Destroys the control and cleans up resources.
     */
    destroy() {
        try {
            // Run all event listener cleanups
            for (const fn of this._cleanups) fn();
            this._cleanups = [];

            // Remove control from the map
            this._controlHandle?.remove();
            this._controlHandle = null;
            this._container = null;

            Log.info(`${CONTEXT} Capability destroyed successfully.`);
        } catch (err) {
            Log.error(`${CONTEXT} Error during destruction:`, (err as Error).message);
        }
    },

    /**
     * Shows the branding control on the map.
     */
    show() {
        if (this._container) {
            this._container.style.display = "";
        }
    },

    /**
     * Hides the branding control from the map.
     */
    hide() {
        if (this._container) {
            this._container.style.display = "none";
        }
    },

    /**
     * Updates the branding text.
     * @param text - New text to display
     */
    setText(text: string) {
        if (this._container) {
            const brandingElement = this._container.querySelector(".gl-branding__content");

            if (brandingElement) {
                // SAFE: textContent prevents XSS
                brandingElement.textContent = text;
            }
        }
    },
};

// ── ESM Export ──
export { Branding };
