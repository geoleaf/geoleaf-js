/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Bounded `fetch` — the core's own, because it cannot borrow the other one.
 *
 * 🛑 WHY THIS EXISTS RATHER THAN REUSING `@geoleaf/host-runtime`'s `fetchWithTimeout`.
 * That package is `private: true` and is never published. A core that imported it would stop
 * installing standalone — `npm install @geoleaf/core` would resolve a dependency that does not
 * exist on npm. The duplication is therefore NOT an oversight: it is what the packaging
 * boundary costs, and merging the two would trade a duplicate for a broken install.
 *
 * ⚠️ The two must move together. If the timeout semantics change here,
 * `host-runtime`'s `fetchWithTimeout` is the sibling to check — and vice versa.
 * Duplication risk, motive written down.
 *
 * WHY IT MATTERS AT ALL (task 3.8). Sixteen production `fetch` calls on the offline perimeter
 * had neither an `AbortController` nor a deadline. A slow server does not fail them — it
 * holds them, forever. On the critical path of a Service Worker `FetchEvent` that means the
 * resource never resolves and the page waits, with no error to show and nothing to retry.
 *
 * ⚠️ AND AN ABANDONMENT MUST DEGRADE **VISIBLY**. A timeout that resolves to `null` is a
 * silent failure wearing a different hat: the caller cannot tell "the server said nothing" from
 * "the server said no". So this throws, with a discriminant saying WHICH of the two happened.
 *
 * @version 3.0.0
 */

/**
 * Which of the two failure modes {@link fetchBounded} ran into.
 *
 * ⚠️ NOT exported: its only consumer is `BoundedFetchError.kind` below. Exporting
 * it would make it a `check-orphan-exports` orphan — whose baseline can only
 * SHRINK — to widen a surface nobody names.
 */
type BoundedFetchFailure = "timeout" | "network";

/**
 * Transport error thrown by {@link fetchBounded}.
 *
 * Carries `kind` so a caller can tell a deadline from an unreachable host and say so — the
 * whole point of bounding a request is that the abandonment is reportable.
 */
export class BoundedFetchError extends Error {
    /** `"timeout"` when the deadline fired, `"network"` otherwise. */
    readonly kind: BoundedFetchFailure;
    /** URL that was being fetched, for a message a user can act on. */
    readonly url: string;

    constructor(kind: BoundedFetchFailure, url: string, options?: { cause?: unknown }) {
        super(
            kind === "timeout"
                ? `[fetchBounded] request timed out: ${url}`
                : `[fetchBounded] network request failed: ${url}`
        );
        this.name = "BoundedFetchError";
        this.kind = kind;
        this.url = url;
        if (options?.cause !== undefined) {
            (this as { cause?: unknown }).cause = options.cause;
        }
    }
}

/**
 * Deadline applied when a caller does not pick one.
 *
 * ⚠️ NOT exported, same motive: callers pass their own value or take the default;
 * none needs to NAME it.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 15000;

/**
 * Runs `fetch` with a deadline, and turns an abandonment into a NAMED error.
 *
 * @param url - Request URL.
 * @param init - Standard `RequestInit`. Any `signal` it carries is honoured **in addition**
 *   to the deadline: the request aborts on whichever fires first.
 * @param timeoutMs - Deadline in milliseconds. Defaults to {@link DEFAULT_FETCH_TIMEOUT_MS}.
 * @returns The `Response`, whatever its status — a 404 is an answer, not an abandonment.
 * @throws {BoundedFetchError} `kind: "timeout"` when the deadline fired, `"network"` otherwise.
 * @example
 * try {
 *     const res = await fetchBounded(url, { method: "HEAD" }, 5000);
 * } catch (err) {
 *     if (err instanceof BoundedFetchError && err.kind === "timeout") {
 *         // tell the user the server did not answer, not that the resource is missing
 *     }
 * }
 */
export async function fetchBounded(
    url: string,
    init: RequestInit = {},
    timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // A caller-supplied signal must keep working: chaining it means the request dies on
    // whichever of the two fires first, instead of the deadline silently replacing it.
    const callerSignal = init.signal;
    const onCallerAbort = () => controller.abort();
    if (callerSignal) {
        if (callerSignal.aborted) controller.abort();
        else callerSignal.addEventListener("abort", onCallerAbort, { once: true });
    }

    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
        // `controller.signal.aborted` alone cannot tell the two apart once the caller's
        // signal is chained in — the deadline is the only thing this module owns.
        throw new BoundedFetchError(controller.signal.aborted ? "timeout" : "network", url, {
            cause: err,
        });
    } finally {
        // The leak this repository already paid for once (`offline-detector.ts`): a timer per
        // failed request, piling up for as long as the network stays down.
        clearTimeout(timer);
        callerSignal?.removeEventListener("abort", onCallerAbort);
    }
}
