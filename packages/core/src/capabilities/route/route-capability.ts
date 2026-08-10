/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability declaration for the in-core `route` capability.
 *
 * Registered in `boot.ts` before the optional-module gate so that
 * `GeoLeaf.Introspection.getAllCapabilities()` and `getCapabilitySchema('route')`
 * work at runtime.
 *
 * Config gate: `modules.route.enabled`. `enableWhenAbsent: true` (opt-OUT at the
 * boot gate) is MANDATORY: the boot gate runs on the PRE-MERGE `baseCfg` (before
 * `loadActiveProfileResources`), so `modules.route.enabled` is `undefined` there —
 * an opt-in (`false`) gate would read `undefined`, NEVER register the module, and
 * leave the capability silently inert (the documented boot-gate-timing pitfall,
 * same reason `legend` / `filter` / `theme-selector` are opt-out). The real opt-in
 * decision is enforced late in `RouteLifecycle` (`config.enabled` on the merged
 * config): the module is always mounted but does nothing unless a profile sets
 * `modules.route.enabled: true`, so the visible default stays "no endpoints".
 */
"use strict";

import type { ICapabilityDeclaration } from "../../contracts/capability.contract.js";

/** In-core capability declaration for the Route (itinerary endpoints) subsystem. */
export const ROUTE_CAPABILITY: ICapabilityDeclaration = {
    id: "route",
    label: "Route",
    description:
        "Itinerary decoration: derives start / end endpoint markers for bound polyline layers.",
    gate: { configPath: "modules.route.enabled", enableWhenAbsent: true },
    configSchema: {
        enabled: {
            type: "boolean",
            default: false,
            description: "Enable itinerary endpoint decoration globally.",
        },
        layers: {
            type: "object",
            default: {},
            description:
                "Per-layer bindings, keyed by GeoLeaf layer id: " +
                "`{ start?, end?, showStart?, showEnd? }` (start/end = circle-marker style " +
                "overrides — radius, color, fillColor, fillOpacity, weight). Opaque subtree: " +
                "the keys are the profile's own layer ids. WITHOUT it the capability is inert " +
                "even when `enabled` is true — `resolveLayerBinding` returns null for every " +
                "layer (resolver.ts), so no endpoint marker is ever drawn.",
        },
    },
    // No loader: route is inline (light). Gated via isEnabled().
};
