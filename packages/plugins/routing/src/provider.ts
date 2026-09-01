/*!
 * @geoleaf-plugins/routing — Provider contract and factory
 *
 * The seam every routing engine plugs into: one interface, one registry, and one place where an
 * endpoint is accepted or refused. Decalqued from `@geoleaf-plugins/geocoding`, including its
 * refusal of anything that is not `https://`.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { Log } from "@geoleaf/host-runtime";
import type { IRouteProvider, RouteProviderFactory } from "./model.js";
import { getPluginConfig, type PluginConfig } from "./config.js";

// The contract itself lives in `model.ts` — pure types, no runtime dependency. Re-exported here
// because this is where a caller looking for the factory will look for it too.
export type { IRouteProvider, RouteProviderFactory } from "./model.js";

/**
 * The registered adapters, by provider id.
 *
 * ⚠️ **Populated by `providers/builtins.js`, a side-effect import of `entry.ts`** — not by this
 * file, and not by anything the host has to remember to call. A plugin whose built-ins only work
 * once someone reads the README has a configuration that silently does nothing.
 *
 * It stays empty in a test that imports only this module, which is what lets the "no adapter
 * registered" case be exercised at all.
 */
const ADAPTERS = new Map<string, RouteProviderFactory>();

/** The endpoint used when a known provider is selected without one. */
const DEFAULT_ENDPOINTS: Readonly<Record<string, string>> = {
    valhalla: "https://valhalla1.openstreetmap.de",
    osrm: "https://router.project-osrm.org",
};

/** What `getProvider()` answers: who computes, and what their data owes. */
export interface ProviderIdentity {
    /** The adapter's stable identifier. */
    readonly id: string;
    /** The credit its data requires, ready to display. Never empty — an empty one is refused. */
    readonly attribution: string;
}

/**
 * Registers a routing engine under `id`.
 *
 * Exported so an integrator can plug an engine this package does not know — the same door
 * `position-share` opens for transports. Registering twice under one id replaces the first:
 * an integrator overriding a built-in is the reason the door exists.
 *
 * @param id Provider identifier, matched against `modules.routing.provider`.
 * @param factory Builds the provider for a resolved endpoint.
 */
export function registerProvider(id: string, factory: RouteProviderFactory): void {
    ADAPTERS.set(id, factory);
}

/** The provider ids currently registered, in registration order. */
export function registeredProviders(): string[] {
    return [...ADAPTERS.keys()];
}

/**
 * Resolves the endpoint a configuration asks for, or refuses it.
 *
 * 🛑 **An endpoint that does not start with `https://` is REFUSED, never downgraded.** The same
 * rule `geocoding` already applies. A routing request carries where someone is and where they
 * are going; over plain HTTP that is readable by every hop on the path, and a silent fallback
 * to a default endpoint would hide the refusal behind a route that still works.
 *
 * @param config The merged plugin configuration.
 * @returns The endpoint to use, or `null` when the configuration names none that is acceptable.
 */
export function resolveEndpoint(config: PluginConfig): string | null {
    const explicit = config.endpoint;
    if (typeof explicit === "string" && explicit.length > 0) {
        return explicit.startsWith("https://") ? explicit : null;
    }
    const provider = typeof config.provider === "string" ? config.provider : "";
    return DEFAULT_ENDPOINTS[provider] ?? null;
}

/**
 * Creates the provider a configuration asks for.
 *
 * Answers `null` — rather than falling back to another engine — when the provider is unknown,
 * when no adapter is registered for it, or when the endpoint was refused. ⚠️ This is where the
 * decalque from `geocoding` deliberately STOPS: that plugin falls back to its default provider
 * on an unusable value, which is right for a search box (a wrong result is visibly wrong, and
 * the user retypes). It is wrong here — routing someone through an engine they did not choose,
 * because the one they chose was misconfigured, is a silent substitution on a decision that
 * belongs to them.
 *
 * @param config The merged plugin configuration. Defaults to the live one.
 * @returns The provider, or `null` with nothing substituted.
 */
export function createProvider(config: PluginConfig = getPluginConfig()): IRouteProvider | null {
    const id = typeof config.provider === "string" ? config.provider : "valhalla";
    const factory = ADAPTERS.get(id);
    if (!factory) return null;

    const endpoint = resolveEndpoint({ ...config, provider: id });
    if (endpoint === null) return null;

    const provider = factory(endpoint);

    // 🛑 A provider with no credit is REFUSED, exactly like an endpoint that is not HTTPS: both
    // are ways of shipping something the integrator cannot be expected to notice is wrong. The
    // built-in engines route on OpenStreetMap, whose ODbL requires attribution wherever the
    // derived work is shown — and the map that omits it is the integrator's, not ours.
    //
    // ⚠️ Refusing rather than substituting a default credit. Inventing "© OpenStreetMap
    // contributors" for an unknown engine would be worse than silence: it would attribute data to
    // a source that may not have produced it, which is a false statement rather than a missing
    // one. A provider genuinely owing no credit says so with an explicit non-empty string.
    if (typeof provider?.attribution !== "string" || provider.attribution.trim() === "") {
        Log.warn(
            `[routing] provider "${id}" declares no attribution — refused. ` +
                "Routing data almost always carries a licence obligation; declare it on the " +
                "provider rather than leaving it to whoever ships the map."
        );
        return null;
    }

    return provider;
}

/**
 * The active provider's identity and the credit its data requires.
 *
 * ⚠️ Reads the CONFIGURED provider, which is not necessarily the one behind a route currently on
 * screen — a profile can be re-pointed while a computed route stays drawn. To credit what is being
 * looked at, read `RouteResult.attribution`, which travels with the data. This function answers
 * "what would compute my next route", which is what a settings panel asks.
 *
 * @param config The merged plugin configuration. Defaults to the live one.
 * @returns The identity, or `null` when no usable provider resolves — same refusals as
 *          `createProvider`, and for the same reasons.
 */
export function getProvider(config: PluginConfig = getPluginConfig()): ProviderIdentity | null {
    const provider = createProvider(config);
    return provider ? { id: provider.id, attribution: provider.attribution } : null;
}
