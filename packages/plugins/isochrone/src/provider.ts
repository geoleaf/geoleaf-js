/*!
 * @geoleaf-plugins/isochrone — Provider registry and factory
 *
 * The seam every routing engine plugs into: one registry, and one place where an address is
 * accepted or refused. Decalqued from `@geoleaf-plugins/routing`, including its refusal of
 * anything that is not `https://` and of a provider that credits nothing.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import { Log } from "@geoleaf/host-runtime";
import type { IIsochroneProvider, IsochroneProviderFactory } from "./model.js";
import { getPluginConfig, type PluginConfig } from "./config.js";
import { getOverrides } from "./runtime-overrides.js";
import { parseEndpoint } from "./request-url.js";

/**
 * The registered providers, by id.
 *
 * ⚠️ **Populated by `providers/builtins.js`, a side-effect import of `entry.ts`** — not by this
 * file. It stays empty in a test that imports only this module, which is what lets the "no
 * provider registered" case be exercised at all.
 */
const ADAPTERS = new Map<string, IsochroneProviderFactory>();

/** The address used when a known provider is selected without one. */
const DEFAULT_ENDPOINTS: Readonly<Record<string, string>> = {
    valhalla: "https://valhalla1.openstreetmap.de",
};

/** What `getProvider()` answers: who computes, and what their data owes. */
export interface ProviderIdentity {
    /** The provider's stable identifier. */
    readonly id: string;
    /** The credit its data requires, ready to display. Never empty — an empty one is refused. */
    readonly attribution: string;
}

/**
 * Registers a routing engine under `id`.
 *
 * Registering twice under one id replaces the first: an integrator overriding the built-in
 * with their own instance is the reason the door exists.
 *
 * @param id Provider identifier, matched against `modules.isochrone.provider`.
 * @param factory Builds the provider for a resolved address.
 */
export function registerProvider(id: string, factory: IsochroneProviderFactory): void {
    ADAPTERS.set(id, factory);
}

/**
 * Resolves the address the next computation would call, or refuses it.
 *
 * Three sources, in this order: the one given at runtime through `configure()`, the one the
 * profile declares, the provider's own default.
 *
 * 🛑 **An address that is refused is never replaced by the next source.** A profile declaring
 * `http://…` gets no engine at all, not the default one: a silent fallback would hide the
 * refusal behind a computation that works — against an engine nobody chose.
 *
 * @param config The merged plugin configuration.
 * @returns The address to use, or `null` when the one that applies is refused or absent.
 */
export function resolveEndpoint(config: PluginConfig): string | null {
    const runtime = getOverrides()?.endpoint;
    const declared = runtime ?? (config.endpoint !== "" ? config.endpoint : undefined);
    if (declared !== undefined) return parseEndpoint(declared) === null ? null : declared;
    return DEFAULT_ENDPOINTS[config.provider] ?? null;
}

/**
 * Creates the provider a configuration asks for.
 *
 * Answers `null` — rather than falling back to another engine — when the provider is unknown,
 * when its address is refused, or when it declares no credit.
 *
 * @param config The merged plugin configuration. Defaults to the live one.
 * @returns The provider, or `null` with nothing substituted.
 */
export function createProvider(
    config: PluginConfig = getPluginConfig()
): IIsochroneProvider | null {
    const factory = ADAPTERS.get(config.provider);
    if (!factory) return null;

    const endpoint = resolveEndpoint(config);
    if (endpoint === null) return null;

    const provider = factory(endpoint, {
        query: getOverrides()?.query ?? {},
        timeoutMs: config.timeoutMs,
    });

    // 🛑 A provider with no credit is REFUSED, exactly like an address that is not HTTPS. The
    // built-in engine routes on OpenStreetMap, whose licence requires attribution wherever the
    // derived work is shown. ⚠️ Refused rather than given a default credit: inventing one for
    // an unknown engine would attribute data to a source that may not have produced it.
    if (typeof provider?.attribution !== "string" || provider.attribution.trim() === "") {
        Log.warn(
            `[isochrone] provider "${config.provider}" declares no attribution — refused. ` +
                "Routed data almost always carries a licence obligation; declare it on the " +
                "provider rather than leaving it to whoever ships the map."
        );
        return null;
    }

    return provider;
}

/**
 * The identity of the provider the next computation would use, and the credit its data owes.
 *
 * @param config The merged plugin configuration. Defaults to the live one.
 * @returns The identity, or `null` when no usable provider resolves — same refusals as
 *          `createProvider`, and for the same reasons.
 */
export function getProvider(config: PluginConfig = getPluginConfig()): ProviderIdentity | null {
    const provider = createProvider(config);
    return provider ? { id: provider.id, attribution: provider.attribution } : null;
}
