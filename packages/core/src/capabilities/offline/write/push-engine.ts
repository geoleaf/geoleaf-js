/*!
 * GeoLeaf Core (offline capability) — Outbox push and identity reconciliation
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Push — the `outbox` drain, and identity reconciliation.
 *
 * The `outbox` got its first writer with local edits; this module gives it its first
 * real READER. The cycle is then closed: pull → read locally → edit off-network →
 * push back when the network returns (here).
 *
 * ## What makes replay idempotent, and why it was not possible before
 *
 * 🛑 **The CLIENT identity goes on the wire.** The body carries `local_id`, outside the
 * property whitelist — business columns belong to the form, this one belongs to the
 * protocol. It is what lets the SERVER refuse a duplicate itself: measured against the
 * proof backend, replaying the same `local_id` yields **409** on a `UNIQUE` constraint,
 * not on a caller convention. `sync_queue` carried no client identity — which is
 * exactly why idempotence was deferred until here.
 *
 * ⚠️ **A 409 is therefore a SUCCESS**, not an error: it says "I already have it".
 * Treating it as failure would make the queue loop on an entry the server did accept.
 *
 * ## Reconciliation
 *
 * When a `create` returns, the server yields its identifier. It is written **into the
 * record itself** (`FeatureRecord.serverId`), not into the queue entry: the queue
 * references only `localId` (contract), and it disappears once pushed. Without that
 * write, the entity would be re-created on the next pull instead of recognised.
 *
 * ## Retry belongs to the QUEUE, not the transport
 *
 * ⚠️ The transport is `fetchBounded` and **not** `FetchHelper`, which retries on its
 * own. Two retry authorities — one in the transport, one in `attempts`/`failed` —
 * would count each other and make the attempt count inexplicable. That is the very
 * shape of the "two mechanisms that never meet" defect closed elsewhere.
 *
 * @version 1.0.0
 */

import { Log } from "../../../utils/log/index.js";
import { StorageContract } from "../../../kernel/shared/index.js";
import { fetchBounded } from "../../../utils/general/fetch-bounded.js";
import { coreProfileLayerConfig } from "../config-seam.js";
import { isUnsafeKey } from "../../../utils/general/object-path-guard.js";
import type {
    FeatureRecord,
    OutboxEntry,
    QuarantineReason,
} from "../../../contracts/sync.contract.js";

/** Property carrying the client identity on the wire. Shared with the backend schema. */
const CLIENT_ID_PROPERTY = "local_id";

/**
 * Replay budget — TOTAL number of attempts before quarantine, first one included.
 *
 * 🛑 **IT NO LONGER EXISTED.** A `MAX_REPLAY_ATTEMPTS = 3` lived in the v3 queue, where
 * it was enforced **at write time**; it left with the store. Measured then: the outbox
 * did carry an `attempts` field, but this engine neither incremented nor capped it —
 * the budget was **already absent from the v4 path** before that removal, which only
 * made it visible.
 *
 * Product consequence without it: a failing entry is replayed **indefinitely**, and the
 * `quarantined` state the contract describes as "kept, but not replayable as-is" is
 * reached by `markFailure` below — four declared `QuarantineReason`s, four producers.
 * ⚠️ This comment said "is reached by NO path — three motives declared, zero producers"
 * for a while, in the very file that produces them. And the exit from that quarantine
 * now exists: `write/quarantine-api.ts`.
 *
 * ⚠️ It counts TOTAL attempts, not retries: `3` = one initial send + two replays. Same
 * convention as the download's `RetryHandler`, so a reader does not have to wonder
 * which of the two applies.
 */
const MAX_REPLAY_ATTEMPTS = 3;

