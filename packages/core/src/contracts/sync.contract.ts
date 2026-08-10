/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Contract — Offline data cycle (public type boundary)
 *
 * Declares the whole cycle, not just one of its ends: pull → read locally → edit →
 * queue → push → reconcile. The previous design repaired the write seam without ever
 * describing the cycle, which is where the work stalled.
 *
 * Three properties this contract exists to make true:
 *
 * 1. **A capture never silently disappears.** Field data has no other copy — no server,
 *    no export. Every rule below that looks conservative is downstream of that.
 * 2. **Pull never grants write access.** A layer that cannot be edited online cannot be
 *    edited offline either. Downloading is a reading convenience; editability is decided
 *    by the layer's own declaration and by the attribute contract's edition rule.
 * 3. **What is not synchronised is never evicted.** Browsers evict per ORIGIN, and the
 *    origin runs best-effort unless persistence is granted, so eviction is a real event
 *    to design against, not a theoretical one.
 *
 * Scope note — types only. The IndexedDB schema, the queue engine and the OGC pull are
 * implemented against this contract, not described by it.
 */

/* -------------------------------------------------------------------------- */
/* Identity                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Client-minted identity, assigned at creation and never reused.
 *
 * It is the ONLY identity the outbox references. That is what makes replay idempotent
 * and what allows a create followed by an update to coalesce: both name the same local
 * entity, whether or not the server has ever seen it.
 */
export type LocalId = string;

/** Server-assigned identity. Null until a create has been pushed and acknowledged. */
export type ServerId = string;

/**
 * Per-entity freshness marker, read at pull time and sent back at push time.
 *
 * Whatever the backend offers: an HTTP `ETag`, or a modification timestamp (`updated_at`,
 * `write_date` on Odoo). Its only job is to make a conflict DETECTABLE — today nothing
 * carries it, so a conflict cannot even be observed, let alone arbitrated.
 */
export interface VersionMarker {
    readonly kind: "etag" | "timestamp";
    readonly value: string;
}

/* -------------------------------------------------------------------------- */
/* Operation vocabulary — one, and entity-generic                              */
/* -------------------------------------------------------------------------- */

/**
 * The single operation vocabulary of the outbox.
 *
 * Two incompatible vocabularies used to coexist — `add_poi` / `update_poi` / `delete_poi`
 * and `editor.save` / `editor.update` / `editor.delete` — in the SAME v3 queue, and the
 * core recognised only the first, which is why geometry drawn by the editor was never
 * restored. Neither survived: the first named a POI when the store holds arbitrary
 * features, the second named a plugin when the core must depend on none.
 *
 * Both writers were redirected here in 4.4b/4.7, and the last readers followed in 4.9.
 * The contract is entity-generic because the store is.
 */
export type SyncOperationKind = "create" | "update" | "delete";

/**
 * Lifecycle of a queued operation.
 *
 * `failed` is deliberately NOT terminal. Today an entry that fails once never returns to
 * the queue, which makes it the single most likely way to lose field data.
 * `quarantined` is the one state that means "kept, but not replayable as-is" — it always
 * carries a reason and always stays visible.
 */
export type SyncState = "pending" | "inFlight" | "synced" | "failed" | "quarantined";

