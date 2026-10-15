/**
 * @geoleaf-plugins/isochrone — the controller's flows
 *
 * From a call to `compute()` to zones on a map that keeps a drawing order: what is refused
 * before any request and in which order, all or nothing, the order of the stack equal to the
 * order on the map after every gesture, and a teardown that leaves nothing — but the settings.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    cancelComputation,
    clearLayers,
    computeIsochrone,
    destroyController,
    isComputing,
    listLayers,
    onStackChange,
    moveLayer,
    removeLayer,
    showLayer,
    styleLayer,
} from "../controller.js";
import type { IsochroneOutcome, IsochroneRequest, ProviderLimits } from "../model.js";
import { registerProvider } from "../provider.js";
import { getOverrides, setOverrides } from "../runtime-overrides.js";
import { createFakeMap, type FakeMap } from "./fake-map.js";

const AREA = {
    type: "Polygon",
    coordinates: [
        [
            [55, -21],
            [56, -21],
            [56, -20],
            [55, -21],
        ],
    ],
} as const;
const ORIGIN = [55.45, -20.88] as const;

const host = globalThis as { GeoLeaf?: unknown };
const previous = host.GeoLeaf;

let map: FakeMap | null;
let answer: (request: IsochroneRequest) => Promise<IsochroneOutcome>;
let limits: ProviderLimits;
const asked = vi.fn();

/** Zones for every duration asked. */
async function everyZone(request: IsochroneRequest): Promise<IsochroneOutcome> {
    return {
        ok: true,
        // The engine sends the largest first: the controller must not trust that order.
        contours: [...request.minutes].reverse().map((minutes) => ({ minutes, geometry: AREA })),
    };
}

registerProvider("controller-engine", () => ({
    id: "controller-engine",
    attribution: "© Test data",
    get limits(): ProviderLimits {
        return limits;
    },
    isochrone: (request) => {
        asked(request);
        return answer(request);
    },
}));

/**
 * Installs a namespace with a profile branch and the current fake map.
 *
 * @param branch Profile keys over the test defaults.
 */
function withProfile(branch: Record<string, unknown> = {}): void {
    host.GeoLeaf = {
        Log: { warn: vi.fn() },
        Config: {
            get: (key: string, fallback: unknown) =>
                key === "modules.isochrone"
                    ? {
                          provider: "controller-engine",
                          endpoint: "https://engine.test",
                          palette: ["#111111", "#222222", "#333333", "#444444"],
                          ...branch,
                      }
                    : fallback,
        },
        Core: { getMap: () => map },
    };
}

/** The ids of the stack, top first. */
function stackIds(): string[] {
    return listLayers().map((l) => l.id);
}

beforeEach(() => {
    map = createFakeMap();
    answer = everyZone;
    limits = { maxContours: 4, maxMinutes: 120 };
    asked.mockClear();
    withProfile();
});

afterEach(() => {
    destroyController();
    setOverrides(null);
    host.GeoLeaf = previous;
});

describe("compute — drawing", () => {
    it("draws one zone per duration, the shortest on top, in the order the stack lists", async () => {
        const result = await computeIsochrone({ origin: ORIGIN, minutes: [15, 5, 10] });
        expect(result.ok).toBe(true);
        expect(listLayers().map((l) => l.minutes)).toEqual([5, 10, 15]);
        expect(result.ok && result.ids).toEqual(stackIds());
        expect(map?.topFirst()).toEqual(stackIds());
        expect(listLayers().map((l) => l.color)).toEqual(["#111111", "#222222", "#333333"]);
    });

    it("draws the zones of the profile's mode and durations when none are given", async () => {
        withProfile({ mode: "foot", durations: [20, 40] });
        await computeIsochrone({ origin: ORIGIN });
        expect(asked).toHaveBeenCalledWith(
            expect.objectContaining({ mode: "foot", minutes: [20, 40] })
        );
        expect(listLayers().map((l) => [l.mode, l.minutes])).toEqual([
            ["foot", 20],
            ["foot", 40],
        ]);
    });

    it("puts the marker and the credit on the map with the first zone", async () => {
        await computeIsochrone({ origin: ORIGIN, minutes: [5, 10] });
        expect(map?.markers.size).toBe(1);
        expect(map?.container.textContent).toBe("© Test data");
    });

    it("puts a second batch on top, in free colours, without moving the first", async () => {
        await computeIsochrone({ origin: ORIGIN, minutes: [5, 10] });
        map?.calls.splice(0);
        await computeIsochrone({ origin: [55.5, -21.1], minutes: [5] });
        expect(map?.topFirst()).toEqual(stackIds());
        expect(listLayers().map((l) => l.color)).toEqual(["#333333", "#111111", "#222222"]);
        expect(map?.calls).not.toContain("setLayerZIndex");
        expect(map?.markers.size).toBe(2);
    });
});

