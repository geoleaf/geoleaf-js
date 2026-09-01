/*!
 * GeoLeaf Core (offline capability) — Optimistic local edit
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Optimistic write — the entry point every edit plugin goes through.
 *
 * An edit made off-network must **show immediately** and **survive a reload**. The two
 * halves are inseparable: the entity goes into the `features` store (which the local
 * read re-reads at load time) and the operation goes into the `outbox` (which the push
 * will replay), **in a single transaction**.
 *
 * ## Why this point is in the CORE and not in the edit plugins
 *
 * 🛑 **Two incompatible vocabularies wrote the same v3 queue, and only one went through
 * the seam.** `addpoi` stacked `add_poi` / `update_poi` / `delete_poi` under a
 * `poiData` key, via `GeoLeaf.Sync.registerHandler("poi", …)`; `editor` stacked
 * `editor.save` / `editor.update` / `editor.delete` under a `payload` key, **without
 * registering any handler**, with its own replay. The sync contract refuses both, for
 * the same reason: "The contract is entity-generic because the store is."
 *
 * The `outbox` is a **core** store, and its `kind` is frozen on `SyncOperationKind`. A
 * plugin can therefore neither write it directly (`no-plugin-in-core`) nor write its
 * own vocabulary into it. This module is the single writer, the plugins become thin
 * callers — and a plugin merge will have nothing to redo.
 *
 * ## The editability invariant is held HERE, not in the database
 *
 * ⚠️ **Pulling NEVER confers editability.** A layer can be pulled for reading without
 * being modifiable; its online declaration decides, never the fact that its data was
 * downloaded. The guard lives in this layer because it is the only one that reads the
 * declaration: placed in `db/local-edit.ts` it would become a *storage* rule,
 * bypassable by any caller speaking to the database directly.
 *
 * ⚠️ **The gate is PER OPERATION** since 05/08/2026, on `LayerEditionPermissions`. It
 * replaces the `enableEdition` / `enableEditionFull` pair, whose second name did not
 * mean "full edition": it was only usefully read once, as `canDelete()`. **Absent
 * means refused for each key, and none implies another.** This is not
 * iso-behavioural: the old `enableEdition` governed *every* `kind` with one flag, so
 * the six layers migrated to explicit `{create, update, delete}`.
 *
 * ✅ **THIS FILE IS NO LONGER THE ONLY PLACE THE PERMISSION IS APPLIED** — fixed on
 * 07/08/2026. It was, and it covered only the OFFLINE path: the online path
 * (`editor/src/persistence/rest-adapter.ts`) emitted an unconditional `DELETE`, so a
 * layer declaring `edition.delete: false` stayed deletable by a **connected** user.
 * The permission was applied only on the path taken when the network is absent.
 *
 * The rule moved to `kernel/shared/edition-permissions.ts` — **the boot graph**,
 * because it reads the profile and not IndexedDB, and because `editor` declares
 * `requires: []` and runs without this engine in `persistence.mode: "online"`.
 * `applyEdit` still applies it, via `grantsEdition`: the SAME function the plugin
 * consults, not a second read.
 *
 * ⚠️ **What stays true**: the editor toolbar gates its delete tool on its own
 * `enabledTools`, a plugin config, never on the layer. The button can therefore be
 * offered on a layer that refuses — the write, however, is refused.
 *
 * @version 1.0.0
 */

import { Log } from "../../../utils/log/index.js";
import { StorageContract, grantsEdition } from "../../../kernel/shared/index.js";
import { coreProfileLayerConfig } from "../config-seam.js";
import type {
    // ⚠️ `LayerEditionPermissions` is no longer imported here: the type is interpreted
    // by `grantsEdition` (`kernel/shared/edition-permissions.ts`), now the only place
    // that reads it. Keeping it would have been a dead import `tsc` flags (TS6196).
    SyncOperationKind,
    VersionMarker,
} from "../../../contracts/sync.contract.js";
import type { LocalEditTally } from "../db/local-edit.js";

/** Why an edit was not recorded. Never `null` without an effective write. */
type EditRefusal =
    /** No layer of that name in the active profile. */
    | "layerUnknown"
    /** The layer grants neither `edition.create` nor `edition.update`. */
    | "layerNotEditable"
    /** The layer does not grant `edition.delete`. */
    | "deleteNotPermitted"
    /** The storage engine is not wired. */
    | "engineUnavailable"
    /** A create without an entity, or a modification without an identity. */
    | "malformedEdit"
    /** A create without a position — the one state the product makes unreachable. */
    | "geometryRequired";

/** A local edit, as an edit plugin submits it. */
interface EditInput {
    readonly layerId: string;
    readonly kind: SyncOperationKind;
    /** Required except for a `create`, where it is minted here. */
    readonly localId?: string;
    /** The entity after the edit. Unneeded for a `delete`. */
    readonly feature?: unknown;
    /** Marker the edit is based on; forwarded to the push to detect a conflict. */
    readonly baseVersion?: VersionMarker | null;
}