/**
 * Statuses that say "not NOW", as opposed to "not like that".
 *
 * 🛑 **THIS DISTINCTION DID NOT EXIST, AND ITS ABSENCE CONDEMNED CAPTURES.** Until
 * 09/08/2026 `pushOne` had a single branch for everything that is neither 409 nor 404:
 * a maintenance 503 and a definitive 403 both came out under the same
 * `rejectedByServer`. That motive being excluded from `REQUEUEABLE`
 * (`quarantine-api.ts`), a transient server outage exhausted the budget then made the
 * entry NON-REPLAYABLE — its only exit became `discardQuarantined`, i.e. destroying
 * the capture. The drain triggers on network return **and on the "Retry" button**, and
 * `attempts` is persistent: three clicks during a maintenance window sufficed.
 *
 * ⚠️ **Each member is here for its own reason, not because it is a 5xx**: 500/502/503/
 * 504 name a server or intermediary unable to answer, 408 a timeout, 429 a refused
 * rate. All become true again without the entry changing. **501 is NOT here**: it does
 * not say "not now" but "I do not know this verb", which calls for immediate
 * quarantine — see {@link PushFailure}.
 */
const TRANSIENT_SERVER_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);

/** The server declares it does not implement the verb — HTTP 501. */
const NOT_IMPLEMENTED_STATUS = 501;

/**
 * Why a send failed.
 *
 * ⚠️ **Only the values this module PRODUCES are declared.** A first draft carried three
 * more — `layerUnknown`, `noWriteTarget`, `recordMissing` — that no path ever returned:
 * those cases are handled in the loop, before the send. A union member nothing produces
 * is indistinguishable from a typo, exactly what the contract holds against a
 * pre-declared dialect.
 */
type PushFailure =
    /**
     * The server refused for a reason replay will not fix.
     *
     * ⚠️ **NARROWED on 09/08/2026.** This member named EVERY non-409/non-404 failure
     * until then, server outages included. It now covers only definitive refusals —
     * the 4xx other than 404 and 501: malformed request, missing right, disallowed
     * verb, unprocessable entity.
     */
    | "rejectedByServer"
    /**
     * The server was in no state to answer, and may be at the next drain.
     *
     * It does NOT carry its own `QuarantineReason`: at the cap it falls onto
     * `retryBudgetExhausted`, which says exactly what happened — the budget was spent
     * without the server ever answering actionably — and which is **replayable**.
     */
    | "serverUnavailable"
    /**
     * The server does not know the verb — HTTP 501.
     *
     * 🛑 **IMMEDIATE quarantine, and yet REPLAYABLE.** Both halves derive from the
     * meaning: replaying an unimplemented verb three times only waits three times
     * (same argument as `deletedOnServer`), but the server upgrade IS the lifting of
     * the cause, and it is not observable here — so it is entrusted to the operator,
     * like `retryBudgetExhausted`.
     *
     * ⚠️ This mirrors the `rest`-dialect carve-out below, which treats a CLIENT-side
     * "not implemented" as replayable. Treating them as opposites of each other was
     * the measured asymmetry that commanded the narrowing.
     */
    | "notImplementedByServer"
    /** The network did not answer. */
    | "networkError"
    /**
     * The server no longer knows the entity — 404 on an `update` or a `delete`.
     *
     * ⚠️ **The operation vocabulary DECIDES**, and that is what makes this member
     * producible: a 404 on a `create` says the endpoint is wrong, not that the entity
     * vanished. Confusing them would quarantine a misconfigured layer under a motive
     * that accuses the server.
     */
    | "deletedOnServer";

/** What a full drain did. */
interface PushReport {
    readonly attempted: number;
    readonly pushed: number;
    readonly failed: number;
    /** Entries the server already knew — a 409 on the client identity. */
    readonly alreadyPresent: number;
    /** Conflicts DETECTED then settled by `lastWriteWins`. */
    readonly conflicts: number;
    readonly refused: "engineUnavailable" | null;
}

/** Write target resolved from the layer declaration. */
interface WriteTarget {
    readonly endpoint: string;
    readonly dialect: "rest" | "collection";
    readonly geometryProperty: string;
    readonly properties: readonly string[] | null;
    /** Column serving as freshness marker — the conflict filter. */
    readonly versionProperty: string;
}

/**
 * The two database modules the drain reads and writes, reduced to what it uses.
 *
 * ⚠️ `list()` replaces `listByState()` here: it is the only one of the two that
 * returns GLOBAL insertion order. `listByState` holds it within one state — enough for
 * whoever reads a single state, never for whoever replays two.
 */