/** Why an entry was set aside instead of replayed or dropped. */
export type QuarantineReason =
    /** The server deleted the entity while it was being edited locally. */
    | "deletedOnServer"
    /** The layer stopped being editable between capture and push. */
    | "layerNoLongerWritable"
    /**
     * The push was refused by the server for a reason replay cannot fix.
     *
     * ⚠️ **NARROWED at B-199 (09/08/2026), and the previous width had a measured cost.** This
     * member used to name EVERY non-409/non-404 failure, transient server outages included:
     * `pushOne` had a single branch for the whole spectrum. Since this reason is excluded from
     * `REQUEUEABLE`, a 503 during maintenance spent the replay budget and then left the capture
     * unreplayable — its only remaining exit being destruction. It now covers 4xx refusals
     * only, 404 and 501 excepted: malformed request, missing right, verb not allowed,
     * unprocessable entity. A server outage is `retryBudgetExhausted`; an unimplemented verb is
     * `notImplementedByServer`.
     */
    | "rejectedByServer"
    /**
     * The server does not implement the verb — HTTP 501.
     *
     * 🛑 **ADDED at B-199, and the asymmetry it closes is the reason it exists.** An
     * unimplemented verb on the CLIENT side (the `rest` dialect, `push-engine.ts`) already fell
     * through to `retryBudgetExhausted` and was therefore replayable; the same fact reported by
     * the SERVER landed on `rejectedByServer` and was not. Same fact, opposite outcomes.
     *
     * It is set IMMEDIATELY — replaying a verb the server does not know only waits three times,
     * the same argument as `deletedOnServer` — and it IS replayable: the lifting condition is
     * the server being upgraded, which no local check can observe, so it is entrusted to the
     * operator exactly like `retryBudgetExhausted`.
     */
    | "notImplementedByServer"
    /**
     * The replay budget ran out — the entry failed `MAX_REPLAY_ATTEMPTS` times without the
     * server ever answering in a way replay could act on.
     *
     * ⚠️ **AJOUTÉ à la tâche 4.11d (B-125), et il manquait pour une raison précise.** Les trois
     * motifs au-dessus nomment tous une CAUSE observée côté serveur ou côté couche. Un budget
     * épuisé n'en est pas une : le serveur a pu ne jamais répondre. Réutiliser
     * `rejectedByServer` pour un délai réseau aurait été un mensonge que le code lui-même
     * détecte — `push-engine` distingue déjà `networkError` de `rejectedByServer`.
     *
     * ✅ **Il porte aussi les pannes serveur transitoires depuis B-199** — 500, 502, 503, 504,
     * 408, 429. Sa phrase les couvrait déjà (« without the server ever answering in a way
     * replay could act on ») : c'est la classification en amont qui ne les lui envoyait pas.
     */
    | "retryBudgetExhausted";

/* -------------------------------------------------------------------------- */
/* The v4 store — one record per entity                                        */
/* -------------------------------------------------------------------------- */

/**
 * Eviction class of a stored record.
 *
 * The hard rule of this contract: anything holding unsynchronised local work is `never`.
 * Only re-fetchable material is `lru`.
 */
export type EvictionClass = "never" | "lru";

/**
 * One entity in the `features` store — keyed by `[layerId, localId]`, with indexes on
 * `serverId`, `syncState` and `updatedAt`.
 *
 * This replaces a single blob per layer sharing one store with tiles, glyphs and sprites,
 * keyed by URL and evictable as a whole. That shape could hold a write but not the read
 * that goes with it, and had no way to tell whether the server had moved on.
 */
export interface FeatureRecord {
    readonly layerId: string;
    readonly localId: LocalId;
    /** Null until the entity has been created server-side. */
    readonly serverId: ServerId | null;
    readonly syncState: SyncState;
    /** Local modification time, milliseconds since epoch. */
    readonly updatedAt: number;
    /** Marker observed at the last pull. Null for an entity created offline. */
    readonly version: VersionMarker | null;
    /** The GeoJSON feature itself. */
    readonly feature: unknown;
    /** Present only when `syncState` is `quarantined`. */
    readonly quarantine?: QuarantineReason;
}

/**
 * One queued operation.
 *
 * It references `localId` and never `serverId`: an entity created offline has no server
 * identity yet, and an outbox that could not name it would be unable to queue its own
 * creation.
 *
 * ⚠️ Named `OutboxEntry` and not `SyncQueueEntry` deliberately: two types already carry
 * that second name with two different shapes — one in the POI plugin's sync types, one in
 * the v3 queue module of this capability. A third homonym would have been indistinguishable
 * from them at a call site, and the identical name IS the defect — so it is not reused.
 *
 * ⚠️ **Les deux homonymes sont retirés à la tâche 4.11**, avec le magasin `sync_queue` qu'ils
 * décrivaient. Le nom reste néanmoins libre-de-collision par construction, et c'est le point :
 * il n'a pas été repris parce que le défaut était le nom partagé, pas sa rareté.
 */
