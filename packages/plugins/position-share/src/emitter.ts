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
import {
    getGeoLeaf,
    getUINotifications,
    isCapabilityOn,
    Log,
    tLabel,
    warnCapabilityMissing,
} from "@geoleaf/host-runtime";

import { getPluginConfig, validateConfig, type PluginConfig } from "./config.js";
import { getClientId } from "./client-id.js";
import { hasMovedEnough, type LatLng } from "./distance.js";
import { setIndicator } from "./indicator.js";
import { ensureWatch, isWatchActive } from "./gps-watch.js";
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
    // The badge says a position is LEAVING: raised with the first fix, not with the loop.
    setIndicator(true);

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

/** Tells the user why a start they asked for did not happen. Silent for a start by program. */
function _refuse(fromUser: boolean, key: string, fallback: string): false {
    if (fromUser) getUINotifications()?.warning(tLabel(key, fallback));
    return false;
}

/** The websocket transport needs the `Ws` channel connected; the plugin never initialises it. */
function _channelReady(cfg: PluginConfig): boolean {
    if (cfg.transport !== "websocket") return true;
    const ws = getGeoLeaf()?.Ws as { state?: string } | undefined;
    return ws?.state === "connected";
}

/**
 * Starts the emission loop.
 *
 * 🛑 **It refuses what it cannot carry out, and says so** — it used to start, raise the badge
 * « Partage de ma position en cours » and send nothing: without the geolocation capability (no fix
 * is ever read), and with the websocket transport before `GeoLeaf.Ws` is connected (every sample
 * dropped). A start by the user's button is told the reason on screen; a start by program
 * (`auto`) only logs it.
 *
 * ⚠️ **`enabled` gates the start by program, not the button** (`APP_SHELL.md`, table of what
 * `enabled` governs): for this plugin it means « emit from the boot ». The shipped profile carries
 * `enabled: false` with the button shown — the button is the switch. `mode: "off"` refuses both.
 *
 * @param override - Configuration to use instead of reading the profile (tests).
 * @param opts - `fromUser`: the start comes from the user's button.
 * @returns `true` when the loop started, `false` when configuration forbids or prevents it.
 */
export function startEmission(override?: PluginConfig, opts: { fromUser?: boolean } = {}): boolean {
    if (_timer) return true;

    const cfg = override ?? getPluginConfig();
    const fromUser = opts.fromUser === true;

    if (cfg.mode === "off") {
        return _refuse(fromUser, "position-share.error.modeOff", "Position sharing is off.");
    }
    if (cfg.enabled !== true && !fromUser) return false;

    if (!isCapabilityOn("geolocation")) {
        warnCapabilityMissing("position-share", "geolocation");
        return _refuse(fromUser, "position-share.error.noGeolocation", "Geolocation is missing.");
    }

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
    if (!_channelReady(cfg)) {
        Log.warn(
            '[PositionShare] transport "websocket" needs GeoLeaf.Ws connected — call ' +
                "GeoLeaf.Ws.init() first; this plugin deliberately does not initialise it"
        );
        _transport = null;
        return _refuse(fromUser, "position-share.error.noChannel", "The channel is not connected.");
    }

    // The button asks for the GPS itself: without a watch running, there is no fix to send, and
    // the loop would turn in silence. `auto` asks for it at boot (`lifecycle.ts`).
    if (fromUser) ensureWatch();

    _timer = setInterval(() => {
        void tick(cfg);
    }, cfg.intervalMs);

    // The badge comes with the first fix (`tick`): raised here only when the watch already
    // runs, so a refused or pending permission does not announce a sharing that is not there.
    if (isWatchActive()) setIndicator(true);

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
    return startEmission(undefined, { fromUser: true });
}
