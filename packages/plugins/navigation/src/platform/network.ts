/*!
 * @geoleaf-plugins/navigation — Network return
 *
 * Notifies when the browser believes the network is back.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * ## 🛑 A HINT, never a predicate — and the distinction is this whole module
 *
 * `navigator.onLine` says a link exists, not that anything answers: a captive
 * portal, a downed provider and one bar of signal all read "online" there.
 * The runtime therefore NEVER queries it to decide whether to attempt a
 * recompute — it attempts, and reads the answer (`network`, `timeout`) among
 * the model's six named causes.
 *
 * What the `online` event brings is something else: **"something just
 * changed, it is worth retrying now"**. Using it to SHORTEN a wait is right;
 * using it to REFUSE an attempt is not, and that is exactly the mistake ruled
 * out when this was designed.
 *
 * ⚠️ The practical consequence: a false positive of `online` costs one
 * request, which will fail and restart the backoff. A false negative, though,
 * would have cost a whole wait while the network was back — and it is the
 * only one of the two the user feels, because they are sitting at a junction
 * waiting for a route.
 */

/**
 * Subscribes to the network's return.
 *
 * @param onReturn Called every time the browser signals a return.
 * @param target   The event target. Injected so a test can drive it — and
 *                 because this module is the ONLY place in the package
 *                 touching this API.
 * @returns The unsubscribe function. Idempotent: guidance stops by the user,
 *          by the arrival and by teardown, and those races are real.
 */
export function onNetworkReturn(
    onReturn: () => void,
    target: EventTarget | undefined = globalThis.window
): () => void {
    if (!target?.addEventListener) return () => {};
    let stopped = false;
    target.addEventListener("online", onReturn);
    return () => {
        if (stopped) return;
        stopped = true;
        target.removeEventListener("online", onReturn);
    };
}