export interface OutboxEntry {
    readonly id: string;
    readonly kind: SyncOperationKind;
    readonly layerId: string;
    readonly localId: LocalId;
    /** Marker the edit was based on, sent back at push so the server can detect a conflict. */
    readonly baseVersion: VersionMarker | null;
    readonly state: SyncState;
    /** Replay attempts so far. A `failed` entry keeps its count when it is requeued. */
    readonly attempts: number;
    readonly createdAt: number;
    readonly quarantine?: QuarantineReason;
}

/* -------------------------------------------------------------------------- */
/* Frozen policies                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Conflict policy — frozen as `lastWriteWins`, and DECLARED rather than defaulted.
 *
 * This is what the code already does, but by accident: every strategy fell through to a
 * forced overwrite. The change is not the outcome, it is that the conflict becomes
 * detectable and logged, because the push now carries `baseVersion`.
 *
 * The rationale is the field: an operator is the authority on what they have just
 * observed, and a blocking dialog raised offline, alone on site, gets clicked at random.
 */
export type ConflictPolicy = "lastWriteWins";

/**
 * What happens when the server deleted an entity that was edited locally.
 *
 * `serverWinsPreserveLocal`: the entity leaves the map, and the local capture is moved to
 * `quarantined` with reason `deletedOnServer`. It is never SILENTLY destroyed — that is the
 * one outcome this contract exists to prevent.
 *
 * ⚠️ **This sentence read « It is never destroyed » until task 8.4, and the absolute form had
 * a cost that was measured rather than argued.** A quarantined entry had NO exit at all: not
 * the drain (`REPLAYABLE_STATUSES` is `failed` + `pending`), not the purge, not any UI
 * gesture. On a field device the class only grew — visible, counted, unresolvable. « Never
 * destroyed » protected the capture from being lost and condemned the operator to carry it
 * forever.
 *
 * The amendment names what the contract actually defends: **the loss the operator did not
 * see**. Two exits, arbitrated by Mattieu on 07/08/2026, and each covers the half it fits:
 *
 * 1. **Requeue when the CAUSE is lifted.** `retryBudgetExhausted`, `layerNoLongerWritable` and
 *    `notImplementedByServer` name a condition that can be lifted — the network answered, the
 *    layer regained its write target, the server was upgraded. Those entries go back to
 *    `pending`. The other two cannot: replaying a `deletedOnServer` would recreate what the
 *    server deleted, and `rejectedByServer` is defined as a reason replay cannot fix.
 *
 *    ⚠️ **The third one was added at B-199, and its absence had turned exit 1 into exit 2 for
 *    a whole class of captures.** Every transient server outage was reported as
 *    `rejectedByServer`, so the only exit left for a capture caught during a maintenance
 *    window was the confirmed destruction below — which the operator would have confirmed in
 *    good faith, having been told replay could not fix it.
 * 2. **Destruction the operator CONFIRMS, having seen the capture enumerated.** A capture
 *    that was shown, itemised and then explicitly discarded is not a capture that was lost.
 *
 * 🛑 What is still forbidden, and it is the whole point: a retention cap, a purge sweep, or
 * any path that drops an entry without a human seeing exactly what is dropped.
 */
export type ServerDeletionPolicy = "serverWinsPreserveLocal";

/**
 * Pull granularity — frozen as `bboxCapped`: bounding box plus a hard feature cap.
 *
 * It uses only mechanisms the OGC loader already implements (`next` pagination, `bbox`,
 * `maxFeatures`, `AbortSignal`), so no transport code is written for it.
 *
 * A cursor-based delta is deliberately NOT frozen here: it needs a backend-side filter
 * that may not exist. Recording a `VersionMarker` per entity from the very first pull is
 * what keeps that door open — delta becomes available later with no schema change and no
 * data migration.
 */
export type PullGranularity = "bboxCapped";

