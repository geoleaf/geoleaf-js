/*!
 * @geoleaf-plugins/editor — HTTP 409 conflict resolution
 * © 2026 Mattieu Pottier — MIT License
 *
 * Applies the configured strategy when the backend reports a conflict:
 *  - `client-wins`  → re-PUT the local edit with a force flag;
 *  - `server-wins`  → repaint the host feature from the server state;
 *  - `prompt`       → ask the user (keep local / keep server / merge by field).
 *
 * The DOM `feature-conflict` event is emitted earlier, at the adapter's 409
 * boundary; this module only drives resolution.
 * https://geoleaf.dev
 */
import { _el, _getLabel } from "../internal.js";
import { createFocusTrap } from "@geoleaf/host-runtime";
import type {
    ConflictEventDetail,
    EditorPersistenceAdapter,
    SavedFeature,
} from "./adapter-interface.js";

/** Conflict-handling strategy (mirrors `editorConfig.persistence.conflictResolution`). */
export type ConflictStrategy = "client-wins" | "server-wins" | "prompt";

/** Collaborators supplied by the caller (entry.ts) so this module stays UI-only. */
export interface ConflictResolveContext {
    /** Used by client-wins to force-write the local edit. */
    adapter: Pick<EditorPersistenceAdapter, "update">;
    /** Repaints the host feature from the server state and drops the Terra Draw copy. */
    reloadFeature: (serverData: unknown, layerId: string) => void;
    /** Called after a successful client-wins (force) re-save. */
    onResolvedLocal?: (saved: SavedFeature) => void;
}

/**
 * Resolves a conflict according to `strategy`. Rejects if a force re-save fails;
 * the caller surfaces the error.
 */
export function resolveConflict(
    detail: ConflictEventDetail,
    strategy: ConflictStrategy,
    ctx: ConflictResolveContext
): Promise<void> {
    if (strategy === "client-wins") return _keepLocal(detail, ctx);
    if (strategy === "server-wins") return _keepServer(detail, ctx);
    return _prompt(detail, ctx);
}

// ---------------------------------------------------------------------------
// Strategy primitives
// ---------------------------------------------------------------------------

async function _keepLocal(detail: ConflictEventDetail, ctx: ConflictResolveContext): Promise<void> {
    const saved = await ctx.adapter.update(detail.localFeature, detail.layerId, { force: true });
    ctx.onResolvedLocal?.(saved);
}

function _keepServer(detail: ConflictEventDetail, ctx: ConflictResolveContext): Promise<void> {
    ctx.reloadFeature(detail.serverData, detail.layerId);
    return Promise.resolve();
}

// ---------------------------------------------------------------------------
// Prompt modal (keep local / keep server / merge)
// ---------------------------------------------------------------------------

function _prompt(detail: ConflictEventDetail, ctx: ConflictResolveContext): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const overlay = _el("div", "gl-form-modal-overlay");
        const dialog = _el("div", "gl-form-modal-panel gl-editor-conflict-modal");
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");

        const title = _el("h2", "gl-form-modal__delete-title");
        title.textContent = _getLabel("editor.sync.conflict.title");

        const body = _el("p", "gl-form-modal__delete-body");
        body.textContent = _getLabel("editor.sync.conflict.body");

        const footer = _el("div", "gl-form-modal__footer");
        const btnLocal = _btn("editor.sync.conflict.btn.keepLocal");
        const btnServer = _btn("editor.sync.conflict.btn.keepServer");
        const btnMerge = _btn("editor.sync.conflict.btn.merge");
        footer.append(btnLocal, btnServer, btnMerge);

        dialog.append(title, body, footer);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const trap = createFocusTrap(dialog, () => close());
        trap.activate();

        function close(): void {
            trap.deactivate();
            overlay.remove();
        }

        /** Runs a resolution branch, closing the modal and settling the promise. */
        function run(branch: () => Promise<void>): void {
            close();
            branch().then(resolve, reject);
        }

        btnLocal.addEventListener("click", () => run(() => _keepLocal(detail, ctx)));
        btnServer.addEventListener("click", () => run(() => _keepServer(detail, ctx)));
        btnMerge.addEventListener("click", () => {
            close();
            _openMergeUi(detail, ctx).then(resolve, reject);
        });
    });
}

