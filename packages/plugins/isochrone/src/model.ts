/*!
 * @geoleaf-plugins/isochrone — Model
 *
 * Pure types: what is asked of a routing engine, what it answers, and what a provider is. No
 * runtime dependency — every other module of the package imports from here.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/** The three travel modes every provider of this package maps onto its engine's own vocabulary. */
export type TravelMode = "car" | "foot" | "bike";

/**
 * Why a computation did not come back.
 *
 * Named, and never collapsed into one "it failed": the gestures that follow are opposite.
 *
 * - **timeout** — the engine did not answer in time: retrying may work.
 * - **network** — the request did not go through. A key refused by a front end that does not
 *   open its error responses to other origins reads as this one too: the browser hides the
 *   refusal.
 * - **http** — the engine answered, and refused. Carries the `status` of the response and,
 *   when the refusal could be read, the engine's own `code`.
 * - **malformed** — the engine answered something this package cannot read, or a contour that
 *   was asked for is missing. Nothing is drawn: a partial answer is not an answer.
 * - **aborted** — the caller cancelled. Not an error, and reported as nothing.
 *
 * ⚠️ There is no reason for "no road near this point", on purpose: no engine was ever seen
 * refusing such a point. The public instance answers it with a polygon the size of one grid
 * cell, which is a success — and this package does not judge a geometry.
 */
export type IsochroneFailure = "timeout" | "network" | "http" | "malformed" | "aborted";

/** What a provider is asked. */
export interface IsochroneRequest {
    /** Where the zones start from — longitude first, as everywhere in this package. */
    readonly origin: readonly [lon: number, lat: number];
    /** How the traveller moves. */
    readonly mode: TravelMode;
    /** The durations asked, in minutes, ascending. */
    readonly minutes: readonly number[];
    /** Cancels the request. Every request carries one. */
    readonly signal: AbortSignal;
}

/** A position: longitude, latitude, and whatever further numbers the engine sent. */
export type IsochronePosition = readonly number[];

/** The only two geometries a zone can be. */
export type IsochroneGeometry =
    | {
          readonly type: "Polygon";
          readonly coordinates: readonly (readonly IsochronePosition[])[];
      }
    | {
          readonly type: "MultiPolygon";
          readonly coordinates: readonly (readonly (readonly IsochronePosition[])[])[];
      };

/** One zone of an answer: a duration and the area reachable within it. */
export interface IsochroneContour {
    /** The duration this zone answers, in minutes — one that was asked. */
    readonly minutes: number;
    /** The zone. Nothing else of the engine's feature is kept. */
    readonly geometry: IsochroneGeometry;
}

/** What a provider answers: the zones asked for, or a named reason. */
export type IsochroneOutcome =
    | { readonly ok: true; readonly contours: readonly IsochroneContour[] }
    | {
          readonly ok: false;
          readonly reason: IsochroneFailure;
          /** HTTP status of a refusal. */
          readonly status?: number;
          /** The engine's own numeric code for that refusal, when its body could be read. */
          readonly code?: number;
      };

/** What a provider accepts in one request. An absent limit means the provider states none. */
export interface ProviderLimits {
    /** How many durations one request may carry. A longer batch is split. */
    readonly maxContours?: number;
    /** The longest duration accepted, in minutes. */
    readonly maxMinutes?: number;
}

/** A routing engine, seen from this package. */
export interface IIsochroneProvider {
    /** Stable identifier, matched against `modules.isochrone.provider`. */
    readonly id: string;
    /** Required. A blank credit is refused, never replaced by a default one. */
    readonly attribution: string;
    /** What one request may carry. */
    readonly limits?: ProviderLimits;
    /**
     * Asks the engine.
     *
     * @param request Origin, mode, durations and the signal that cancels.
     * @returns One zone per duration asked, or a named reason — never a partial answer.
     */
    isochrone(request: IsochroneRequest): Promise<IsochroneOutcome>;
}

/** What a provider is built with, beyond its endpoint. */
export interface ProviderOptions {
    /** Query parameters to send with every request — where a key travels. Never logged. */
    readonly query: Readonly<Record<string, string>>;
    /** How long the engine is given to answer, in milliseconds. */
    readonly timeoutMs: number;
}

/** Builds a provider for an endpoint already accepted — `https://`, and nothing else. */
export type IsochroneProviderFactory = (
    endpoint: string,
    options: ProviderOptions
) => IIsochroneProvider;

/** What `configure()` accepts: where the engine is, and what every request must carry. */
export interface RuntimeOverrides {
    /** Base URL of the engine. Takes precedence over the profile's. */
    readonly endpoint?: string;
    /** Query parameters added to every request. `json` is reserved for the question. */
    readonly query?: Readonly<Record<string, string>>;
}

/**
 * Why `compute()` drew nothing — the provider's own reasons, and those the plugin decides
 * before any request leaves.
 *
 * - **invalid** — the call itself cannot be read: an origin that is not a position, an
 *   unknown mode, no duration, a duration that is not a whole positive number of minutes.
 * - **no-map** — no map is mounted.
 * - **no-engine** — no usable provider resolves: unknown name, refused address, no credit.
 * - **busy** — a computation is already running. It is never queued behind.
 * - **too-long** — a duration exceeds what the provider declares; `limit` carries it.
 * - **cap-reached** — the batch would exceed `maxLayers`; `limit` carries the cap.
 */
export type ComputeRefusal =
    IsochroneFailure | "invalid" | "no-map" | "no-engine" | "busy" | "too-long" | "cap-reached";

/** What `compute()` is given. */
export interface ComputeOptions {
    /** Where the zones start from — longitude first. */
    readonly origin: readonly [lon: number, lat: number];
    /** How the traveller moves. Defaults to the profile's `mode`. */
    readonly mode?: TravelMode;
    /** The durations, in whole minutes. Defaults to the profile's `durations`. */
    readonly minutes?: readonly number[];
}

/** What `compute()` answers: the zones drawn, or why none was. */
export type ComputeResult =
    | {
          readonly ok: true;
          /** The identifiers of the zones drawn, top of the stack first. */
          readonly ids: readonly string[];
      }
    | {
          readonly ok: false;
          readonly reason: ComputeRefusal;
          /** For `too-long`, the longest duration; for `cap-reached`, the cap. */
          readonly limit?: number;
          /** For `http`, the status of the refusal. */
          readonly status?: number;
          /** For `http`, the engine's own code, when its body could be read. */
          readonly code?: number;
      };

/** One zone of the stack, as `getLayers()` shows it. */
export interface IsochroneLayer {
    /** Stable identifier — the one every stack member takes. */
    readonly id: string;
    /** Where the zone starts from — longitude first. */
    readonly origin: readonly [lon: number, lat: number];
    /** How the traveller moved. */
    readonly mode: TravelMode;
    /** The duration this zone answers, in minutes. */
    readonly minutes: number;
    /** Fill and outline colour, `#rrggbb`. */
    readonly color: string;
    /** Opacity of the fill, from 0 to 1. The outline stays opaque. */
    readonly opacity: number;
    /** Whether the zone is drawn. A hidden zone keeps its place in the stack. */
    readonly visible: boolean;
    /** The credit the provider's data owes. */
    readonly attribution: string;
}

/** What `setLayerStyle()` changes. An absent member is kept. */
export interface LayerStyle {
    /** `#rrggbb`. */
    readonly color?: string;
    /** From 0 to 1. */
    readonly opacity?: number;
}
