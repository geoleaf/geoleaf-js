/**
 * The GeoJSON Worker URL — the default next to the bundle, or the one a host sets.
 *
 * `_scriptBase` is computed ONCE, when `worker-manager` loads, and keeps only the bundle's
 * directory: the query string a host puts on the bundle (`?v=<content hash>`) never reaches the
 * worker. A host serving under a long cache lifetime therefore had no way to version the worker's
 * URL — and it only learns its own URL after the bundle has loaded. These cases pin both halves:
 * the host's URL is used EXACTLY, even when set after the module evaluated; without one, the
 * default is unchanged.
 *
 * ✅ Seen turning red by mutation on 22/09/2026: `_createWorker` building from
 * `_scriptBase + WORKER_FILENAME` again fails the eight cases that set a URL, and only them —
 * the two default cases hold; dropping `workerAvailable = true` from `setWorkerUrl` fails the
 * recovery case alone.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../src/utils/general/di-accessors.js", () => ({
    getLog: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

/** Where the page loaded the bundle from — the query must NOT reach the default worker URL. */
const BUNDLE_SRC = "https://cdn.example/lib/geoleaf.esm.js?v=abc123";
const DEFAULT_WORKER_URL = "https://cdn.example/lib/geojson-worker.js";
const HOST_WORKER_URL = "https://host.example/static/geoleaf/geojson-worker.js?v=3f9a2c";

type WorkerManagerModule = typeof import("../../src/kernel/geojson/worker-manager.js");
type WorkerManagerApi = WorkerManagerModule["WorkerManager"];

interface FakeWorker {
    postMessage: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
    onmessage: ((event: { data: unknown }) => void) | null;
    onerror: ((event: { message?: string; filename?: string }) => void) | null;
}

let WM: WorkerManagerApi;
let workers: FakeWorker[];
let WorkerCtor: ReturnType<typeof vi.fn>;
let workerOrigine: unknown;

/** Loads `worker-manager` afresh, with the page's `<script>` list showing the bundle. */
async function loadFresh(): Promise<void> {
    const scripts = vi
        .spyOn(document, "getElementsByTagName")
        .mockReturnValue([{ src: BUNDLE_SRC }] as unknown as HTMLCollectionOf<HTMLScriptElement>);
    vi.resetModules();
    WM = (await import("../../src/kernel/geojson/worker-manager.js")).WorkerManager;
    // The base is captured at evaluation: the spy has done its job once the import resolved.
    scripts.mockRestore();
}

/** Starts a load, which builds the Worker on first need; the promise is left pending. */
function triggerWorker(layerId = "l1"): void {
    void WM.fetchGeoJSON("https://data.example/layer.json", layerId).catch(() => {});
}

beforeEach(async () => {
    workers = [];
    workerOrigine = (globalThis as { Worker?: unknown }).Worker;
    WorkerCtor = vi.fn(function (this: FakeWorker) {
        this.postMessage = vi.fn();
        this.terminate = vi.fn();
        this.onmessage = null;
        this.onerror = null;
        workers.push(this);
    });
    (globalThis as { Worker?: unknown }).Worker = WorkerCtor;
    await loadFresh();
});

afterEach(() => {
    WM.dispose();
    (globalThis as { Worker?: unknown }).Worker = workerOrigine;
    vi.clearAllTimers();
});

describe("GeoJSON Worker URL", () => {
    it("without a host URL, the Worker comes from the bundle's directory — its query dropped", () => {
        triggerWorker();
        expect(WorkerCtor).toHaveBeenCalledTimes(1);
        expect(WorkerCtor).toHaveBeenCalledWith(DEFAULT_WORKER_URL);
    });

    it("a URL set AFTER the module loaded is the one the Worker is built from, exactly", () => {
        WM.setWorkerUrl(HOST_WORKER_URL);
        triggerWorker();
        expect(WorkerCtor).toHaveBeenCalledWith(HOST_WORKER_URL);
    });

    it("`null` restores the default", () => {
        WM.setWorkerUrl(HOST_WORKER_URL);
        WM.setWorkerUrl(null);
        triggerWorker();
        expect(WorkerCtor).toHaveBeenCalledWith(DEFAULT_WORKER_URL);
    });

    it.each([
        ["an empty string", ""],
        ["a blank string", "   "],
        ["a number", 42],
        ["an object", { href: HOST_WORKER_URL }],
        ["undefined", undefined],
    ])("refuses %s, and keeps the URL it had", (_label, value) => {
        WM.setWorkerUrl(HOST_WORKER_URL);
        expect(() => WM.setWorkerUrl(value as unknown as string)).toThrow(TypeError);
        triggerWorker();
        expect(WorkerCtor).toHaveBeenCalledWith(HOST_WORKER_URL);
    });

    it("a URL set survives `dispose()` — it is configuration, not state", () => {
        WM.setWorkerUrl(HOST_WORKER_URL);
        WM.dispose();
        triggerWorker();
        expect(WorkerCtor).toHaveBeenCalledWith(HOST_WORKER_URL);
    });

    it("a new URL clears an earlier Worker failure: the next load builds a Worker again", () => {
        triggerWorker("l1");
        expect(workers).toHaveLength(1);
        // The default URL answered 404: the manager falls back to the main thread for good.
        workers[0]!.onerror?.({ message: "" });
        expect(WM.isAvailable()).toBe(false);

        WM.setWorkerUrl(HOST_WORKER_URL);
        expect(WM.isAvailable()).toBe(true);
        triggerWorker("l2");
        expect(WorkerCtor).toHaveBeenCalledTimes(2);
        expect(WorkerCtor).toHaveBeenLastCalledWith(HOST_WORKER_URL);
    });
});