describe("compute — refused before any request, in order", () => {
    it.each([
        [{ origin: [200, 0] }],
        [{ origin: [0, Number.NaN] }],
        [{ origin: "55,-20" }],
        [{ origin: ORIGIN, mode: "plane" }],
        [{ origin: ORIGIN, minutes: [] }],
        [{ origin: ORIGIN, minutes: [10.5] }],
        // A JavaScript caller can pass nothing at all: still a refusal, never a throw.
        [undefined],
        [null],
    ])("refuses %j as invalid", async (options) => {
        expect(await computeIsochrone(options as never)).toEqual({ ok: false, reason: "invalid" });
        expect(asked).not.toHaveBeenCalled();
    });

    it("refuses with no map before looking for an engine", async () => {
        map = null;
        withProfile({ provider: "nobody" });
        expect(await computeIsochrone({ origin: ORIGIN })).toEqual({ ok: false, reason: "no-map" });
    });

    it("refuses with no usable engine before seeing a computation running", async () => {
        let release: (o: IsochroneOutcome) => void = () => {};
        answer = () => new Promise((resolve) => (release = resolve));
        const first = computeIsochrone({ origin: ORIGIN, minutes: [5] });
        withProfile({ provider: "nobody" });
        expect(await computeIsochrone({ origin: ORIGIN })).toEqual({
            ok: false,
            reason: "no-engine",
        });
        release({ ok: true, contours: [{ minutes: 5, geometry: AREA }] });
        await first;
    });

    it("refuses while a computation runs, and queues nothing behind it", async () => {
        let release: (o: IsochroneOutcome) => void = () => {};
        answer = () => new Promise((resolve) => (release = resolve));
        const first = computeIsochrone({ origin: ORIGIN, minutes: [5] });
        expect(await computeIsochrone({ origin: ORIGIN, minutes: [500] })).toEqual({
            ok: false,
            reason: "busy",
        });
        release({ ok: true, contours: [{ minutes: 5, geometry: AREA }] });
        await first;
        expect(asked).toHaveBeenCalledTimes(1);
        answer = everyZone;
        expect((await computeIsochrone({ origin: ORIGIN, minutes: [10] })).ok).toBe(true);
    });

    it("refuses a duration beyond the provider's limit before the cap, carrying the limit", async () => {
        withProfile({ maxLayers: 1 });
        expect(await computeIsochrone({ origin: ORIGIN, minutes: [10, 121] })).toEqual({
            ok: false,
            reason: "too-long",
            limit: 120,
        });
        expect(asked).not.toHaveBeenCalled();
    });

    it("refuses a batch beyond the cap, carrying the cap, and keeps what is drawn", async () => {
        withProfile({ maxLayers: 3 });
        await computeIsochrone({ origin: ORIGIN, minutes: [5, 10] });
        asked.mockClear();
        expect(await computeIsochrone({ origin: ORIGIN, minutes: [15, 20] })).toEqual({
            ok: false,
            reason: "cap-reached",
            limit: 3,
        });
        expect(asked).not.toHaveBeenCalled();
        expect(listLayers()).toHaveLength(2);
        expect((await computeIsochrone({ origin: ORIGIN, minutes: [15] })).ok).toBe(true);
    });
});

