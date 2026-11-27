/*!
 * @geoleaf/host-runtime — capability presence seam
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Whether an in-core capability can serve a plugin — embarked in the bundle AND switched on.
 *
 * No plugin read the embarkation of a capability: each judged by the presence of a façade or by a
 * configuration key, so a bundle without the offline engine offered a download that never
 * answered, and position sharing announced itself active without geolocation. This module is the
 * ONE place a plugin asks, and every plugin asks the same way.
 *
 * It reads `GeoLeaf.Introspection.getCapabilityStatus()`, the core's own verdict — gate and
 * declared dependencies included. 🛑 **An unknown answer is `"unknown"`, never `"absent"`**: before
 * the boot nothing is declared, and a host without introspection cannot tell. A plugin that hid a
 * control on that answer would hide it everywhere the boot has not run yet. Same rule as the
 * core's own reader (`capabilities/coordinates`).
 *
 * ⚠️ It mirrors `ICapabilityStatus` and does not import it: this package imports nothing from
 * `@geoleaf/core`, not even a type (see `index.ts`).
 */

import { getGeoLeaf } from "./host.js";
import { Log } from "./log-seam.js";

/** One row of `GeoLeaf.Introspection.getCapabilityStatus()`, the fields read here. */
interface CapabilityStatusRow {
    readonly id: string;
    readonly embarked: boolean;
    readonly enabled: boolean;
}

/**
 * What the core says of a capability.
 *
 * - `"on"` — embarked and switched on;
 * - `"off"` — embarked, switched off by the profile (or one of its dependencies is);
 * - `"absent"` — the core knows its capabilities and this one is not among them;
 * - `"unknown"` — nothing to ask yet: no introspection, or nothing declared (before the boot).
 */
export type CapabilityAvailability = "on" | "off" | "absent" | "unknown";

/**
 * The core's verdict on one capability, read at call time.
 *
 * @param id - Capability id, as its installer declares it (e.g. `"offline"`, `"geolocation"`).
 * @returns See {@link CapabilityAvailability}.
 * @example
 * if (capabilityAvailability("offline") === "absent") hideDownloadButton();
 */
export function capabilityAvailability(id: string): CapabilityAvailability {
    const introspection = getGeoLeaf()?.Introspection as
        { getCapabilityStatus?(): readonly CapabilityStatusRow[] } | undefined;
    const rows = introspection?.getCapabilityStatus?.();
    if (!rows || rows.length === 0) return "unknown";
    const row = rows.find((r) => r.id === id);
    if (!row || !row.embarked) return "absent";
    return row.enabled ? "on" : "off";
}

/**
 * Whether a control that drives this capability may be offered.
 *
 * @param id - Capability id.
 * @returns `false` only when the core says the capability is absent or off; `true` when it is on
 *   or when nothing can be asked yet.
 * @example
 * if (isCapabilityOn("geolocation")) panel.append(myPositionButton);
 */
export function isCapabilityOn(id: string): boolean {
    const verdict = capabilityAvailability(id);
    return verdict === "on" || verdict === "unknown";
}

/** Pairs already reported — one warning per plugin and capability, not one per click. */
const _warned = new Set<string>();

/**
 * Tells the integrator, once, that a plugin withholds a control for want of a capability.
 *
 * The user sees nothing — the control is simply not offered —, so the console is where the reason
 * has to be written: a missing button with no word anywhere reads as a defect.
 *
 * @param pluginId - The plugin that withholds the control.
 * @param capabilityId - The capability it needs.
 * @example
 * if (!isCapabilityOn("offline")) warnCapabilityMissing("offline-ui", "offline");
 */
export function warnCapabilityMissing(pluginId: string, capabilityId: string): void {
    const key = `${pluginId}\u0000${capabilityId}`;
    if (_warned.has(key)) return;
    _warned.add(key);
    const verdict = capabilityAvailability(capabilityId);
    Log.warn(
        `[${pluginId}] The "${capabilityId}" capability is ${verdict === "off" ? "switched off by the profile" : "not in this bundle"} — what needs it is not offered.`
    );
}
