/*!
 * GeoLeaf Core (offline capability) — Persisted pull outcomes
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * The pull marker — what makes `declaredNeverPulled` observable.
 *
 * 🛑 **It exists because the entity count is NOT ENOUGH, and that is the heart of it.**
 * A layer declared offline whose pull returned zero entities is, in the store,
 * strictly indistinguishable from a layer never pulled: zero in both cases. Yet they
 * are opposite situations — the first is healthy, the second is the one with "no
 * observable until the outage" that the contract names. Without a written trace that a
 * pull HAPPENED, the report would have to guess, and a guessing report is worse than
 * no report.
 *
 * ⚠️ **The `FeatureRecord`'s `updatedAt` cannot serve as a fallback**: it was
 * deliberately kept LOCAL ("Local modification time"), so an off-network capture
 * advances it with no pull having happened. It would date the edit, not the pull.
 *
 * Persisted in the `preferences` store, under ONE key carrying every layer — same
 * pattern as `offline.dataOrigins` (`data-origins.ts`). No new store, no IndexedDB
 * schema migration.
 *
 * @version 1.0.0
 */

import { Log } from "../../../utils/log/index.js";
import { isUnsafeKey } from "../../../utils/general/object-path-guard.js";

/** Single `preferences`-store key carrying the pull state of every layer. */
export const PULL_STATE_KEY = "offline.pullState";

/** What a pull leaves behind, whether it succeeded or not. */
export interface LayerPullState {
    /** Local timestamp of the attempt, in milliseconds. */
    readonly at: number;
    /**
     * `ok` when the source answered and the run went to its end — even returning zero
     * entities. `partial` when it wrote and stopped short. `failed` when the source
     * said nothing usable.
     *
     * 🛑 **`partial` IS THE MARKER'S RESUME POINT, and it is deliberately not a cursor.**
     * R9 made the pull commit page by page, so an interrupted run now leaves entities
     * behind — durably. Persisting the unfollowed `next` link and restarting from it
     * looks like the natural completion of that, and it is **unsound**: an OGC `next`
     * link is an offset in most deployments, so a row inserted before it between two
     * runs pushes entities past the window and they are **never fetched**, silently.
     * That is the very defect this subsystem exists to prevent, reintroduced by the
     * repair. What makes a re-pull cheap is not a cursor but idempotence —
     * `putManyPreservingLocal` writes by identity — so the honest resume is: re-pull
     * from the start, and let this marker say the last run did not finish.
     */
    readonly outcome: "ok" | "partial" | "failed";
    /** Entities written during this attempt. Always 0 when `outcome` is `failed`. */
    readonly written: number;
    /**
     * The delta's starting point: the greatest freshness marker the last COMPLETE pull of a
     * layer declaring `offline.source.delta` was served, kept as the server wrote it.
     *
     * 🛑 **It describes what the store holds, so it goes when that content goes.** A delta
     * from it asks the source only for what changed since: valid only while the store still
     * holds what the pull that set it wrote, for the same source and the same extent — hence
     * `scope`. A purge of the store, a cut run, or a different scope means a complete pull next.
     */
    readonly mark?: string;
    /** What `mark` was taken against — source, marker property and extent, serialised. */
    readonly scope?: string;
}

/** The state of every layer, as persisted. */
export type PullStateMap = Readonly<Record<string, LayerPullState>>;

/** The only member of the storage seam this module uses. */
interface PreferenceStore {
    getPreference?: (key: string, defaultValue?: unknown) => Promise<unknown>;
    setPreference?: (key: string, value: unknown) => Promise<unknown>;
}

/**
 * True when the re-read value has the shape of a {@link LayerPullState}.
 *
 * ⚠️ The validation is not ceremony: the `preferences` store is written by several
 * versions of the code across deployments, and an earlier-shaped entry read unchecked
 * would yield a FALSE status rather than an absent one. An unrecognised entry is
 * treated as absent — hence `declaredNeverPulled`, the safe fallback: it alerts.
 */
function isLayerPullState(value: unknown): value is LayerPullState {
    if (!value || typeof value !== "object") return false;
    const v = value as Record<string, unknown>;
    return (
        typeof v.at === "number" &&
        (v.outcome === "ok" || v.outcome === "partial" || v.outcome === "failed") &&
        typeof v.written === "number"
    );
}

/**
 * The entry as this code reads it: the three required fields, and the delta's starting point
 * only when both its halves are strings.
 *
 * ⚠️ A `mark` without its `scope` — or either of another type — is dropped, never guessed: an
 * unscoped mark could start a delta against a store it does not describe, and the cost of
 * dropping it is one complete pull.
 *
 * @param v - An entry that passed {@link isLayerPullState}.
 * @returns A fresh object holding only what is known.
 */