/* -------------------------------------------------------------------------- */
/* Editability — pull does NOT grant it                                        */
/* -------------------------------------------------------------------------- */

/**
 * What a layer's local store is allowed to do.
 *
 * ⚠️ **This is never derived from the offline declaration.** Every layer may be pulled for
 * offline reading; only a layer that is editable ONLINE gets an outbox. Deriving write
 * access from "the user downloaded it" would make the offline path a back door around the
 * layer's own edition flags and around the attribute contract's edition rule.
 *
 * - `readOnly` — pulled, readable offline, no outbox. No queue entry may name this layer.
 * - `readWrite` — pulled, readable offline, and its edits are queued.
 */
export type LayerSyncMode = "readOnly" | "readWrite";

/**
 * What a layer permits, per operation. Declared under the profile key `edition`.
 *
 * Replaced the pair `enableEdition` / `enableEditionFull` on 05/08/2026 (Sprint 5, task
 * 5.9 — decision V1). The second name did not mean what it said: it was read once
 * usefully, as `canDelete()`, so "full edition" was in fact **the right to delete**.
 *
 * ## Absent means refused — each key independently
 *
 * ```
 * edition absent          → create=false, update=false, delete=false
 * edition: {}             → the same: declaring the block grants NOTHING
 * edition: {create:true}  → create only; update and delete stay false
 * ```
 *
 * **No key implies another.** Deriving one from another is the exact mechanism by which
 * `enableEditionFull` acquired a name that lied — and, at the other end, by which the
 * editor's layer picker briefly read it as a *widener* (it granted edition to a layer that
 * only carried the delete right). Both readings are gone.
 *
 * ⚠️ **The default is restrictive, and that is a deliberate departure from the sibling
 * fallback in `packages/plugins/editor/src/config.ts` (`_acceptsGeometry`)**, which stays
 * permissive on purpose. The difference
 * is what each one gates: `editableGeometryTypes` is a *sub-filter* on an already-editable
 * layer, so making it restrictive would render layers unclickable with no other gate to say
 * why. `edition` **is** the gate. Measured at the migration: 42 of the 48 layer configs
 * declare nothing and are not editable — a restrictive default changes nothing for them,
 * a permissive one would have granted edition to all 42 in silence.
 *
 * ✅ **Enforced on EVERY write path since 07/08/2026** (Sprint 8, task 8.7 — B-138). It was
 * enforced on the **offline** path only (`local-edit-api.ts`), while the online path
 * (`editor/src/persistence/rest-adapter.ts`) issued an unconditional `DELETE`: a connected
 * user could delete from a layer declaring `delete: false`. The rule now lives in the BOOT
 * graph (`kernel/shared/edition-permissions.ts`) because it reads the profile, not IndexedDB —
 * and the editor's persistence factory wraps all four of its outputs with a gate consulting
 * `GeoLeaf.Storage.mayEdit()` before routing, so `online`, `offline`, `auto` and the
 * `collection` dialect are covered by one guard.
 *
 * ⚠️ **What this type still does NOT gate**: the editor's toolbar gates the delete TOOL on its
 * own `enabledTools`, a plugin config, never on the layer. The button may therefore be offered
 * on a layer that refuses — the write itself is refused.
 */
export interface LayerEditionPermissions {
    /** Right to create a feature. Absent or `false` ⟹ refused. */
    readonly create?: boolean;
    /** Right to modify an existing feature. Absent or `false` ⟹ refused. */
    readonly update?: boolean;
    /** Right to delete a feature — what `enableEditionFull` actually gated. */
    readonly delete?: boolean;
}

/** Per-layer synchronisation settings, resolved from the layer configuration. */
export interface LayerSyncConfig {
    readonly layerId: string;
    readonly mode: LayerSyncMode;
    /** Records holding unsynchronised work are always `never`, whatever this says. */
    readonly eviction: EvictionClass;
    /** Hard cap on features pulled for this layer. */
    readonly maxFeatures?: number;
}

/* -------------------------------------------------------------------------- */
/* Write target and declared origins                                           */
/* -------------------------------------------------------------------------- */