interface OutboxModule {
    /** Every entry, in insertion order (`seq` key, `autoIncrement`). */
    list(): Promise<OutboxEntry[]>;
    updateState(
        id: string,
        state: string,
        patch?: { attempts?: number; quarantine?: QuarantineReason; quarantineStatus?: number }
    ): Promise<void>;
    remove(id: string): Promise<void>;
}
interface FeaturesModule {
    get(layerId: string, localId: string): Promise<FeatureRecord | null>;
    put(record: FeatureRecord): Promise<void>;
    remove(layerId: string, localId: string): Promise<void>;
}

/** The storage seam, reduced to what this module reads and writes. */
interface PushStore {
    _ensureModule?: (name: string) => unknown;
}

/**
 * Marks a failure: increments the budget, and sets aside when it is exhausted.
 *
 * 🛑 **A SINGLE EXIT POINT FOR FAILURE.** The drain's four failure paths each did
 * `updateState(id, "failed")` — four writes, none touching `attempts`. A counter
 * nobody increments caps nothing, and a cap spread over four sites would have
 * desynchronised at the first fifth path.
 *
 * @param outbox - The queue module.
 * @param entry - The entry that just failed; its `attempts` is the tally's base.
 * @param reason - IMMEDIATE quarantine motive, when replay can change nothing.
 *   Without it, the entry stays `failed` until the budget is exhausted.
 * @param lastFailure - What made the last send fail, when there was one. It DECIDES
 *   the motive at the cap: an exhausted server refusal is not an exhausted mute
 *   network.
 * @param httpStatus - Status of the refusal, when there was one. It TRAVELS WITH THE
 *   ENTRY instead of staying in a `Log.warn` nobody opens in the field.
 * @returns `true` when the entry went into quarantine.
 */
async function markFailure(
    outbox: OutboxModule,
    entry: OutboxEntry,
    reason?: QuarantineReason,
    lastFailure?: PushFailure,
    httpStatus?: number
): Promise<boolean> {
    const attempts = (entry.attempts ?? 0) + 1;
    // ⚠️ An IMMEDIATE quarantine does not consume the budget, it short-circuits it:
    // replaying a layer that lost its `write` block three times only waits three times.
    //
    // 🛑 AT THE CAP, THE MOTIVE FOLLOWS THE LAST FAILURE. A server that refuses three
    // times REFUSED; a network mute three times said nothing. Writing
    // `retryBudgetExhausted` in both cases would have produced one true motive and one
    // false one under the same name — and left `rejectedByServer` declared without a
    // producer, which the contract itself calls "indistinguishable from a typo".
    //
    // ⚠️ **THIS REASONING WAS RIGHT, AND ITS PREMISE WAS FALSE.** "A server that
    // refuses three times REFUSED" assumes `rejectedByServer` names a refusal — but it
    // named, until 09/08/2026, EVERY non-409/non-404 failure, 5xx outages included.
    // The line below did not change: it is `pushOne` that now produces
    // `rejectedByServer` only for a real refusal, and a `serverUnavailable` therefore
    // falls on the right side with no new motive needed here.
    const exhausted: QuarantineReason =
        lastFailure === "rejectedByServer" ? "rejectedByServer" : "retryBudgetExhausted";
    const quarantine = reason ?? (attempts >= MAX_REPLAY_ATTEMPTS ? exhausted : null);
    if (quarantine) {
        Log.warn(
            `[Offline.Push] ${entry.id} — QUARANTAINE (${quarantine}) après ${attempts} essai(s). ` +
                "L'entrée reste en base : le contrat interdit de la détruire."
        );
        // `quarantineStatus` is written ONLY when it exists: a quarantine that does
        // not come from a server response (`layerNoLongerWritable`, mute network at
        // the cap) must not be assigned a fabricated status. An absent field says "no
        // response"; a `0` would say "the server answered 0", which is false and
        // indistinguishable.
        await outbox.updateState(entry.id, "quarantined", {
            attempts,
            quarantine,
            ...(httpStatus !== undefined ? { quarantineStatus: httpStatus } : {}),
        });
        return true;
    }
    await outbox.updateState(entry.id, "failed", { attempts });
    return false;
}

