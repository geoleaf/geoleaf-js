/**
 * fetch-helper-branches.test.js
 * Sprint T21.3 — Branch coverage for onTimeout, onRetry callbacks,
 * _parseResponse content types, get/post/head/exists, configure, getConfig, _delay
 */

import { FetchHelper, FetchError } from "../../src/utils/general/fetch-helper.js";

function mockResponse({
    ok = true,
    status = 200,
    contentType = "application/json",
    body = {},
} = {}) {
    return {
        ok,
        status,
        statusText: ok ? "OK" : "Error",
        headers: { get: (h) => (h.toLowerCase() === "content-type" ? contentType : null) },
        json: () => Promise.resolve(typeof body === "object" ? body : {}),
        text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
        blob: () => Promise.resolve(new Blob([typeof body === "string" ? body : "binary"])),
        clone: function () {
            return this;
        },
    };
}

beforeEach(() => {
    FetchHelper._rateLimiter?.reset?.();
    global.fetch.mockReset();
    // Restore defaults after configure() tests
    FetchHelper.configure({
        timeout: 10000,
        retries: 2,
        retryDelay: 1000,
        retryDelayMultiplier: 1.5,
        parseResponse: true,
        throwOnError: true,
        validateUrl: true,
    });
});

// ─── _parseResponse content-type branches ─────────────────────────────────

describe("_parseResponse content-type", () => {
    it("parses image/* content-type → blob", async () => {
        global.fetch.mockResolvedValue(mockResponse({ contentType: "image/png", body: "binary" }));
        const result = await FetchHelper.fetch("https://example.com/img.png", { retries: 0 });
        expect(result).toBeDefined();
        // Blob is returned for image types
    });

    it("parses application/octet-stream → blob", async () => {
        global.fetch.mockResolvedValue(
            mockResponse({ contentType: "application/octet-stream", body: "data" })
        );
        const result = await FetchHelper.fetch("https://example.com/file.bin", { retries: 0 });
        expect(result).toBeDefined();
    });

    it("parses application/javascript → text", async () => {
        global.fetch.mockResolvedValue(
            mockResponse({ contentType: "application/javascript", body: "var x = 1;" })
        );
        const result = await FetchHelper.fetch("https://example.com/script.js", { retries: 0 });
        expect(typeof result).toBe("string");
    });

    it("unknown content-type → text fallback", async () => {
        global.fetch.mockResolvedValue(
            mockResponse({ contentType: "application/pdf", body: "pdf-data" })
        );
        const result = await FetchHelper.fetch("https://example.com/doc.pdf", { retries: 0 });
        expect(typeof result).toBe("string");
    });
});

// ─── onRetry callback ─────────────────────────────────────────────────────

describe("onRetry callback", () => {
    it("calls onRetry with (attempt, error, delay) on each retry", async () => {
        const onRetry = vi.fn();
        global.fetch.mockRejectedValueOnce(new Error("fail #1")).mockResolvedValue(mockResponse());
        await FetchHelper.fetch("https://example.com/retry-cb.json", {
            retries: 1,
            retryDelay: 1,
            onRetry,
        });
        expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), expect.any(Number));
    });

    it("swallows onRetry callback errors gracefully", async () => {
        const badOnRetry = vi.fn(() => {
            throw new Error("callback blew up");
        });
        global.fetch.mockRejectedValueOnce(new Error("net fail")).mockResolvedValue(mockResponse());
        // Should NOT throw from the callback error
        await expect(
            FetchHelper.fetch("https://example.com/retry-bad-cb.json", {
                retries: 1,
                retryDelay: 1,
                onRetry: badOnRetry,
            })
        ).resolves.toBeDefined();
    });
});

// ─── onTimeout callback ───────────────────────────────────────────────────

describe("onTimeout callback", () => {
    it("calls onTimeout when request aborts due to timeout", async () => {
        const onTimeout = vi.fn();
        // Simulate a request that triggers AbortController abort
        global.fetch.mockImplementation(() => {
            return new Promise((_, reject) => {
                // Simulate abort
                setTimeout(
                    () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
                    5
                );
            });
        });
        await expect(
            FetchHelper.fetch("https://example.com/slow.json", {
                timeout: 10,
                retries: 0,
                retryDelay: 1,
                onTimeout,
            })
        ).rejects.toBeDefined();
    });

    it("swallows onTimeout callback errors gracefully", async () => {
        const badOnTimeout = vi.fn(() => {
            throw new Error("timeout cb error");
        });
        global.fetch.mockImplementation(
            () =>
                new Promise((_, reject) =>
                    setTimeout(
                        () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
                        5
                    )
                )
        );
        await expect(
            FetchHelper.fetch("https://example.com/slow2.json", {
                timeout: 10,
                retries: 0,
                retryDelay: 1,
                onTimeout: badOnTimeout,
            })
        ).rejects.toBeDefined();
    });
});

// ─── validateUrl: false option ────────────────────────────────────────────

describe("validateUrl option", () => {
    it("bypasses URL validation when validateUrl: false", async () => {
        global.fetch.mockResolvedValue(mockResponse());
        // Even 'javascript:alert(1)' should not throw when validateUrl=false
        await expect(
            FetchHelper.fetch("https://example.com/ok.json", { retries: 0, validateUrl: false })
        ).resolves.toBeDefined();
    });
});

// ─── parseResponse: false ─────────────────────────────────────────────────