/**
 * Wire dialect a write target speaks.
 *
 * Exactly the two the code implements — no third is declared here. An OGC Features write
 * dialect would be a genuine addition to make deliberately, not a value to pre-declare:
 * a dialect nothing dispatches on is indistinguishable from a typo.
 */
export type WriteDialect = "rest" | "collection";

/** How a write endpoint is authenticated. */
export type WriteAuth = "csrf" | "bearer" | "none";

/**
 * Where a layer's edits are pushed.
 *
 * Declared PER LAYER, with a plugin-level default, because on a backend such as Odoo each
 * layer is a distinct collection. Today two mechanisms compete and never meet: a per-layer
 * block read in four places but set by zero layers on 48, and a plugin-level base URL that
 * ignores the layer entirely.
 *
 * Mirrors the shape the persistence adapters actually read; `geometryProperty` and
 * `properties` are consumed only by the `collection` dialect, which sends a flat body.
 */
export interface LayerWriteTarget {
    readonly enabled: boolean;
    readonly endpoint: string;
    readonly dialect?: WriteDialect;
    readonly auth?: WriteAuth;
    /** Property key carrying the geometry in a `collection` body. Defaults to `"geom"`. */
    readonly geometryProperty?: string;
    /** Whitelist of property keys sent in a `collection` body. */
    readonly properties?: readonly string[];
}

/** What a declared origin is allowed to serve. */
export type DataOriginRole = "layerData" | "tiles" | "sprites" | "glyphs" | "api";

/**
 * An origin the profile declares, with what it may serve and whether it is cacheable.
 *
 * ⚠️ This replaces routing by GUESSWORK. The service worker currently decides by hostname
 * substring (`hostname.includes("tile")` matches `mon-site-hostile.tilerie.com`), by path
 * sniffing, by a hardcoded provider domain, and by a blanket `/api/` exclusion that skips
 * the most common path of a data API. None of those can be reviewed, and two of them are
 * exploitable.
 *
 * `cacheable: false` is meaningful and must stay expressible: a cross-origin tile provider
 * answering opaquely cannot have its content validated, so it is not cached — a correct
 * decision whose CONSEQUENCE (no raster basemap offline) has to be declared rather than
 * discovered.
 *
 * ## The invariant, and the ONE thing it does not cover
 *
 * **Declaring any origin refuses every origin left undeclared.** Silence is a refusal, not a
 * permission — that is what makes a declaration reviewable, and it governs everything below.
 *
 * ⚠️ **It does NOT cover the origin that SERVES the application** (decision B-119, arbitrated
 * 07/08/2026). That origin changes with every deployment — `localhost:8766` on the `ports`
 * target, `demo.geoleaf.local.test` behind nginx, production elsewhere — so no PORTABLE
 * profile can write it. Before the exception, a profile that declared its data origins lost
 * the cache of its own shell, i.e. offline altogether: all-or-nothing, where "nothing" was
 * only reachable by declaring nothing at all.
 *
 * The exception is **narrow, and the narrowness is the point**. It covers what serves the
 * application — profile resources and static assets — and NOT same-origin data. A data API
 * served from the very same origin is still a DATA origin, by the exact motive that grants
 * the exception, and it must be declared like any other. Widening it to "same-origin" would
 * cache an authenticated same-origin response by default, i.e. open one defect while closing
 * another.
 *
 * 🛑 So the invariant is not weakened, it is **delimited**: silence refuses caching of DATA;
 * the application shell is not data. Enforced in `kernel/storage/sw-core.js` (`routeRequest`),
 * which is a standalone worker and cannot import this file — the parity is held by the source
 * guard in `__tests__/storage/sw-core.test.js`.
 */
