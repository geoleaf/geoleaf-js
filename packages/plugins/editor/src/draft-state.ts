/*!
 * @geoleaf-plugins/editor — The draft awaiting its form
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * A draft is a new feature that exists on screen but not yet anywhere else: a shape the
 * user just finished drawing, or a point captured for the add form. It waits for its
 * attribute form, and ends when that form saves or cancels. `discardDraft` lets the HOST
 * end it too — close the form, remove what was drawn — without simulating a click on the
 * form's cancel button.
 *
 * One draft at a time: the form modal is a single instance, and opening a form closes the
 * previous one. The draft is identified by the HANDLE its opener holds, never by its id —
 * an add-form capture has no id, and a replaced form cancels after the next draft began.
 */

/** A draft as the code that opened it holds it. */
interface DraftHandle {
    /** True once the draft was abandoned or saved: nothing is left to open or discard. */
    readonly ended: boolean;
    /** Records how to close the form that now shows this draft, when there is one. */
    opened(close: (() => void) | undefined): void;
    /**
     * Marks the draft's write as in flight: it cannot be discarded until the write settles.
     * A success ends the draft; a failure makes it discardable again (the form stays open).
     */
    saving<T>(write: Promise<T>): Promise<T>;
    /** Abandons the draft: runs its cleanup once, and ends it. Idempotent. */
    abandon(): void;
}

/** The draft as this module tracks it. */
interface Draft extends DraftHandle {
    readonly id: string | null;
    readonly isSaving: boolean;
    readonly close: (() => void) | undefined;
}

let _current: Draft | null = null;

/**
 * Starts tracking a draft, which becomes the one {@link discardDraft} abandons.
 *
 * Called BEFORE the host is told about the new feature, so a host that abandons it from
 * its `geoleaf:editor:feature-created` listener finds it — and the opener, seeing the draft
 * ended, does not open its form.
 *
 * @param id - The drawing engine's feature id, or `null` when nothing was drawn.
 * @param cleanup - Removes what the draft left on screen, and its undo entries.
 * @returns The handle the opener wires into its form.
 * @example
 * const draft = beginDraft(id, () => removeDrawn(id));
 * dispatchCreated(id);
 * if (!draft.ended) draft.opened(openForm({ onCancel: draft.abandon }));
 */
export function beginDraft(id: string | null, cleanup: () => void): DraftHandle {
    let ended = false;
    let isSaving = false;
    let close: (() => void) | undefined;
    const end = (): void => {
        ended = true;
        if (_current === draft) _current = null;
    };
    const draft: Draft = {
        id,
        get ended() {
            return ended;
        },
        get isSaving() {
            return isSaving;
        },
        get close() {
            return close;
        },
        opened(fn) {
            close = fn;
        },
        saving(write) {
            isSaving = true;
            return write.then(
                (value) => {
                    isSaving = false;
                    end();
                    return value;
                },
                (err: unknown) => {
                    isSaving = false;
                    throw err;
                }
            );
        },
        abandon() {
            if (ended) return;
            end();
            cleanup();
        },
    };
    _current = draft;
    return draft;
}

/**
 * Abandons the draft awaiting its form — the shape just drawn, or the point captured for
 * the add form — as the form's cancel button would, without the dirty-form confirmation.
 *
 * Its form closes, the drawn geometry is removed along with its undo and redo entries, and
 * a placement marker is retired. Nothing is persisted, and no event is emitted: the caller
 * already knows. Callable from a `geoleaf:editor:feature-created` listener, which runs
 * before the form opens: the form then never opens.
 *
 * It does not abandon a shape still being drawn, a geometry edit of an existing feature,
 * or an armed placement (`Editor.PlacementMode.deactivate()` does that).
 *
 * @param featureId - Abandon only if the draft is this drawn feature — `detail.feature.id`
 *   of `geoleaf:editor:feature-created`. Omitted: whatever draft is pending, including an
 *   add-form capture, which has no id.
 * @returns `true` if a draft was abandoned. `false` when none is pending, when it is not
 *   `featureId`, or while its form is saving — a write in flight is never undone here.
 * @example
 * // The host persists the new feature itself, then drops the editor's draft.
 * const editor = GeoLeaf?.Editor as { discardDraft(id?: string | number): boolean } | undefined;
 * document.addEventListener("geoleaf:editor:feature-created", (e) => {
 *     const { feature } = (e as CustomEvent<{ feature: { id?: string | number } }>).detail;
 *     editor?.discardDraft(feature.id);
 * });
 */
export function discardDraft(featureId?: string | number): boolean {
    const draft = _current;
    if (!draft || draft.isSaving) return false;
    if (featureId != null && draft.id !== String(featureId)) return false;
    // The forced close fires the form's cancel, which abandons the draft; without a form
    // (still in the creation listener, or the form already gone) abandon it directly.
    draft.close?.();
    draft.abandon();
    return true;
}
