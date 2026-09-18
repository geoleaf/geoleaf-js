/*!
 * GeoLeaf Connector — the renewal's way back after an outage
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Retries a renewal that could not conclude, at the moments the core stops listening to.
 *
 * 🛑 **THOSE MOMENTS HAD NOBODY.** After a 401 whose renewal could not conclude, the session is
 * kept and the core's drain stops on `authRequired`. Its triggers — network back, foreground,
 * periodic tick, a new capture — then stay silent until a pass that does not stop, that is until
 * the session comes back; and nothing in the core can bring it back, since it knows nothing of
 * sessions. This module takes three of those moments for the one thing the plugin can do: try
 * the renewal again. A success emits `token-refreshed`, and `session-resume.ts` puts the queue
 * back on the wire.
 *
 * - `online` on `window` — coverage returned;
 * - `visibilitychange` to visible on `document` — the operator is back in the application;
 * - `geoleaf:offline:outbox-queued` on `document` — a capture entered the queue: the moment the
 *   session matters, and one the halted drain ignores.
 *
 * ⚠️ **No timer, and what it leaves uncovered is written rather than hidden:** online, in the
 * foreground, and no new capture. Nothing is added to the queue then, and its head waits for the
 * next of the three moments. A periodic retry would need an interval nobody has measured.
 *
 * ⚠️ **Each trigger first waits for a renewal already in flight** — it may have started before
 * the network came back, and its "unavailable" would describe the world before the event — then
 * tries once more, past the store's pause: a change of state is worth one more try.
 */

import { TokenStore } from "./token-store.js";
import type { RefreshOutcome } from "./token-store.js";

/** The events that retry, on `document` — `online` is on `window`. */
const DOCUMENT_TRIGGERS = ["visibilitychange", "geoleaf:offline:outbox-queued"] as const;

/** A session that came back by another way: nothing left to retry. */
const CONCLUSIVE_EVENTS = [
    "geoleaf:connector:authenticated",
    "geoleaf:connector:token-refreshed",
] as const;

/**
 * Where the armed listeners are held.
 *
 * 🛑 **ON THE GLOBAL, as `session-resume.ts` and the guided reconnection do, and for the same
 * reason:** a module-scoped handle only disarms the instance that armed it — another copy of this
 * plugin, or a module re-imported, would leave its listeners behind, and one `online` would renew
 * as many times as there are copies.
 */
interface RetryHost {
    /** Written by name, never through a variable: a computed key would need a pollution guard. */
    __GEOLEAF_CONNECTOR_RENEWAL_RETRY__?: {
        trigger: EventListener;
        conclude: EventListener;
    };
}

/** The retry running now — triggers that coincide (online and foreground) share it. */
let _running: Promise<void> | null = null;

/**
 * One retry: waits for a renewal in flight, then tries once more if that one did not conclude.
 * Never throws — it runs from an event listener.
 */
async function _retry(baseUrl: string): Promise<void> {
    let outcome: RefreshOutcome | null = null;
    const inflight = TokenStore.inflightRefresh(baseUrl);
    if (inflight) outcome = await inflight;
    if (!outcome || outcome.verdict === "unavailable") {
        outcome = await TokenStore.forceRefresh(baseUrl, { bypassPause: true });
    }
    switch (outcome.verdict) {
        case "unavailable":
            // Still armed: the next trigger tries again.
            return;
        case "refused":
            disarmRenewalRetry();
            await TokenStore.declareSessionDead(
                baseUrl,
                outcome.presented,
                "Authentication failed — the renewal was refused."
            );
            return;
        case "renewed":
        case "absent":
        case "superseded":
            // Renewed (the delegate announced it), or the session changed by another way.
            disarmRenewalRetry();
    }
}

/**
 * Listens for the moments a renewal is worth retrying, until one concludes.
 *
 * Idempotent: a second call replaces the listeners rather than adding to them.
 *
 * @param baseUrl - The API whose session is waiting for its renewal.
 */
export function armRenewalRetry(baseUrl: string): void {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    disarmRenewalRetry();
    const trigger: EventListener = (event) => {
        if (event.type === "visibilitychange" && document.visibilityState !== "visible") return;
        _running ??= _retry(baseUrl)
            .catch((error: unknown) => {
                console.warn("[GeoLeaf Connector] Renewal retry failed:", error);
            })
            .finally(() => {
                _running = null;
            });
    };
    const conclude: EventListener = () => disarmRenewalRetry();
    window.addEventListener("online", trigger);
    for (const name of DOCUMENT_TRIGGERS) document.addEventListener(name, trigger);
    for (const name of CONCLUSIVE_EVENTS) document.addEventListener(name, conclude);
    (globalThis as RetryHost).__GEOLEAF_CONNECTOR_RENEWAL_RETRY__ = { trigger, conclude };
}

/** Releases what {@link armRenewalRetry} took. Idempotent. */
export function disarmRenewalRetry(): void {
    if (typeof document === "undefined") return;
    const host = globalThis as RetryHost;
    const armed = host.__GEOLEAF_CONNECTOR_RENEWAL_RETRY__;
    if (!armed) return;
    if (typeof window !== "undefined") window.removeEventListener("online", armed.trigger);
    for (const name of DOCUMENT_TRIGGERS) document.removeEventListener(name, armed.trigger);
    for (const name of CONCLUSIVE_EVENTS) document.removeEventListener(name, armed.conclude);
    delete host.__GEOLEAF_CONNECTOR_RENEWAL_RETRY__;
}
