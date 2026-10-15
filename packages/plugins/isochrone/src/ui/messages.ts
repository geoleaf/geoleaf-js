/*!
 * @geoleaf-plugins/isochrone — What the window says
 *
 * The labels of the window, filled with their values, and the one message each refusal earns.
 * A message never says « an error occurred »: it names the case, because what the user can do
 * next differs from one case to the other.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import { tLabel } from "@geoleaf/host-runtime";

import type { ComputeResult, TravelMode } from "../model.js";

/**
 * A label of the window, with its `{name}` placeholders filled.
 *
 * ⚠️ Every key this package reads is written as a LITERAL at the call: the parity test of the
 * dictionaries finds the keys by reading the source, and a composed key is one it cannot see.
 *
 * @param key A flat `isochrone.*` key.
 * @param values What the placeholders stand for; a placeholder without a value is left as is.
 * @returns The label in the active language — the key itself when no dictionary has it.
 */
export function label(key: string, values: Record<string, string | number> = {}): string {
    return tLabel(key).replace(/\{(\w+)\}/g, (whole, name: string) =>
        name in values ? String(values[name]) : whole
    );
}

/**
 * The name of a travel mode.
 *
 * @param mode The mode.
 * @returns Its label.
 */
export function modeLabel(mode: TravelMode): string {
    if (mode === "foot") return label("isochrone.mode.foot");
    if (mode === "bike") return label("isochrone.mode.bike");
    return label("isochrone.mode.car");
}

/**
 * The label of a zone's row — what makes a zone recognisable once the colours no longer do.
 *
 * @param minutes The duration it answers.
 * @param mode How the traveller moved.
 * @returns « 10 min · Car ».
 */
export function rowLabel(minutes: number, mode: TravelMode): string {
    return label("isochrone.list.row", { minutes, mode: modeLabel(mode) });
}

/**
 * The message a refused computation earns.
 *
 * @param result What `compute()` answered.
 * @returns The message, or `""` when there is none to give: a success, and a cancellation the
 *   user asked for.
 */
export function refusalMessage(result: ComputeResult): string {
    if (result.ok) return "";
    switch (result.reason) {
        case "aborted":
            return "";
        case "timeout":
            return label("isochrone.error.timeout");
        case "network":
            return label("isochrone.error.network");
        case "http":
            return result.code !== undefined
                ? label("isochrone.error.httpCode", {
                      status: result.status ?? "?",
                      code: result.code,
                  })
                : label("isochrone.error.http", { status: result.status ?? "?" });
        case "no-engine":
            return label("isochrone.error.noEngine");
        case "no-map":
            return label("isochrone.error.noMap");
        case "busy":
            return label("isochrone.error.busy");
        case "too-long":
            return label("isochrone.error.tooLong", { limit: result.limit ?? "?" });
        case "cap-reached":
            return label("isochrone.error.capReached", { limit: result.limit ?? "?" });
        case "invalid":
            return label("isochrone.error.invalid");
        default:
            // A reason this window does not know is still not « an error occurred »: it reads as
            // an answer that cannot be read, which is what it is to this window.
            return label("isochrone.error.malformed");
    }
}