describe("compute — the engine's answer", () => {
    it("draws nothing on a refusal, and carries its status and code", async () => {
        answer = async () => ({ ok: false, reason: "http", status: 400, code: 151 });
        expect(await computeIsochrone({ origin: ORIGIN, minutes: [90] })).toEqual({
            ok: false,
            reason: "http",
            status: 400,
            code: 151,
        });
        expect(map?.layers).toEqual([]);
        expect(map?.markers.size).toBe(0);
    });

    it("reads a provider that throws as an answer that cannot be read", async () => {
        answer = async () => {
            throw new Error("https://engine.test/?api_key=SENTINEL");
        };
        expect(await computeIsochrone({ origin: ORIGIN, minutes: [5] })).toEqual({
            ok: false,
            reason: "malformed",
        });
    });

    it("draws nothing when the map went while the engine answered", async () => {
        let release: (o: IsochroneOutcome) => void = () => {};
        answer = () => new Promise((resolve) => (release = resolve));
        const pending = computeIsochrone({ origin: ORIGIN, minutes: [5] });
        const gone = map;
        map = null;
        release({ ok: true, contours: [{ minutes: 5, geometry: AREA }] });
        expect(await pending).toEqual({ ok: false, reason: "no-map" });
        expect(gone?.layers).toEqual([]);
        expect(listLayers()).toEqual([]);
    });
});

describe("stack members", () => {
    beforeEach(async () => {
        await computeIsochrone({ origin: ORIGIN, minutes: [5, 10, 15] });
    });

    it("moves a zone on the map as in the list, in place and without asking the engine", async () => {
        asked.mockClear();
        map?.calls.splice(0);
        const [top] = stackIds();
        expect(moveLayer(top ?? "", 2)).toBe(true);
        expect(stackIds().indexOf(top ?? "")).toBe(2);
        expect(map?.topFirst()).toEqual(stackIds());
        expect(map?.calls).not.toContain("addGeoJSONLayer");
        expect(asked).not.toHaveBeenCalled();
    });

    it("keeps the map in the list's order through the rebuild when re-ranking is refused", async () => {
        destroyController();
        map = createFakeMap({ rerank: "refuses" });
        await computeIsochrone({ origin: ORIGIN, minutes: [5, 10, 15] });
        const [top] = stackIds();
        showLayer(top ?? "", false);
        expect(moveLayer(top ?? "", 2)).toBe(true);
        expect(map.topFirst()).toEqual(stackIds());
        expect(map.layers.find((l) => l.id === top)?.visible).toBe(false);
    });

    it("refuses an unknown id and a row outside the stack", () => {
        expect(moveLayer("nope", 0)).toBe(false);
        expect(moveLayer(stackIds()[0] ?? "", 3)).toBe(false);
        expect(styleLayer("nope", { opacity: 0.5 })).toBe(false);
        expect(showLayer("nope", false)).toBe(false);
        expect(removeLayer("nope")).toBe(false);
    });

    it("restyles a zone with its whole style, and refuses a value it cannot use", () => {
        const [id = ""] = stackIds();
        expect(styleLayer(id, { opacity: 0.6 })).toBe(true);
        const drawn = map?.layers.find((l) => l.id === id);
        expect(drawn?.style).toMatchObject({ fillColor: "#111111", fillOpacity: 0.6, opacity: 1 });
        expect(styleLayer(id, { color: "red" })).toBe(false);
        expect(styleLayer(id, { opacity: 1.5 })).toBe(false);
        expect(styleLayer(id, { color: "#abcdef", visible: false } as never)).toBe(true);
        expect(listLayers()[0]).toMatchObject({ color: "#abcdef", opacity: 0.6, visible: true });
    });

    it("hides a zone, which keeps its place", () => {
        const [, id = ""] = stackIds();
        expect(showLayer(id, false)).toBe(true);
        expect(stackIds()[1]).toBe(id);
        expect(map?.layers.find((l) => l.id === id)?.visible).toBe(false);
        expect(showLayer(id, "no" as never)).toBe(false);
    });

    it("removes a zone, re-ranks those above, and keeps the marker until the last one", async () => {
        const [a = "", b = "", c = ""] = stackIds();
        expect(removeLayer(b)).toBe(true);
        expect(map?.topFirst()).toEqual([a, c]);
        expect(map?.markers.size).toBe(1);
        removeLayer(a);
        removeLayer(c);
        expect(map?.layers).toEqual([]);
        expect(map?.markers.size).toBe(0);
        expect(map?.container.children).toHaveLength(0);
    });

    it("clears every zone, marker and credit", () => {
        clearLayers();
        expect(listLayers()).toEqual([]);
        expect(map?.layers).toEqual([]);
        expect(map?.markers.size).toBe(0);
        expect(map?.container.children).toHaveLength(0);
    });
});

