/*!
 * @geoleaf-plugins/editor — Persistence adapter factory
 * © 2026 Mattieu Pottier — MIT License
 *
 * Single seam that maps `editorConfig.persistence.mode` to a concrete adapter.
 * S10 ships REST online only; S11 returns the StorageQueue / Auto adapters from
 * here without touching any call site (everyone depends on the interface).
 * https://geoleaf.dev
 */
import type { EditorConfig } from "../types.js";
import { createRestAdapter } from "./rest-adapter.js";
import { createCollectionRestAdapter } from "./collection-rest-adapter.js";
import { createStorageQueueAdapter } from "./storage-queue-adapter.js";
import { createQueueFirstAdapter } from "./queue-first-adapter.js";
import { withEditionPermissions } from "./permission-gate.js";
import type { ConflictEventDetail, EditorPersistenceAdapter } from "./adapter-interface.js";

/** Hooks injected by entry.ts (e.g. the conflict-event dispatcher). */
interface PersistenceHooks {
    onConflict?: (detail: ConflictEventDetail) => void;
}

/** Resolves the shared REST options (baseUrl / auth / timeout) with their defaults. */
function _buildApiOptions(cfg: EditorConfig): {
    baseUrl: string;
    authHeader: string | null;
    timeoutMs: number;
} {
    const api = cfg.api ?? {};
    return {
        baseUrl: api.baseUrl ?? "",
        authHeader: api.authHeader ?? null,
        timeoutMs: api.timeoutMs ?? 8000,
    };
}

/**
 * Builds the online backend adapter (REST envelope, or the flat `collection`
 * dialect). Exposed so the offline replay handler can reuse the exact same online
 * adapter — including its conflict wiring — to flush the queue on reconnect.
 */
// ⚠️ NOT exported since R7 (05/09/2026): `entry.ts` was its last production importer,
// for the replay's `rest` collaborator — which the core's drain made pointless, and which
// was in fact never read. Its only caller is `createPersistenceAdapter` below, and the
// factory is the right door: a test reaching past it asserted a wiring nobody used.
function createOnlineAdapter(
    cfg: EditorConfig,
    hooks: PersistenceHooks = {}
): EditorPersistenceAdapter {
    const base = _buildApiOptions(cfg);

    // Collection dialect: flat `POST {baseUrl}/{layerId} { ...props, geom }` (OGC/PostgREST).
    // Auth is handled by the Connector plugin (global fetch patch) — no authHeader needed.
    if (cfg.persistence?.dialect === "collection") {
        return createCollectionRestAdapter({
            ...base,
            geometryProperty: cfg.api?.geometryProperty ?? "geom",
        });
    }

    return createRestAdapter({
        ...base,
        ...(hooks.onConflict && { onConflict: hooks.onConflict }),
    });
}

/**
 * Builds the persistence adapter — ONE write path whenever this device can hold the write.
 *
 * 🛑 **`persistence.mode` AND `persistence.dialect` NO LONGER CHOOSE A TRANSPORT.** They
 * did, and the routing was the defect: `"collection"` returned the online adapter *whatever
 * the mode*, so a layer declared in that dialect had no offline capability at all — in
 * silence; `"auto"` (the default) chose by reachability and fell back into the queue on a
 * transport failure, which is how a lost response after an accepted POST became a duplicate
 * the server could not detect (the online path put no `local_id` on the wire, the drain
 * does). What decides now is a CAPABILITY question asked before the write —
 * `Storage.canQueueWrites(layerId)` — so a write never changes protocol mid-flight.
 *
 * ⚠️ **Neither key is removed**, and that is deliberate: a removed key makes
 * `validatePersistence` warn and rewrites an integrator's profile for nothing. They are
 * DEPRECATED, dated, and `layer.write.*` is the authority the core already reads
 * (`push-engine.ts`, `resolveWriteTarget`).
 *
 * ⚠️ **The permission guard still wraps every exit**, and for the reason that put it there:
 * it must cover the CONNECTED path, which is the one that carried the authorisation hole.
 *
 * @param cfg - The resolved editor config.
 * @param hooks - Injected collaborators (the conflict-event dispatcher).
 * @returns The adapter every call site depends on through its interface.
 */
export function createPersistenceAdapter(
    cfg: EditorConfig,
    hooks: PersistenceHooks = {}
): EditorPersistenceAdapter {
    const online = createOnlineAdapter(cfg, hooks);
    const mode = cfg.persistence?.mode ?? "auto";

    // The one mode that still names a transport, because it names the ABSENCE of the other:
    // an integrator who declares `online` is saying "this deployment has no local store".
    // ⚠️ Redefined rather than honoured literally elsewhere — see the header.
    if (mode === "online") return withEditionPermissions(online);

    const queue = createStorageQueueAdapter();
    if (mode === "offline") return withEditionPermissions(queue);

    return withEditionPermissions(createQueueFirstAdapter({ queue, online }));
}
