/**
 * @geoleaf-plugins/isochrone — a batch held to the provider's limits
 *
 * Refused whole when a duration is too long; split when it carries more durations than one
 * request may; all or nothing across the requests.
 */
import { describe, expect, it, vi } from "vitest";

import { durationLimitExceeded, requestInBatches } from "../compute.js";
import type {
    IIsochroneProvider,
    IsochroneOutcome,
    IsochroneRequest,
    ProviderLimits,
} from "../model.js";

const AREA = { type: "Polygon", coordinates: [] } as const;

/**
 * A provider answering one zone per duration, or what `answer` says.
 *
 * @param limits What it declares.
 * @param answer Overrides the answer of a request.
 * @returns The provider and its spy.
 */
function provider(
    limits: ProviderLimits | undefined,
    answer?: (request: IsochroneRequest) => IsochroneOutcome | undefined
) {
    const isochrone = vi.fn(
        async (request: IsochroneRequest): Promise<IsochroneOutcome> =>
            answer?.(request) ?? {
                ok: true,
                contours: request.minutes.map((minutes) => ({ minutes, geometry: AREA })),
            }
    );
    const p: IIsochroneProvider = {
        id: "test",
        attribution: "© Test",
        ...(limits ? { limits } : {}),
        isochrone,
    };
    return { p, isochrone };
}

/**
 * A request for these durations.
 *
 * @param minutes The durations.
 * @param signal Defaults to one never aborted.
 * @returns The request.
 */
function ask(minutes: number[], signal = new AbortController().signal): IsochroneRequest {
    return { origin: [55.45, -20.88], mode: "car", minutes, signal };
}

describe("durationLimitExceeded", () => {
    it("answers the limit when one duration exceeds it", () => {
        expect(durationLimitExceeded([10, 121], { maxMinutes: 120 })).toBe(120);
    });

    it("answers null at the limit, and when the provider states none", () => {
        expect(durationLimitExceeded([120], { maxMinutes: 120 })).toBeNull();
        expect(durationLimitExceeded([500], undefined)).toBeNull();
        expect(durationLimitExceeded([500], { maxMinutes: Number.NaN })).toBeNull();
    });
});

describe("requestInBatches", () => {
    it("sends a batch within the limit in one request", async () => {
        const { p, isochrone } = provider({ maxContours: 4 });
        const outcome = await requestInBatches(p, ask([5, 10, 15]));
        expect(isochrone).toHaveBeenCalledTimes(1);
        expect(outcome).toMatchObject({
            ok: true,
            contours: [{ minutes: 5 }, { minutes: 10 }, { minutes: 15 }],
        });
    });

    it("splits a longer batch into successive requests, and joins their zones", async () => {
        const { p, isochrone } = provider({ maxContours: 2 });
        const outcome = await requestInBatches(p, ask([5, 10, 15, 20, 25]));
        expect(isochrone.mock.calls.map(([r]) => r.minutes)).toEqual([[5, 10], [15, 20], [25]]);
        expect(outcome.ok && outcome.contours.map((c) => c.minutes)).toEqual([5, 10, 15, 20, 25]);
    });

    it.each([[{}], [{ maxContours: 0 }], [{ maxContours: 1.5 }]])(
        "sends one request when the limit is %j",
        async (declared: ProviderLimits) => {
            const { p, isochrone } = provider(declared);
            await requestInBatches(p, ask([5, 10, 15]));
            expect(isochrone).toHaveBeenCalledTimes(1);
        }
    );

    it("keeps nothing when one request fails, and asks no further", async () => {
        const { p, isochrone } = provider({ maxContours: 1 }, (r) =>
            r.minutes[0] === 10 ? { ok: false, reason: "http", status: 400, code: 151 } : undefined
        );
        const outcome = await requestInBatches(p, ask([5, 10, 15]));
        expect(outcome).toEqual({ ok: false, reason: "http", status: 400, code: 151 });
        expect(isochrone).toHaveBeenCalledTimes(2);
    });

    it("stops between two requests once cancelled, and keeps nothing", async () => {
        const controller = new AbortController();
        const { p, isochrone } = provider({ maxContours: 1 }, () => {
            controller.abort();
            return undefined;
        });
        const outcome = await requestInBatches(p, ask([5, 10], controller.signal));
        expect(outcome).toEqual({ ok: false, reason: "aborted" });
        expect(isochrone).toHaveBeenCalledTimes(1);
    });
});
