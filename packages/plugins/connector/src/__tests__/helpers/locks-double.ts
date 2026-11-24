/**
 * An in-memory `navigator.locks` double — exclusive locks only, what `pair-session.ts` asks.
 *
 * Each name holds a queue: a request runs once every earlier request of the same name has
 * settled, whatever its outcome. `_held` lists the names held right now, and `_requests`
 * counts the requests, so a suite can tell a renewal that went through the lock from one that
 * did not.
 */
export function makeLocksDouble() {
    const tails = new Map<string, Promise<unknown>>();
    const held = new Set<string>();
    let requests = 0;

    return {
        request<T>(name: string, callback: () => Promise<T>): Promise<T> {
            requests += 1;
            const before = tails.get(name) ?? Promise.resolve();
            const run = before
                .catch(() => undefined)
                .then(async () => {
                    held.add(name);
                    try {
                        return await callback();
                    } finally {
                        held.delete(name);
                    }
                });
            tails.set(
                name,
                run.catch(() => undefined)
            );
            return run;
        },
        get _held(): ReadonlySet<string> {
            return held;
        },
        get _requests(): number {
            return requests;
        },
    };
}
