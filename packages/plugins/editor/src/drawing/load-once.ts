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
 * redeploy while an old page is still open. Every later tool use then replayed the same
 * rejection, until a reload. A failed attempt — rejected, or resolved to `null` because what it
 * needs is not there yet — is now forgotten, so the next call runs `load` again (for the editor,
 * the engine's `import()` included).
 *
 * ⚠️ What this cannot promise: that the BROWSER fetches again. Not holding on to the failure is
 * all this loader does; what the browser makes of the next `import()` of the same URL is its own.
 * - After a redeploy that removed the old files, the open page still names the old
 *   content-hashed chunks (`geoleaf-editor.terra-draw-<hash>.js`): every retry fails, in every
 *   browser, until the page is reloaded.
 * - Some browsers keep a failed module fetch in their module map and reject a later `import()`
 *   of the same URL at once, without a request, until the page is reloaded. The HTML standard
 *   has been changed to stop caching such failures, but browsers adopt it at different times.
 *
 * So a retry recovers a transient network failure only where the browser really fetches again.
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
