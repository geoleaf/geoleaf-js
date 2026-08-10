import { describe, it, expect, vi } from "vitest";
import { jsonHeaders, bearer, fetchWithTimeout, parseJsonBody, HttpFetchError } from "../http.js";

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
