/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf UI – Whether a slot or a pane may be offered at all.
 *
 * Two questions the profile-key guards cannot answer, shared by the toolbar slots
 * (`ui-slot-builder.ts`) and the hostable panes (`panel-panes.ts`):
 *
 * - **`requiresCapability`** — is the in-core capability the control drives embarked AND
 *   switched on? A plugin whose button can only fail without it (the offline download without
 *   the offline engine, position sharing without geolocation) must not be offered. Declarative,
 *   because the lazy slots are declared by the host page before any plugin code has loaded.
 * - **`isAvailable()`** — the owner's own verdict, read at render time. It is the only way to
 *   express a condition that lives in the merged profile and nowhere else: `modules.<id>.enabled`
 *   for a plugin registered before the profile loads, or a layer the plugin needs to draw into.
 *
 * Both are read at RENDER, never at registration: registration happens before the profile is
 * merged, so a verdict taken then would be the pre-profile one.
 */

import { getGeoLeaf } from "../../utils/general/geoleaf-global.js";
import { Log } from "../../utils/log/index.js";
import { CapabilityRegistry } from "../api/capability-registry.js";

/** Dotted-path config reader — the shape the capability registry reads gates against. */
interface ConfigReader {
    get(key: string, defaultValue?: unknown): unknown;
}

const _NO_CONFIG: ConfigReader = { get: (_key, def) => def };

/** Capabilities already named in the console for a withheld control — once each per page. */
const _warnedWithheld = new Set<string>();

/**
 * Whether a capability can serve the control that names it.
 *
 * 🛑 **Unknown answers `true`, and that is the safe way round.** Before boot pass 1 nothing is
 * declared, and an isolated mount may have no registry at all: hiding the control on an empty
 * registry would remove every gated button from every host that renders early. Only a positive
 * answer hides — the registry knows capabilities and this one is not among them (the bundle
 * does not embark it), or it is there and its gate or one of its dependencies is closed.
 * Same rule as the scale wrapper's `_scaleCanCome` in `capabilities/coordinates`.
 *
 * A withheld control is said once per capability (`Log.warn`): without it, a profile that
 * forgot the capability lost the button with no reason given.
 *
 * @param id - Capability id, as its installer declares it (e.g. `"offline"`, `"geolocation"`).
 * @returns `false` only when the capability is known to be absent or switched off.
 */
export function isCapabilityOffered(id: string): boolean {
    const config = (getGeoLeaf()?.Config as ConfigReader | undefined) ?? _NO_CONFIG;
    const statuses = CapabilityRegistry.getAllStatuses(config);
    if (statuses.length === 0) return true;
    const status = statuses.find((s) => s.id === id);
    const offered = !!status && status.embarked && status.enabled;
    if (!offered && !_warnedWithheld.has(id)) {
        _warnedWithheld.add(id);
        Log.warn(
            `[UI] A control needs the "${id}" capability, which is ${status?.embarked ? "switched off" : "not embarked"}: it is not offered.`
        );
    }
    return offered;
}

/**
 * Reads an owner's availability predicate, failing open.
 *
 * A throwing predicate is a defect in its owner; it is logged and the control is kept — a
 * spurious button costs a click, a missing one costs the feature.
 *
 * @param owner - The slot or pane id, for the log line.
 * @param predicate - The owner's predicate, if it declared one.
 * @returns `false` only when the predicate ran and answered `false`.
 */
export function isOwnerAvailable(owner: string, predicate: (() => boolean) | undefined): boolean {
    if (!predicate) return true;
    try {
        return predicate() !== false;
    } catch (err) {
        Log.warn(`[UI] ${owner}: isAvailable() threw — the control is kept.`, err);
        return true;
    }
}
