/*!
 * GeoLeaf — the offline write cycle, called the way an integrator calls it.
 * © 2026 Mattieu Pottier — MIT
 */

/**
 *
 * @description
 * `GeoLeaf.Storage` is typed by the ambient namespace the package publishes (`global.d.ts`,
 * referenced from the entry). This file compiles only if every member the offline write cycle
 * teaches is NAMED there, with the shape the facade really returns.
 *
 * ## Why this file exists
 *
 * The ambient `Storage` ended with a `[key: string]: unknown` tail. A member the declaration
 * did not name fell into it and became `unknown` — not callable — and the documentation gate
 * could not tell: it defers the "is of type 'unknown'" diagnostic, because a tail absorbs real
 * members and invented ones alike. The write-cycle members were all in that tail, so an
 * integrator's compiler refused `GeoLeaf.Storage.pushOutbox()` while every gate stayed green.
 * Here the compiler answers instead: a member that is no longer named stops this file
 * compiling, and so does a result field that is misspelled or no longer returned.
 *
 * Since 3.15.0 the tail is GONE: every member of the façade is named. `misspelled()` below is
 * what holds that — a name the façade does not carry must be an error, and the day a tail
 * comes back the `@ts-expect-error` above it has nothing left to expect, which is an error too.
 *
 * Compiled, never run: nothing imports it, so `rollup.consumer.mjs` (input = `entry.ts` alone)
 * does not bundle it and the `size:consumer` measure is untouched.
 */

import "@geoleaf/core";

type StorageNs = NonNullable<typeof GeoLeaf>["Storage"];

// Each annotation below IS the assertion: the compile error is the failure.

/** Permission and routing — synchronous, read from the active profile. */
export async function permission(storage: StorageNs): Promise<void> {
    await storage?.whenReady?.();
    const mayUpdate: boolean | undefined = storage?.mayEdit?.("layer", "update");
    const canQueue: boolean | undefined = storage?.canQueueWrites?.("layer");
    void [mayUpdate, canQueue];
}

/** A capture — device first, then queued — and a drain on demand. */
export async function captureAndDrain(storage: StorageNs): Promise<void> {
    const edit = await storage?.applyEdit?.({
        layerId: "layer",
        kind: "create",
        feature: {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: {},
        },
    });
    const queued: boolean | undefined = edit?.queued;
    const editRefused: string | null | undefined = edit?.refused;
    const report = await storage?.pushOutbox?.();
    const pushed: number | undefined = report?.pushed;
    const haltedBy: string | null | undefined = report?.haltedBy;
    void [queued, editRefused, pushed, haltedBy];
}

/** Entries set aside — listed, requeued, discarded. */
export async function setAside(storage: StorageNs): Promise<void> {
    const liftable: readonly string[] | undefined = storage?.requeueableReasons?.();
    const batch = await storage?.requeueAll?.("authRequired");
    const requeued: number | undefined = batch?.requeued;
    const listed = (await storage?.DB?.listPendingEdits?.()) ?? [];
    const entry = listed.find((p) => p.state === "quarantined");
    if (!entry) return;
    const one = await storage?.requeueQuarantined?.(entry.entryId);
    const gone = await storage?.discardQuarantined?.(entry.entryId, entry.localId);
    const ok: boolean | undefined = one?.ok ?? gone?.ok;
    // An entry set aside says why — the motive, and the status of the refusal when a server
    // answer caused it.
    const why: string | undefined = entry.quarantine;
    const status: number | undefined = entry.quarantineStatus;
    void [liftable, requeued, ok, why, status];
}

/**
 * A member the façade does not carry is refused by the compiler — the tail used to turn it into
 * `unknown`, and a misspelled call into a diagnostic every documentation gate defers.
 */
export function misspelled(storage: StorageNs): void {
    // @ts-expect-error — `pushOutBox` is not `pushOutbox`: no tail absorbs it any more.
    void storage?.pushOutBox;
}

/** The origin rule of the offline preparation, asked before a download. */
export function preparation(storage: StorageNs): void {
    const verdict = storage?.prefetchVerdict?.("https://tiles.example.test/{z}/{x}/{y}.png");
    const allowed: boolean | undefined = verdict?.allowed;
    const reason: string | undefined = verdict?.reason;
    void [allowed, reason];
}

/** Conflicts settled by the last write. */
export async function conflicts(storage: StorageNs): Promise<void> {
    const archived = (await storage?.listConflicts?.("layer")) ?? [];
    const settledBy: "lastWriteWins" | undefined = archived[0]?.settledBy;
    const cleared: boolean | undefined = await storage?.clearConflicts?.("layer");
    void [settledBy, cleared];
}
