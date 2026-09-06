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
import { DrainHooksContract } from "../../../kernel/shared/drain-hooks-seam.js";
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

/** Preference key holding the last instant the server accepted something. */
export const LAST_SYNC_PREFERENCE = "offline.lastSyncAt";

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
 * Delay before an entry that just failed may be replayed — the base, then ×4 per attempt.
 *
 * 🛑 **THE BUDGET COUNTED GESTURES, NOT TIME, AND THAT IS WHAT MADE IT WRONG.** Three
 * TOTAL attempts is a defensible number for a network coming back; it is an absurd one
 * for three drains fired inside the same minute. And the drain fires on network return
 * **and** on the operator's "Retry" button, with `attempts` persisted: three clicks
 * during a maintenance window set aside a field capture whose only remaining exit — at
 * the time the width of `rejectedByServer` was measured — was destruction.
 *
 * ⚠️ **The deferral is written ON THE ENTRY and read by the drain — never awaited.** A
 * `setTimeout` inside the send would put the retry back into the transport, which
 * `fetchBounded` deliberately does not do (see the header: two retry authorities count
 * each other), and would block the walk over the rest of the queue.
 *
 * ⚠️ **The three numbers are a product decision, not a measurement**: 30 s covers a
 * passing radio hole, 2 min a cell handover, 8 min a maintenance window — and the cap
 * keeps a whole tour from ending on one entry that waits an hour. They are named here so
 * the next reader changes a value, not a mechanism.
 */
const RETRY_BACKOFF_BASE_MS = 30_000;
const RETRY_BACKOFF_FACTOR = 4;
const RETRY_BACKOFF_MAX_MS = 480_000;

/**
 * Age past which an `inFlight` entry is considered abandoned rather than in flight.
 *
 * 🛑 **A WIDE MULTIPLE OF THE TRANSPORT CAP, AND THE MULTIPLE IS THE POINT.**
 * `fetchBounded` aborts at 15 s, so past a minute no request of ours is still running:
 * either the response came back, or the session that sent it is gone. Reclaiming below
 * that threshold would race a LIVE push — two tabs share this database but not their
 * network — and a `DELETE` sent twice earns a 404, i.e. an immediate quarantine on an
 * operation that had succeeded.
 *
 * ⚠️ The two values must move together: shortening the transport cap without shortening
 * this one only delays recovery, lengthening it past this one makes the race real.
 */
const IN_FLIGHT_GRACE_MS = 60_000;

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
 * The status that says "I do not know who you are" — HTTP 401.
 *
 * 🛑 **403 IS NOT HERE, and the exclusion is the interesting half.** A first draft put it
 * beside 401 on the grounds that "both lift with a session carrying the right". They do
 * not lift the same way: 401 says the session is over — signing back in fixes it, and
 * that is a gesture the operator owns; 403 says the identity is known and lacks the
 * right, which no sign-in changes. Widening to 403 would also have destroyed the
 * counter-proof deliberately placed on 09/08/2026 (« un 403 épuisé RESTE un refus »),
 * whose whole job is to prove that `rejectedByServer` has not been over-narrowed. A
 * motive that swallows its own counter-proof cannot be checked any more.
 */