/** What the edit produced. */
interface EditReport {
    readonly layerId: string;
    readonly localId: string;
    readonly kind: SyncOperationKind;
    readonly entryId: string | null;
    readonly queued: boolean;
    readonly coalescedInto: string | null;
    readonly annulled: boolean;
    readonly refused: EditRefusal | null;
}

/** The only member of the storage seam this module uses. */
interface EditWriter {
    applyLocalEdit?: (input: {
        layerId: string;
        localId: string;
        kind: SyncOperationKind;
        feature?: unknown;
        baseVersion?: VersionMarker | null;
    }) => Promise<LocalEditTally | null>;
}

/**
 * Mints the client identity of an entity created off-network.
 *
 * ⚠️ **It is minted by the CLIENT and never reused** (contract, `LocalId`). It is what
 * the push will send to the server, and what makes replay idempotent: a second attempt
 * carries the same identity, so the server can refuse it itself — which the proof
 * backend does through a `UNIQUE` constraint, not a caller convention.
 *
 * Prefixed `loc:` to never collide with `srv:<id>`, the form the pull derives from a
 * server identity.
 *
 * @returns A unique local identifier.
 */
function mintLocalId(): string {
    const random = globalThis.crypto?.randomUUID?.();
    return `loc:${random ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
}

/**
 * Applies an edit locally and enqueues it — the edit plugins' entry point.
 *
 * Does not throw: every outcome is a report. A refusal **names itself**, because an
 * edit that vanishes without a motive is indistinguishable from a recorded one, and
 * that is the loss the contract exists to prevent.
 *
 * @param input - The edit submitted by the plugin.
 * @returns The report of what was done.
 * @example
 * const report = await GeoLeaf?.Storage?.applyEdit?.({
 *     layerId: "sites_rosario", kind: "update", localId: "loc:abc", feature
 * });
 * if (report?.refused) console.warn("édition refusée :", report.refused);
 */
export async function applyEdit(input: EditInput): Promise<EditReport> {
    const localId = input.localId ?? (input.kind === "create" ? mintLocalId() : "");
    const nothing = {
        layerId: input.layerId,
        localId,
        kind: input.kind,
        entryId: null,
        queued: false,
        coalescedInto: null,
        annulled: false,
    };

    if (!localId) return { ...nothing, refused: "malformedEdit" };

    // 🛑 ONLY CREATION REQUIRES AN ENTITY, AND THAT IS DELIBERATE.
    //
    // A modification is a PARTIAL edit by nature: renaming a point does not resend its
    // position. Requiring the full entity here would refuse a capture already made —
    // and a refused field capture is lost, loudly instead of silently, which the
    // contract's property 1 forbids just the same. The store keeps what the edit does
    // not bring (`db/local-edit.ts`), so nothing is lost without refusing anything.
    if (input.kind === "create") {
        if (input.feature === undefined) return { ...nothing, refused: "malformedEdit" };
        // ⚠️ A create WITHOUT A POSITION, by contrast, is the one state the product
        // makes unreachable: the form carries a `latlng` field, fed by the placement
        // click. The guard is thus set on an impossible state — it is a guard, not a
        // loss, which is what distinguishes it from an enqueueing refusal.
        const geometry = (input.feature as { geometry?: unknown } | null)?.geometry;
        if (geometry === undefined || geometry === null) {
            return { ...nothing, refused: "geometryRequired" };
        }
    }

    const config = coreProfileLayerConfig(input.layerId);
    if (!config) return { ...nothing, refused: "layerUnknown" };

    // 🛑 THE STANDING INVARIANT. The layer's declaration decides, never the presence
    // of its data in the local store. A layer pulled for reading stays read-only.
    //
    // ⚠️ The gate is PER OPERATION, and that is not iso-behavioural: the old
    // `enableEdition` governed *every* `kind` with one flag. Absent means REFUSED for
    // each key, and none implies another — `update` does not grant `delete`. That is
    // exactly what the previous pair could not say, and why its second name lied.
    if (!grantsEdition(config["edition"], input.kind)) {
        return {
            ...nothing,
            refused: input.kind === "delete" ? "deleteNotPermitted" : "layerNotEditable",
        };
    }

    const db = StorageContract.DB as EditWriter | null;
    if (!db?.applyLocalEdit) return { ...nothing, refused: "engineUnavailable" };

    const tally = await db.applyLocalEdit({
        layerId: input.layerId,
        localId,
        kind: input.kind,
        ...(input.feature !== undefined ? { feature: input.feature } : {}),
        ...(input.baseVersion !== undefined ? { baseVersion: input.baseVersion } : {}),
    });

    if (!tally) return { ...nothing, refused: "engineUnavailable" };

    Log.debug(
        `[Offline.Edit] "${input.layerId}"/${localId} ${input.kind} —`,
        tally.annulled ? "annulée" : tally.queued ? "mise en file" : `fusionnée`
    );

    return {
        layerId: input.layerId,
        localId,
        kind: input.kind,
        entryId: tally.entryId,
        queued: tally.queued,
        coalescedInto: tally.coalescedInto,
        annulled: tally.annulled,
        refused: null,
    };
}
