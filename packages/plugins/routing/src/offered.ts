/*!
 * @geoleaf-plugins/routing — Whether the plugin is offered at all
 *
 * The toolbar slot and the hostable pane are registered before the profile is merged — this
 * plugin loads EAGER —, so neither can read the profile when it registers. The kernel reads this
 * predicate at render instead (`isAvailable()`), and `openPanel` reads it too.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { coreConfigGet, getGeoLeaf } from "@geoleaf/host-runtime";

import { getPluginConfig } from "./config.js";

/** Fallback of `modules.routing.layerId`, as `publish.ts` resolves it. */
const DEFAULT_LAYER_ID = "routing-route";

/**
 * Whether routing may be offered: switched on, and the profile declares the layer it draws into.
 *
 * 🛑 **Two refusals, both measured.** `modules.routing.enabled: false` switched nothing off: the
 * slot and the panel stayed, and a route computed. And a profile without the route layer offered
 * the slot, let the route compute, then said the profile declared no layer to draw it into —
 * a refusal only reachable by doing the whole gesture first.
 *
 * ⚠️ The layer is looked up in the profile's DECLARED layers, not in the loaded store: the toolbar
 * is built before every layer has loaded. With no declared list to read (no profile yet, a host
 * without `Config`), the answer is « offered » — unknown is not absent.
 *
 * @returns `false` when the profile switches routing off or lacks its route layer.
 */
export function isRoutingOffered(): boolean {
    if (coreConfigGet<boolean>("modules.routing.enabled", true) === false) return false;
    const config = getGeoLeaf()?.Config as
        { getActiveProfile?(): { layers?: unknown } | null } | undefined;
    const layers = config?.getActiveProfile?.()?.layers;
    if (!Array.isArray(layers) || layers.length === 0) return true;
    const wanted = getPluginConfig().layerId || DEFAULT_LAYER_ID;
    return layers.some((l) => (l as { id?: unknown } | null)?.id === wanted);
}
