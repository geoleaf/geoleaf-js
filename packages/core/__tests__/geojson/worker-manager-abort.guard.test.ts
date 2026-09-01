/**
 * GUARD — `dispose()` also cancels the MAIN-THREAD fallbacks, not only the Worker's requests.
 *
 * 🛑 THE DEFECT, AND WHY ITS OWNER DID NOT SEE IT.
 *
 * `WorkerManager.dispose()` already covered what goes through the Worker: it
 * rejects **all** `_state.pending` entries and `terminate()`s the worker.
 * But the **two main-thread fallbacks** — `_mainThreadFetch()` and the text
 * fallback — return a **direct** `fetch` promise and never enter `pending`.
 * Their lifecycle owner **existed and ignored them**: the `fetch` survived
 * the `dispose()` and resolved into a torn-down caller.
 *
 * 📌 The most discreet shape of the defect this work treats. Not a lifecycle
 * missing — **one branch** of it: the one that does not go through the
 * registry the teardown sweeps.
 *
 * ✅ Seen turning red by mutation on 17/08/2026: removing `dispose()`'s
 * `abort()` leaves the signal unaborted, and this file fails.
 *
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { WorkerManager } = await import("../../src/kernel/geojson/worker-manager.js");

let fetchOrigine: typeof globalThis.fetch;
let workerOrigine: typeof globalThis.Worker | undefined;

beforeEach(() => {
    fetchOrigine = globalThis.fetch;
    workerOrigine = globalThis.Worker;
    // 🛑 Force the FALLBACK path: without Worker, `_createWorker()` returns
    // `null` and the manager takes the main thread. The branch `dispose()`
    // did not see.
    // @ts-expect-error — the constructor is removed on purpose
    delete globalThis.Worker;
});

afterEach(() => {
    globalThis.fetch = fetchOrigine;
    if (workerOrigine) globalThis.Worker = workerOrigine;
    WorkerManager.dispose();
    vi.restoreAllMocks();
});

describe("garde — dispose() atteint les replis main-thread", () => {
    it("le repli passe un signal, et `dispose()` l'avorte", async () => {
        let signal: AbortSignal | undefined;
        globalThis.fetch = vi.fn((_u: string, init?: RequestInit) => {
            signal = init?.signal ?? undefined;
            return new Promise<Response>(() => {}); // jamais résolue : la requête reste en vol
        }) as unknown as typeof globalThis.fetch;

        // The promise is not awaited: the IN-FLIGHT state is wanted.
        void WorkerManager.fetchGeoJSON("https://exemple.test/couche.json", "couche-a");
        await Promise.resolve();

        // 🛑 Anti-empty-gate: if the manager had taken the Worker path, or
        // launched nothing, the next assertion would pass exercising nothing.
        expect(
            globalThis.fetch,
            "aucun fetch de repli : le chemin testé n'a pas été pris"
        ).toHaveBeenCalled();
        expect(signal, "le repli main-thread part SANS signal").toBeInstanceOf(AbortSignal);
        expect(signal?.aborted).toBe(false);

        WorkerManager.dispose();

        expect(
            signal?.aborted,
            "`dispose()` n'a pas avorté le repli main-thread : il ne balaie que `_state.pending`"
        ).toBe(true);
    });

    it("un appel APRÈS `dispose()` refonctionne — le contrôleur avorté n'est pas réutilisé", async () => {
        let signal: AbortSignal | undefined;
        globalThis.fetch = vi.fn((_u: string, init?: RequestInit) => {
            signal = init?.signal ?? undefined;
            return new Promise<Response>(() => {});
        }) as unknown as typeof globalThis.fetch;

        void WorkerManager.fetchGeoJSON("https://exemple.test/1.json", "c1");
        await Promise.resolve();
        WorkerManager.dispose();

        // 🛑 The manager is a LAZY singleton: it serves again after
        // `dispose()`. An aborted `AbortController` is aborted for life —
        // keeping it would fail this second cycle outright, with nothing saying so.
        void WorkerManager.fetchGeoJSON("https://exemple.test/2.json", "c2");
        await Promise.resolve();

        expect(
            signal?.aborted,
            "le second cycle est parti avec un signal DÉJÀ avorté : le contrôleur a été réutilisé"
        ).toBe(false);
    });
});
