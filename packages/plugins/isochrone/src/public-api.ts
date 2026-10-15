/*!
 * @geoleaf-plugins/isochrone — Public API facade
 * © 2026 Mattieu Pottier — MIT License
 *
 * Façade only: exposes the plugin's public surface (INV-FACADE). Methods are
 * thin wrappers that delegate to internal modules — no business logic here.
 * https://geoleaf.dev
 */

import { getPluginConfig, type PluginConfig } from "./config.js";
import {
    clearLayers,
    computeIsochrone,
    listLayers,
    moveLayer,
    removeLayer,
    showLayer,
    styleLayer,
} from "./controller.js";
import { closeIsochrone, openIsochrone } from "./isochrone-api.js";
import type {
    ComputeOptions,
    ComputeResult,
    IsochroneLayer,
    IsochroneProviderFactory,
    LayerStyle,
    RuntimeOverrides,
} from "./model.js";
import { getProvider, registerProvider, type ProviderIdentity } from "./provider.js";
import { setOverrides } from "./runtime-overrides.js";

/** The object mounted on `GeoLeaf.Isochrone`. */
export interface IsochronePublicApi {
    /** The merged and validated `modules.isochrone` configuration. */
    getConfig(): PluginConfig;
    /**
     * Gives the engine's address and the query parameters every request must carry, for the
     * computations that follow. This is the door a key comes through: a profile is a served
     * file, so a key is never written in one.
     *
     * Replaces the previous settings WHOLE; `null` clears them. Validated whole or refused
     * whole: an address that is not `https://`, that cannot be read or that carries
     * credentials, a parameter that is not a string, and a parameter named `json` — reserved
     * for the question — are refused, and then nothing is applied. A refusal is logged with the
     * name of the field, never with its value.
     *
     * The settings survive an unmount of the application. They do not survive a reload.
     *
     * @returns `true` once applied, `false` when refused.
     */
    configure(overrides: RuntimeOverrides | null): boolean;
    /**
     * Registers a routing engine under `id`, so an integrator can plug one this package does
     * not know. Registering twice under one id replaces the first.
     */
    registerProvider(id: string, factory: IsochroneProviderFactory): void;
    /**
     * The identity of the engine the next computation would use, and the credit its data owes.
     *
     * @returns `null` when no usable engine resolves: an unknown `provider`, an address that
     *   is refused, or a provider that declares no credit. Nothing is ever substituted.
     */
    getProvider(): ProviderIdentity | null;
    /**
     * Opens the plugin's window, over the map, and closes the other floating tools'. Opening it
     * again keeps the one already open.
     *
     * @param anchor An element to place the window beside — the toolbar button, typically.
     *   Without one, the window keeps the place it had, or its default one.
     * @returns `false` when the profile switched the plugin off, `true` once it is open.
     */
    open(anchor?: Element): boolean;
    /**
     * Closes the window, and leaves the picking of a point if it was armed. The zones stay on
     * the map. Calling it when the window is not open does nothing.
     */
    close(): void;
    /**
     * Computes the zones reachable from a point, and draws them on top of the stack — the same
     * path as a point placed on the map, without the click.
     *
     * One zone per duration, the shortest on top, each in the first colour of the palette no
     * zone wears. All or nothing: no zone is drawn unless the engine answered every duration.
     *
     * Refused before any request, in this order: `invalid` (an origin that is not a position,
     * an unknown mode, no duration, one that is not a whole positive number of minutes),
     * `no-map`, `no-engine`, `busy`, `too-long` (a duration beyond what the provider declares,
     * carried as `limit`), `cap-reached` (more zones than `maxLayers`, carried as `limit`).
     * Then the engine's own reasons — `http` with its `status` and `code`, `timeout`,
     * `network`, `malformed` — and `aborted` when the plugin is torn down meanwhile.
     *
     * @param options Origin `[lon, lat]`; the mode and the durations default to the profile's.
     * @returns The identifiers of the zones drawn, top first, or the reason none was.
     *
     * @example
     * ```ts
     * const result = await GeoLeaf.Isochrone.compute({ origin: [55.45, -20.88], minutes: [10] });
     * if (!result.ok) console.warn(result.reason);
     * ```
     */
    compute(options: ComputeOptions): Promise<ComputeResult>;
    /**
     * A snapshot of the stack, top first — the order the zones are drawn in, the top one
     * above.
     *
     * @returns Copies: changing them changes nothing.
     */
    getLayers(): IsochroneLayer[];
    /**
     * Changes a zone's colour or the opacity of its fill. The outline stays opaque.
     *
     * @param id The zone's identifier.
     * @param style `color` as `#rrggbb`, `opacity` from 0 to 1; an absent member is kept.
     * @returns `false` for an unknown id or a value refused — and then nothing changes.
     */
    setLayerStyle(id: string, style: LayerStyle): boolean;
    /**
     * Hides or shows a zone. A hidden zone keeps its place in the stack.
     *
     * @returns `false` for an unknown id.
     */
    setLayerVisible(id: string, visible: boolean): boolean;
    /**
     * Moves a zone to a row of the stack, `0` being the top. The map follows, without asking
     * the engine again.
     *
     * @returns `false` for an unknown id or a row outside the stack.
     */
    moveLayer(id: string, toIndex: number): boolean;
    /**
     * Removes a zone. Its origin's marker goes with the last zone of that origin, the credit
     * with the last zone of all.
     *
     * @returns `false` for an unknown id.
     */
    removeLayer(id: string): boolean;
    /** Removes every zone, the markers and the credit. */
    clear(): void;
}

/**
 * Builds the object mounted on `GeoLeaf.Isochrone`.
 *
 * Facade methods delegate; they never hold logic (`check-facade-purity`).
 *
 * @returns The plugin's public surface.
 */
export function buildPublicApi(): IsochronePublicApi {
    return {
        getConfig: (): PluginConfig => getPluginConfig(),
        configure: (overrides: RuntimeOverrides | null): boolean => setOverrides(overrides),
        registerProvider: (id: string, factory: IsochroneProviderFactory): void =>
            registerProvider(id, factory),
        getProvider: (): ProviderIdentity | null => getProvider(),
        open: (anchor?: Element): boolean => openIsochrone(anchor),
        close: (): void => closeIsochrone(),
        compute: (options: ComputeOptions): Promise<ComputeResult> => computeIsochrone(options),
        getLayers: (): IsochroneLayer[] => listLayers(),
        setLayerStyle: (id: string, style: LayerStyle): boolean => styleLayer(id, style),
        setLayerVisible: (id: string, visible: boolean): boolean => showLayer(id, visible),
        moveLayer: (id: string, toIndex: number): boolean => moveLayer(id, toIndex),
        removeLayer: (id: string): boolean => removeLayer(id),
        clear: (): void => clearLayers(),
    };
}