/**
 * Resolves a layer's write target.
 *
 * ⚠️ **Per LAYER, and never per plugin** (contract point 7). Two mechanisms disputed
 * this role without ever meeting: a per-layer block, read in four places but set by
 * **zero layers out of 48** at first, and a plugin-level base URL that ignores the
 * layer entirely. On a backend where each layer is a distinct collection, only the
 * first form can be right.
 *
 * @param layerId - Targeted layer.
 * @returns The target, or `null` when the layer declares no usable one.
 */
function resolveWriteTarget(layerId: string): WriteTarget | null {
    const config = coreProfileLayerConfig(layerId);
    if (!config) return null;
    const write = config.write as
        | {
              enabled?: boolean;
              endpoint?: string;
              dialect?: string;
              geometryProperty?: string;
              properties?: string[];
          }
        | undefined;
    if (write?.enabled !== true || !write.endpoint) return null;
    return {
        endpoint: write.endpoint,
        dialect: write.dialect === "rest" ? "rest" : "collection",
        geometryProperty: write.geometryProperty ?? "geom",
        properties: Array.isArray(write.properties) ? write.properties : null,
        // The same column the pull reads its `VersionMarker` from: both halves of the
        // cycle must name the SAME thing, or the conflict compares beside the point.
        versionProperty:
            (config.offline as { source?: { versionProperty?: string } } | undefined)?.source
                ?.versionProperty ?? "updated_at",
    };
}

/**
 * Builds the body sent to the server for the `collection` dialect — a FLAT object.
 *
 * The `properties` whitelist is a whitelist: what is not on it never leaves. Two keys
 * are added because they belong to the protocol and not the form: the geometry, and
 * the client identity that makes replay idempotent.
 *
 * @param record - The local record to send.
 * @param target - The resolved target.
 * @returns The body ready to serialise.
 */
function buildCollectionBody(record: FeatureRecord, target: WriteTarget): Record<string, unknown> {
    const feature = (record.feature ?? {}) as { geometry?: unknown; properties?: unknown };
    const properties = (
        feature.properties && typeof feature.properties === "object" ? feature.properties : {}
    ) as Record<string, unknown>;

    // ⚠️ EVERY key written here comes from data: the layer's whitelist, or the
    // entity's properties when the layer declares none. A `__proto__` or `constructor`
    // name would pollute the serialised body's prototype — the repo's canonical guard
    // is what makes the case unreachable rather than improbable.
    const body: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const allowed = target.properties ?? Object.keys(properties);
    for (const name of allowed) {
        if (isUnsafeKey(name)) continue;
        const value = properties[name];
        if (value !== undefined) body[name] = value;
    }
    if (!isUnsafeKey(target.geometryProperty)) body[target.geometryProperty] = feature.geometry;
    body[CLIENT_ID_PROPERTY] = record.localId;
    return body;
}

/**
 * HTTP request matching an operation.
 *
 * 🛑 **The `collection` dialect only, and refusing the other is EXPLICIT.** The
 * contract declares two dialects because the plugins' code implements two; core-side,
 * no layer in the repo declares `rest` — `sites_rosario`, the only one carrying a
 * `write` block, is `collection`. Building a flat body here and sending it to a REST
 * endpoint "just in case" would send the wrong shape **silently**, which is the defect
 * class being closed. The drain therefore refuses `rest` by name, and this line is
 * what will tell the next reader a dialect remains to be written.
 */
