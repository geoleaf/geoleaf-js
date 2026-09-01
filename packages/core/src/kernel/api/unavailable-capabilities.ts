/*!
 * GeoLeaf Core – Unavailable capabilities / notification bus
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Records the capabilities a caller asked for and did not get, and notifies
 * whoever subscribed. Backs the public {@link Capabilities} facade.
 *
 * ## Why this is a bus and not a detector
 *
 * The tempting shape — "confront the profile's `modules.<id>` keys against the registered
 * capabilities at boot" — is **false by construction**, and the measurement that establishes
 * it is worth keeping here rather than in a document nobody opens.
 * `PluginRegistry.registerCapability()` writes into the SAME registry as the preset
 * (`plugin-registry.ts`), and plugins load lazily (`registerLazy`, `ensureLoadedForAction`).
 * A capability can therefore register long after boot — **or never**, if its action is never
 * triggered. So "is X absent?" has no defined answer at any instant, and a boot-time verdict
 * would accuse every lazy capability that had not yet loaded.
 *
 * What CAN be stated is narrower and true: *this caller asked for X, and at that moment
 * nothing provided it*. That is what {@link declareUnavailable} records, and it is why the
 * consumer side is a subscription rather than a query.
 *
 * ## Two properties that are contract, not implementation detail
 *
 * 1. **Late subscribers receive the backlog.** The declaration happens during boot; a host
 *    subscribes after `GeoLeaf.boot()` resolves. Without replay, every fact would be emitted
 *    before anyone could hear it — which is the ordering problem this shape exists to solve,
 *    reintroduced one level down.
 * 2. **Idempotent per id.** The first motif for an id wins and later declarations are no-ops.
 *    A capability asked for inside a render path would otherwise flood subscribers with the
 *    same fact, and a listener that fires N times is one a host learns to ignore.
 *
 * A callback that throws is logged and does not stop the others — same posture as the
 * base-layer listener loop (`kernel/basemaps/basemaps-state.ts`).
 */

import { Log } from "../../utils/log/index.js";
import type {
    ICapabilitiesAPI,
    ICapabilityUnavailableFact,
} from "../../contracts/capability.contract.ts";

/** Facts already declared, keyed by capability id. Insertion order is replay order. */
const _facts = new Map<string, ICapabilityUnavailableFact>();

/** Live subscribers. A set, so the same callback registered twice is notified once. */
const _listeners = new Set<(fact: ICapabilityUnavailableFact) => void>();

/** Invokes one listener, converting a throw into a log line. */
function _notify(cb: (fact: ICapabilityUnavailableFact) => void, fact: ICapabilityUnavailableFact) {
    try {
        cb(fact);
    } catch (err) {
        Log.warn("[GeoLeaf.Capabilities] unavailable listener failed:", err);
    }
}

/**
 * Records that a capability was asked for and is not available, and notifies subscribers.
 *
 * Idempotent per `id`: the first motif is kept, later calls for the same id do nothing and
 * notify nobody.
 *
 * @param id - Capability id, as it would have been passed to `CapabilityRegistry.register()`.
 * @param motif - Why it is unavailable, in one sentence — this is what a host displays.
 *
 * @example
 * ```ts
 * GeoLeaf?.Capabilities?.declareUnavailable(
 *     "offline",
 *     "the bundle does not embark it"
 * );
 * ```
 */
export function declareUnavailable(id: string, motif: string): void {
    if (_facts.has(id)) return;

    const fact: ICapabilityUnavailableFact = { id, motif };
    _facts.set(id, fact);
    Log.warn(`[GeoLeaf.Capabilities] "${id}" is unavailable — ${motif}`);

    for (const cb of _listeners) _notify(cb, fact);
}

/**
 * Subscribes to capability-unavailable facts.
 *
 * The callback fires **immediately** for every fact already recorded, then for each new one.
 * Subscribing after boot therefore loses nothing — see the module header for why that replay
 * is contract rather than convenience.
 *
 * @param cb - Called once per distinct unavailable capability.
 * @returns An unsubscribe function. Calling it twice is harmless.
 *
 * @example
 * ```ts
 * const off = GeoLeaf?.Capabilities?.onUnavailable(({ id, motif }) => {
 *     console.warn(`no ${id}: ${motif}`);
 * });
 * off?.();
 * ```
 */
export function onUnavailable(cb: (fact: ICapabilityUnavailableFact) => void): () => void {
    _listeners.add(cb);
    for (const fact of _facts.values()) _notify(cb, fact);

    return () => {
        _listeners.delete(cb);
    };
}

/**
 * The `GeoLeaf.Capabilities` namespace.
 *
 * Two members, and the shape is **frozen**: it is public API on a published major, so
 * `I4` forbids removing or deprecating either one. Widening it later is possible; narrowing
 * it is not.
 */
export const Capabilities: ICapabilitiesAPI & { _reset(): void } = {
    declareUnavailable,
    onUnavailable,

    /** Resets recorded facts and subscribers. For use in tests only. */
    _reset(): void {
        _facts.clear();
        _listeners.clear();
    },
};