function sanitise(v: LayerPullState): LayerPullState {
    // The type says `string | undefined`, the store may hold anything: the guard vouched for
    // the three required fields only, so these two are tested here, at run time.
    const { mark, scope } = v;
    const scoped = typeof mark === "string" && typeof scope === "string";
    return {
        at: v.at,
        outcome: v.outcome,
        written: v.written,
        ...(scoped ? { mark, scope } : {}),
    };
}

/**
 * Re-reads the pull state of every layer.
 *
 * Never throws: unavailable persistence yields an empty state, and the report will
 * say `declaredNeverPulled` — which is true from the observer's point of view.
 *
 * @param db - The storage facade (`GeoLeaf.Storage.DB`).
 * @returns The per-layer state; `{}` when nothing was ever written or the read fails.
 * @example
 * const state = await readPullState(GeoLeaf?.Storage?.DB);
 * console.info(state["sites_rosario"]?.outcome);
 */
export async function readPullState(db: PreferenceStore | null | undefined): Promise<PullStateMap> {
    try {
        const raw = await db?.getPreference?.(PULL_STATE_KEY, null);
        if (!raw || typeof raw !== "object") return {};
        const out: Record<string, LayerPullState> = {};
        for (const [layerId, value] of Object.entries(raw as Record<string, unknown>)) {
            // 🛑 The re-read value comes from IndexedDB, hence from a deserialiser:
            // `__proto__` comes out as an OWN property, enumerated by
            // `Object.entries`, and `out[k] = …` would send it to the prototype
            // setter. The store is not a trusted source just because it is local — it
            // is written by code of several versions, and it survives deployments.
            if (isUnsafeKey(layerId)) continue;
            if (isLayerPullState(value)) out[layerId] = sanitise(value);
        }
        return out;
    } catch (err) {
        Log.warn("[Offline.PullState] Lecture impossible :", (err as Error).message);
        return {};
    }
}

/**
 * Records a pull's outcome for ONE layer, preserving the others'.
 *
 * ⚠️ **Read-modify-write, and the key is single**: two concurrent pulls on two layers
 * could lose each other. Accepted here, and the motive is measurable — `pullLayer` is
 * triggered by a user gesture, one at a time, and the stake is a display marker, not
 * a capture. The contract's rule ("a capture never disappears") bears on `features`
 * and the `outbox`, which do go through transactions.
 *
 * Never throws: a successful pull must not be reported as failed because its marker
 * could not be written.
 *
 * @param db - The storage facade (`GeoLeaf.Storage.DB`).
 * @param layerId - Layer concerned.
 * @param state - The outcome to record.
 * @returns Resolves once the write was attempted.
 * @example
 * await writePullState(GeoLeaf?.Storage?.DB, "sites_rosario", {
 *     at: Date.now(),
 *     outcome: "ok",
 *     written: 27,
 * });
 */
export async function writePullState(
    db: PreferenceStore | null | undefined,
    layerId: string,
    state: LayerPullState
): Promise<void> {
    try {
        const current = await readPullState(db);
        await db?.setPreference?.(PULL_STATE_KEY, { ...current, [layerId]: state });
        Log.debug(
            `[Offline.PullState] "${layerId}" — ${state.outcome}, ${state.written} écrite(s)`
        );
    } catch (err) {
        Log.warn(
            `[Offline.PullState] "${layerId}" — écriture impossible :`,
            (err as Error).message
        );
    }
}

/**
 * Drops the delta's starting point of every layer, keeping the rest of each entry.
 *
 * 🛑 **Called when the store's content goes.** A mark says "the store holds what the source held
 * up to here" — after a purge it holds nothing, and a delta from the old mark would bring back
 * only what changed since: a layer rebuilt from its latest edits, the rest missing, and nothing
 * to say so. Without a mark, the next pull is complete.
 *
 * Never throws, like {@link writePullState}: the purge it follows must not be reported as failed.
 *
 * @param db - The storage facade (`GeoLeaf.Storage.DB`).
 * @returns Resolves once the write was attempted.
 * @example
 * await clearPullMarks(GeoLeaf?.Storage?.DB);
 */
export async function clearPullMarks(db: PreferenceStore | null | undefined): Promise<void> {
    try {
        const current = await readPullState(db);
        // `Object.fromEntries` defines own properties: a key read back from IndexedDB never
        // reaches a prototype setter — and `readPullState` already dropped the unsafe ones.
        const unmarked = Object.fromEntries(
            Object.entries(current).map(([layerId, state]) => [
                layerId,
                { at: state.at, outcome: state.outcome, written: state.written },
            ])
        );
        await db?.setPreference?.(PULL_STATE_KEY, unmarked);
    } catch (err) {
        Log.warn("[Offline.PullState] Effacement des marques impossible :", (err as Error).message);
    }
}
