import { describe, it, expect, vi } from "vitest";
import {
    jsonHeaders,
    bearer,
    fetchWithTimeout,
    parseJsonBody,
    isSameOrigin,
    HttpFetchError,
} from "../http.js";

describe("jsonHeaders", () => {
    it("defaults to Content-Type only", () => {
        expect(jsonHeaders()).toEqual({ "Content-Type": "application/json" });
    });

    it("adds Authorization when provided", () => {
        expect(jsonHeaders({ authorization: "Bearer x" })).toEqual({
            "Content-Type": "application/json",
            Authorization: "Bearer x",
        });
    });

    it("omits Authorization when falsy", () => {
        expect(jsonHeaders({ authorization: null })).toEqual({
            "Content-Type": "application/json",
        });
        expect(jsonHeaders({ authorization: "" })).toEqual({
            "Content-Type": "application/json",
        });
    });

    it("adds X-Force-Update when force is true", () => {
        expect(jsonHeaders({ force: true })).toEqual({
            "Content-Type": "application/json",
            "X-Force-Update": "true",
        });
    });

    it("never sets X-Force-Update when force is falsy", () => {
        expect(jsonHeaders({ force: false })["X-Force-Update"]).toBeUndefined();
    });
});

describe("bearer", () => {
    it("formats a bearer value", () => {
        expect(bearer("abc")).toBe("Bearer abc");
    });
});

describe("fetchWithTimeout", () => {
    it("passes through a successful response and injects a signal", async () => {
        const res = new Response("ok", { status: 200 });
        const doFetch = vi.fn(async () => res);
        const out = await fetchWithTimeout(doFetch, "https://x/y", { method: "GET" }, 1000);
        expect(out).toBe(res);
        const init = doFetch.mock.calls[0][1] as RequestInit;
        expect(init.signal).toBeInstanceOf(AbortSignal);
        expect(init.method).toBe("GET");
    });

    it("throws HttpFetchError kind 'timeout' when the timeout fires", async () => {
        // doFetch never resolves on its own; it rejects only when aborted.
        const doFetch = vi.fn(
            (_url: string, init?: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener("abort", () => {
                        const err = new Error("aborted");
                        err.name = "AbortError";
                        reject(err);
                    });
                })
        ) as unknown as typeof fetch;

        await expect(fetchWithTimeout(doFetch, "https://x/y", {}, 5)).rejects.toMatchObject({
            name: "HttpFetchError",
            kind: "timeout",
        });
    });

    it("throws HttpFetchError kind 'network' on a non-abort rejection", async () => {
        const cause = new Error("boom");
        const doFetch = vi.fn(async () => {
            throw cause;
        }) as unknown as typeof fetch;

        const err = await fetchWithTimeout(doFetch, "https://x/y", {}, 1000).catch((e) => e);
        expect(err).toBeInstanceOf(HttpFetchError);
        expect(err.kind).toBe("network");
        expect(err.cause).toBe(cause);
    });

    it("throws HttpFetchError kind 'network' when doFetch is not a function", async () => {
        await expect(
            fetchWithTimeout(null as unknown as typeof fetch, "https://x/y", {}, 1000)
        ).rejects.toMatchObject({ name: "HttpFetchError", kind: "network" });
    });
});

describe("parseJsonBody", () => {
    it("returns {} for an empty body", async () => {
        expect(await parseJsonBody(new Response(""))).toEqual({});
    });

    it("parses a valid JSON body", async () => {
        expect(await parseJsonBody(new Response('{"a":1}'))).toEqual({ a: 1 });
    });

    it("propagates a SyntaxError on malformed JSON", async () => {
        await expect(parseJsonBody(new Response("{not json"))).rejects.toBeInstanceOf(SyntaxError);
    });
});

describe("isSameOrigin", () => {
    const BASE = "https://api.exemple.fr";

    it("accepts the same origin when the base has no path", () => {
        expect(isSameOrigin(`${BASE}/tiles/1/2/3.mvt`, BASE)).toBe(true);
    });

    it("accepts a URL under the base path (and the base path itself)", () => {
        expect(
            isSameOrigin("https://api.exemple.fr/v1/tiles/1.pbf", "https://api.exemple.fr/v1")
        ).toBe(true);
        expect(isSameOrigin("https://api.exemple.fr/v1", "https://api.exemple.fr/v1")).toBe(true);
    });

    it("rejects a path that only shares a prefix segment", () => {
        // /v1betrayal must NOT pass for base /v1 — the segment boundary matters.
        expect(isSameOrigin("https://api.exemple.fr/v1betrayal", "https://api.exemple.fr/v1")).toBe(
            false
        );
    });

    it("rejects a suffix host — the bug no. 4 credential leak", () => {
        // startsWith(base) returned true here and leaked the bearer; isSameOrigin must not.
        expect(isSameOrigin("https://api.exemple.fr.attaquant.tld/vol", BASE)).toBe(false);
    });

    it("rejects a different origin and a scheme downgrade", () => {
        expect(isSameOrigin("https://autre.tld/x", BASE)).toBe(false);
        expect(isSameOrigin("http://api.exemple.fr/x", BASE)).toBe(false);
    });

    it("rejects an unreadable URL — it belongs to nobody", () => {
        expect(isSameOrigin("http://", BASE)).toBe(false);
    });
});
