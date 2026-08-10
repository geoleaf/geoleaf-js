/**
 */

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// B.12 — complet par construction (voir coverage-modules-config.test.js).
vi.mock("../../src/kernel/security/index.js", async (importActual) => ({
    ...(await importActual()),
    Security: {
        validateUrl: vi.fn((url) => url),
    },
}));

import { ConfigLoader } from "../../src/kernel/config/loader.js";

describe("config/loader", () => {
    beforeEach(() => {
        global.fetch = vi.fn();
    });

    afterEach(() => {
        delete global.fetch;
    });

    describe("loadUrl", () => {
        it("returns empty object when url is empty", async () => {
            const result = await ConfigLoader.loadUrl("");
            expect(result).toEqual({});
        });

        it("rejects when fetch fails", async () => {
            global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 404 }));
            await expect(ConfigLoader.loadUrl("https://example.com/config.json")).rejects.toThrow();
        });

        it("rejects when response ok but content-type is not application/json (strictContentType)", async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    headers: { get: () => "text/html" },
                    json: () => Promise.resolve({}),
                })
            );
            await expect(ConfigLoader.loadUrl("/config.json")).rejects.toThrow(
                /Content-Type invalide/
            );
        });

        it("resolves with json when fetch returns application/json", async () => {
            const cfg = { map: { zoom: 10 } };
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    headers: { get: () => "application/json" },
                    json: () => Promise.resolve(cfg),
                })
            );
            const result = await ConfigLoader.loadUrl("/config.json");
            expect(result).toEqual(cfg);
        });
    });

    describe("fetchJson", () => {
        it("returns null when url is empty", async () => {
            const result = await ConfigLoader.fetchJson("");
            expect(result).toBeNull();
        });

        it("resolves with json when fetch returns application/json", async () => {
            const data = { key: "value" };
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    headers: { get: () => "application/json" },
                    json: () => Promise.resolve(data),
                })
            );
            const result = await ConfigLoader.fetchJson("/data.json");
            expect(result).toEqual(data);
        });
    });
});
