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

    // 🛑 LA GARDE DE PERMISSION ENVELOPPE LES QUATRE SORTIES, ET C'EST LE POINT (tâche 8.7).
    //
    // Elle n'est PAS dans `createAutoAdapter` : ce chemin-ci rend l'adaptateur REST **nu** en
    // `mode: "online"` et sur le dialecte `collection`, sans jamais construire l'automatique.
    // Une garde posée au routage aurait donc laissé ouverts exactement les modes connectés —
    // ceux qui portaient le trou de B-138, la permission n'étant appliquée jusqu'ici que par
    // le chemin hors ligne.
    if (cfg.persistence?.dialect === "collection") return withEditionPermissions(online);

    const mode = cfg.persistence?.mode ?? "auto";
    if (mode === "online") return withEditionPermissions(online);

    const queue = createStorageQueueAdapter();
    if (mode === "offline") return withEditionPermissions(queue);

    return withEditionPermissions(
        createAutoAdapter({ rest: online, queue, baseUrl: cfg.api?.baseUrl ?? "" })
    );
}
