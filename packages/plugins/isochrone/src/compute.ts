/*!
 * @geoleaf-plugins/isochrone — Batch computation
 *
 * Holds a batch of durations to what the provider declares it accepts: refused whole when one
 * duration is too long, split when it carries more durations than one request may.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import type {
    IIsochroneProvider,
    IsochroneContour,
    IsochroneOutcome,
    IsochroneRequest,
    ProviderLimits,
} from "./model.js";

/**
 * Tells whether a batch asks a duration longer than the provider accepts.
 *
 * Checked BEFORE any request: the engine would refuse it anyway, and only once the rest of the
 * batch had been paid for.
 *
 * @param minutes The durations asked.
 * @param limits What the provider declares. An absent `maxMinutes` states no limit.
 * @returns The provider's limit when a duration exceeds it, `null` when the batch is within it.
 */
export function durationLimitExceeded(
    minutes: readonly number[],
    limits: ProviderLimits | undefined
): number | null {
    const max = limits?.maxMinutes;
    if (typeof max !== "number" || !Number.isFinite(max)) return null;
    return minutes.some((m) => m > max) ? max : null;
}

/**
 * Splits a batch into the requests the provider accepts.
 *
 * @param minutes The durations, ascending.
 * @param maxContours How many one request may carry; an absent or unusable value states none.
 * @returns The durations of each request, in order.
 */
function splitBatch(minutes: readonly number[], maxContours: number | undefined): number[][] {
    const size =
        typeof maxContours === "number" && Number.isInteger(maxContours) && maxContours >= 1
            ? maxContours
            : minutes.length;
    const batches: number[][] = [];
    for (let i = 0; i < minutes.length; i += size) batches.push(minutes.slice(i, i + size));
    return batches;
}

/**
 * Asks a provider for every duration of a batch — in as many requests as its limit demands,
 * one after the other, under the one signal that cancels them all.
 *
 * All or nothing: the first request that fails ends the batch, and its reason is the batch's.
 * Zones already received are dropped — a partial batch is not an answer.
 *
 * @param provider The engine.
 * @param request The whole batch.
 * @returns Every zone asked, or the reason none is kept.
 */
export async function requestInBatches(
    provider: IIsochroneProvider,
    request: IsochroneRequest
): Promise<IsochroneOutcome> {
    const contours: IsochroneContour[] = [];
    for (const minutes of splitBatch(request.minutes, provider.limits?.maxContours)) {
        if (request.signal.aborted) return { ok: false, reason: "aborted" };
        const outcome = await provider.isochrone({ ...request, minutes });
        if (!outcome.ok) return outcome;
        contours.push(...outcome.contours);
    }
    return request.signal.aborted ? { ok: false, reason: "aborted" } : { ok: true, contours };
}