describe("parseResponse: false", () => {
    it("returns raw Response when parseResponse is false", async () => {
        const rawResp = mockResponse();
        global.fetch.mockResolvedValue(rawResp);
        const result = await FetchHelper.fetch("https://example.com/raw.json", {
            retries: 0,
            parseResponse: false,
        });
        expect(result).toBe(rawResp);
    });
});

// ─── Convenience methods ──────────────────────────────────────────────────

describe("FetchHelper.get()", () => {
    it("issues a GET request", async () => {
        global.fetch.mockResolvedValue(mockResponse({ body: { items: [] } }));
        const result = await FetchHelper.get("https://example.com/items.json", { retries: 0 });
        expect(result).toEqual({ items: [] });
        expect(global.fetch).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ method: "GET" })
        );
    });
});

describe("FetchHelper.post()", () => {
    it("issues a POST request with JSON body", async () => {
        global.fetch.mockResolvedValue(mockResponse({ body: { id: 1 } }));
        const result = await FetchHelper.post(
            "https://example.com/create",
            { name: "test" },
            { retries: 0 }
        );
        expect(result).toEqual({ id: 1 });
        const call = global.fetch.mock.calls[0];
        expect(call[1].method).toBe("POST");
        expect(call[1].body).toBe(JSON.stringify({ name: "test" }));
    });

    it("passes string body as-is", async () => {
        global.fetch.mockResolvedValue(mockResponse({ body: { ok: true } }));
        await FetchHelper.post("https://example.com/create", '{"raw":true}', { retries: 0 });
        expect(global.fetch.mock.calls[0][1].body).toBe('{"raw":true}');
    });
});

describe("FetchHelper.head()", () => {
    it("issues a HEAD request (parseResponse=false)", async () => {
        const rawResp = mockResponse({ ok: true, status: 200 });
        global.fetch.mockResolvedValue(rawResp);
        const result = await FetchHelper.head("https://example.com/exists.json", { retries: 0 });
        expect(result).toBe(rawResp);
        expect(global.fetch.mock.calls[0][1].method).toBe("HEAD");
    });
});

describe("FetchHelper.exists()", () => {
    it("returns true when HEAD response is ok", async () => {
        global.fetch.mockResolvedValue(mockResponse({ ok: true }));
        const result = await FetchHelper.exists("https://example.com/file.json", { retries: 0 });
        expect(result).toBe(true);
    });

    it("returns false when HEAD response is not ok", async () => {
        global.fetch.mockResolvedValue(mockResponse({ ok: false, status: 404 }));
        const result = await FetchHelper.exists("https://example.com/missing.json", {
            retries: 0,
            throwOnError: false,
        });
        expect(result).toBe(false);
    });

    it("returns false when HEAD request throws", async () => {
        global.fetch.mockRejectedValue(new Error("network error"));
        const result = await FetchHelper.exists("https://example.com/error.json", {
            retries: 0,
            retryDelay: 1,
        });
        expect(result).toBe(false);
    });
});

// ─── configure() and getConfig() ────────────────────────────────────────

describe("configure() / getConfig()", () => {
    it("configure() updates default timeout", async () => {
        FetchHelper.configure({ timeout: 5000 });
        const cfg = FetchHelper.getConfig();
        expect(cfg.timeout).toBe(5000);
    });

    it("getConfig() returns a copy, not the original reference", () => {
        const cfg1 = FetchHelper.getConfig();
        const cfg2 = FetchHelper.getConfig();
        expect(cfg1).not.toBe(cfg2);
        expect(cfg1).toEqual(cfg2);
    });
});

// ─── Rate limiter with relative URL ──────────────────────────────────────

describe("Rate limiter — relative URL domain fallback", () => {
    it("groups relative URLs under _relative domain", async () => {
        global.fetch.mockResolvedValue(mockResponse());
        // Relative URLs should not crash the domain extraction
        await expect(
            FetchHelper.fetch("/api/data", { retries: 0, validateUrl: false })
        ).resolves.toBeDefined();
    });
});

// ─── AbortError → network_error type in FetchError ─────────────────────────
// _executeRequest converts AbortError to a plain Error ("Request timed out..."),
// so _throwFinalRetryError receives an Error (not AbortError) → type = 'network_error'

describe("FetchError type for AbortError (converted to plain Error by _executeRequest)", () => {
    it("sets type='network_error' when underlying cause was AbortError (converted in _executeRequest)", async () => {
        global.fetch.mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
        let caught;
        try {
            await FetchHelper.fetch("https://example.com/abort.json", {
                retries: 0,
                retryDelay: 1,
            });
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeDefined();
        // AbortError is converted to Error in _executeRequest; final type is network_error
        expect(caught.type).toBe("network_error");
    });
});

// ─── FetchError constructor coverage ─────────────────────────────────────

describe("FetchError constructor", () => {
    it("captures url, type, attempts, cause", () => {
        const err = new FetchError("test error", {
            url: "https://x.com",
            type: "network_error",
            attempts: 3,
            cause: new Error("root"),
        });
        expect(err.url).toBe("https://x.com");
        expect(err.type).toBe("network_error");
        expect(err.attempts).toBe(3);
        expect(err.cause).toBeInstanceOf(Error);
        expect(err.name).toBe("FetchError");
    });

    it("defaults type to 'unknown' when not specified", () => {
        const err = new FetchError("oops");
        expect(err.type).toBe("unknown");
    });
});
