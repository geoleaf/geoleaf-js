/*!
 * @geoleaf-plugins/editor — Load once, remember only success
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * A loader that shares ONE attempt between concurrent callers, and remembers only a success.
 *
 * The drawing engine is a lazy chunk, fetched on the first tool use. A plain memoised promise
 * kept its first outcome for the life of the page — and once the chunk is really fetched on
 * demand, that first outcome can be a failure: no network in the field, or a chunk gone after a
 * redeploy while an old page is still open. Every later tool use would then have replayed the
 * same rejection, until a reload. A failed attempt — rejected, or resolved to `null` because
 * what it needs is not there yet — is forgotten, so the next call tries again.
 */
interface LoadOnce<T> {
    /** The shared attempt: the one in flight or already succeeded, else a new one. */
    get(): Promise<T | null>;
    /** Forgets everything, success included — for a teardown. */
    reset(): void;
}

/**
 * Wraps `load` so that concurrent callers share one attempt and only a success is kept.
 *
 * @param load - Produces the value; resolves `null` when it cannot yet, rejects on failure.
 * @returns The shared loader.
 */
export function loadOnce<T>(load: () => Promise<T | null>): LoadOnce<T> {
    let current: Promise<T | null> | null = null;
    return {
        get(): Promise<T | null> {
            if (current) return current;
            // `Promise.resolve().then(load)` rather than `load()`: a loader that throws
            // synchronously becomes a rejection like any other, and is forgotten like one.
            const attempt: Promise<T | null> = Promise.resolve()
                .then(load)
                .then(
                    (value) => {
                        if (value === null && current === attempt) current = null;
                        return value;
                    },
                    (err: unknown) => {
                        if (current === attempt) current = null;
                        throw err;
                    }
                );
            current = attempt;
            return attempt;
        },
        reset(): void {
            current = null;
        },
    };
}
