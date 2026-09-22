/**
 * `loadOnce` — the drawing engine is fetched on the first tool use, and a failed fetch must not
 * be remembered for the life of the page.
 *
 * The editor memoised a plain promise. Once the Terra Draw chunk is REALLY fetched on demand —
 * it used to leave with the plugin, through a static import that made the laziness void — the
 * first outcome can be a failure: no network in the field, a chunk gone after a redeploy. Every
 * later tool use would have replayed that rejection until a reload.
 *
 * ✅ Seen turning red by mutation on 22/09/2026: dropping the reset from the rejection branch
 * fails the retry-after-rejection and synchronous-throw cases; dropping it from the `null`
 * branch fails the retry-after-null case; dropping the `current === attempt` guard from the
 * rejection branch fails the stale-failure case.
 */

import { describe, it, expect, vi } from "vitest";
import { loadOnce } from "../drawing/load-once.js";

/** A promise whose settlement the test controls. */
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe("loadOnce", () => {
    it("shares ONE attempt between concurrent callers", async () => {
        const d = deferred<string | null>();
        const load = vi.fn(() => d.promise);
        const loader = loadOnce(load);

        const a = loader.get();
        const b = loader.get();
        d.resolve("engine");

        await expect(a).resolves.toBe("engine");
        await expect(b).resolves.toBe("engine");
        expect(load).toHaveBeenCalledTimes(1);
    });

    it("remembers a success", async () => {
        const load = vi.fn(async () => "engine");
        const loader = loadOnce(load);

        await loader.get();
        await expect(loader.get()).resolves.toBe("engine");
        expect(load).toHaveBeenCalledTimes(1);
    });

    it("forgets a rejection: the next call tries again", async () => {
        const load = vi
            .fn<() => Promise<string | null>>()
            .mockRejectedValueOnce(new Error("chunk unreachable"))
            .mockResolvedValueOnce("engine");
        const loader = loadOnce(load);

        await expect(loader.get()).rejects.toThrow("chunk unreachable");
        await expect(loader.get()).resolves.toBe("engine");
        expect(load).toHaveBeenCalledTimes(2);
    });

    it("forgets a `null`: what the load needs was not there yet", async () => {
        const load = vi
            .fn<() => Promise<string | null>>()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce("engine");
        const loader = loadOnce(load);

        await expect(loader.get()).resolves.toBeNull();
        await expect(loader.get()).resolves.toBe("engine");
        expect(load).toHaveBeenCalledTimes(2);
    });

    it("turns a synchronous throw into a rejection, forgotten like one", async () => {
        let calls = 0;
        const loader = loadOnce<string>(() => {
            calls++;
            if (calls === 1) throw new Error("threw before any promise");
            return Promise.resolve("engine");
        });

        await expect(loader.get()).rejects.toThrow("threw before any promise");
        await expect(loader.get()).resolves.toBe("engine");
    });

    it("`reset()` forgets a success too", async () => {
        const load = vi.fn(async () => "engine");
        const loader = loadOnce(load);

        await loader.get();
        loader.reset();
        await loader.get();
        expect(load).toHaveBeenCalledTimes(2);
    });

    it("a stale attempt failing late does not erase the newer one", async () => {
        const stale = deferred<string | null>();
        const load = vi
            .fn<() => Promise<string | null>>()
            .mockReturnValueOnce(stale.promise)
            .mockResolvedValueOnce("engine");
        const loader = loadOnce(load);

        const first = loader.get();
        loader.reset(); // a teardown while the first attempt is in flight
        await expect(loader.get()).resolves.toBe("engine");

        stale.reject(new Error("late failure"));
        await expect(first).rejects.toThrow("late failure");
        // The newer success is still the shared one: no third load.
        await expect(loader.get()).resolves.toBe("engine");
        expect(load).toHaveBeenCalledTimes(2);
    });
});
