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

/** The gestures the offline write cycle publishes, as this plugin expects them. */
interface OutboxSeam {
    requeueAll?: (reason?: string) => Promise<unknown>;
    pushOutbox?: () => Promise<unknown>;
    /** Resolves once the offline engine is wired and its database open — never without it. */
    whenReady?: () => Promise<void>;
}

/** The storage façade, or `null` when the application carries no offline write cycle. */
function _outbox(): OutboxSeam | null {
    const host = globalThis as { GeoLeaf?: { Storage?: OutboxSeam } };
    const storage = host.GeoLeaf?.Storage;
    if (!storage?.requeueAll || !storage.pushOutbox) return null;
    return storage;
}

/**
 * A resume asked for while the offline engine was not wired yet, and replayed once it is.
 *
 * 🛑 **A SESSION CAN COME BACK BEFORE THE ENGINE DOES.** `GeoLeaf.Storage` exists from the
 * core's import, but its engine is only wired when the offline capability loads, during boot.
 * A `configure()` called before `GeoLeaf.boot()` renews an expired session at that moment, and
 * the two gestures then answer `refused: "engineUnavailable"`. The core's arming pass does not
 * make up for it: it replays `pending` and `failed`, never a quarantine — so the capture the
 * previous session set aside stayed quarantined while the session was back.
 *
 * ⚠️ One wait per page, whatever the number of renewals: `whenReady()` never resolves without
 * the offline capability, and a waiter per renewal would pile up for nothing. Disarming drops
 * it — the replay checks that its claim is still the one held.
 */
let _owed: object | null = null;

/** True when the core answered that its offline engine is not wired yet. */
function _engineUnavailable(answer: unknown): boolean {
    return (
        typeof answer === "object" &&
        answer !== null &&
        (answer as { refused?: unknown }).refused === "engineUnavailable"
    );
}

/**
 * Replays the resume once the engine is ready — if the core says when.
 *
 * ⚠️ **It first JOINS the core's arming pass.** The core drains the instant its engine is ready,
 * and that pass read the queue before anything is requeued: requeued mid-pass, the captures
 * would wait for the next trigger, which a quiet queue may not bring. `pushOutbox()` hands a
 * caller the running pass, so awaiting it once is waiting for that pass to end.
 *
 * @param outbox - The storage façade.
 * @param cause - The event that asked, for the log.
 */
function _oweUntilReady(outbox: OutboxSeam, cause: string): void {
    if (!outbox.whenReady) return;
    const claim = {};
    _owed = claim;
    void outbox.whenReady().then(async () => {
        if (_owed !== claim) return;
        _owed = null;
        try {
            await outbox.pushOutbox?.();
        } catch {
            // The arming pass reports its own failure; the replay below still runs.
        }
        await _resume(cause);
    });
}

/**
 * Puts the session's captures back in the queue, then drains.
 *
 * ⚠️ **In that order, and the order is the point**: draining first would walk past entries
 * still marked quarantined, report nothing owed, and leave the core's triggers paused.
 *
 * ⚠️ **An engine not wired yet defers it** — see {@link _owed}.
 *
 * ⚠️ **It never throws.** This runs from an event listener, at the end of a sign-in the user
 * has just completed: a storage error must not surface as an unhandled rejection over the
 * screen that says "welcome back".
 *
 * @param cause - The event that asked, for the log.
 */
async function _resume(cause: string): Promise<void> {
    const outbox = _outbox();
    if (!outbox || _owed !== null) return;
    try {
        const answer = await outbox.requeueAll?.(SESSION_MOTIVE);
        if (_engineUnavailable(answer)) {
            _oweUntilReady(outbox, cause);
            return;
        }
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

/** Releases what {@link armSessionResume} took, a resume still owed included. Idempotent. */
export function disarmSessionResume(): void {
    _owed = null;
    if (typeof document === "undefined") return;
    const host = globalThis as ListenerHost;
    const listener = host.__GEOLEAF_CONNECTOR_RESUME_LISTENER__;
    if (!listener) return;
    for (const name of RESUMING_EVENTS) document.removeEventListener(name, listener);
    delete host.__GEOLEAF_CONNECTOR_RESUME_LISTENER__;
}