// ---------------------------------------------------------------------------
// Merge-by-field UI
// ---------------------------------------------------------------------------

/** Best-effort extraction of a server feature's attribute bag. */
function _serverProps(serverData: unknown): Record<string, unknown> {
    const d = serverData as { properties?: unknown } | null | undefined;
    if (d && typeof d === "object" && d.properties && typeof d.properties === "object") {
        return d.properties as Record<string, unknown>;
    }
    return {};
}

/**
 * Per-field "use local / use server" chooser. On apply, force-saves the local
 * feature with the merged attributes (client-wins with the chosen values).
 */
function _openMergeUi(detail: ConflictEventDetail, ctx: ConflictResolveContext): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const local = detail.localFeature.properties;
        const server = _serverProps(detail.serverData);
        const keys = Array.from(new Set([...Object.keys(local), ...Object.keys(server)]));
        const choice = new Map<string, "local" | "server">();

        const overlay = _el("div", "gl-form-modal-overlay");
        const dialog = _el("div", "gl-form-modal-panel gl-editor-conflict-merge");
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");

        const title = _el("h2", "gl-form-modal__delete-title");
        title.textContent = _getLabel("editor.sync.conflict.merge.title");
        dialog.appendChild(title);

        const list = _el("div", "gl-editor-conflict-merge__list");
        keys.forEach((key) => list.appendChild(_mergeRow(key, local[key], server[key], choice)));
        dialog.appendChild(list);

        const footer = _el("div", "gl-form-modal__footer");
        const btnCancel = _btn("editor.modal.btn.cancel");
        const btnApply = _btn("editor.sync.conflict.merge.apply");
        footer.append(btnCancel, btnApply);
        dialog.appendChild(footer);

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        const trap = createFocusTrap(dialog, () => close());
        trap.activate();

        function close(): void {
            trap.deactivate();
            overlay.remove();
        }

        btnCancel.addEventListener("click", () => {
            close();
            resolve();
        });
        btnApply.addEventListener("click", () => {
            const merged: Record<string, unknown> = {};
            keys.forEach((key) => {
                merged[key] = choice.get(key) === "server" ? server[key] : local[key];
            });
            close();
            _keepLocal(
                { ...detail, localFeature: { ...detail.localFeature, properties: merged } },
                ctx
            ).then(resolve, reject);
        });
    });
}

/** One merge row: field name + two mutually-exclusive local/server toggles. */
function _mergeRow(
    key: string,
    localVal: unknown,
    serverVal: unknown,
    choice: Map<string, "local" | "server">
): HTMLElement {
    const row = _el("div", "gl-editor-conflict-merge__row");
    const name = _el("span", "gl-editor-conflict-merge__key");
    name.textContent = key;

    const btnLocal = _el(
        "button",
        "gl-form-modal__btn gl-editor-conflict-merge__opt"
    ) as HTMLButtonElement;
    btnLocal.type = "button";
    btnLocal.textContent = `${_getLabel("editor.sync.conflict.merge.useLocal")}: ${_fmt(localVal)}`;
    const btnServer = _el(
        "button",
        "gl-form-modal__btn gl-editor-conflict-merge__opt"
    ) as HTMLButtonElement;
    btnServer.type = "button";
    btnServer.textContent = `${_getLabel("editor.sync.conflict.merge.useServer")}: ${_fmt(serverVal)}`;

    choice.set(key, "local");
    btnLocal.classList.add("gl-is-selected");

    btnLocal.addEventListener("click", () => {
        choice.set(key, "local");
        btnLocal.classList.add("gl-is-selected");
        btnServer.classList.remove("gl-is-selected");
    });
    btnServer.addEventListener("click", () => {
        choice.set(key, "server");
        btnServer.classList.add("gl-is-selected");
        btnLocal.classList.remove("gl-is-selected");
    });

    row.append(name, btnLocal, btnServer);
    return row;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _btn(labelKey: string): HTMLButtonElement {
    const b = _el("button", "gl-form-modal__btn") as HTMLButtonElement;
    b.type = "button";
    b.textContent = _getLabel(labelKey);
    return b;
}

/** Renders a value as a short, safe preview string for the merge UI. */
function _fmt(v: unknown): string {
    if (v == null) return "—";
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s.length > 32 ? `${s.slice(0, 31)}…` : s;
}
