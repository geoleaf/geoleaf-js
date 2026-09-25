/*!
 * @geoleaf-plugins/geocoding — Provider registry
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 *
 * Which services a search asks, in what order — and what becomes of a name nobody
 * registered.
 *
 * `modules.geocoding.provider` takes one name (or an `https://` URL), as it always did, or,
 * since 1.1.0, an ordered LIST of them. Names resolve through a registry: the built-in
 * address services, the built-in `layers` provider — the features the map holds, through
 * `GeoLeaf.Layers.search`, which needs no network — and whatever an integrator adds with
 * {@link registerProvider}. Until 1.1.0 the names were a closed `switch`.
 *
 * A list asks its providers in order and keeps their results in that order, so
 * `["layers", "nominatim"]` lists what the map holds before any address. While the browser
 * says it is offline, the providers that need the network are not asked at all: a request
 * that can only fail costs the user its timeout, and nothing else.
 *
 * 🛑 **An unknown name.** A single `provider` string nobody registered — a typo, an `http://`
 * URL — falls back on the default service, as the plugin has always documented (GC-11). The
 * fallback reaches the network with the user's input, and it used to do so without a word:
 * it is now NAMED, and announced as refused from the next minor version, which is when the
 * fallback goes (`VERSIONING_POLICY.md`: a behaviour is withdrawn only after a published
 * version announced it). Inside a list — a form no profile written before 1.1.0 can hold, so
 * no one relies on a fallback there — an unknown name is refused at once: nothing is asked
 * for it.
 */

import type { GeocodingConfig, GeocodingResult } from "./types.js";
import {
    AddokProvider,
    CustomProvider,
    NominatimProvider,
    PhotonProvider,
    type IGeocodingProvider,
} from "./provider.js";
import { getGeoLeaf, Log } from "@geoleaf/host-runtime";

/** Builds a provider from the plugin's configuration. */
export type GeocodingProviderFactory = (config: GeocodingConfig) => IGeocodingProvider;

/** The name a missing `provider` resolves to. */
const DEFAULT_PROVIDER = "addok";

/**
 * The `layers` provider — the features the map holds, searched by `GeoLeaf.Layers.search`.
 * It never touches the network, so it answers off-network; on a core older than the member,
 * it answers nothing rather than throwing.
 */
class LayersProvider implements IGeocodingProvider {
    readonly network = false;

    async search(query: string, limit: number): Promise<GeocodingResult[]> {
        const hits = getGeoLeaf()?.Layers?.search?.(query, { limit });
        return Array.isArray(hits) ? (hits as GeocodingResult[]) : [];
    }
}

/**
 * Asks several providers in order and keeps their results in that order, within `limit`.
 * Off-network, a provider that needs the network is skipped; a provider that fails answers
 * nothing rather than taking the others down with it.
 */
class ProviderList implements IGeocodingProvider {
    constructor(private readonly _providers: readonly IGeocodingProvider[]) {}

    async search(query: string, limit: number): Promise<GeocodingResult[]> {
        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        const asked = this._providers.filter((p) => !(offline && p.network !== false));
        const answers = await Promise.all(asked.map((p) => p.search(query, limit).catch(() => [])));
        return answers.flat().slice(0, limit);
    }
}

const _factories = new Map<string, GeocodingProviderFactory>([
    ["addok", (config) => new AddokProvider(config)],
    ["nominatim", (config) => new NominatimProvider(config)],
    ["photon", (config) => new PhotonProvider(config)],
    ["layers", () => new LayersProvider()],
]);

/**
 * Values already named once, per form — the control re-resolves the configuration at each
 * search, and one warning per keystroke would drown the one that matters.
 */
const _named = new Set<string>();

/**
 * Makes a provider available under `name`, for `modules.geocoding.provider` to list.
 * Registering an existing name replaces it — built-in names included.
 *
 * @param name - The name a profile will use.
 * @param factory - Builds the provider from the plugin's configuration.
 * @throws When `name` is empty or `factory` is not a function.
 */
export function registerProvider(name: string, factory: GeocodingProviderFactory): void {
    if (typeof name !== "string" || name.length === 0) {
        throw new TypeError("[Geocoding] registerProvider: a provider needs a non-empty name.");
    }
    if (typeof factory !== "function") {
        throw new TypeError(`[Geocoding] registerProvider("${name}"): factory is not a function.`);
    }
    _factories.set(name, factory);
}

/** The names a profile can use today, for the messages below. */
function _knownNames(): string {
    return [..._factories.keys()].join(", ") + ", or an https:// URL";
}

/** Resolves one name or URL, or `null` when nothing answers to it. */
function _resolve(value: unknown, config: GeocodingConfig): IGeocodingProvider | null {
    if (typeof value !== "string") return null;
    const factory = _factories.get(value);
    if (factory) return factory(config);
    // Custom HTTPS URL — the scheme is validated before anything is asked of it.
    return value.startsWith("https://") ? new CustomProvider(value) : null;
}

/** Names an unknown value, once per value and form. */
function _nameUnknown(value: unknown, inList: boolean): void {
    const shown = JSON.stringify(value) ?? String(value);
    const key = `${inList ? "list" : "single"}:${shown}`;
    if (_named.has(key)) return;
    _named.add(key);
    if (inList) {
        Log.warn(
            `[Geocoding] Unknown provider ${shown} in the provider list — known: ${_knownNames()}. ` +
                "It is refused: nothing is asked for it."
        );
        return;
    }
    Log.warn(
        `[Geocoding] Unknown provider ${shown} — known: ${_knownNames()}. Falling back on ` +
            `"${DEFAULT_PROVIDER}", which sends the search to that service; this value will be ` +
            "refused from the next minor version of @geoleaf-plugins/geocoding."
    );
}

/**
 * Builds the provider `modules.geocoding.provider` describes: one name or URL, or an
 * ordered list of them. See this module's header for what an unknown name becomes.
 *
 * @param config - The plugin's configuration.
 * @returns The provider to ask.
 * @internal
 */
export function createProvider(config: GeocodingConfig): IGeocodingProvider {
    const value = config.provider ?? DEFAULT_PROVIDER;
    if (Array.isArray(value)) {
        const providers: IGeocodingProvider[] = [];
        for (const entry of value) {
            const provider = _resolve(entry, config);
            if (provider) providers.push(provider);
            else _nameUnknown(entry, true);
        }
        return new ProviderList(providers);
    }
    const provider = _resolve(value, config);
    if (provider) return provider;
    _nameUnknown(value, false);
    return new AddokProvider(config);
}
