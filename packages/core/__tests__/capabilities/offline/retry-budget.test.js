/**
 * Unit tests — RetryHandler's budget is a count of ATTEMPTS, not of retries (CAPACITÉS B.16).
 *
 * The option was called `maxRetries` but the loop is `for (attempt = 1; attempt <= budget)`:
 * `3` bought 3 attempts (1 try + 2 retries), not 4. The name is not merely cosmetic —
 * `maxRetries: 0`, the obvious way to spell "do not retry", made the loop body unreachable:
 * the operation was NEVER invoked and `retry()` rejected with `undefined` (the untouched
 * `lastError`), i.e. a download silently reported a failure it had never attempted.
 *
 * Canonical name is now `maxAttempts`; `maxRetries` stays accepted as a deprecated alias
 * so no existing profile config silently falls back to the default.
 */

import { RetryHandler } from "../../../src/capabilities/offline/cache/retry-handler.js";

describe("RetryHandler — attempt budget", () => {
    afterEach(() => {
        vi.useRealTimers();
        // Restore the module defaults — the object is a singleton shared across tests.
        RetryHandler.init({
            maxAttempts: 3,
            initialDelay: 1000,
            maxDelay: 5000,
            backoffMultiplier: 2,
        });
    });

    test("maxAttempts counts TOTAL attempts (1 initial + N-1 retries)", async () => {
        vi.useFakeTimers();
        const op = vi.fn().mockRejectedValue(new Error("always"));
        const p = RetryHandler.retry(op, { maxAttempts: 3, resourceName: "x" });
        const assertion = expect(p).rejects.toThrow("always");
        await vi.runAllTimersAsync();
        await assertion;
        expect(op).toHaveBeenCalledTimes(3);
    });

    test("maxRetries is still honoured as a deprecated alias of maxAttempts", async () => {
        const op = vi.fn().mockRejectedValue(new Error("always"));
        await expect(RetryHandler.retry(op, { maxRetries: 1, resourceName: "x" })).rejects.toThrow(
            "always"
        );
        expect(op).toHaveBeenCalledTimes(1);
    });

    test("a zero budget still makes one attempt and surfaces the real error", async () => {
        const op = vi.fn().mockRejectedValue(new Error("boom"));
        await expect(RetryHandler.retry(op, { maxAttempts: 0, resourceName: "z" })).rejects.toThrow(
            "boom"
        );
        expect(op).toHaveBeenCalledTimes(1);
    });

    test("a zero budget spelled with the deprecated alias behaves identically", async () => {
        const op = vi.fn().mockRejectedValue(new Error("boom"));
        await expect(RetryHandler.retry(op, { maxRetries: 0, resourceName: "z" })).rejects.toThrow(
            "boom"
        );
        expect(op).toHaveBeenCalledTimes(1);
    });

    test("a negative budget cannot silently skip the operation either", async () => {
        const op = vi.fn().mockResolvedValue("ok");
        await expect(RetryHandler.retry(op, { maxAttempts: -5 })).resolves.toBe("ok");
        expect(op).toHaveBeenCalledTimes(1);
    });

    test("init() stores the budget under the canonical name", () => {
        RetryHandler.init({ maxAttempts: 7 });
        expect(RetryHandler.getConfig().maxAttempts).toBe(7);
    });

    test("init() accepts the deprecated alias and normalises it away", () => {
        RetryHandler.init({ maxRetries: 5 });
        const cfg = RetryHandler.getConfig();
        expect(cfg.maxAttempts).toBe(5);
        // No shadow copy left behind: one key, one source of truth.
        expect(cfg.maxRetries).toBeUndefined();
    });

    test("the configured budget drives retry() when no per-call override is given", async () => {
        vi.useFakeTimers();
        RetryHandler.init({ maxAttempts: 2, initialDelay: 1 });
        const op = vi.fn().mockRejectedValue(new Error("always"));
        const p = RetryHandler.retry(op, { resourceName: "x" });
        const assertion = expect(p).rejects.toThrow("always");
        await vi.runAllTimersAsync();
        await assertion;
        expect(op).toHaveBeenCalledTimes(2);
    });
});
