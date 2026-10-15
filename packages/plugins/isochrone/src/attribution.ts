/*!
 * @geoleaf-plugins/isochrone — Data credit
 *
 * Shows the credit the zones' data owes, on the map, for as long as a zone is displayed.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import type { IsochroneMap } from "./map-binding.js";
import type { IsochroneLayer } from "./model.js";

/** Class of the credit element — styled by the plugin's stylesheet. */
const CREDIT_CLASS = "gl-isochrone-attribution";

/**
 * The credit element, written in the map's container.
 *
 * ⚠️ The adapter's own `attribution` option of a layer is not used: no adapter reads it for a
 * GeoJSON layer, so the credit would never show. The element goes in the container the adapter
 * hands out — no access to the engine's native map is needed.
 */
export class AttributionNote {
    private element: HTMLElement | null = null;

    /**
     * Writes the credits of the zones displayed, or takes the element away when there is none.
     *
     * Two engines with two credits show both, each once, joined by « · ».
     *
     * @param map The adapter.
     * @param layers The zones of the stack.
     */
    sync(map: IsochroneMap, layers: readonly IsochroneLayer[]): void {
        const credits = [...new Set(layers.map((l) => l.attribution))];
        if (credits.length === 0) {
            this.clear();
            return;
        }
        const container = map.getContainer();
        if (!this.element || this.element.parentElement !== container) {
            this.element?.remove();
            this.element = document.createElement("div");
            this.element.className = CREDIT_CLASS;
            container.append(this.element);
        }
        // `textContent`, never markup: a credit comes from a provider an integrator registered.
        this.element.textContent = credits.join(" · ");
    }

    /** Takes the element away. */
    clear(): void {
        this.element?.remove();
        this.element = null;
    }
}