function buildRequest(
    entry: OutboxEntry,
    record: FeatureRecord,
    target: WriteTarget,
    conditional = true
): { url: string; init: RequestInit } {
    const identified = `${target.endpoint}?id=eq.${encodeURIComponent(String(record.serverId))}`;
    // 🛑 THE BASE MARKER BECOMES A FILTER, AND THAT IS WHAT MAKES THE CONFLICT
    // DETECTABLE. Measured against real PostgREST: a `PATCH` filtered on a STALE
    // `updated_at` yields **200 with an EMPTY array** — zero rows touched, so someone
    // else wrote in between. With a fresh marker, 1 row. That was the only missing
    // piece: the contract says the gain is not the outcome but that the conflict
    // becomes OBSERVABLE.
    //
    // ⚠️ `encodeURIComponent` is not decorative: the `+` of an ISO timestamp's
    // timezone must be encoded, otherwise PostgREST reads it as a space and yields
    // `400 invalid input syntax for type timestamp`. Also measured.
    const guarded =
        conditional && entry.baseVersion
            ? `${identified}&${target.versionProperty}=eq.${encodeURIComponent(entry.baseVersion.value)}`
            : identified;
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        // The server returns the created row: that is where the `serverId` comes
        // from, and asking explicitly avoids a second round-trip to learn it.
        Prefer: "return=representation",
    };

    if (entry.kind === "delete") {
        return { url: guarded, init: { method: "DELETE", headers } };
    }
    const body = JSON.stringify(buildCollectionBody(record, target));
    if (entry.kind === "create") {
        return { url: target.endpoint, init: { method: "POST", headers, body } };
    }
    return { url: guarded, init: { method: "PATCH", headers, body } };
}

/**
 * Pushes one entry, and returns the server identity when the server provides one.
 *
 * @param entry - The queue entry.
 * @param record - The entity it names.
 * @param target - The layer's write target.
 * @param conditional - Filter on the base marker, which makes the conflict detectable.
 *   Set to `false` for the SECOND send, the one that settles by `lastWriteWins`: the
 *   conflict was already observed and logged, re-filtering would fail it a second
 *   time.
 * @returns The outcome, the `serverId` to reconcile, and whether a conflict was detected.
 */
async function pushOne(
    entry: OutboxEntry,
    record: FeatureRecord,
    target: WriteTarget,
    conditional = true
): Promise<{
    ok: boolean;
    serverId?: string;
    alreadyPresent?: boolean;
    conflicted?: boolean;
    failure?: PushFailure;
    /** Status of the refusal, when the server answered — it travels with the entry. */
    httpStatus?: number;
}> {
    const { url, init } = buildRequest(entry, record, target, conditional);
    let response: Response;
    try {
        response = await fetchBounded(url, init);
    } catch (error) {
        Log.warn(`[Offline.Push] ${entry.id} — réseau muet :`, String(error));
        return { ok: false, failure: "networkError" };
    }

    // 🛑 409 = "I already have it". The UNIQUE constraint on the client identity is
    // what makes replay safe; treating it as failure would loop the queue on a
    // success.
    if (response.status === 409) return { ok: true, alreadyPresent: true };

    if (!response.ok) {
        // 404 on an entity the server should know: it was deleted over there while it
        // was being edited here. Replay will not resurrect it.
        if (response.status === 404 && entry.kind !== "create") {
            Log.warn(`[Offline.Push] ${entry.id} — l'entité n'existe plus côté serveur (404).`);
            return { ok: false, failure: "deletedOnServer", httpStatus: response.status };
        }
        // 🛑 THE STATUS CLASS DECIDES THE CAPTURE'S FATE. These three branches used
        // to be one line returning `rejectedByServer` — hence a non-replayable entry —
        // for a 503 as for a 403. The detailed reasoning sits on
        // `TRANSIENT_SERVER_STATUSES` and on the members of {@link PushFailure}.
        if (response.status === NOT_IMPLEMENTED_STATUS) {
            Log.warn(
                `[Offline.Push] ${entry.id} — le serveur ne connaît pas ce verbe (501) ; quarantaine immédiate.`
            );
            return { ok: false, failure: "notImplementedByServer", httpStatus: response.status };
        }
        if (TRANSIENT_SERVER_STATUSES.has(response.status)) {
            Log.warn(
                `[Offline.Push] ${entry.id} — serveur indisponible (${response.status}) ; l'entrée reste rejouable.`
            );
            return { ok: false, failure: "serverUnavailable", httpStatus: response.status };
        }
        Log.warn(`[Offline.Push] ${entry.id} — refusé (${response.status}).`);
        return { ok: false, failure: "rejectedByServer", httpStatus: response.status };
    }

    const payload = (await response.json().catch(() => null)) as
        { id?: unknown } | Array<{ id?: unknown }> | null;
    // 🛑 ZERO ROWS TOUCHED ON A CONDITIONAL UPDATE = CONFLICT. The entity exists (the
    // server identity is known) but its freshness marker no longer matches: someone
    // wrote between the read and this push. Measured: PostgREST yields `200 []`. That
    // is the only form in which this server knows how to say it.
    if (conditional && entry.baseVersion && entry.kind === "update") {
        const affected = Array.isArray(payload) ? payload.length : payload ? 1 : 0;
        if (affected === 0) return { ok: false, conflicted: true };
    }

    const row = Array.isArray(payload) ? payload[0] : payload;
    const serverId = row?.id;
    return serverId != null ? { ok: true, serverId: String(serverId) } : { ok: true };
}

