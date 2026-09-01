/*!
 * @geoleaf-plugins/routing — Data attribution
 *
 * The credit the routing data requires, on screen for as long as the route is.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { getNativeMap } from "@geoleaf/host-runtime";

/**
 * ## 🛑 This is a licence obligation, not an interface feature
 *
 * Both built-in engines route on OpenStreetMap. Its ODbL permits commercial use and does not
 * require sharing anything back for a route drawn on a map — but it does require **attribution**,
 * wherever the derived work is shown. A map that displays a computed itinerary without crediting
 * the data is not a map missing a nicety; it is a map out of compliance.
 *
 * ⚠️ **And the person who bears that is the integrator, not this package.** They ship the map.
 * That is why the credit is mounted by the plugin itself rather than documented as something to
 * remember: a compliance step an integrator must perform is a compliance step some integrator
 * will not perform, and they will not know.
 *
 * ## Why it is tied to the ROUTE and not to the panel
 *
 * The itinerary panel closes; the drawn route stays. Crediting from the panel would put the notice
 * on screen exactly while someone is looking at the controls, and take it away while they look at
 * the thing that needs crediting.
 *
 * ## Why the plugin draws its own rather than using the map's attribution control
 *
 * The engine's own control renders what its SOURCES declare, and the seam this plugin publishes
 * through — `GeoLeaf.Layers.setData` — carries features, not source metadata. Reaching past it to
 * the native map would make the plugin the second thing writing to the map's sources, which is the
 * arrangement `publish.ts` exists to avoid. The cost is one small element; the alternative is a
 * rendering path the core owns.
 */

/** The mounted credit, for as long as a route is drawn. */
export interface RouteAttribution {
    /** Removes it. Idempotent. */
    remove(): void;
}

/** The map surface this needs. */
interface ContainerCapableMap {
    getContainer(): HTMLElement;
}

/** The one credit a page may show. Mounting twice replaces rather than stacks. */
let mounted: { element: HTMLElement; text: string } | null = null;

/**
 * Shows `text` as the routing data credit, replacing any previous one.
 *
 * @param text The credit, from `RouteResult.attribution`. An empty or blank string removes the
 *             notice instead of showing an empty box — but note that a provider cannot supply one:
 *             `createProvider` refuses an engine with no attribution, so a blank here means a
 *             route built by something other than this plugin's own path.
 * @returns The mounted credit. Every method is safe when no map was available.
 */
export function showRouteAttribution(text: string): RouteAttribution {
    const clean = (text ?? "").trim();
    if (mounted && mounted.text === clean) return { remove: removeRouteAttribution };

    removeRouteAttribution();
    if (clean === "") return { remove: removeRouteAttribution };

    const container = getNativeMap<ContainerCapableMap>()?.getContainer?.();
    // No map, no notice — and no throw. A headless caller computing a route for an export is not
    // showing it to anyone, so there is nothing to credit on screen; failing here would break the
    // computation over a display concern.
    if (!container) return { remove: removeRouteAttribution };

    const element = document.createElement("div");
    element.className = "gl-routing-attribution";
    // A credit is not an interactive control and must not be announced as one, but it must be
    // readable by a screen reader in document order like any other text — so no `aria-hidden`.
    // `textContent`, never `innerHTML`: a custom provider supplies this string, and it is not this
    // module's business to decide whether the integrator's markup is safe.
    element.textContent = clean;

    container.append(element);
    mounted = { element, text: clean };
    return { remove: removeRouteAttribution };
}

/**
 * Removes the credit, if one is shown.
 *
 * ⚠️ Called by `clearRoute`, and that pairing is the whole point: a credit outliving the route it
 * credits attributes data nobody is looking at, which is a different false statement from omitting
 * it — and a harder one to notice.
 */
export function removeRouteAttribution(): void {
    mounted?.element.remove();
    mounted = null;
}

/**
 * The credit currently on screen, or `null`.
 *
 * Exists so a test can assert the pairing without reaching into the DOM by class name, which would
 * pin the markup rather than the behaviour.
 *
 * @returns The text, or `null` when nothing is shown.
 */
export function currentRouteAttribution(): string | null {
    return mounted ? mounted.text : null;
}
