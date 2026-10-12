/**
 * @geoleaf-plugins/isochrone — the transport
 *
 * 🛑 **Nothing here touches the network.** `fetch` is replaced for the whole file.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchIsochroneJson } from "../providers/http.js";

const URL_ = "https://engine.example/isochrone?json=%7B%7D";

/**
 * Installs a `fetch` that answers once.
 *
 * @param status HTTP status.
 * @param json What `json()` does: a value to resolve with, or an error to throw.
 * @returns The spy, so the request itself can be asserted.
 */
function answering(status: number, json: unknown): ReturnType<typeof vi.fn> {
    const spy = vi.fn(async () => ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => {
            if (json instanceof Error) throw json;
            return json;
        },
    }));
    vi.stubGlobal("fetch", spy);
    return spy;
}

/**
 * Installs a `fetch` that never answers, and rejects when its signal aborts — what a real
 * `fetch` does.
 *
 * @returns The spy.
 */
function hanging(): ReturnType<typeof vi.fn> {
    const spy = vi.fn(
        (_url: string, init: RequestInit) =>
            new Promise((_resolve, reject) => {
                init.signal?.addEventListener("abort", () =>
                    reject(new DOMException("aborted", "AbortError"))
                );
            })
    );
    vi.stubGlobal("fetch", spy);
    return spy;
}

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("@geoleaf-plugins/isochrone — fetchIsochroneJson", () => {
    it("answers the parsed body of a 200", async () => {
        const spy = answering(200, { features: [] });
        const out = await fetchIsochroneJson(URL_, new AbortController().signal, 1000);
        expect(out).toEqual({ ok: true, body: { features: [] } });
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0]?.[0]).toBe(URL_);
        expect((spy.mock.calls[0]?.[1] as RequestInit).method).toBe("GET");
    });

    it("answers `http` with the status and the parsed body of a refusal", async () => {
        answering(400, { error_code: 151, error: "Exceeded max time: 60" });
        const out = await fetchIsochroneJson(URL_, new AbortController().signal, 1000);
        expect(out).toEqual({
            ok: false,
            reason: "http",
            status: 400,
            refusal: { error_code: 151, error: "Exceeded max time: 60" },
        });
    });

    it("answers `http` with the status alone when the refusal cannot be read", async () => {
        answering(502, new SyntaxError("Unexpected token <"));
        const out = await fetchIsochroneJson(URL_, new AbortController().signal, 1000);
        expect(out).toEqual({ ok: false, reason: "http", status: 502 });
    });

    it("answers `malformed` for a 200 whose body is not JSON", async () => {
        answering(200, new SyntaxError("Unexpected token <"));
        const out = await fetchIsochroneJson(URL_, new AbortController().signal, 1000);
        expect(out).toEqual({ ok: false, reason: "malformed" });
    });

    it("answers `network` when the request does not go through", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new TypeError("Failed to fetch");
            })
        );
        const out = await fetchIsochroneJson(URL_, new AbortController().signal, 1000);
        expect(out).toEqual({ ok: false, reason: "network" });
    });

    it("answers `timeout` when the engine does not answer in time, and aborts the request", async () => {
        vi.useFakeTimers();
        const spy = hanging();
        const pending = fetchIsochroneJson(URL_, new AbortController().signal, 1000);
        await vi.advanceTimersByTimeAsync(1000);
        expect(await pending).toEqual({ ok: false, reason: "timeout" });
        expect((spy.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(true);
    });

    it("answers `aborted` when the caller cancels while the engine is asked", async () => {
        const spy = hanging();
        const caller = new AbortController();
        const pending = fetchIsochroneJson(URL_, caller.signal, 60_000);
        caller.abort();
        expect(await pending).toEqual({ ok: false, reason: "aborted" });
        expect((spy.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(true);
    });

    it("answers `aborted` without calling the engine when the caller had already cancelled", async () => {
        const spy = answering(200, {});
        const caller = new AbortController();
        caller.abort();
        expect(await fetchIsochroneJson(URL_, caller.signal, 1000)).toEqual({
            ok: false,
            reason: "aborted",
        });
        expect(spy).not.toHaveBeenCalled();
    });

    it("names a cancellation that lands while the body is being read — not `malformed`", async () => {
        const caller = new AbortController();
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => ({
                ok: true,
                status: 200,
                json: async () => {
                    caller.abort();
                    throw new DOMException("aborted", "AbortError");
                },
            }))
        );
        expect(await fetchIsochroneJson(URL_, caller.signal, 1000)).toEqual({
            ok: false,
            reason: "aborted",
        });
    });

    it("disarms its timer once the engine has answered", async () => {
        vi.useFakeTimers();
        answering(200, { features: [] });
        const out = await fetchIsochroneJson(URL_, new AbortController().signal, 1000);
        expect(out.ok).toBe(true);
        // Read BEFORE any time passes: a timer left armed is still counted here, and it would
        // have fired — and vanished — had the clock been advanced first.
        expect(vi.getTimerCount()).toBe(0);
    });

    it("stops listening to the caller's signal once it has answered", async () => {
        answering(200, { features: [] });
        const caller = new AbortController();
        const remove = vi.spyOn(caller.signal, "removeEventListener");
        await fetchIsochroneJson(URL_, caller.signal, 1000);
        expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    });
});
