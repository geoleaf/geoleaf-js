/*!
 * @geoleaf-plugins/routing — Numbering the stops on the map
 *
 * Asks the core's `labels` capability to draw `properties.step`, when the host has it.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * ## 🛑 The arbitration this file did NOT need
 *
 * A question sat open on this feature for three days — Q-01 — asking whether numbering the stops
 * required widening the map adapter's layer contract or opening a public seam on the `labels`
 * capability. Both would have made "the one lot that touches the core" mean something larger than
 * the sprint announced, and the choice was escalated as an architecture decision.
 *
 * **The premise was wrong.** The seam is already open, and has been:
 *
 * - `GeoLeaf.Labels.enableLabels(layerId, config)` is public — it comes from `LabelsApi`, which
 *   `LabelsPublicApi` is composed with;
 * - the renderer draws `["get", labelConfig.labelId]`, so the property to display travels in the
 *   config the caller passes;
 * - and `_hasConfigLabel` asks for exactly two keys, `enabled` and `labelId`, falling back to a
 *   complete default style for everything else.
 *
 * ⚠️ **What made the question look hard was reading `public-api.ts` alone.** That file adds only
 * `isEnabled` and `getConfig`; the surface it exposes lives in the type it is composed with, one
 * file over. A seam can be open and still look shut to a reader who stops at the façade — which is
 * an argument for measuring an API by calling it, not by reading the file that mounts it.
 *
 * ## Why this is a seam and not a dependency
 *
 * Same reasoning as the geocoding seam next door: `labels` is a core capability a profile may
 * disable, so it is read off the namespace at CALL time. A route still draws without it — the
 * stops simply carry no number, which is the state this package shipped in until now.
 */

/** The slice of the labels capability this uses. */
interface LabelsSeam {
    enableLabels(layerId: string, config: Record<string, unknown>, showImmediately?: boolean): void;
    disableLabels(layerId: string): void;
}

/**
 * The property the stop features carry, written by `routeFeatures`.
 *
 * ⚠️ Named here as a constant rather than inlined, because it is one half of a pair: the other is
 * `step: i + 1` in `publish.ts`. Two string literals in two files that must agree, and nothing
 * would catch them drifting apart — a renamed property would simply stop labelling, silently.
 */
const STEP_PROPERTY = "step";

/**
 * The labels seam, or `undefined` when the host has no `labels` capability.
 *
 * @returns The seam when both methods are callable.
 */
function seam(): LabelsSeam | undefined {
    const l = (globalThis as { GeoLeaf?: { Labels?: Partial<LabelsSeam> } }).GeoLeaf?.Labels;
    return typeof l?.enableLabels === "function" && typeof l.disableLabels === "function"
        ? (l as LabelsSeam)
        : undefined;
}

/**
 * Numbers the stops of the route drawn in `layerId`.
 *
 * @param layerId The layer the geometry was published into.
 * @returns `true` when the capability was asked. `false` means the host has no `labels` — not a
 *          failure, and not something to report: a route without numbers is what this package drew
 *          before the numbers existed.
 */
export function showStepLabels(layerId: string): boolean {
    const l = seam();
    if (!l) return false;
    // `showImmediately` is `true`: the numbers exist to be read at the moment the route appears,
    // and a label the user must switch on is a label they will not find.
    l.enableLabels(layerId, { enabled: true, labelId: STEP_PROPERTY }, true);
    return true;
}

/**
 * Removes the numbering from `layerId`.
 *
 * Paired with `clearRoute` for the same reason the attribution is: numbers left behind after the
 * geometry that carried them label nothing, and an empty layer with a legend is harder to explain
 * than an empty layer.
 *
 * @param layerId The layer.
 */
export function hideStepLabels(layerId: string): void {
    seam()?.disableLabels(layerId);
}
