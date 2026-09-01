/*!
 * @geoleaf-plugins/routing — Optional address search
 *
 * Reads `@geoleaf-plugins/geocoding` if the host has it, and answers plainly when it does not.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * ## 🛑 Why this is a seam and not a dependency
 *
 * The CDC calls the geocoding integration **optional**, and the only way optional means anything
 * is if the package is not in `dependencies`. Declaring it would put an address-search bundle in
 * front of every integrator who only ever pastes coordinates — and would make a profile without it
 * fail to load rather than degrade.
 *
 * So it is read off the global namespace at CALL time, exactly as the repository already does
 * between `measure` and `print`. Reading it at module load would freeze the answer before
 * `GeoLeaf.boot()` has mounted anything, and the field would be permanently coordinates-only on a
 * host that has the plugin.
 *
 * ⚠️ **`geocodingAvailable()` is deliberately a separate question from `searchAddress()`.** The
 * caller needs to distinguish "no search here" — where the honest message is *type coordinates* —
 * from "the search answered nothing", where the honest message is *no match*. Collapsing them into
 * an empty array would tell a user with no geocoding plugin that their address does not exist.
 */

/** One address match, reduced to what a waypoint needs. */
export interface AddressHit {
    /** What to show, and what the stop will be called. */
    readonly label: string;
    /** Latitude. */
    readonly lat: number;
    /** Longitude. */
    readonly lng: number;
}

/** The slice of the geocoding plugin this reads. */
interface GeocodingSeam {
    search(query: string, limit?: number): Promise<readonly RawHit[]>;
}

/** What the geocoding plugin answers with. */
interface RawHit {
    readonly label?: unknown;
    readonly lat?: unknown;
    readonly lng?: unknown;
}

/** Enough choices to be useful, few enough to read without scrolling a panel. */
const MAX_HITS = 5;

/**
 * The geocoding seam, or `undefined`.
 *
 * @returns The seam when the host has the plugin AND it exposes a search.
 */
function seam(): GeocodingSeam | undefined {
    const g = (globalThis as { GeoLeaf?: { Geocoding?: Partial<GeocodingSeam> } }).GeoLeaf
        ?.Geocoding;
    return typeof g?.search === "function" ? (g as GeocodingSeam) : undefined;
}

/**
 * Whether an address search is available at all.
 *
 * @returns `true` when the host carries the geocoding plugin.
 */
export function geocodingAvailable(): boolean {
    return seam() !== undefined;
}

/**
 * Searches for `query`.
 *
 * ⚠️ **A rejection from the geocoding plugin is NOT caught here, and the caller must expect one.**
 * A network failure and a genuine absence of results call for different words on screen, and a
 * caller that cannot tell them apart will pick the wrong one — so this function declines to
 * flatten the two into an empty array.
 *
 * 🛑 Said in prose and not with `@throws`, which would be false: nothing here throws. It declines
 * to catch, which is a different fact about a different line, and the tag would send a reader
 * looking for a `throw` that is not in this file. `check-tsdoc-conformity` refuses the tag for
 * exactly that reason, and it is right to.
 *
 * @param query What was typed.
 * @returns The matches, at most `MAX_HITS`. An empty array means the search ran and found
 *          nothing — check `geocodingAvailable()` first if you need to tell that from
 *          "there is no search here".
 */
export async function searchAddress(query: string): Promise<readonly AddressHit[]> {
    const g = seam();
    if (!g) return [];

    const raw = await g.search(query, MAX_HITS);
    if (!Array.isArray(raw)) return [];

    const hits: AddressHit[] = [];
    for (const r of raw) {
        // A match with no usable position is dropped rather than defaulted. `[0, 0]` would be a
        // stop off the coast of Africa that the user did not choose and cannot explain.
        if (typeof r?.lat !== "number" || typeof r?.lng !== "number") continue;
        if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue;
        hits.push({
            label: typeof r.label === "string" && r.label !== "" ? r.label : `${r.lat}, ${r.lng}`,
            lat: r.lat,
            lng: r.lng,
        });
    }
    return hits;
}
