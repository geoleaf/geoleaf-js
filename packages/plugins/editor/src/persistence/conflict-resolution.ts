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
import { createModalShell } from "@geoleaf/host-runtime";
import type {
    ConflictEventDetail,
    EditorPersistenceAdapter,
    SavedFeature,
} from "./adapter-interface.js";
import type { ConflictStrategy } from "./conflict-strategies.js";

/**
 * Conflict-handling strategy (mirrors `editorConfig.persistence.conflictResolution`).
 *
 * ## Its twin in the core, and why their relationship had no home
 *
 * ⚠️ **A SECOND type describes the same arbitration, under another name and in
 * another package**: `ConflictPolicy` (`@geoleaf/core`,
 * `contracts/sync.contract.ts`), frozen at `"lastWriteWins"`. Neither the
 * compiler nor any gate can flag that they speak of the same thing — **two
 * differently-named types on either side of a package boundary**, which is
 * also a review boundary.
 *
 * **The split as MEASURED on 17/08/2026 — each governs its own path, no
 * hierarchy:** this type governs the **interactive submission** (`submit.ts`,
 * on a backend 409); `ConflictPolicy` governs the **offline drain** of the
 * queue (`core` — `capabilities/offline/write/push-engine.ts`).
 *
 * 🛑 **Consequence to know, written nowhere before: setting
 * `conflictResolution: "prompt"` does give a prompt HERE, and gives NONE to
 * the offline drain**, which settles by `lastWriteWins` without consulting
 * this setting. Measured: `push-engine.ts` carries no reference to
 * `conflictResolution` nor `ConflictStrategy`. Not a defect — the core
 * motivates it explicitly (a blocking prompt raised offline, alone in the
 * field, gets clicked at random) — **but it happens silently**.
 *
 * 📌 Neither wins over the other; the question "which wins when the two paths
 * cross" is named and NOT settled, rather than invented.
 *
 * ✅ **The vocabulary has ONE source since 19/08/2026** —
 * `conflict-strategies.ts`. It lived until then in three copies (this type,
 * the union re-spelled in `types.ts`, and the validator's array): they were
 * equal by coincidence, not construction, and the copy that VALIDATES decided.
 * The type and the validator's array now derive from it.
 */
// Re-exported under its name and from its original path: the declaration moved
// to `conflict-strategies.ts` to stop being one of three copies, but its
// consumers' import path — and the published declaration's — does not move.
// ⚠️ The re-export is not enough: it does NOT bring the name into this file's
// scope, which uses it too. Hence the two lines rather than one.
export type { ConflictStrategy };

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
    return _RESOLVERS[strategy](detail, ctx);
}

/**
 * Strategy → handler, keyed by the DERIVED union so the compiler enforces exhaustiveness.
 *
 * 🛑 **This was a chain of `if` ending in a fallback, and the fallback was the defect.** A fourth
 * strategy added to the vocabulary fell through to the prompt without a word: the resolution
 * *looked* handled, and the integrator got an interactive prompt where they had configured
 * something else. That is the same oriented failure as the validator's copy — silence where a
 * refusal was needed — and it lived at the point where the decision is actually executed.
 *
 * `Record<ConflictStrategy, …>` removes the possibility rather than guarding against it: a
 * member added to `CONFLICT_STRATEGIES` makes this object fail to compile until it gains a
 * handler. **The compiler follows the runtime source, which is the direction that was missing.**
 *
 * ⚠️ Not exported, deliberately: it would enter the published declarations of this plugin, and
 * nothing outside needs to dispatch by hand. Its exhaustiveness is proved by compilation, not by
 * a reader.
 */
const _RESOLVERS: Record<
    ConflictStrategy,
    (detail: ConflictEventDetail, ctx: ConflictResolveContext) => Promise<void>
> = {
    "client-wins": _keepLocal,
    "server-wins": _keepServer,
    prompt: _prompt,
};

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
        /** Runs a resolution branch, closing the modal and settling the promise. */
        function run(branch: () => Promise<void>): void {
            shell.close();
            branch().then(resolve, reject);
        }

        const shell = createModalShell({
            panelClass: "gl-editor-conflict-modal",
            fill(dialog) {
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

                btnLocal.addEventListener("click", () => run(() => _keepLocal(detail, ctx)));
                btnServer.addEventListener("click", () => run(() => _keepServer(detail, ctx)));
                btnMerge.addEventListener("click", () => run(() => _openMergeUi(detail, ctx)));
            },
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

        const shell = createModalShell({
            panelClass: "gl-editor-conflict-merge",
            fill(dialog) {
                const title = _el("h2", "gl-form-modal__delete-title");
                title.textContent = _getLabel("editor.sync.conflict.merge.title");
                dialog.appendChild(title);

                const list = _el("div", "gl-editor-conflict-merge__list");
                keys.forEach((key) =>
                    list.appendChild(_mergeRow(key, local[key], server[key], choice))
                );
                dialog.appendChild(list);

                const footer = _el("div", "gl-form-modal__footer");
                const btnCancel = _btn("editor.modal.btn.cancel");
                const btnApply = _btn("editor.sync.conflict.merge.apply");
                footer.append(btnCancel, btnApply);
                dialog.appendChild(footer);

                btnCancel.addEventListener("click", () => {
                    shell.close();
                    resolve();
                });
                btnApply.addEventListener("click", () => {
                    const merged: Record<string, unknown> = {};
                    keys.forEach((key) => {
                        merged[key] = choice.get(key) === "server" ? server[key] : local[key];
                    });
                    shell.close();
                    _keepLocal(
                        { ...detail, localFeature: { ...detail.localFeature, properties: merged } },
                        ctx
                    ).then(resolve, reject);
                });
            },
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

    const btnLocal = _el("button", "gl-form-modal__btn gl-editor-conflict-merge__opt");
    btnLocal.type = "button";
    btnLocal.textContent = `${_getLabel("editor.sync.conflict.merge.useLocal")}: ${_fmt(localVal)}`;
    const btnServer = _el("button", "gl-form-modal__btn gl-editor-conflict-merge__opt");
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
    const b = _el("button", "gl-form-modal__btn");
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