const UNAUTHORIZED_STATUS = 401;

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
     * The session is over — 401 or 403 on a write.
     *
     * 🛑 **It is NOT a sub-case of `rejectedByServer`, and the difference decides the
     * capture's fate.** That member means "replay cannot fix this"; an expired session is
     * the one thing replay fixes as soon as the operator signs back in. Landing there
     * left a field capture with destruction as its only exit.
     *
     * ⚠️ It also HALTS the drain, alone among the failures: everything queued behind it
     * would meet the same dead session, and in the connector's token mode the requests
     * that follow do not even carry an `Authorization` header any more.
     */
    | "authRequired"
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
    /**
     * Entries the drain deliberately walked past, their retry delay not yet elapsed.
     *
     * ⚠️ **Without this member, a drain that does nothing is indistinguishable from an
     * empty queue** — `attempted: 0` on both. The operator pressing "Retry" during a
     * backoff window would see a report saying nothing happened, with no way to tell
     * "there is nothing to send" from "not yet".
     */
    readonly deferred: number;
    /**
     * What stopped the drain before the end of the queue, or `null`.
     *
     * ⚠️ **Without it, a halted drain is indistinguishable from a finished one**, and the
     * difference is everything: forty captures still due, or none. `attempted` alone
     * cannot say it — a queue of one and a halt on the first entry produce the same
     * figure.
     */
    readonly haltedBy: "authRequired" | null;
    readonly pushed: number;
    readonly failed: number;
    /** Entries the server already knew — a 409 on the client identity. */
    readonly alreadyPresent: number;
    /** Conflicts DETECTED then settled by `lastWriteWins`. */
    readonly conflicts: number;
    readonly refused: "engineUnavailable" | null;
}

/** What one send concluded — shared by `pushOne` and the 409 settlement it delegates. */
interface PushOutcome {
    ok: boolean;
    serverId?: string;
    alreadyPresent?: boolean;
    conflicted?: boolean;
    failure?: PushFailure;
    /** Status of the refusal, when the server answered — it travels with the entry. */
    httpStatus?: number;
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
        patch?: {
            attempts?: number;
            quarantine?: QuarantineReason;
            quarantineStatus?: number;
            inFlightAt?: number | null;
            nextAttemptAt?: number | null;
        }
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
    // 🛑 THE DEFERRAL IS WRITTEN AT THE SAME POINT AS THE TALLY, and for the same
    // reason the tally lives here: a budget spread over several sites desynchronises
    // at the first new path. `attempts` says HOW MANY, `nextAttemptAt` says NOT BEFORE
    // WHEN — a counter without the second measured a number of operator gestures.
    const backoff = Math.min(
        RETRY_BACKOFF_BASE_MS * RETRY_BACKOFF_FACTOR ** (attempts - 1),
        RETRY_BACKOFF_MAX_MS
    );
    await outbox.updateState(entry.id, "failed", {
        attempts,
        nextAttemptAt: Date.now() + backoff,
        // The entry is no longer on the wire: leaving its departure stamp would make a
        // later reclaim read a flight that ended.
        inFlightAt: null,
    });
    return false;
}

/**
 * Re-reads a created entity's server identity through the CLIENT identity.
 *
 * 🛑 **A 409 SAYS "I ALREADY HAVE IT" — IT DOES NOT SAY WHICH ROW.** The drain treated
 * that as a plain success, so the entry left the queue with `FeatureRecord.serverId`
 * still `null`: the entity was then locally reputed synchronised and server-side
 * unreachable, every later update filtering on `id=eq.null`. The capture was not lost —
 * worse, it was silently orphaned, and only a full re-pull of the layer could repair it.
 *
 * ⚠️ **The re-read goes through `local_id`, the only key both sides share at that
 * point** — and it is the same key the UNIQUE constraint refused, so it names exactly
 * the row that caused the 409.
 *
 * @param record - The local record whose identity is missing.
 * @param target - The layer's write target.
 * @returns The `serverId` when found; `missing` when the server has no such row;
 *   `unavailable` when the re-read itself could not conclude.
 */
