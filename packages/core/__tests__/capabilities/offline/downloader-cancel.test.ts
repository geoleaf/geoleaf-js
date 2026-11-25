/**
 * A cancelled download says « cancelled », and only that.
 *
 * The workers leave their loop with a `break` when the run is aborted — no throw. The run then
 * went on to the summary and dispatched `geoleaf:cache:completed`, after the orchestrator had
 * already announced `geoleaf:cache:cancelled`: the interface received two contradictory signals,
 * and the call resolved to a full summary. Red on the code before the fix: `completed` fired.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { retryFn, getSummary } = vi.hoisted(() => ({
    retryFn: vi.fn(),
    getSummary: vi.fn(),
}));

vi.mock("../../../src/capabilities/offline/cache/retry-handler.js", () => ({
    RetryHandler: { init: vi.fn(), retry: retryFn },
}));
vi.mock("../../../src/capabilities/offline/cache/progress-tracker.js", () => ({
    ProgressTracker: {
        init: vi.fn(),
        getSummary,
        recordSuccess: vi.fn(),
        recordFailure: vi.fn(),
    },
}));
vi.mock("../../../src/capabilities/offline/cache/fetch-manager.js", () => ({
    FetchManager: { fetch: vi.fn() },
}));
vi.mock("../../../src/capabilities/offline/cache/storage.js", () => ({
    CacheStorage: {
        getCachedUrls: vi.fn(async () => new Set()),
        getManifest: vi.fn(async () => null),
    },
}));
vi.mock("../../../src/capabilities/offline/cache/metrics.js", () => ({
    CacheMetrics: { estimateProfileSize: vi.fn(async () => ({ totalSize: 0 })) },
}));

const { Downloader } = await import("../../../src/capabilities/offline/cache/downloader.js");

beforeEach(() => {
    Downloader._config.enableProfileCache = true;
    Downloader._config.concurrentDownloads = 1;
    Downloader._cachingProfiles.clear();
    getSummary.mockReturnValue({ successful: 1, failed: 0, successfulDownloads: ["a"] });
    // The first resource stops the run, the way « Stop » does mid-download.
    retryFn.mockImplementation(async () => {
        Downloader.cancelDownload();
    });
});

afterEach(() => {
    vi.clearAllMocks();
});

describe("téléchargement annulé", () => {
    it("rend cancelled et n'émet pas geoleaf:cache:completed", async () => {
        const completed = vi.fn();
        document.addEventListener("geoleaf:cache:completed", completed);
        try {
            const result = await Downloader.cacheProfile("p", {}, [
                { url: "a", type: "layer" },
                { url: "b", type: "layer" },
                { url: "c", type: "layer" },
            ]);
            expect(result).toEqual({ cancelled: true, profileId: "p" });
            expect(completed).not.toHaveBeenCalled();
            expect(Downloader._cachingProfiles.has("p")).toBe(false);
        } finally {
            document.removeEventListener("geoleaf:cache:completed", completed);
        }
    });
});
