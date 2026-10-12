/*!
 * @geoleaf-plugins/isochrone — Public API facade
 * © 2026 Mattieu Pottier — MIT License
 *
 * Façade only: exposes the plugin's public surface (INV-FACADE). Methods are
 * thin wrappers that delegate to internal modules — no business logic here.
 * https://geoleaf.dev
 */

import { getPluginConfig, type PluginConfig } from "./config.js";
import { closeIsochrone, openIsochrone } from "./isochrone-api.js";
import type { IsochroneProviderFactory, RuntimeOverrides } from "./model.js";
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
     * Opens the plugin.
     *
     * @returns `false` when the profile switched the plugin off, `true` once it is open.
     */
    open(): boolean;
    /** Closes the plugin. Calling it when the plugin is not open does nothing. */
    close(): void;
}

/**
 * Builds the object mounted on `GeoLeaf.Isochrone`.
 *
 * ⚠️ No `compute()` member YET: a zone is nothing without the stack it lands in, and a method
 * advertised before what it feeds exists would answer something nobody can display. Facade
 * methods delegate; they never hold logic (`check-facade-purity`).
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
        open: (): boolean => openIsochrone(),
        close: (): void => closeIsochrone(),
    };
}
