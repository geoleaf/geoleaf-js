/*!
 * @geoleaf-plugins/isochrone — Controller
 *
 * The one owner of the plugin's state: the stack of zones, the area of each, and the
 * computation running. It is the only module that links the two chains — the question to the
 * engine, and the stack to the map.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import { AttributionNote } from "./attribution.js";
import { durationLimitExceeded, requestInBatches } from "./compute.js";
import { getPluginConfig, isColour, isDuration, isTravelMode } from "./config.js";
import {
    drawZone,
    eraseZone,
    getMapAdapter,
    rerankZones,
    restyleZone,
    showZone,
    type IsochroneMap,
} from "./map-binding.js";
import type {
    ComputeOptions,
    ComputeResult,
    IsochroneGeometry,
    IsochroneLayer,
    IsochroneOutcome,
    LayerStyle,
} from "./model.js";
import { OriginMarkers } from "./origin-markers.js";
import { createProvider } from "./provider.js";
import { changedRanks, LayerStack, pickColours } from "./stack.js";

const stack = new LayerStack();
const areas = new Map<string, IsochroneGeometry>();
const markers = new OriginMarkers();
const credit = new AttributionNote();

/** The computation running, if any — what cancels it. */
let running: AbortController | null = null;
/** Numbers the zones: an identifier is never given twice in a page. */
let nextId = 0;
/** Who is told when the stack or the computation changes — the window, while it is open. */
const listeners = new Set<() => void>();

/** Tells every listener; one that throws does not keep the others from hearing. */
function notify(): void {
    for (const listener of [...listeners]) {
        try {
            listener();
        } catch {
            // A listener's defect is its own: the stack has already changed.
        }
    }
}

/** What a call to `compute()` asks, once read. */
interface ReadRequest {
    readonly origin: readonly [lon: number, lat: number];
    readonly mode: IsochroneLayer["mode"];
    readonly minutes: number[];
}

/**
 * Reads what `compute()` was given, completed by the profile.
 *
 * @param options What the caller passed.
 * @returns The request, or `null` when it cannot be read.
 */
function readRequest(options: ComputeOptions): ReadRequest | null {
    const config = getPluginConfig();
    const [lon, lat] = Array.isArray(options?.origin) ? options.origin : [];
    const mode = options?.mode ?? config.mode;
    const asked = options?.minutes ?? config.durations;
    if (typeof lon !== "number" || !Number.isFinite(lon) || Math.abs(lon) > 180) return null;
    if (typeof lat !== "number" || !Number.isFinite(lat) || Math.abs(lat) > 90) return null;
    if (!isTravelMode(mode) || !Array.isArray(asked) || asked.length === 0) return null;
    if (!asked.every(isDuration)) return null;
    return { origin: [lon, lat], mode, minutes: [...new Set(asked)].sort((a, b) => a - b) };
}

/**
 * Asks the provider, and never throws: a provider that does is a defect, read as an answer
 * that cannot be read.
 *
 * @param ask Runs the batch.
 * @returns The outcome.
 */
async function settle(ask: () => Promise<IsochroneOutcome>): Promise<IsochroneOutcome> {
    try {
        return await ask();
    } catch {
        return { ok: false, reason: "malformed" };
    }
}

/**
 * Finds a zone and its area — what a rebuild needs.
 *
 * @param id The zone's identifier.
 * @returns Both, or `null`.
 */
function zoneOf(id: string): { layer: IsochroneLayer; geometry: IsochroneGeometry } | null {
    const layer = stack.get(id);
    const geometry = areas.get(id);
    return layer && geometry ? { layer, geometry } : null;
}

/**
 * Runs a gesture on the stack and moves, on the map, the zones whose rank it changed.
 *
 * @param map The adapter.
 * @param gesture Changes the stack.
 */
function withReranking(map: IsochroneMap, gesture: () => void): void {
    const base = getPluginConfig().zIndex;
    const before = stack.ranks(base);
    gesture();
    rerankZones(map, changedRanks(before, stack.ranks(base)), zoneOf);
}

/**
 * Puts the markers and the credit in line with the stack.
 *
 * @param map The adapter.
 */
function syncDecorations(map: IsochroneMap): void {
    const layers = stack.list();
    markers.sync(map, layers);
    credit.sync(map, layers);
}

/**
 * Computes zones from a point, and draws them on top of the stack.
 *
 * Refused before any request, in this order: a call that cannot be read, no map, no usable
 * engine, a computation already running, a duration beyond the provider's limit, a batch beyond
 * the cap. Then the engine is asked, all or nothing.
 *
 * @param options Origin, and optionally mode and durations — the profile's otherwise.
 * @returns The identifiers of the zones drawn, top first, or why none was.
 */
