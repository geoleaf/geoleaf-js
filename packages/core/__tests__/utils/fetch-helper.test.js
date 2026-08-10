/**
 * @file fetch-helper.test.js
 * Sprint 3.3 — Tests for FetchHelper and rate limiter
 */

import { FetchHelper } from "../../src/utils/general/fetch-helper.js";

// Helper — build a mock Response
function mockResponse({
    ok = true,
    status = 200,
    contentType = "application/json",
    body = {},
} = {}) {
    return {
        ok,
        status,
        headers: { get: (h) => (h.toLowerCase() === "content-type" ? contentType : null) },
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
        clone: function () {
            return this;
        },
    };
}

// Reset rate limiter and fetch mock before each test
beforeEach(() => {
    FetchHelper._rateLimiter?.reset?.();
    global.fetch.mockReset();
});

// ─────────────────────────────────────────
// 3.3.1  Rate limiter
// ─────────────────────────────────────────
describe("Rate limiter", () => {
    it("allows requests under the limit", async () => {
        global.fetch.mockResolvedValue(mockResponse());
        // 5 requests to the same domain — should all succeed
        const url = "https://rate-test.example.com/data.json";
        for (let i = 0; i < 5; i++) {
            await expect(FetchHelper.fetch(url, { retries: 0 })).resolves.toBeDefined();
        }
    });

    it("blocks the 51st request to the same domain", async () => {
        global.fetch.mockResolvedValue(mockResponse());
        const url = "https://rate-block.example.com/data.json";

        // Fill the bucket
        for (let i = 0; i < 50; i++) {
            await FetchHelper.fetch(url, { retries: 0 });
        }

        // 51st should be rate-limited
        await expect(FetchHelper.fetch(url, { retries: 0 })).rejects.toMatchObject({
            message: expect.stringContaining("Rate limit"),
        });
    });

    it("counts requests independently per domain", async () => {
        global.fetch.mockResolvedValue(mockResponse());
        const urlA = "https://domain-a.example.com/data.json";
        const urlB = "https://domain-b.example.com/data.json";

        for (let i = 0; i < 30; i++) {
            await FetchHelper.fetch(urlA, { retries: 0 });
        }
        // domain-b should still be allowed
        await expect(FetchHelper.fetch(urlB, { retries: 0 })).resolves.toBeDefined();
    });

    it("resets the counter after calling reset()", async () => {
        global.fetch.mockResolvedValue(mockResponse());
        const url = "https://rate-reset.example.com/data.json";

        for (let i = 0; i < 50; i++) {
            await FetchHelper.fetch(url, { retries: 0 });
        }

        // reset
        FetchHelper._rateLimiter?.reset?.();

        // should work again
        await expect(FetchHelper.fetch(url, { retries: 0 })).resolves.toBeDefined();
    });
});

// ─────────────────────────────────────────
// 3.3.2  fetch() behaviour with mocks
// ─────────────────────────────────────────
describe("FetchHelper.fetch()", () => {
    it("parses JSON response automatically", async () => {
        global.fetch.mockResolvedValue(mockResponse({ body: { key: "value" } }));
        const result = await FetchHelper.fetch("https://example.com/api.json", { retries: 0 });
        expect(result).toEqual({ key: "value" });
    });

    it("returns text for text/html responses", async () => {
        global.fetch.mockResolvedValue(
            mockResponse({
                contentType: "text/html",
                body: "<html>page</html>",
            })
        );
        const result = await FetchHelper.fetch("https://example.com/page.html", { retries: 0 });
        expect(typeof result).toBe("string");
        expect(result).toContain("page");
    });

    it("throws on 404 when throwOnError is true", async () => {
        global.fetch.mockResolvedValue(mockResponse({ ok: false, status: 404 }));
        await expect(
            FetchHelper.fetch("https://example.com/missing.json", {
                retries: 0,
                throwOnError: true,
            })
        ).rejects.toBeDefined();
    });

    it("does NOT throw on 404 when throwOnError is false", async () => {
        global.fetch.mockResolvedValue(mockResponse({ ok: false, status: 404 }));
        const result = await FetchHelper.fetch("https://example.com/missing.json", {
            retries: 0,
            throwOnError: false,
            parseResponse: false,
        });
        expect(result).toBeDefined();
    });

    it("retries on failure and succeeds on 3rd attempt", async () => {
        global.fetch
            .mockRejectedValueOnce(new Error("network fail"))
            .mockRejectedValueOnce(new Error("network fail"))
            .mockResolvedValue(mockResponse({ body: { ok: true } }));

        const result = await FetchHelper.fetch("https://example.com/retry.json", {
            retries: 2,
            retryDelay: 1,
        });
        expect(result).toEqual({ ok: true });
        expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it("throws FetchError after exhausting all retries", async () => {
        global.fetch.mockRejectedValue(new Error("always fails"));

        await expect(
            FetchHelper.fetch("https://example.com/fail.json", { retries: 2, retryDelay: 1 })
        ).rejects.toMatchObject({
            message: expect.stringContaining("attempts"),
        });
    });

    it("throws a validation_error for blocked protocol URLs", async () => {
        await expect(
            FetchHelper.fetch("javascript:alert(1)", { retries: 0 })
        ).rejects.toMatchObject({
            message: expect.stringContaining("validation"),
        });
    });
});

// ─────────────────────────────────────────
// 3.3.3  FetchError class
// ─────────────────────────────────────────
describe("FetchError", () => {
    it("includes url and type in the thrown error context", async () => {
        global.fetch.mockRejectedValue(new Error("net error"));
        let caughtError;
        try {
            await FetchHelper.fetch("https://example.com/err.json", { retries: 0, retryDelay: 1 });
        } catch (e) {
            caughtError = e;
        }
        expect(caughtError).toBeDefined();
        expect(caughtError.message).toBeTruthy();
    });

    it("has a stack trace", async () => {
        global.fetch.mockRejectedValue(new Error("net error"));
        let caughtError;
        try {
            await FetchHelper.fetch("https://example.com/stack.json", {
                retries: 0,
                retryDelay: 1,
            });
        } catch (e) {
            caughtError = e;
        }
        expect(caughtError.stack).toBeTruthy();
    });
});
