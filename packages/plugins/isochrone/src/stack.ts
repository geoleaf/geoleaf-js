/*!
 * @geoleaf-plugins/isochrone — The stack of zones
 *
 * A pure model: an ordered list, the rank rule and the palette rule. It knows neither the map
 * nor the network — what it answers is applied by `map-binding.ts`, through the controller.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import { MAX_LAYER_CAP } from "./config.js";
import type { IsochroneLayer } from "./model.js";

/**
 * Distance between two neighbouring zones of the stack.
 *
 * With at most `MAX_LAYER_CAP` zones, the top one sits at `zIndex + MAX_LAYER_CAP × RANK_STEP`,
 * strictly below `zIndex + 1`: the zones never reach the rank of the profile's next layers.
 */
const RANK_STEP = 1 / (MAX_LAYER_CAP + 1);

/**
 * The rank a row of the stack is drawn at.
 *
 * Counted from the BOTTOM — `(count − index)` — so that adding zones on top changes no rank
 * already given: only the newcomers are placed, nothing below them moves.
 *
 * @param base The profile's `zIndex`.
 * @param index The row, `0` being the top.
 * @param count How many rows the stack holds.
 * @returns A rank strictly between `base` and `base + 1`.
 */
function rankOf(base: number, index: number, count: number): number {
    return base + (count - index) * RANK_STEP;
}

/**
 * Picks the colours of the zones about to be added.
 *
 * Each takes the first colour of the palette no zone wears. Once all are worn — a palette
 * shorter than the stack — it takes the one worn the fewest times, the earliest in the palette
 * on a tie. A zone keeps its colour: the colours of zones already there are not redistributed.
 *
 * @param worn The colours the stack's zones wear.
 * @param palette The profile's palette — never empty, the configuration reader sees to it.
 * @param count How many colours are wanted.
 * @returns `count` colours, in the order they are to be given.
 */
export function pickColours(
    worn: readonly string[],
    palette: readonly string[],
    count: number
): string[] {
    const uses = new Map<string, number>(palette.map((c) => [c, 0]));
    for (const c of worn) {
        const n = uses.get(c);
        if (n !== undefined) uses.set(c, n + 1);
    }
    const picked: string[] = [];
    for (let k = 0; k < count; k++) {
        let best = palette[0] ?? "";
        let fewest = Number.POSITIVE_INFINITY;
        for (const c of palette) {
            const n = uses.get(c) ?? 0;
            if (n < fewest) {
                best = c;
                fewest = n;
            }
        }
        uses.set(best, fewest + 1);
        picked.push(best);
    }
    return picked;
}

/**
 * Lists the zones whose rank differs between two snapshots of the stack.
 *
 * A zone absent from either snapshot is not listed: a newcomer is placed when it is drawn, and
 * a removed zone has nothing left to move.
 *
 * @param before Ranks before a gesture, by id.
 * @param after Ranks after it, by id.
 * @returns The ids to re-rank, with their new rank, top of the stack first.
 */
export function changedRanks(
    before: ReadonlyMap<string, number>,
    after: ReadonlyMap<string, number>
): { id: string; zIndex: number }[] {
    const changed: { id: string; zIndex: number }[] = [];
    for (const [id, zIndex] of after) {
        const was = before.get(id);
        if (was !== undefined && was !== zIndex) changed.push({ id, zIndex });
    }
    return changed;
}

/**
 * The zones, top first. Row `0` is drawn above every other.
 *
 * Every method that takes an id answers `false` or `null` for an unknown one, and then changes
 * nothing.
 */
export class LayerStack {
    private rows: IsochroneLayer[] = [];

    /** How many zones the stack holds. */
    get size(): number {
        return this.rows.length;
    }

    /**
     * A copy of the zones, top first: changing it changes nothing in the stack.
     *
     * @returns The zones.
     */
    list(): IsochroneLayer[] {
        return this.rows.map((row) => ({ ...row }));
    }

    /**
     * Finds a zone.
     *
     * @param id The zone's identifier.
     * @returns A copy of it, or `null`.
     */
    get(id: string): IsochroneLayer | null {
        const row = this.rows.find((r) => r.id === id);
        return row ? { ...row } : null;
    }

    /**
     * The rank of every zone.
     *
     * @param base The profile's `zIndex`.
     * @returns Ranks by id.
     */
    ranks(base: number): Map<string, number> {
        const count = this.rows.length;
        return new Map(this.rows.map((row, index) => [row.id, rankOf(base, index, count)]));
    }

    /**
     * Puts zones on top of the stack, in the order given: the first given ends up on top.
     *
     * @param layers The new zones, top first.
     */
    addOnTop(layers: readonly IsochroneLayer[]): void {
        this.rows = [...layers.map((l) => ({ ...l })), ...this.rows];
    }

    /**
     * Moves a zone to a row.
     *
     * @param id The zone's identifier.
     * @param toIndex The row it goes to, `0` being the top — a whole number within the stack.
     * @returns `false` for an unknown id or a row outside the stack.
     */
    move(id: string, toIndex: number): boolean {
        const from = this.rows.findIndex((r) => r.id === id);
        if (from < 0 || !Number.isInteger(toIndex) || toIndex < 0) return false;
        if (toIndex >= this.rows.length) return false;
        const rows = this.rows.filter((r) => r.id !== id);
        rows.splice(toIndex, 0, ...this.rows.slice(from, from + 1));
        this.rows = rows;
        return true;
    }

    /**
     * Changes what a zone looks like, or whether it is drawn.
     *
     * @param id The zone's identifier.
     * @param patch The members that change.
     * @returns The zone as it now is, or `null` for an unknown id.
     */
    update(
        id: string,
        patch: Partial<Pick<IsochroneLayer, "color" | "opacity" | "visible">>
    ): IsochroneLayer | null {
        const index = this.rows.findIndex((r) => r.id === id);
        const row = this.rows[index];
        if (!row) return null;
        const next = { ...row, ...patch };
        this.rows = this.rows.map((r, i) => (i === index ? next : r));
        return { ...next };
    }

    /**
     * Takes a zone out of the stack.
     *
     * @param id The zone's identifier.
     * @returns The zone removed, or `null` for an unknown id.
     */
    remove(id: string): IsochroneLayer | null {
        const row = this.rows.find((r) => r.id === id);
        if (!row) return null;
        this.rows = this.rows.filter((r) => r !== row);
        return row;
    }

    /**
     * Empties the stack.
     *
     * @returns The zones it held, top first.
     */
    clear(): IsochroneLayer[] {
        const rows = this.rows;
        this.rows = [];
        return rows;
    }
}
