/*!
 * GeoLeaf Connector — the queue's way back when a session returns
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * What happens to the captures a dead session set aside, once the operator is back in.
 *
 * 🛑 **THE CORE CANNOT SEE A SESSION RETURN, AND SAYS SO.** Its drain stops at the first 401
 * and sets that capture aside under `authRequired` — a motive its own contract calls
 * replayable, adding that "the lifting of the cause is a new sign-in, which nothing in the
 * core can observe (it knows nothing of the connector)". Measured on 17/09/2026: nothing
 * listened to `authenticated` or `token-refreshed`, and `requeueAll` had no caller outside the
 * façade. A tour's captures therefore stayed in quarantine, one added per minute while the
 * session was dead, until someone opened a console.
 *
 * This module is the answer, and it deliberately lives HERE rather than in the core: the
 * connector is what knows a session just came back. It asks through two PUBLIC gestures —
 * `Storage.requeueAll("authRequired")` then `Storage.pushOutbox()` — so an application that
 * signs in by its own means makes exactly the same two calls.
 *
 * ⚠️ **The surface is redeclared, not imported.** A plugin does not import the core's
 * sources; it describes what it expects of the global and tolerates its absence — an
 * application without the offline capability has neither method, and nothing here throws.
 *
 * @version 1.0.0
 */

/** The motive whose cause a sign-in lifts. Spelled out: it is the contract's word. */
const SESSION_MOTIVE = "authRequired";

/** Events the connector emits when a session becomes usable again. */
const RESUMING_EVENTS = [
    "geoleaf:connector:authenticated",
    "geoleaf:connector:token-refreshed",
] as const;

/** The two gestures the offline write cycle publishes, as this plugin expects them. */
interface OutboxSeam {
    requeueAll?: (reason?: string) => Promise<unknown>;
    pushOutbox?: () => Promise<unknown>;
}

/** The storage façade, or `null` when the application carries no offline write cycle. */
function _outbox(): OutboxSeam | null {
    const host = globalThis as { GeoLeaf?: { Storage?: OutboxSeam } };
    const storage = host.GeoLeaf?.Storage;
    if (!storage?.requeueAll || !storage.pushOutbox) return null;
    return storage;
}

/**
 * Puts the session's captures back in the queue, then drains.
 *
 * ⚠️ **In that order, and the order is the point**: draining first would walk past entries
 * still marked quarantined, report nothing owed, and leave the core's triggers paused.
 *
 * ⚠️ **It never throws.** This runs from an event listener, at the end of a sign-in the user
 * has just completed: a storage error must not surface as an unhandled rejection over the
 * screen that says "welcome back".
 *
 * @param cause - The event that asked, for the log.
 */
async function _resume(cause: string): Promise<void> {
    const outbox = _outbox();
    if (!outbox) return;
    try {
        await outbox.requeueAll?.(SESSION_MOTIVE);
        await outbox.pushOutbox?.();
    } catch (error) {
        console.warn(`[GeoLeaf.Connector] reprise de la file après « ${cause} » en échec :`, error);
    }
}

/**
 * Where the armed listener is held.
 *
 * 🛑 **ON THE GLOBAL, NOT IN THIS MODULE, and `_wireGuidedReconnect` made the same choice for
 * the same reason.** A module-scoped handle only disarms the instance that armed it: another
 * copy of this plugin on the page — or, in a suite, a module re-imported after a reset —
 * leaves its listener behind, and one sign-in then asks the queue to resume as many times as
 * there are copies. Measured here: eighteen drains for one event.
 */
interface ListenerHost {
    /** Written by name, never through a variable: a computed key would need a pollution guard. */
    __GEOLEAF_CONNECTOR_RESUME_LISTENER__?: EventListener;
}

/**
 * Listens for a session coming back, and empties what it had blocked.
 *
 * Idempotent: a second call replaces the listener rather than adding one — `configure()` may
 * run again on the same page.
 */
export function armSessionResume(): void {
    if (typeof document === "undefined") return;
    disarmSessionResume();
    const listener: EventListener = (event) => void _resume(event.type);
    for (const name of RESUMING_EVENTS) document.addEventListener(name, listener);
    (globalThis as ListenerHost).__GEOLEAF_CONNECTOR_RESUME_LISTENER__ = listener;
}

/** Releases what {@link armSessionResume} took. Idempotent. */
export function disarmSessionResume(): void {
    if (typeof document === "undefined") return;
    const host = globalThis as ListenerHost;
    const listener = host.__GEOLEAF_CONNECTOR_RESUME_LISTENER__;
    if (!listener) return;
    for (const name of RESUMING_EVENTS) document.removeEventListener(name, listener);
    delete host.__GEOLEAF_CONNECTOR_RESUME_LISTENER__;
}