describe("destroyController", () => {
    it("cancels the computation running, which then draws nothing", async () => {
        answer = (request) =>
            new Promise((resolve) =>
                request.signal.addEventListener("abort", () =>
                    resolve({ ok: false, reason: "aborted" })
                )
            );
        const pending = computeIsochrone({ origin: ORIGIN, minutes: [5] });
        destroyController();
        expect(await pending).toEqual({ ok: false, reason: "aborted" });
        expect(map?.layers).toEqual([]);
    });

    it("leaves nothing on the map, keeps the settings, and lets the plugin start again", async () => {
        setOverrides({ endpoint: "https://other.test" });
        await computeIsochrone({ origin: ORIGIN, minutes: [5] });
        destroyController();
        expect(map?.layers).toEqual([]);
        expect(map?.markers.size).toBe(0);
        expect(map?.container.children).toHaveLength(0);
        expect(getOverrides()).toEqual({ endpoint: "https://other.test" });
        expect(() => destroyController()).not.toThrow();
        expect((await computeIsochrone({ origin: ORIGIN, minutes: [5] })).ok).toBe(true);
    });
});

describe("cancelComputation", () => {
    it("interrupts the request: nothing is drawn, and the computation answers aborted", async () => {
        answer = (request) =>
            new Promise((resolve) =>
                request.signal.addEventListener("abort", () =>
                    resolve({ ok: false, reason: "aborted" })
                )
            );
        const pending = computeIsochrone({ origin: ORIGIN, minutes: [5] });
        expect(isComputing()).toBe(true);
        expect(cancelComputation()).toBe(true);
        expect(await pending).toEqual({ ok: false, reason: "aborted" });
        expect(isComputing()).toBe(false);
        expect(map?.layers).toEqual([]);
    });

    it("answers false when nothing runs", () => {
        expect(cancelComputation()).toBe(false);
    });
});

describe("onStackChange", () => {
    it("tells a listener of every change, whoever made it", async () => {
        const heard = vi.fn();
        const stop = onStackChange(heard);
        const result = await computeIsochrone({ origin: ORIGIN, minutes: [5, 10] });
        // Once when the request leaves, once when the zones are drawn.
        expect(heard).toHaveBeenCalledTimes(2);
        const [top, bottom] = result.ok ? result.ids : [];
        heard.mockClear();
        styleLayer(top ?? "", { opacity: 0.5 });
        showLayer(top ?? "", false);
        moveLayer(top ?? "", 1);
        removeLayer(bottom ?? "");
        clearLayers();
        expect(heard).toHaveBeenCalledTimes(5);
        stop();
        stop();
        await computeIsochrone({ origin: ORIGIN, minutes: [5] });
        expect(heard).toHaveBeenCalledTimes(5);
    });

    it("says when a computation ends without zones", async () => {
        answer = async () => ({ ok: false, reason: "timeout" });
        const states: boolean[] = [];
        const stop = onStackChange(() => states.push(isComputing()));
        await computeIsochrone({ origin: ORIGIN, minutes: [5] });
        expect(states).toEqual([true, false]);
        stop();
    });

    it("says nothing for a gesture that changed nothing", () => {
        const heard = vi.fn();
        const stop = onStackChange(heard);
        styleLayer("unknown", { opacity: 0.5 });
        moveLayer("unknown", 0);
        removeLayer("unknown");
        expect(heard).not.toHaveBeenCalled();
        stop();
    });

    it("keeps telling the others when one listener throws", async () => {
        const heard = vi.fn();
        const stopA = onStackChange(() => {
            throw new Error("listener defect");
        });
        const stopB = onStackChange(heard);
        await computeIsochrone({ origin: ORIGIN, minutes: [5] });
        expect(heard).toHaveBeenCalled();
        expect(listLayers()).toHaveLength(1);
        stopA();
        stopB();
    });
});
