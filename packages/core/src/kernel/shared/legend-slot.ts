/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * The legend slot — what the kernel asks of a legend, when the bundle embarks one.
 *
 * The style selector and the theme applier keep the legend in step with a layer's style and
 * visibility. They used to import the legend capability for it, statically: two kernel → capability
 * edges that pinned the whole capability into the eager closure of every bundle, whatever the
 * entry's manifest said. The dependency is inverted here, as `app/boot-modules/shared.module.ts`
 * inverted it for the app-global lifecycles: the kernel owns this slot, the legend capability's
 * installer fills it (`capabilities/legend/install.ts`, at `registerGlobals`), and a bundle without
 * a legend leaves it empty — the kernel then has nothing to keep in step, and says nothing.
 *
 * The ESLint boundary `KERNEL_CAPABILITY_BOUNDARY` (`eslint.config.mjs`) refuses a new edge.
 *
 * Lives in `kernel/shared/` because the capability fills it: R.8 forbids `capabilities/**` a deep
 * import under `kernel/**`, and `provideLegend` passes the mediation barrel; the kernel callers
 * import this file directly.
 */

import type { LegendLayerConfig } from "../../contracts/legend.contract.js";

/** What the kernel calls on the legend. */
export interface LegendSink {
    /** `true` once the legend is initialised — a call before would land nowhere. */
    isAvailable(): boolean;
    /** Loads and shows the legend of a layer, for one of its styles. */
    loadLayerLegend(
        layerId: string | undefined,
        styleId: string | undefined,
        layerConfig: LegendLayerConfig
    ): void;
    /** Shows or hides a layer's entry. */
    setLayerVisibility(layerId: string, visible: boolean | undefined): void;
}

let _sink: LegendSink | null = null;

/**
 * Fills the slot — the legend capability's installer does, when the bundle embarks it.
 *
 * @param sink - The legend's side of the slot, or `null` to empty it.
 */
export function provideLegend(sink: LegendSink | null): void {
    _sink = sink;
}

/**
 * The legend, when one is embarked and initialised — else `null`, and the caller has nothing to
 * keep in step.
 *
 * @returns The sink, or `null`.
 */
export function availableLegend(): LegendSink | null {
    return _sink && _sink.isAvailable() ? _sink : null;
}
