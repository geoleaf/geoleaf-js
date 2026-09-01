/*!
 * @geoleaf-plugins/offline-ui — Corridor selection
 *
 * The third zone-selection mode: the corridor of a persisted itinerary, next to
 * "current view" and "profile extent".
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { StorageContract } from "../shared/storage-contract.js";
import { corridorTiles, type Position } from "../sync/corridor-tiles.js";

/**
 * ## Where the itinerary is read, and why it is NOT in a navigation plugin
 *
 * It is read from the core database's `routes` store. That is what makes this
 * mode possible without `offline-ui` knowing `routing` or `navigation` exist:
 * offline prepares a zone, it does not have to know who computed the line, nor
 * whether that plugin is installed.
 *
 * ⚠️ Access goes through `_ensureModule`, and the precedent is `editor` — which
 * reads the `outbox` exactly this way. Not a workaround: the facade injects the
 * ENTIRE engine (`db: IndexedDB`), and `_ensureModule` is the only route it
 * offers to a sub-module. Opening a public accessor in the core for this single
 * call would have widened the core's published surface during work that does not
 * touch it.
 *
 * ## 🛑 Why a refusal names ITS TWO LEVERS
 *
 * A refusal saying "too large" without saying what to lower is not actionable:
 * the reader sees a wall, not a dial. The only two levers are the **zoom cap**
 * and the **buffer**, and they are not equivalent — one zoom less divides the
 * tiles by ~4, halving the buffer divides them by ~2. The refusal names both
 * **with their effect**, failing which the user lowers the one that costs the
 * most information for the least space.
 */

/** What the `Routes` sub-module returns, seen from here. */
interface RoutesModule {
    listRoutes?: () => Promise<Array<{ id: string; line?: unknown }>>;
}

/** A corridor selection, ready to be estimated then persisted. */
export interface CorridorSelection {
    /** The itinerary the corridor comes from. */
    readonly routeId: string;
    /** Buffer radius, in METRES. */
    readonly bufferMetres: number;
    /** Lowest zoom, inclusive. */
    readonly minZoom: number;
    /** Highest zoom, inclusive. */
    readonly maxZoom: number;
    /** Nombre de tuiles distinctes, tous zooms confondus. */
    readonly tiles: number;
    /** Estimated weight, in BYTES. */
    readonly bytes: number;
}

/** Why a corridor could not be proposed, or was refused. */
export type CorridorRefusal =
    /** The offline engine is not there — the `offline` capability is absent or disabled. */
    | "no-engine"
    /** No itinerary was prepared. Not an error: there is nothing to download. */
    | "no-route"
    /** The persisted line is too short to form a corridor. */
    | "degenerate-line"
    /** The estimate exceeds what the browser grants. */
    | "over-quota";

/** What proposing a corridor returns. */
export type CorridorOutcome =
    | { readonly ok: true; readonly selection: CorridorSelection }
    | {
          readonly ok: false;
          readonly reason: CorridorRefusal;
          /** The two levers, with their effect — see the header note. Empty outside `over-quota`. */
          readonly levers?: readonly CorridorLever[];
      };

/** A lever the user can pull, and what it yields. */
export interface CorridorLever {
    /** `zoom` ou `buffer`. */
    readonly kind: "zoom" | "buffer";
    /** The proposed value. */
    readonly to: number;
    /** The estimated weight if applied, in BYTES. */
    readonly bytes: number;
}

/** The same per-tile cost as the bbox path — two different figures would be incomparable. */
const AVG_PBF_BYTES = 30 * 1024;

/**
 * The weight of a tile count.
 *
 * ⚠️ Without the bbox path's glyphs/sprites flat fee: that one is paid ONCE per
 * profile, not once per zone. Adding it here would count it twice when both paths
 * are used one after the other, and would refuse a corridor that fits.
 *
 * @param tiles The tile count.
 * @returns The bytes.
 */
function bytesFor(tiles: number): number {
    return tiles * AVG_PBF_BYTES;
}

/**
 * The last persisted itinerary, as a decoded line.
 *
 * @returns The line and its identity, or `null` when there is none.
 */
async function latestRoute(): Promise<{ id: string; line: Position[] } | null> {
    const routes = StorageContract.DB?._ensureModule?.("Routes") as RoutesModule | null;
    if (!routes?.listRoutes) return null;

    const all = await routes.listRoutes();
    const first = all?.[0];
    if (!first || !Array.isArray(first.line)) return null;

    // The store already sorts newest first; we do not re-sort here, otherwise two
    // screens could present two different "latest".
    const line = (first.line as unknown[]).filter(
        (p): p is Position => Array.isArray(p) && p.length >= 2
    );
    return { id: first.id, line };
}

/**
 * Proposes a corridor for the last prepared itinerary.
 *
 * @param bufferMetres Buffer radius.
 * @param minZoom      Lowest zoom, inclusive.
 * @param maxZoom      Highest zoom, inclusive.
 * @param quotaBytes   What the browser still grants, in bytes. `Infinity` when
 *                     unknown — do NOT refuse for lack of knowing: a refusal on
 *                     an unknown blocks a download that would have fit.
 * @returns The corridor, or the refusal with its levers.
 */
export async function proposeCorridor(
    bufferMetres: number,
    minZoom: number,
    maxZoom: number,
    quotaBytes: number = Number.POSITIVE_INFINITY
): Promise<CorridorOutcome> {
    if (typeof StorageContract.DB?._ensureModule !== "function") {
        return { ok: false, reason: "no-engine" };
    }

    const route = await latestRoute();
    if (!route) return { ok: false, reason: "no-route" };
    if (route.line.length < 2) return { ok: false, reason: "degenerate-line" };

    const tiles = corridorTiles(route.line, minZoom, maxZoom, bufferMetres).length;
    const bytes = bytesFor(tiles);

    if (bytes > quotaBytes) {
        return {
            ok: false,
            reason: "over-quota",
            levers: levers(route.line, bufferMetres, minZoom, maxZoom),
        };
    }
    return {
        ok: true,
        selection: { routeId: route.id, bufferMetres, minZoom, maxZoom, tiles, bytes },
    };
}

/**
 * The two levers, each with the weight it would yield.
 *
 * ⚠️ They are returned MEASURED, not described. "Lower the zoom" leaves the user
 * estimating a gain they have no way to know; "zoom 14 → 220 MB" compares to what
 * they have left. Same lesson as the step-cap refusal: a refusal that does not
 * carry its limit is not actionable.
 *
 * @param line    The line.
 * @param buffer  The current buffer.
 * @param minZoom Lowest zoom.
 * @param maxZoom Highest zoom.
 * @returns The applicable levers. The zoom lever is omitted when the range is
 *          already down to one level — proposing to go below the floor would
 *          yield an empty corridor.
 */
function levers(
    line: readonly Position[],
    buffer: number,
    minZoom: number,
    maxZoom: number
): CorridorLever[] {
    const out: CorridorLever[] = [];
    if (maxZoom > minZoom) {
        out.push({
            kind: "zoom",
            to: maxZoom - 1,
            bytes: bytesFor(corridorTiles(line, minZoom, maxZoom - 1, buffer).length),
        });
    }
    const halved = Math.max(1, Math.round(buffer / 2));
    if (halved < buffer) {
        out.push({
            kind: "buffer",
            to: halved,
            bytes: bytesFor(corridorTiles(line, minZoom, maxZoom, halved).length),
        });
    }
    return out;
}
