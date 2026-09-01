/*!
 * @geoleaf-plugins/position-share — Receive side
 * © 2026 Mattieu Pottier — MIT License
 *
 * The whole receive path is ONE delegation. `realtime-layer` already does upsert by `idField`
 * and expiry by `staleTimeoutMs`, driven by `start` / `stop` — which is exactly, and only, what
 * showing other users needs. Re-implementing any of it here would fork a solved problem.
 * https://geoleaf.dev
 */
import { getGeoLeaf, Log } from "@geoleaf/host-runtime";

import { getPluginConfig } from "./config.js";

/** The slice of `GeoLeaf.RealtimeLayer` used here — read late, never imported. */
interface RealtimeLayerSurface {
    start?: (layerId: string) => void;
    stop?: (layerId: string) => void;
}

/**
 * Shows or hides the other users' positions.
 *
 * The `realtime-layer` plugin is declared `optional`, so its absence is a NORMAL state, not a
 * crash: this reports the cause and returns `false`, and every other function of this plugin
 * keeps working. Emission does not depend on reception.
 *
 * @param visible - `true` to start the realtime layer, `false` to stop it.
 * @returns `true` when the call reached `realtime-layer`.
 *
 * @example
 * ```ts
 * GeoLeaf.PositionShare.showOthers(true);
 * ```
 */
export function showOthers(visible: boolean): boolean {
    const cfg = getPluginConfig();
    const layerId = cfg.receive.layerId;

    if (!layerId) {
        Log.warn(
            "[PositionShare] modules.position-share.receive.layerId is required to show other users"
        );
        return false;
    }

    const rt = getGeoLeaf()?.RealtimeLayer as RealtimeLayerSurface | undefined;
    if (!rt || typeof rt.start !== "function" || typeof rt.stop !== "function") {
        Log.warn(
            "[PositionShare] GeoLeaf.RealtimeLayer is absent — load " +
                "@geoleaf-plugins/realtime-layer to display other users"
        );
        return false;
    }

    if (visible) rt.start(layerId);
    else rt.stop(layerId);
    return true;
}

/**
 * Starts the realtime layer at boot when the profile asks for it.
 *
 * @returns `true` when reception was started.
 */
export function initReceive(): boolean {
    const cfg = getPluginConfig();
    if (cfg.receive.enabled !== true) return false;
    return showOthers(true);
}