async function reconcileByClientId(
    record: FeatureRecord,
    target: WriteTarget
): Promise<{ serverId?: string; missing?: boolean; unavailable?: boolean }> {
    const url =
        `${target.endpoint}?${CLIENT_ID_PROPERTY}=eq.${encodeURIComponent(String(record.localId))}` +
        "&select=id";
    let response: Response;
    try {
        response = await fetchBounded(url, { headers: { Accept: "application/json" } });
    } catch (error) {
        Log.warn(
            `[Offline.Push] relecture d'identité muette pour ${record.localId} :`,
            String(error)
        );
        return { unavailable: true };
    }
    if (!response.ok) {
        Log.warn(
            `[Offline.Push] relecture d'identité refusée (${response.status}) pour ${record.localId}.`
        );
        return { unavailable: true };
    }
    const payload = (await response.json().catch(() => null)) as
        { id?: unknown } | Array<{ id?: unknown }> | null;
    const row = Array.isArray(payload) ? payload[0] : payload;
    if (row?.id != null) return { serverId: String(row.id) };
    // A JSON array proves the server answered in representation: empty means it holds
    // NO row for this client identity, so the 409 came from another UNIQUE constraint.
    if (Array.isArray(payload)) return { missing: true };
    // Anything else — a body we cannot read — proves nothing.
    return { unavailable: true };
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
 * Settles a 409 — "I already have it" — into an outcome that knows WHICH row.
 *
 * ⚠️ **The identity is only MISSING on a create**, and only when no previous attempt
 * reconciled it: an update or a delete names a row the record already identifies. On
 * those two, a 409 keeps its historical reading — narrower than the truth, since a
 * UNIQUE violation on a business column means nothing was written either. That case has
 * no measurement against a real backend, so it is named here rather than guessed at.
 *
 * @param entry - The queue entry.
 * @param record - The entity it names.
 * @param target - The layer's write target.
 * @returns Present with its identity, refused, or undecided — never a bare success.
 */
async function settleAlreadyPresent(
    entry: OutboxEntry,
    record: FeatureRecord,
    target: WriteTarget
): Promise<PushOutcome> {
    if (entry.kind !== "create" || record.serverId != null) {
        return { ok: true, alreadyPresent: true };
    }
    const found = await reconcileByClientId(record, target);
    if (found.serverId) return { ok: true, alreadyPresent: true, serverId: found.serverId };
    if (found.missing) {
        // The server holds no row under our client identity: the 409 came from another
        // constraint, so it accepted NOTHING. Declaring a success here would empty the
        // queue on a write that never happened.
        Log.warn(
            `[Offline.Push] ${entry.id} — 409 sans ligne correspondante : une AUTRE contrainte a refusé.`
        );
        return { ok: false, failure: "rejectedByServer", httpStatus: 409 };
    }
    // The re-read could not conclude. We do not know, so we do not decide: the entry
    // stays replayable rather than being declared pushed or refused.
    return { ok: false, failure: "serverUnavailable" };
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
): Promise<PushOutcome> {
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
    if (response.status === 409) return settleAlreadyPresent(entry, record, target);

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
        // 🛑 BEFORE the default branch: a 401 is not "a 4xx like any other". See
        // {@link PushFailure.authRequired} — and note that in the connector's token mode
        // this status is SYNTHETIC, produced by the interceptor once renewal failed.
        if (response.status === UNAUTHORIZED_STATUS) {
            Log.warn(
                `[Offline.Push] ${entry.id} — session expirée ou refusée (${response.status}) ; le drain s'arrête ici.`
            );
            return { ok: false, failure: "authRequired", httpStatus: response.status };
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
    // 🛑 ZERO ROWS TOUCHED ON AN UPDATE — and what it MEANS depends on the filter.
    //
    // Measured: PostgREST yields `200 []`, the only form in which this server says
    // "nothing matched". A JSON **array** is what proves it answered in representation;
    // a `null` body (a 204, an absent representation) proves nothing and must not be
    // read as zero — that distinction is what keeps an entity created offline, which
    // has no marker, from inventing a conflict at every update.
    //
    // 🛑 **THE SECOND SEND WAS NEVER CHECKED, AND THAT IS THE HOLE THIS CLOSES.** The
    // guard used to require `conditional`, so the unfiltered re-send that settles a
    // conflict by `lastWriteWins` fell through to the success path: an empty array
    // emptied the queue while the server had written nothing. Unfiltered, the request
    // matches on `id=eq.<serverId>` alone — zero rows then says the row is GONE, not
    // stale. That is the same fact a 404 carries, said in this server's own words, so
    // it takes the same motive.
    if (entry.kind === "update" && Array.isArray(payload) && payload.length === 0) {
        if (conditional && entry.baseVersion) return { ok: false, conflicted: true };
        Log.warn(
            `[Offline.Push] ${entry.id} — zéro ligne touchée SANS filtre : l'entité n'existe plus côté serveur.`
        );
        return { ok: false, failure: "deletedOnServer", httpStatus: response.status };
    }

    const row = Array.isArray(payload) ? payload[0] : payload;
    const serverId = row?.id;
    return serverId != null ? { ok: true, serverId: String(serverId) } : { ok: true };
}

/**
 * Resolves what one entry needs to be sent — or why it cannot be.
 *
 * ⚠️ **Three refusals, and only one of them is the entry's own fault.** A layer that
 * lost its write target will not find it back by replaying, so it is set aside at once;
 * the `rest` dialect is a hole in the CORE, so the entry keeps its budget and a lasting
 * hole surfaces as a quarantine rather than an endless loop; a record gone from the
 * store names an entry with nothing left to send.
 *
 * @param entry - The queue entry.
 * @param features - The entity store.
 * @returns The target and record to send, or the immediate quarantine motive when there
 *   is one — `undefined` meaning "fail, but spend the budget like any other failure".
 */
async function prepareSend(
    entry: OutboxEntry,
    features: FeaturesModule
): Promise<
    | { ok: true; target: WriteTarget; record: FeatureRecord }
    | { ok: false; immediate?: QuarantineReason }
> {
    const target = resolveWriteTarget(entry.layerId);
    if (!target) {
        Log.warn(`[Offline.Push] ${entry.id} — aucune cible d'écriture pour "${entry.layerId}".`);
        // IMMEDIATE quarantine: a layer that lost its write target will not find it back
        // by replaying. That is exactly what `layerNoLongerWritable` names, and this is
        // its FIRST producer.
        return { ok: false, immediate: "layerNoLongerWritable" };
    }
    // NAMED refusal rather than a flat body sent to a REST endpoint: see `buildRequest`.
    if (target.dialect === "rest") {
        Log.warn(
            `[Offline.Push] ${entry.id} — dialecte "rest" non implémenté côté core ; l'entrée reste en file.`
        );
        return { ok: false };
    }
    const record = await features.get(entry.layerId, entry.localId);
    if (!record) {
        Log.warn(`[Offline.Push] ${entry.id} — l'entité nommée a disparu du magasin.`);
        return { ok: false };
    }
    return { ok: true, target, record };
}

/**
 * The failures that quarantine AT ONCE, instead of spending the replay budget.
 *
 * ⚠️ **Three members, three times the same argument**: replaying changes nothing they
 * describe, so waiting three drains only wastes three drains. An entity the server
 * deleted will not come back; a verb it does not implement will not appear; a dead
 * session will not revive on its own. What differs is downstream — two of them are
 * replayable once the cause lifts, `deletedOnServer` never is.
 *
 * @param failure - What the send concluded, when it concluded anything.
 * @returns The motive to set aside with, or `undefined` to spend the budget normally.
 */
function immediateReason(failure?: PushFailure): QuarantineReason | undefined {
    return failure === "deletedOnServer" ||
        failure === "notImplementedByServer" ||
        failure === "authRequired"
        ? failure
        : undefined;
}

/**
 * Brings back the entries a dead session left on the wire.
 *
 * 🛑 **`inFlight` WAS A ONE-WAY STATE.** It is written before the call and cleared by
 * the outcome; between the two, a tab killed by the system — the ordinary case on a
 * phone that sleeps mid-sync — left the entry in a state `REPLAYABLE` does not hold and
 * no gesture exits. The capture itself was never lost (`features` keeps it), which is
 * the worst part: the operator saw a due count that would not go down, on a queue whose
 * "Retry" button did nothing for that entry.
 *
 * ⚠️ **The age is what decides, never the state alone.** Two tabs share this database
 * and not their network: reclaiming a young `inFlight` would re-send what another tab
 * has on the wire. See {@link IN_FLIGHT_GRACE_MS} for the threshold and its origin.
 *
 * ⚠️ **The budget is NOT consumed here, and no deferral is written.** The entry did not
 * fail — nobody knows what the server answered, and an interrupted session is not the
 * operator's doing. Charging it an attempt would set aside a capture for a crash. The
 * risk it comes back on — a push the server actually applied — is the one the client
 * identity covers: a replayed `create` yields a 409, which now re-reads the identity
 * instead of dropping it.
 *
 * @param outbox - The queue module.
 * @param entries - The queue as read, in insertion order.
 * @param now - The drain's clock, so every entry is judged against the same instant.
 * @returns The ids brought back, to be replayed by this very drain.
 */
async function reclaimStaleInFlight(
    outbox: OutboxModule,
    entries: readonly OutboxEntry[],
    now: number
): Promise<Set<string>> {
    const reclaimed = new Set<string>();
    for (const entry of entries) {
        if (entry.state !== "inFlight") continue;
        // An entry stamped by no writer predates this field, hence a previous session:
        // reading its absence as "just departed" would keep stuck exactly the entries
        // this reclaim exists to free.
        const startedAt = entry.inFlightAt ?? 0;
        if (startedAt && now - startedAt < IN_FLIGHT_GRACE_MS) continue;
        Log.warn(
            `[Offline.Push] ${entry.id} — restée « en vol » d'une session interrompue ; remise au rejeu.`
        );
        // `failed` and not `pending`: the send did not conclude, and saying "never
        // attempted" would be false. Both are replayable — the difference is what the
        // operator reads.
        await outbox.updateState(entry.id, "failed", { inFlightAt: null });
        reclaimed.add(entry.id);
    }
    return reclaimed;
}

/**
 * Runs the registered pre-drain steps, in registration order.
 *
 * 🛑 **INSIDE THE DRAIN, NOT IN WHATEVER TRIGGERS IT — AND THE MOTIVE IS A COALESCENCE.**
 * The step that exists today uploads the editor's locally-held photos, and the reconciling
 * `update` it writes is absorbed into the still-pending `create`: the server therefore
 * never sees an image token it cannot resolve. That only works if the step runs **before
 * this pass reads the queue**. Put it in a trigger instead and every other caller — the
 * console, the E2E suite, `offline-ui`'s replay button — would push the token as it stands.
 *
 * ⚠️ **A failing step never stops the drain.** A photo that cannot be uploaded is a photo
 * still waiting, not a reason to hold every other capture hostage. Enforced here rather
 * than trusted to the step: a plugin cannot be relied on to swallow its own errors.
 *
 * ⚠️ **No timeout, deliberately.** Capping a step would let the `create` leave carrying an
 * unresolved token — the very defect the step exists to prevent. A hanging step stalls the
 * drain, which is the behaviour that already applied when this ran in the plugin.
 */
async function _runBeforeDrainSteps(): Promise<void> {
    for (const step of DrainHooksContract._list()) {
        try {
            await step();
        } catch (e) {
            Log.warn("[Offline.Push] étape pré-drain en échec ; on draine quand même :", e);
        }
    }
}

/**
 * Records the instant the server last accepted something.
 *
 * 🛑 **WRITTEN HERE BECAUSE THE DRAIN IS THE ONLY PLACE THAT KNOWS IT**, and PERSISTED
 * because the question it answers — "when did this device last succeed?" — is asked by a
 * technician before leaving coverage, hence typically after a reload. An in-memory value
 * would answer "never" to every question that matters.
 *
 * ⚠️ Its failure never loses the pass that earned it: a stamp is a comfort, the tally is
 * the fact.
 *
 * @param db - The open store, or `null`.
 */
async function _stampLastSync(db: PushStore | null): Promise<void> {
    const prefs = db?._ensureModule?.("Preferences") as {
        setPreference?(key: string, value: unknown): Promise<unknown>;
    } | null;
    try {
        await prefs?.setPreference?.(LAST_SYNC_PREFERENCE, Date.now());
    } catch (e) {
        Log.warn("[Offline.Push] horodatage de dernière synchro non écrit :", e);
    }
}

/**
 * Announces the end of a drain on `document`.
 *
 * 🛑 **THE CORE HAD NO CHANNEL OF ITS OWN — WHICH IS WHY THE PENDING BADGE HUNG ON A
 * PLUGIN EVENT.** `geoleaf:editor:feature-sync-flushed` is emitted by the editor's
 * replay module, so everything watching the queue depth was in fact watching a plugin,
 * and would stop being told the moment the drain stopped going through it. An event
 * owned by the drain is what lets the pending badge, the sync banner and any host UI
 * follow the queue without knowing which plugin filled it.
 *
 * ⚠️ **It carries the TALLY, not the remaining depth.** The drain knows exactly what it
 * attempted; what is still owed afterwards is a count, and deriving it here as
 * `replayable - pushed` would ignore whatever quarantined mid-pass — a number that
 * looks right and is wrong, which is the one thing this file refuses to emit. A
 * listener that needs the depth reads it.
 *
 * ⚠️ Guarded on the EXISTENCE of `document`, the very guard `cache/storage.ts` uses:
 * this engine also runs where there is none (worker, prerender, the Service Worker
 * context sharing these modules), and an unguarded emitter takes the whole drain down
 * with it. Pinned by `__tests__/capabilities/offline/dom-event-guards.test.js`.
 *
 * @param report - The tally the pass just produced.
 */
function _announceDrained(report: PushReport): void {
    if (typeof document === "undefined") return;
    document.dispatchEvent(
        new CustomEvent("geoleaf:offline:outbox-drained", {
            detail: {
                attempted: report.attempted,
                pushed: report.pushed,
                failed: report.failed,
                deferred: report.deferred,
                conflicts: report.conflicts,
                haltedBy: report.haltedBy,
            },
        })
    );
}

/**
 * The drain in flight, or `null` when none runs.
 *
 * 🛑 **THE LOCK LIVES HERE AND NOT IN THE CALLER, BECAUSE THIS IS WHERE EVERYONE
 * ARRIVES.** The editor plugin kept a `_flushing` module flag on its own side and said
 * so itself: it "only guards what goes through here". Three paths do not go through
 * there — the console, the E2E suite and `offline-ui`'s replay button — and all three
 * reach `Storage.pushOutbox()` directly. A lock in front of one door guards one door.
 *
 * ⚠️ **What it protects is the REPLAY BUDGET AND THE TALLY, not integrity.** Two
 * concurrent drains both read the queue before either writes `inFlight`, so two
 * requests leave — and the second earns a 409 on `local_id`, which
 * `settleAlreadyPresent` resolves: no duplicate row is created. What is lost without
 * the lock is `attempts` spent twice (a capture quarantined in half the drains it was
 * owed), `nextAttemptAt` written twice, a tally describing neither pass, and the
 * pre-drain steps run twice. Nobody should relax this on the grounds that `local_id`
 * makes duplicates impossible: that is true, and beside the point.
 */
let _draining: Promise<PushReport> | null = null;

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
    // A concurrent caller gets the RUNNING promise, never a sentinel. The return type is
    // `PushReport`, it is published through `Storage.pushOutbox()`, and its consumers —
    // `offline-ui`'s replay button among them — read the tally with no null check.
    // Widening the type to say "refused, a drain is already running" would force every
    // consumer to learn a case none of them has asked to tell apart.
    if (_draining) return _draining;
    _draining = _drainOnce();
    try {
        return await _draining;
    } finally {
        _draining = null;
    }
}

/**
 * One drain pass — the body {@link pushOutbox} serialises.
 *
 * Split out for the lock and for nothing else: keeping it inside the public function
 * would have put the guard and the work in the same scope, where a later `return` on
 * an early path can leave `_draining` set. The `finally` above owns the release.
 */
async function _drainOnce(): Promise<PushReport> {
    const nothing = {
        attempted: 0,
        haltedBy: null,
        deferred: 0,
        pushed: 0,
        failed: 0,
        alreadyPresent: 0,
        conflicts: 0,
    };
    const db = StorageContract.DB as PushStore | null;
    const outbox = db?._ensureModule?.("Outbox") as OutboxModule | null | undefined;
    const features = db?._ensureModule?.("Features") as FeaturesModule | null | undefined;
    if (!outbox?.list || !features?.put) return { ...nothing, refused: "engineUnavailable" };

    // Before the read, and that ordering is load-bearing — see `_runBeforeDrainSteps`.
    await _runBeforeDrainSteps();

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
    const queue = await outbox.list();
    // ONE clock for the whole drain: judging two entries against two `Date.now()` reads
    // would make the deferral depend on where in the queue an entry sits.
    const now = Date.now();
    // Reclaim FIRST, so an entry a dead session left on the wire is replayed by THIS
    // drain rather than waiting for the next one.
    const reclaimed = await reclaimStaleInFlight(outbox, queue, now);
    const replayable = queue.filter(
        (entry) => REPLAYABLE.has(entry.state) || reclaimed.has(entry.id)
    );
    // 🛑 The deferral is READ here and nowhere else — the drain walks past, it never
    // waits. An entry whose delay has not elapsed is not a failure and must not be
    // counted as one; it is reported apart so a silent drain stays distinguishable
    // from an empty queue.
    const pending = replayable.filter((entry) => (entry.nextAttemptAt ?? 0) <= now);
    const deferred = replayable.length - pending.length;

    let pushed = 0;
    let failed = 0;
    let alreadyPresent = 0;
    let conflicts = 0;
    // ⚠️ COUNTED IN THE LOOP, not derived from `pending.length`: since the drain can now
    // stop before the end, a figure taken from the filter would report entries it never
    // touched as attempted — the exact kind of true-looking number this file exists to
    // avoid.
    let attempted = 0;
    let haltedBy: "authRequired" | null = null;

    for (const entry of pending) {
        attempted += 1;
        const prepared = await prepareSend(entry, features);
        if (!prepared.ok) {
            await markFailure(outbox, entry, prepared.immediate);
            failed += 1;
            continue;
        }
        const { target, record } = prepared;

        // `inFlight` BEFORE the call, and that is what protects coalescing: a
        // concurrent edit will not merge into an entry already gone on the wire.
        // ⚠️ The departure DATE goes with the state, in the same write: a state saying
        // "in flight" without it cannot be told apart from one another tab is sending,
        // which is the whole subject of `reclaimStaleInFlight`.
        await outbox.updateState(entry.id, "inFlight", { inFlightAt: now });
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
            await markFailure(
                outbox,
                entry,
                immediateReason(result.failure),
                result.failure,
                result.httpStatus
            );
            failed += 1;
            // 🛑 THE ONLY FAILURE THAT STOPS THE DRAIN, and the narrowness is the point.
            // Everything queued behind meets the same dead session, so replaying it
            // spends a budget for nothing — and in the connector's token mode the
            // requests that follow do not even carry an `Authorization` header any more.
            // A mute network is the opposite case: every entry must be attempted and
            // deferred, which is what brings a whole tour back at the next drain.
            if (result.failure === "authRequired") {
                haltedBy = "authRequired";
                break;
            }
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
        `[Offline.Push] ${pushed} poussée(s), ${failed} à retenter, ${conflicts} conflit(s) tranché(s)` +
            (deferred > 0 ? `, ${deferred} différée(s)` : "") +
            (haltedBy
                ? `, ARRÊTÉ (${haltedBy}) — ${pending.length - attempted} non tentée(s).`
                : ".")
    );
    if (pushed > 0) await _stampLastSync(db);

    const report: PushReport = {
        attempted,
        haltedBy,
        deferred,
        pushed,
        failed,
        alreadyPresent,
        conflicts,
        refused: null,
    };
    // Announced on EVERY completed pass, including the empty one: a listener that only
    // hears about non-empty drains cannot tell "nothing was owed" from "nobody drained",
    // and that is exactly the pair a sync banner exists to separate. The early
    // `engineUnavailable` return above stays silent on purpose — no pass happened.
    _announceDrained(report);
    return report;
}
