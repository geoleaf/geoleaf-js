/*!
 * @geoleaf-plugins/routing — Config reader
 *
 * Reads `modules.routing`, the plugin's ONLY branch of the profile, and merges it over the
 * built-in defaults. The endpoint of the routing provider will land here — and a value that
 * does not start with `https://` is refused rather than downgraded, the same way `geocoding`
 * already does it.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { coreConfigGet } from "@geoleaf/host-runtime";

const DEFAULTS = {
    enabled: true,

    // Read by the toolbar slot of `entry.ts` as `modules.routing.showButton` — the
    // SAME branch this file reads. That template declared its button under
    // `ui.show<Namespace>` until 08/08/2026: a second branch, which did not even share this
    // one's casing, so a scaffolded plugin's button could not be switched on from the config
    // its own file documented. INV-CONFIG forbids it; `create-plugin.cjs` now rejects it.
    // ⚠️ `false` at the start, unlike the template — and it is a product
    // choice, not style. The panel does not exist yet: a button visible by
    // default would be a DEAD control for any integrator enabling the module,
    // and a dead control does not announce itself, it gets clicked. It will
    // go back to `true` with what it opens.
    showButton: false,

    // Which routing engine to ask. `valhalla` first: it is the only MIT-licensed engine of
    // the shortlist, and the only one measured to return a localised French narrative — the
    // instructions in `fixtures/valhalla-*.json` are the evidence, not a claim.
    provider: "valhalla",

    // Empty means "use the default endpoint of the selected provider". A value that does not
    // start with `https://` is REFUSED, never downgraded: a routing request carries where
    // someone is and where they are going. See `resolveEndpoint` in `provider.ts`.
    endpoint: "",

    // How long the engine is given to answer, in milliseconds. Exposed because the right
    // value depends on the instance: a self-hosted engine on the same network answers in
    // tens of milliseconds, a shared public one under load can take seconds.
    timeoutMs: 10000,

    // Travel mode requested from the engine. ⚠️ An unknown value falls back
    // to `"car"` rather than being forwarded: the three engines name their
    // modes differently, and letting an unrecognised token through produces
    // either a provider error or — worse — a route computed for a mode nobody asked for.
    profile: "car",

    // Cap on the number of stops. Beyond it, adding is REFUSED with a message
    // naming the limit — a silently ignored addition rereads as a missed click.
    maxWaypoints: 10,

    // Profile layer where the geometry is published. ⚠️ The plugin does not
    // DRAW: it pushes features through the core's seam, and it refuses to
    // write if the layer does not exist — writing into the void would make
    // "no route" and "no layer" indistinguishable.
    layerId: "routing-route",

    // Which POI property carries its label. Configurable because profiles
    // differ, and because GUESSING is worse than asking: taking "the first
    // string property" would name a destination after a status code or an
    // identifier, with no way for the user to know why.
    // ⚠️ This field must ALSO be named in the profile's `action` widget
    // `payloadFields`, otherwise `properties` arrives empty and the
    // destination has no name.
    labelField: "name",
} as const;

/**
 * The merged `modules.routing` configuration.
 *
 * The index signature is deliberate: a profile may carry keys this version does not know
 * yet, and dropping them at the type boundary would make an unknown key indistinguishable
 * from a typo — the reader would see neither.
 */
export interface PluginConfig {
    enabled: boolean;

    showButton: boolean;

    /** Routing engine id, matched against the adapters registered in `provider.ts`. */
    provider: string;

    /** Base URL of the engine. Empty selects the provider's default; non-HTTPS is refused. */
    endpoint: string;

    /** Milliseconds an engine is given to answer before the request is ABORTED. */
    timeoutMs: number;

    /** Maximum number of waypoints. Below 2 is a mistake and falls back. */
    maxWaypoints: number;
    /** Travel mode asked of the engine — `car`, `foot` or `bike`. */
    profile: TravelProfile;

    /** Profile layer the geometry is published to. */
    layerId: string;

    /**
     * Feature property carrying the POI label, also named in `payloadFields`.
     *
     * A LIST is accepted, and it is what a profile with more than one layer needs: the button
     * is declared per layer, but this setting is global to the plugin, and layers do not agree
     * on the name of their label. Measured on the tourism profile — `Name`, `title`, `name`,
     * `ville`, `place`, `vernacularName`, six layers, six spellings. The first property that
     * is present and non-empty wins.
     *
     * 🛑 Still NAMED by the integrator, never guessed. Taking "the first string property"
     * would name a destination after a status code or an identifier, and the user would have
     * no way to know why.
     */
    labelField: string | readonly string[];

    [key: string]: unknown;
}

/** The three travel modes every adapter of this package maps onto its engine's own vocabulary. */
export type TravelProfile = "car" | "foot" | "bike";

/** The three, as a set, so an unknown token is refused rather than forwarded. */
const TRAVEL_PROFILES: ReadonlySet<string> = new Set<TravelProfile>(["car", "foot", "bike"]);

/**
 * The configured travel mode, or `car`.
 *
 * ⚠️ Falls back rather than forwarding an unknown token, on the same reasoning as `timeoutMs`
 * and `provider`: a value the plugin does not recognise is a configuration mistake, and passing
 * it through turns it into either an engine error or — worse — a route computed for a mode
 * nobody asked for, which nothing on screen would contradict.
 *
 * @param config The merged configuration. Defaults to the live one.
 * @returns One of the three modes.
 */
export function travelProfile(config: PluginConfig = getPluginConfig()): TravelProfile {
    const v = config.profile;
    return typeof v === "string" && TRAVEL_PROFILES.has(v) ? v : "car";
}

/**
 * Reads the plugin configuration from the `modules.routing` namespace of the running
 * core (Plugin Contract v1, INV-CONFIG), merged over the built-in defaults.
 *
 * ⚠️ `modules.routing` is the plugin's ONLY branch of the profile — never open a
 * second one, whatever the key. See `PLUGIN_ARCHITECTURE_SPEC.md` §5.
 *
 * @returns The merged configuration — built-in defaults under any profile override.
 */
export function getPluginConfig(): PluginConfig {
    const raw = coreConfigGet<Partial<PluginConfig>>("modules.routing", {}) ?? {};
    return { ...DEFAULTS, ...raw } as PluginConfig;
}