export interface DataOriginDeclaration {
    /** Origin in `scheme://host[:port]` form. Never a substring, never a bare hostname. */
    readonly origin: string;
    readonly roles: readonly DataOriginRole[];
    readonly cacheable: boolean;
    /** True when requests to this origin carry credentials and must never be cached. */
    readonly authenticated?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Per-layer offline status, reported rather than guessed.
 *
 * `declaredNeverPulled` is the case that has no observable today: a layer marked for
 * offline use that was never actually fetched looks exactly like one that was, right up
 * to the moment the network drops.
 */
export type LayerOfflineStatus =
    | "notDeclared"
    | "declaredNeverPulled"
    | "pulled"
    | "pulledStale"
    | "pullFailed";

/** What the sync report exposes for one layer. */
export interface LayerSyncReport {
    readonly layerId: string;
    readonly status: LayerOfflineStatus;
    readonly featureCount: number;
    /** Entries still owed to the server. */
    readonly pendingCount: number;
    readonly quarantinedCount: number;
    /** Last successful pull, milliseconds since epoch; null if never. */
    readonly lastPullAt: number | null;
}

/**
 * Quota regime the origin is running under.
 *
 * ⚠️ **Measured twice on 02/08/2026, and the two readings disagree — deliberately kept
 * both, because the gap IS the finding.**
 *
 * - Headless Chromium, fresh profile: **refused**, quota ~800 MB. The floor.
 * - Real Chrome, same dev origin: **granted**, quota ~10 GB — and `display-mode` was NOT
 *   standalone, so persistence came without installing anything.
 *
 * Chrome grants without prompting on several signals (installed, bookmarked, notification
 * permission, accumulated engagement). A dev origin opened daily satisfies the last one.
 *
 * The consequence for this contract: persistence is **obtainable but never guaranteed**,
 * and it depends on the user's relationship with the ORIGIN — not on any property the
 * application controls. A field device opening a production origin for the first time
 * starts at `bestEffort`. So the engine MUST NOT assume persistence: the per-class
 * eviction rule stays the default, and this value is read back per device rather than
 * inferred.
 */
export type StoragePersistenceRegime = "persistent" | "bestEffort" | "unsupported";

/* -------------------------------------------------------------------------- */
/* Replay handlers — the seam both sides read                                  */
/* -------------------------------------------------------------------------- */

/**
 * Shape of an offline sync handler, as registered on `GeoLeaf.Sync`.
 *
 * All members are optional: the engine guards every call (`handler.processSyncQueue?.()`),
 * so a partially-implemented handler is safe. A data plugin that owns an offline flow
 * pushes its handler at its own `entry.ts` — the core never imports a plugin, which is
 * what keeps `no-plugin-in-core` true once the engine lives in-core.
 *
 * 🛑 **It lives in the CONTRACT because it had two declarations, and they lied in
 * concert** (compteur C4, soldé par 4.9). `kernel/shared/sync-handler-seam.ts` held one
 * and `offline-ui/src/core/sync-seam.ts` the other; both typed `restoreBackup(backupId:
 * string)` while the `sync_backups` store is `autoIncrement`, so its keys are numeric.
 * The typecheck was green on both sides for a call that never found anything. Two
 * declarations of one contract do not drift apart loudly — they agree, and are both
 * wrong. The plugin now reads this type through the `types`-only subpath
 * `@geoleaf/core/contracts/sync.contract.js`: erased at build, no runtime coupling.
 */
export interface SyncHandler {
    /** Pending-operation summary (counts by kind). */
    getSyncSummary?(): Promise<{ total: number; add: number; update: number; delete: number }>;
    /** Replay the whole pending queue. */
    processSyncQueue?(): Promise<{ synced?: number; failed?: number; skipped?: number }>;
    /**
    /* 🛑 `restoreBackup?()` est RETIRÉE du contrat (tâche 4.11), avec toute la chaîne de
     * sauvegarde : plus d'écrivain depuis 4.4b, un motif faux sur le mécanisme (le magasin
     * vivait dans la base qu'une purge d'origine détruit), et un rôle couvert deux fois —
     * par l'interdiction contractuelle de détruire une entrée d'outbox, et par l'export JSON
     * d'`offline-ui`, qui sort du navigateur. */
    /** One-shot sync trigger. */
    sync?(): Promise<unknown>;
    [key: string]: unknown;
}
