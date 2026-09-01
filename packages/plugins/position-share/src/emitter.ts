/*!
 * @geoleaf-plugins/position-share — Emission loop
 *
 * Reads a fix from the geolocation seam every `intervalMs`, drops it when the user has not
 * moved far enough, and hands the rest to the resolved transport. A rejected send DROPS the
 * sample: there is no queue anywhere in this plugin, because a position is perishable and
 * replaying a stale one publishes a false fact about where someone is.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { getGeoLeaf, Log } from "@geoleaf/host-runtime";

import { getPluginConfig, validateConfig, type PluginConfig } from "./config.js";
import { getClientId } from "./client-id.js";
import { hasMovedEnough, type LatLng } from "./distance.js";
import { setIndicator } from "./indicator.js";
import { registerBuiltinTransports } from "./transports/builtins.js";
import { resolveTransport } from "./transports/registry.js";
import type { IPositionTransport, PositionPayload } from "./transports/contract.js";

/** The slice of `GeoLeaf.Geolocation` this module reads — late, never imported. */
interface GeolocationSurface {
    getState?: () => {
        active: boolean;
        userPosition: { lat: number; lng: number; accuracy?: number; timestamp?: number } | null;
    };
}

let _timer: ReturnType<typeof setInterval> | null = null;
let _transport: IPositionTransport | null = null;
let _lastSent: LatLng | null = null;
let _inactiveWarned = false;

/** Whether the emission loop is currently running. */
export function isEmitting(): boolean {
    return _timer !== null;
}

/** Reads one fix, or `null` when the capability is absent or the watch is off. */
function readFix(): PositionPayload | null {
    const geo = getGeoLeaf()?.Geolocation as GeolocationSurface | undefined;
    const state = geo?.getState?.();

    if (!state || state.active !== true || state.userPosition == null) {
        return null;
    }

    const p = state.userPosition;
    const payload: PositionPayload = {
        clientId: getClientId(),
        lat: p.lat,
        lng: p.lng,
        timestamp: p.timestamp ?? Date.now(),
    };
    // Assigned only when the browser reported it: under `exactOptionalPropertyTypes`, writing
    // `accuracy: undefined` is a different thing from leaving the key out — and the backend
    // would receive an explicit null rather than a silent absence.
    if (p.accuracy !== undefined) payload.accuracy = p.accuracy;
    return payload;
}

/** One cycle: read, filter, send. Never throws — a lost sample must not stop the loop. */
async function tick(cfg: PluginConfig): Promise<void> {
    const fix = readFix();
    if (!fix) {
        // Not an error: the user may simply not have started the GPS watch. Said once, so a
        // 30-second loop cannot turn a normal state into a wall of console noise.
        if (!_inactiveWarned) {
            _inactiveWarned = true;
            Log.info("[PositionShare] GPS watch inactive or no fix yet — nothing to emit");
        }
        return;
    }
    _inactiveWarned = false;

    if (!hasMovedEnough(_lastSent, fix, cfg.minDistanceM)) return;

    const transport = _transport;
    if (!transport) return;

    try {
        await transport.send(fix);
        _lastSent = { lat: fix.lat, lng: fix.lng };
    } catch (err) {
        // The sample is DROPPED, deliberately — no queue, no retry. A position is
        // perishable: replaying it later publishes a false fact about where someone is.
        // `_lastSent` is left untouched so the next fix is judged against what actually
        // reached the backend, not against what we merely tried to send.
        Log.warn("[PositionShare] sample dropped:", err);
    }
}

/**
 * Starts the emission loop.
 *
 * @param override - Configuration to use instead of reading the profile (tests).
 * @returns `true` when the loop started, `false` when configuration forbids or prevents it.
 */
export function startEmission(override?: PluginConfig): boolean {
    if (_timer) return true;

    const cfg = override ?? getPluginConfig();

    if (cfg.enabled !== true || cfg.mode === "off") return false;

    const problems = validateConfig(cfg);
    if (problems.length > 0) {
        for (const p of problems) Log.warn("[PositionShare]", p.message);
        return false;
    }

    registerBuiltinTransports();
    _transport = resolveTransport(cfg);
    if (!_transport) {
        Log.warn(
            `[PositionShare] no transport registered under "${cfg.transport}" — ` +
                "register it with GeoLeaf.PositionShare.registerTransport() before emitting"
        );
        return false;
    }

    _timer = setInterval(() => {
        void tick(cfg);
    }, cfg.intervalMs);

    // Raised with the loop, not with the first successful send: what the badge reports is that
    // this browser is now sharing, and that becomes true here.
    setIndicator(true);

    // Emit once immediately: waiting a full period before the first sample makes the feature
    // look broken at exactly the moment someone switches it on to check that it works.
    void tick(cfg);
    return true;
}

/** Stops the loop and releases the transport. Idempotent. */
export function stopEmission(): void {
    if (_timer) {
        clearInterval(_timer);
        _timer = null;
    }
    _transport?.close?.();
    _transport = null;
    _lastSent = null;
    _inactiveWarned = false;
    setIndicator(false);
}

/**
 * Flips emission on or off — what the toolbar button drives.
 *
 * @returns The state after the call: `true` when emitting.
 */
export function toggleEmission(): boolean {
    if (isEmitting()) {
        stopEmission();
        return false;
    }
    return startEmission();
}
