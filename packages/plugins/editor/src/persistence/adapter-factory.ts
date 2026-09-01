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
import { createAutoAdapter } from "./auto-adapter.js";
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
export function createOnlineAdapter(
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
 * Builds the persistence adapter for the resolved editor config, mapping
 * `persistence.mode` to the concrete backend:
 *  - `"online"`  → online adapter (REST/collection);
 *  - `"offline"` → Storage queue (write-through);
 *  - `"auto"`    → {@link createAutoAdapter} switching on reachability.
 *
 * The `collection` dialect is online-only for now (create-only backend), so it
 * ignores the offline/auto modes and always returns the online adapter.
 */
export function createPersistenceAdapter(
    cfg: EditorConfig,
    hooks: PersistenceHooks = {}
): EditorPersistenceAdapter {
    const online = createOnlineAdapter(cfg, hooks);

    // 🛑 THE PERMISSION GUARD WRAPS ALL FOUR EXITS, AND THAT IS THE POINT.
    //
    // It is NOT in `createAutoAdapter`: this path returns the **bare** REST
    // adapter in `mode: "online"` and on the `collection` dialect, without
    // ever building the auto one. A guard set at the routing would thus have
    // left open exactly the connected modes — the ones carrying the
    // authorisation hole, the permission having been applied until now only
    // through the offline path.
    if (cfg.persistence?.dialect === "collection") return withEditionPermissions(online);

    const mode = cfg.persistence?.mode ?? "auto";
    if (mode === "online") return withEditionPermissions(online);

    const queue = createStorageQueueAdapter();
    if (mode === "offline") return withEditionPermissions(queue);

    return withEditionPermissions(
        createAutoAdapter({ rest: online, queue, baseUrl: cfg.api?.baseUrl ?? "" })
    );
}