export async function computeIsochrone(options: ComputeOptions): Promise<ComputeResult> {
    const request = readRequest(options);
    if (!request) return { ok: false, reason: "invalid" };
    const config = getPluginConfig();
    if (!getMapAdapter()) return { ok: false, reason: "no-map" };
    const provider = createProvider(config);
    if (!provider) return { ok: false, reason: "no-engine" };
    if (running) return { ok: false, reason: "busy" };
    const limit = durationLimitExceeded(request.minutes, provider.limits);
    if (limit !== null) return { ok: false, reason: "too-long", limit };
    if (stack.size + request.minutes.length > config.maxLayers) {
        return { ok: false, reason: "cap-reached", limit: config.maxLayers };
    }

    const controller = new AbortController();
    running = controller;
    notify();
    const outcome = await settle(() =>
        requestInBatches(provider, { ...request, signal: controller.signal })
    );
    if (running === controller) running = null;
    if (!outcome.ok) {
        notify();
        return outcome;
    }

    // The map may have gone while the engine answered: the zones then have nowhere to land.
    const map = getMapAdapter();
    if (!map) {
        notify();
        return { ok: false, reason: "no-map" };
    }

    // Shortest on top: the zones are nested, and a larger one drawn above would hide the rest.
    const contours = [...outcome.contours].sort((a, b) => a.minutes - b.minutes);
    const colours = pickColours(
        stack.list().map((l) => l.color),
        config.palette,
        contours.length
    );
    const layers: IsochroneLayer[] = contours.map((contour, i) => ({
        id: `__gl_isochrone_${++nextId}`,
        origin: request.origin,
        mode: request.mode,
        minutes: contour.minutes,
        color: colours[i] ?? config.palette[0] ?? "#3987e5",
        opacity: config.fillOpacity,
        visible: true,
        attribution: provider.attribution,
    }));
    contours.forEach((contour, i) => {
        const layer = layers[i];
        if (layer) areas.set(layer.id, contour.geometry);
    });

    withReranking(map, () => stack.addOnTop(layers));
    const ranks = stack.ranks(config.zIndex);
    for (const layer of layers) {
        const area = areas.get(layer.id);
        if (area) drawZone(map, layer, area, ranks.get(layer.id) ?? config.zIndex);
    }
    syncDecorations(map);
    notify();
    return { ok: true, ids: layers.map((l) => l.id) };
}

/**
 * A snapshot of the stack.
 *
 * @returns The zones, top first. Changing it changes nothing.
 */
export function listLayers(): IsochroneLayer[] {
    return stack.list();
}

/**
 * Changes a zone's colour or opacity.
 *
 * @param id The zone's identifier.
 * @param style `#rrggbb` and an opacity from 0 to 1; an absent member is kept.
 * @returns `false` for an unknown id or a value refused — and then nothing changes.
 */
export function styleLayer(id: string, style: LayerStyle): boolean {
    const { color, opacity } = style ?? {};
    if (color !== undefined && !isColour(color)) return false;
    if (opacity !== undefined && !(typeof opacity === "number" && opacity >= 0 && opacity <= 1)) {
        return false;
    }
    const map = getMapAdapter();
    const patch = {
        ...(color !== undefined ? { color } : {}),
        ...(opacity !== undefined ? { opacity } : {}),
    };
    const layer = map && stack.get(id) ? stack.update(id, patch) : null;
    if (!map || !layer) return false;
    restyleZone(map, layer);
    notify();
    return true;
}

/**
 * Shows or hides a zone. A hidden zone keeps its place in the stack.
 *
 * @param id The zone's identifier.
 * @param visible Whether it is drawn.
 * @returns `false` for an unknown id.
 */
export function showLayer(id: string, visible: boolean): boolean {
    const map = getMapAdapter();
    if (!map || typeof visible !== "boolean" || !stack.update(id, { visible })) return false;
    showZone(map, id, visible);
    notify();
    return true;
}

/**
 * Moves a zone to a row of the stack — and on the map, without asking the engine again.
 *
 * @param id The zone's identifier.
 * @param toIndex The row, `0` being the top.
 * @returns `false` for an unknown id or a row outside the stack.
 */
export function moveLayer(id: string, toIndex: number): boolean {
    const map = getMapAdapter();
    if (!map) return false;
    let moved = false;
    withReranking(map, () => {
        moved = stack.move(id, toIndex);
    });
    if (moved) notify();
    return moved;
}

/**
 * Removes a zone — its marker goes with the last zone of its origin.
 *
 * @param id The zone's identifier.
 * @returns `false` for an unknown id.
 */
export function removeLayer(id: string): boolean {
    const map = getMapAdapter();
    if (!map || !stack.get(id)) return false;
    withReranking(map, () => {
        stack.remove(id);
        eraseZone(map, id);
        areas.delete(id);
    });
    syncDecorations(map);
    notify();
    return true;
}

/** Removes every zone, its markers and the credit. */
export function clearLayers(): void {
    const map = getMapAdapter();
    for (const layer of stack.clear()) {
        if (map) eraseZone(map, layer.id);
    }
    areas.clear();
    markers.clear(map);
    credit.clear();
    notify();
}

/**
 * Whether a computation is running — what the window reads to offer « Cancel » and to keep a
 * second one from starting.
 *
 * @returns `true` between the request leaving and its answer being drawn or refused.
 */
export function isComputing(): boolean {
    return running !== null;
}

/**
 * Cancels the computation running: the request is interrupted, nothing is drawn, and its
 * `compute()` answers `aborted`.
 *
 * @returns `false` when nothing was running.
 */
export function cancelComputation(): boolean {
    if (!running) return false;
    running.abort();
    return true;
}

/**
 * Subscribes to every change of the stack — a zone drawn, restyled, shown, hidden, moved or
 * removed — and to a computation starting or ending, whoever made the change: a gesture in the
 * window or a call to the public API.
 *
 * Internal to the package: the plugin emits nothing on the application's event bus.
 *
 * @param listener Called after the change, with nothing — it reads what it needs.
 * @returns Unsubscribes. Calling it twice does nothing.
 */
export function onStackChange(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Tears the plugin's map state down: cancels the computation running, removes every zone.
 *
 * What `configure()` set and the providers registered survive — they belong to the page, not
 * to the map.
 */
export function destroyController(): void {
    running?.abort();
    running = null;
    clearLayers();
}
