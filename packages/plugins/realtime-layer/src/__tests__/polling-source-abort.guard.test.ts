/**
 * GUARD — `PollingSource.stop()` keeps the in-flight request from calling the handler back.
 *
 * 🛑 THE DEFECT. `stop()` did `clearInterval` + `removeEventListener` and
 * **nothing else**: it closed the front door — no more ticks, no more
 * wake-ups on `visibilitychange` — but not the request **already gone**. Its
 * continuation calls `this._handler` back, which pushes data into a layer the
 * caller just stopped.
 *
 * ── WHY THE ORACLE IS DIRECT HERE, WHEN IT COULD NOT BE FOR `legend` ──────────────────────
 *
 * `legend.ts`'s twin guard could not be made load-bearing on its microtask
 * window: its effect goes through `_applyStyleToLegend`, which only writes
 * conditionally. Here the effect **is** the handler call, and a handler is a
 * spy. Both windows are therefore exercised:
 *
 *   · **network window** — `stop()` before the response: the signal is
 *     aborted, the `fetch` rejects;
 *   · **microtask window** — the response arrived, `stop()` lands while the
 *     body is being read (itself an `await`), and the `signal.aborted` test
 *     is what holds the handler back.
 *
 * ✅ Both seen turning red by mutation on 17/08/2026.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PollingSource } from "../sources/polling-source.js";

let fetchOrigine: typeof globalThis.fetch;

beforeEach(() => {
    fetchOrigine = globalThis.fetch;
});
afterEach(() => {
    globalThis.fetch = fetchOrigine;
    vi.restoreAllMocks();
});

describe("garde — PollingSource.stop() annule ce qui est en vol", () => {
    it("le signal est TRANSMIS au fetch — sinon rien de ce qui suit ne veut dire quelque chose", () => {
        let signal: AbortSignal | undefined;
        globalThis.fetch = vi.fn((_u: string, init?: RequestInit) => {
            signal = init?.signal ?? undefined;
            return new Promise<Response>(() => {}); // jamais résolue
        }) as unknown as typeof globalThis.fetch;

        const src = new PollingSource("https://exemple.test/a.json", 60_000, "json");
        src.onData(() => {});
        src.start();

        // 🛑 Anti-empty-guard: `start()` fires an immediate fetch. If it
        // stopped doing so, the next two cases would pass exercising nothing.
        expect(globalThis.fetch, "aucun fetch au démarrage").toHaveBeenCalled();
        expect(signal, "`fetch` appelé SANS signal").toBeInstanceOf(AbortSignal);
        expect(signal?.aborted).toBe(false);

        src.stop();
        expect(signal?.aborted, "`stop()` n'a pas avorté la requête en vol").toBe(true);
    });

    it("fenêtre MICRO-TÂCHE — `stop()` pendant la lecture du corps : le handler n'est PAS rappelé", async () => {
        let libererCorps!: (v: unknown) => void;
        const corps = new Promise<unknown>((r) => (libererCorps = r));

        globalThis.fetch = vi.fn(
            (_u: string, init?: RequestInit) =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    // Reading the body is asynchronous: THIS is the window
                    // `abort()` can no longer close, the request being already done.
                    json: () => corps,
                    _signal: init?.signal,
                }) as unknown as Promise<Response>
        ) as unknown as typeof globalThis.fetch;

        const handler = vi.fn();
        const src = new PollingSource("https://exemple.test/b.json", 60_000, "json");
        src.onData(handler);
        src.start();

        // We let the response arrive, then stop DURING the body read.
        await Promise.resolve();
        src.stop();
        libererCorps({ type: "FeatureCollection", features: [] });

        await new Promise((r) => setTimeout(r, 0));

        expect(
            handler,
            "le handler a été rappelé APRÈS stop() : la source pousse dans une couche arrêtée"
        ).not.toHaveBeenCalled();
    });

    it("un `start()` après `stop()` refonctionne — le contrôleur avorté n'est pas réutilisé", async () => {
        const handler = vi.fn();
        globalThis.fetch = vi.fn(
            (_u: string, init?: RequestInit) =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({ ok: true }),
                    _s: init?.signal,
                }) as unknown as Promise<Response>
        ) as unknown as typeof globalThis.fetch;

        const src = new PollingSource("https://exemple.test/c.json", 60_000, "json");
        src.onData(handler);
        src.start();
        src.stop();
        handler.mockClear();

        // 🛑 An aborted `AbortController` is aborted FOR LIFE. If `stop()`
        // kept it, this second cycle would fail outright — and `start()` after
        // `stop()` is a NORMAL cycle here.
        src.start();
        await new Promise((r) => setTimeout(r, 0));
        src.stop();

        expect(
            handler,
            "le second cycle n'a rien reçu : le contrôleur avorté a été réutilisé"
        ).toHaveBeenCalled();
    });
});
