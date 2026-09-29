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
 * The ambient `Storage` ends with a `[key: string]: unknown` tail. A member the declaration
 * does not name falls into it and becomes `unknown` — not callable — and the documentation
 * gate cannot tell: it defers the "is of type 'unknown'" diagnostic, because the tail absorbs
 * real members and invented ones alike. The write-cycle members were all in that tail, so an
 * integrator's compiler refused `GeoLeaf.Storage.pushOutbox()` while every gate stayed green.
 * Here the compiler answers instead: a member that falls back into the tail stops this file
 * compiling, and so does a result field that is misspelled or no longer returned.
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
    void [liftable, requeued, ok];
}

/** Conflicts settled by the last write. */
export async function conflicts(storage: StorageNs): Promise<void> {
    const archived = (await storage?.listConflicts?.("layer")) ?? [];
    const settledBy: "lastWriteWins" | undefined = archived[0]?.settledBy;
    const cleared: boolean | undefined = await storage?.clearConflicts?.("layer");
    void [settledBy, cleared];
}
