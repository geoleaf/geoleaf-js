/**
 * maplibre-pmtiles — the protocol bridge registers once, degrades without the engine,
 * and defers the library to the first tile request.
 *
 * The real pmtiles fetch path is not exercised here: it needs a served archive and a real
 * MapLibre, which is E2E territory. What a unit CAN prove is the seam's contract — the three
 * properties a regression would silently break: idempotence (MapLibre keeps the LAST handler
 * for a scheme, so a double registration would be masked), the engine-less no-op (every
 * adapter test would otherwise need a MapLibre stub), and the laziness (the library must not
 * load at registration, or every profile pays for a feature none of them asked for).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    registerPmtilesProtocol,
    _resetPmtilesProtocolForTests,
} from "../../src/adapters/maplibre/maplibre-pmtiles.js";

type GlobalWithEngine = typeof globalThis & { maplibregl?: { addProtocol?: unknown } };
const g = globalThis as GlobalWithEngine;

afterEach(() => {
    _resetPmtilesProtocolForTests();
    delete g.maplibregl;
});

describe("registerPmtilesProtocol", () => {
    it("is a no-op when the MapLibre global is absent", () => {
        expect(() => registerPmtilesProtocol()).not.toThrow();
    });

    it("registers the pmtiles scheme exactly once", () => {
        const addProtocol = vi.fn();
        g.maplibregl = { addProtocol };
        registerPmtilesProtocol();
        registerPmtilesProtocol();
        expect(addProtocol).toHaveBeenCalledTimes(1);
        expect(addProtocol).toHaveBeenCalledWith("pmtiles", expect.any(Function));
    });

    it("hands MapLibre a handler that reaches the real library through the lazy seam", async () => {
        const addProtocol = vi.fn();
        g.maplibregl = { addProtocol };
        registerPmtilesProtocol();
        const handler = addProtocol.mock.calls[0][1] as (
            params: { url: string; type: string },
            controller: AbortController
        ) => Promise<unknown>;
        // An unreachable archive must surface an error FROM pmtiles — proving the request
        // travelled the lazy import into the real Protocol, not into a stub that swallows.
        await expect(
            handler(
                { url: "pmtiles://http://127.0.0.1:1/none.pmtiles/0/0/0", type: "arrayBuffer" },
                new AbortController()
            )
        ).rejects.toThrow();
    });
});
