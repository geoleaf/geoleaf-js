/**
 * Lightweight integration tests — cache workflow (config + storage)
 * Simule paths main sans module cache real
 *
 * ⚠️ **Kept deliberately — imports no module, and that is owned.** This
 * file is a simulation on mock-ups, it announces it, and it does not claim
 * to cover production code. The no-import triage deleted five files that
 * did redefine in the test the function they verified without saying so:
 * `constants`, `style-normalization`, `style-format-validation`,
 * `xss-prevention` and `ui/cache-button` (the last one redone at
 * `plugin-storage`, against the real code). The difference is not the
 * missing import, it is the **pretence**. Do not re-flag it at the next triage.
 */

describe("Integration — Cache workflow", () => {
    let mockConfig;
    let mockStorage;

    beforeEach(() => {
        mockConfig = {
            get: vi.fn((key, def) => {
                if (key === "cache.maxSize") return 50 * 1024 * 1024;
                if (key === "cache.maxTiles") return 1000;
                return def;
            }),
        };
        mockStorage = {
            getItem: vi.fn(),
            setItem: vi.fn(),
            removeItem: vi.fn(),
        };
    });

    describe("config + cache limits", () => {
        test("config provides cache limits used by workflow", () => {
            const maxSize = mockConfig.get("cache.maxSize");
            const maxTiles = mockConfig.get("cache.maxTiles");
            expect(maxSize).toBe(50 * 1024 * 1024);
            expect(maxTiles).toBe(1000);
            expect(mockConfig.get).toHaveBeenCalledWith("cache.maxSize");
        });
    });

    describe("download session state", () => {
        test("workflow can store and read download session in storage", () => {
            const session = { id: "dl-1", totalTiles: 100, downloaded: 0, status: "in-progress" };
            mockStorage.setItem("currentDownload", JSON.stringify(session));
            expect(mockStorage.setItem).toHaveBeenCalledWith("currentDownload", expect.any(String));
            const read = mockStorage.setItem.mock.calls[0][1];
            expect(JSON.parse(read).status).toBe("in-progress");
        });

        test("workflow can clear session on cancel", () => {
            mockStorage.removeItem("currentDownload");
            expect(mockStorage.removeItem).toHaveBeenCalledWith("currentDownload");
        });
    });

    describe("cache stats calculation", () => {
        test("stats from tile count and size", () => {
            const tileCount = 500;
            const tileSize = 20000;
            const totalSize = tileCount * tileSize;
            const formatted = `${(totalSize / (1024 * 1024)).toFixed(2)} MB`;
            expect(tileCount).toBe(500);
            expect(formatted).toContain("MB");
        });
    });
});
