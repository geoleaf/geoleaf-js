/*!
 * @geoleaf-plugins/isochrone — Provider transport
 *
 * The one place a routing engine is called over the network, and the one place a failure is
 * turned into a reason the caller can act on.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import type { IsochroneFailure } from "../model.js";

/**
 * What a transport call answers.
 *
 * ⚠️ A refusal carries the engine's parsed body as `refusal`, and that is as far as it goes:
 * the adapter reads the one number it knows how to find there and drops the rest. No text an
 * engine wrote ever leaves the `providers/` directory.
 */
type FetchOutcome =
    | { readonly ok: true; readonly body: unknown }
    | {
          readonly ok: false;
          readonly reason: IsochroneFailure;
          readonly status?: number;
          readonly refusal?: unknown;
      };

/**
 * Calls a routing engine with a GET and reads its JSON body.
 *
 * ## Why this package has its own transport
 *
 * The timeout helper of `@geoleaf/host-runtime` REPLACES the signal it is given with its own,
 * so it cannot carry a cancellation the user asked for. Here a single `AbortController` serves
 * both: the timer aborts it, and so does the caller's signal. What tells the two apart
 * afterwards is who fired — the only difference between "the engine is slow" and "the user
 * changed their mind".
 *
 * ⚠️ Aborting, and not racing a promise: a race leaves the request running, so a slow engine
 * keeps a connection and a quota slot for an answer nobody will read.
 *
 * @param url Absolute URL, composed by `buildRequestUrl`.
 * @param signal The caller's cancellation.
 * @param timeoutMs How long the engine is given.
 * @returns The parsed body, or a named reason.
 */
export async function fetchIsochroneJson(
    url: string,
    signal: AbortSignal,
    timeoutMs: number
): Promise<FetchOutcome> {
    if (signal.aborted) return { ok: false, reason: "aborted" };

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);
    const onAbort = (): void => controller.abort();
    signal.addEventListener("abort", onAbort, { once: true });

    /**
     * Names an interruption, whichever await it broke.
     *
     * @returns `timeout` or `aborted` when one of the two fired, `null` otherwise.
     */
    const interrupted = (): FetchOutcome | null => {
        if (timedOut) return { ok: false, reason: "timeout" };
        if (signal.aborted) return { ok: false, reason: "aborted" };
        return null;
    };

    try {
        const res = await fetch(url, { method: "GET", signal: controller.signal });
        let body: unknown;
        let readable = true;
        try {
            body = await res.json();
        } catch {
            readable = false;
        }
        const cut = interrupted();
        if (cut) return cut;
        if (!res.ok) {
            return readable
                ? { ok: false, reason: "http", status: res.status, refusal: body }
                : { ok: false, reason: "http", status: res.status };
        }
        // A 200 whose body is not JSON. Distinct from `http` on purpose: the engine believed
        // it answered, so the fault is in the shape, not in the request.
        return readable ? { ok: true, body } : { ok: false, reason: "malformed" };
    } catch {
        return interrupted() ?? { ok: false, reason: "network" };
    } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
    }
}