/**
 * Drains the `outbox`: pushes each pending operation and reconciles identities.
 *
 * Does not throw — each entry gets its outcome, and a failing entry stays in the queue
 * with its counter incremented. `failed` is **not terminal** (contract): that is the
 * guarantee a field capture comes back at the next drain rather than disappearing.
 *
 * @returns The drain's real tally.
 * @example
 * const report = await GeoLeaf?.Storage?.pushOutbox?.();
 * console.info(`${report?.pushed} poussées, ${report?.failed} à retenter`);
 */
export async function pushOutbox(): Promise<PushReport> {
    const nothing = { attempted: 0, pushed: 0, failed: 0, alreadyPresent: 0, conflicts: 0 };
    const db = StorageContract.DB as PushStore | null;
    const outbox = db?._ensureModule?.("Outbox") as OutboxModule | null | undefined;
    const features = db?._ensureModule?.("Features") as FeaturesModule | null | undefined;
    if (!outbox?.list || !features?.put) return { ...nothing, refused: "engineUnavailable" };

    // 🛑 SINGLE READ, THEN FILTER — AND IT IS THE ORDER THAT DEMANDS IT.
    //
    // This block used to do `[...listByState("pending"), ...listByState("failed")]`.
    // That is **exactly the concatenation already fixed once** on the v3 queue: two
    // index reads, put end to end, hence every `pending` before every `failed`
    // whatever their capture rank.
    //
    // ⚠️ **Coalescing does NOT make the case impossible**, contrary to what one might
    // believe: `local-edit.ts` does absorb a new edit into an existing `failed` entry
    // (`COALESCIBLE = {pending, failed}`), but **not during the `inFlight` window**,
    // which is deliberately not mergeable. An edit made while a push is in flight
    // therefore stacks a second entry, and if the push fails the entity carries a
    // `failed` of rank N and a `pending` of rank N+1 — which the concatenation
    // inverted.
    //
    // `list()` returns "Every entry, in INSERTION order": the store is
    // `autoIncrement`, so `getAll()` comes out in key order, i.e. `seq` order. The
    // order is held **by construction** and not by a sort — `db/outbox.ts` says it in
    // its own words: "A sort would be a second ordering authority, i.e. the defect's
    // own shape."
    //
    // ✅ And this drain was the ONLY one concatenating: `poi-restore.ts`, the
    // outbox's other reader, has always called `list()`. Boot-time restoration thus
    // held the order replay was losing — two reads of the same store, two orders.
    const REPLAYABLE = new Set(["pending", "failed"]);
    const pending = (await outbox.list()).filter((entry) => REPLAYABLE.has(entry.state));

    let pushed = 0;
    let failed = 0;
    let alreadyPresent = 0;
    let conflicts = 0;

    for (const entry of pending) {
        const target = resolveWriteTarget(entry.layerId);
        if (!target) {
            Log.warn(
                `[Offline.Push] ${entry.id} — aucune cible d'écriture pour "${entry.layerId}".`
            );
            // IMMEDIATE quarantine: a layer that lost its write target will not find
            // it back by replaying. That is exactly what `layerNoLongerWritable`
            // names, and this is its FIRST producer.
            await markFailure(outbox, entry, "layerNoLongerWritable");
            failed += 1;
            continue;
        }
        // NAMED refusal rather than a flat body sent to a REST endpoint: see `buildRequest`.
        if (target.dialect === "rest") {
            Log.warn(
                `[Offline.Push] ${entry.id} — dialecte "rest" non implémenté côté core ; l'entrée reste en file.`
            );
            // ⚠️ NO quarantine here, deliberately: the `rest` dialect is a hole in
            // the CORE, not a defect of the entry. A version implementing it will
            // replay it. The entry therefore spends its budget like the others — a
            // lasting hole will become visible to it in quarantine rather than making
            // it loop forever.
            await markFailure(outbox, entry);
            failed += 1;
            continue;
        }

        const record = await features.get(entry.layerId, entry.localId);
        if (!record) {
            Log.warn(`[Offline.Push] ${entry.id} — l'entité nommée a disparu du magasin.`);
            await markFailure(outbox, entry);
            failed += 1;
            continue;
        }

        // `inFlight` BEFORE the call, and that is what protects coalescing: a
        // concurrent edit will not merge into an entry already gone on the wire.
        await outbox.updateState(entry.id, "inFlight");
        let result = await pushOne(entry, record, target);

        // ── `lastWriteWins`, DECLARED rather than suffered ─────────────────────────
        //
        // The outcome is the same as before: the local version wins. What changes is
        // that the conflict was DETECTED and LOGGED before being settled — until now
        // it was indistinguishable from a normal write, and "the strategy" boiled down
        // to an `X-Force-Update` header that NO server in the repo reads.
        //
        // The motive is the field, and it is in the contract: an operator is the
        // authority on what they just observed, and a dialog raised off-network, alone
        // on site, gets clicked at random.
        if (result.conflicted) {
            conflicts += 1;
            Log.warn(
                `[Offline.Push] ${entry.id} — CONFLIT : "${entry.layerId}"/${entry.localId} a changé côté serveur depuis la saisie. Politique lastWriteWins : la version locale écrase.`
            );
            result = await pushOne(entry, record, target, false);
        }

        if (!result.ok) {
            // The path the budget exists for: mute network or server refusal. Both
            // CAN be transient, so we replay — up to the cap, not beyond. The motive
            // written at the cap distinguishes the two.
            //
            // ⚠️ `deletedOnServer` is the exception: it does not spend the budget.
            // Replaying an entity the server deleted can neither recreate nor modify
            // it — that is a product decision, not a transport incident, and it must
            // reach the operator now rather than in three drains.
            //
            // ✅ `notImplementedByServer` JOINS THE EXCEPTION at the same narrowing, on
            // the same argument: replaying a verb the server declares unknown only
            // waits three times. The difference is downstream — this one is REPLAYABLE
            // once the server is upgraded, where `deletedOnServer` never is.
            const immediate: QuarantineReason | undefined =
                result.failure === "deletedOnServer" || result.failure === "notImplementedByServer"
                    ? result.failure
                    : undefined;
            await markFailure(outbox, entry, immediate, result.failure, result.httpStatus);
            failed += 1;
            continue;
        }

        if (entry.kind === "delete") {
            // The entity finished its cycle: the queue lets it go, and so does the store.
            await features.remove(entry.layerId, entry.localId);
        } else {
            await features.put({
                ...record,
                serverId: result.serverId ?? record.serverId,
                syncState: "synced",
            });
        }
        await outbox.remove(entry.id);
        pushed += 1;
        if (result.alreadyPresent) alreadyPresent += 1;
    }

    Log.info(
        `[Offline.Push] ${pushed} poussée(s), ${failed} à retenter, ${conflicts} conflit(s) tranché(s).`
    );
    return { attempted: pending.length, pushed, failed, alreadyPresent, conflicts, refused: null };
}
