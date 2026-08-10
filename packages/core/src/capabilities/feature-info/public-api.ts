/*!
 * GeoLeaf Core (feature-info capability) — Public API facade
 * © 2026 Mattieu Pottier — MIT License
 *
 * Façade only: exposes the plugin's public surface (INV-FACADE). All methods
 * delegate to internal modules — no business logic here.
 * https://geoleaf.dev
 */
import { closePopup, handleClick } from "./surfaces/popup.js";
import { openSidePanel, closeSidePanel } from "./surfaces/sidepanel.js";
import { getLayerBinding } from "./convert.js";
import { getFeatureInfoConfig } from "./config.js";
import type { FeatureInfoLayerBinding, FeatureInfoPublicApi } from "./types.js";

/** Builds the object mounted on `GeoLeaf.FeatureInfo`. */
export function buildPublicApi(): FeatureInfoPublicApi {
    return {
        isEnabled(): boolean {
            return getFeatureInfoConfig().enabled;
        },

        /** Closes both the popup and the side-panel if open. */
        close(): void {
            closePopup();
            closeSidePanel();
        },

        openPopup(detail, layout): void {
            if (!getFeatureInfoConfig().enabled) return;
            handleClick(detail, layout);
        },

        openSidePanel(detail, layout): void {
            if (!getFeatureInfoConfig().enabled) return;
            openSidePanel(detail, layout);
        },

        getConfig(layerId): FeatureInfoLayerBinding | null {
            return getLayerBinding(layerId);
        },
    };
}
