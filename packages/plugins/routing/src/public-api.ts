/*!
 * @geoleaf-plugins/routing — Public API facade
 * © 2026 Mattieu Pottier — MIT License
 *
 * Façade only: exposes the plugin's public surface (INV-FACADE). Methods are
 * thin wrappers that delegate to internal modules — no business logic here.
 * https://geoleaf.dev
 */
import type { Feature } from "geojson";
import { getPluginConfig, type PluginConfig } from "./config.js";
import {
    registerProvider,
    registeredProviders,
    getProvider,
    type RouteProviderFactory,
    type ProviderIdentity,
} from "./provider.js";
import {
    addWaypoint,
    removeWaypoint,
    moveWaypoint,
    clearWaypoints,
    isRoutable,
    maxWaypoints,
    type CompositionResult,
} from "./composition.js";
import { legSummaries, type LegSummary } from "./legs.js";
import { publishRoute, clearRoute, routeFeatures, type PublishOutcome } from "./publish.js";
import type { RouteResult, Waypoint } from "./model.js";
import { actionId } from "./entry-point.js";

/** The object mounted on `GeoLeaf.Routing`. */
export interface RoutingPublicApi {
    /** The merged `modules.routing` configuration. */
    getConfig(): PluginConfig;
    /**
     * Registers a routing engine under `id`, so an integrator can plug one this package does
     * not know. Must run before the first route is asked for.
     */
    registerProvider(id: string, factory: RouteProviderFactory): void;
    /**
     * The active provider's identity and the credit its data requires.
     *
     * ⚠️ Answers for the CONFIGURED provider. To credit a route already on screen, read its own
     * `attribution` — a profile can be re-pointed while a computed route stays drawn.
     */
    getProvider(): ProviderIdentity | null;
    /** The engine ids currently registered. */
    listProviders(): string[];
    /**
     * The `actionId` a profile must declare on its `feature-info` action widget for the
     * "route to here" button to reach this plugin.
     *
     * Exposed because the profile and the plugin have to agree on this string EXACTLY, and a
     * typo produces a button that renders, clicks, and does nothing — with no error anywhere.
     */
    actionId(): string;

    // ── composition ──
    /** Appends a waypoint, or refuses with the reason and the configured cap. */
    addWaypoint(waypoints: readonly Waypoint[], waypoint: Waypoint): CompositionResult;
    /** Removes the waypoint at `index`. */
    removeWaypoint(waypoints: readonly Waypoint[], index: number): CompositionResult;
    /** Moves a waypoint — what a drag-and-drop in the step list performs. */
    moveWaypoint(waypoints: readonly Waypoint[], from: number, to: number): CompositionResult;
    /** Empties the itinerary. */
    clearWaypoints(): CompositionResult;
    /** Whether the list can be sent to a provider — two waypoints up. */
    isRoutable(waypoints: readonly Waypoint[]): boolean;
    /** The configured cap on the number of waypoints. */
    maxWaypoints(): number;

    // ── reading a computed route ──
    /** One summary per leg, paired with the points it runs between. */
    legSummaries(route: RouteResult): LegSummary[];

    // ── map ──
    /** The GeoJSON a route renders as, without publishing it. */
    routeFeatures(route: RouteResult): Feature[];
    /** Publishes a route to the configured layer, through the core's seam. */
    publishRoute(route: RouteResult): PublishOutcome;
    /** Empties the route layer. */
    clearRoute(): PublishOutcome;
}

/**
 * Builds the object mounted on `GeoLeaf.Routing`.
 *
 * ⚠️ The surface is deliberately narrow at this stage: route computation lands with the
 * provider contract, and a method advertised before it resolves is worse than an absent
 * one — an integrator reading `GeoLeaf.Routing.route` would find a function that answers
 * nothing. Facade methods delegate; they never hold logic (`check-facade-purity`).
 *
 * @returns The plugin's public surface.
 */
export function buildPublicApi(): RoutingPublicApi {
    return {
        getConfig: (): PluginConfig => getPluginConfig(),
        registerProvider: (id: string, factory: RouteProviderFactory): void =>
            registerProvider(id, factory),
        getProvider: (): ProviderIdentity | null => getProvider(),
        listProviders: (): string[] => registeredProviders(),
        actionId: (): string => actionId(),

        addWaypoint: (waypoints, waypoint): CompositionResult => addWaypoint(waypoints, waypoint),
        removeWaypoint: (waypoints, index): CompositionResult => removeWaypoint(waypoints, index),
        moveWaypoint: (waypoints, from, to): CompositionResult => moveWaypoint(waypoints, from, to),
        clearWaypoints: (): CompositionResult => clearWaypoints(),
        isRoutable: (waypoints): boolean => isRoutable(waypoints),
        maxWaypoints: (): number => maxWaypoints(),

        legSummaries: (route): LegSummary[] => legSummaries(route),

        routeFeatures: (route): Feature[] => routeFeatures(route),
        publishRoute: (route): PublishOutcome => publishRoute(route),
        clearRoute: (): PublishOutcome => clearRoute(),
    };
}
