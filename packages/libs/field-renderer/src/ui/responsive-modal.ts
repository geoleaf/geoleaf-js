/*!
 * @geoleaf/field-renderer — Responsive form modal (desktop) / drawer (mobile)
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import "../css/form-modal-base.css";
import "../css/form-field-components.css";
import type { FieldConfig } from "../contract.js";
import { _el, _getLabel } from "../helpers.js";
import { createFocusTrap } from "@geoleaf/host-runtime";
import { confirmDialog } from "@geoleaf/host-runtime";
import { createFieldRendererBridge } from "../field-renderer-bridge.js";

const _g = globalThis as { GeoLeaf?: { I18n?: { lang?: string } } };

/** Minimal contract for an element injected in the modal header (e.g. layer dropdown). */
export interface HeaderSlot {
    el: HTMLElement;
    getValue(): string | null;
}

/**
 * Configuration for the responsive modal, decoupled from EditorConfig.
 * Callers map their plugin-specific config to these options before calling
 * `createResponsiveModal`.
 */
export interface ResponsiveModalOptions {
    desktopBreakpointPx?: number;
    maxWidthPx?: number;
    confirmCancelOnDirty?: boolean;
    /** Optional override labels keyed by i18n key (falls back to globalThis.GeoLeaf.I18n). */
    labelKeys?: Record<string, string>;
    /** Factory called at open() time to inject a custom header slot (e.g. layer selector). */
    createHeaderSlot?: (geometryType: string | undefined) => HeaderSlot;
    /**
     * Returns the form schema for a given layer id.
     * Called once at open time with the initial layer, then again each time the
     * header slot select changes. When provided, `ModalOpenOptions.schema` is ignored.
     */
    getSchemaForLayer?: (layerId: string) => FieldConfig[];
}

/**
 * What one `open()` call needs: the title, the schema to render, and where to save.
 *
 * Distinct from `ResponsiveModalOptions`, which configures the modal once at construction —
 * these are per-opening.
 */
export interface ModalOpenOptions {
    title: string;
    schema: FieldConfig[];
    initialValues?: Record<string, unknown>;
    geometryType?: string;
    /**
     * Persists the form. May be async: the modal shows a busy state while it is
     * pending, closes on resolution, and stays open (busy cleared) if it rejects
     * so the user can retry. The caller surfaces the failure (toast).
     */
    onSave: (values: Record<string, unknown>, layerId: string) => void | Promise<void>;
    onCancel?: () => void;
    /**
     * Deletes the record behind the form. When omitted (the default) no delete
     * button is rendered at all — callers opt in per open() call, typically for
     * edit mode only.
     *
     * Unlike `onSave`, the modal does NOT close when this resolves: deletion has
     * three outcomes, not two — done, failed, or declined at the confirmation
     * step — and only the caller can tell them apart. So the caller owns both
     * confirming and closing (via its own modal handle), and the modal only
     * renders the button and holds the busy state while the hook is pending.
     * A rejection clears busy and leaves the modal open so the user can retry.
     */
    onDelete?: () => void | Promise<void>;
    /**
     * Supplies the values of the schema's `computed` fields. Called with the
     * resolved schema every time the bridge is (re)built — at open, and again on
     * each header-slot layer change, since a different layer means a different
     * set of computed field ids.
     *
     * This package deliberately owns no geometry math: the caller closes over
     * whatever it is describing (plugin-editor passes the drawn feature's
     * geometry) and returns a plain id → value map, merged over `initialValues`.
     * Omitted by default — a caller that passes no hook renders `computed` fields
     * read-only and empty, which is what every caller did before PLUGINS S4.
     */
    computeValues?: (schema: FieldConfig[]) => Record<string, unknown>;
}

/**
 * A modal that renders as a dialog on desktop and a sheet on narrow screens.
 *
 * One instance is reused across openings: `open()` renders a fresh schema each time, while
 * `destroy()` is final. `close()` honours the dirty-state confirmation unless forced.
 */
export interface ResponsiveModal {
    open(options: ModalOpenOptions): void;
    /** @param force Skip dirty-state check when true. */
    close(force?: boolean): void;
    isOpen(): boolean;
    destroy(): void;
}

function getCurrentLang(): string {
    return (_g?.GeoLeaf?.I18n?.lang as string | undefined) ?? "fr";
}

function label(key: string, labelKeys?: Record<string, string>): string {
    return labelKeys?.[key] ?? _getLabel(key);
}

/**
 * Creates a responsive modal bound to `opts`.
 * On desktop (≥ `opts.desktopBreakpointPx`): centred dialog.
 * On mobile (< breakpoint): bottom drawer that slides up.
 */
export function createResponsiveModal(opts: ResponsiveModalOptions): ResponsiveModal {
    const breakpointPx = opts.desktopBreakpointPx ?? 768;
    const maxWidthPx = opts.maxWidthPx ?? 640;

    let overlay: HTMLElement | null = null;
    let trap = { activate: () => {}, deactivate: () => {} };
    let currentOptions: ModalOpenOptions | null = null;
    let fieldBridge: ReturnType<typeof createFieldRendererBridge> | null = null;
    let headerSlot: HeaderSlot | null = null;
    let mediaQuery: MediaQueryList | null = null;

    function isMobile(): boolean {
        return mediaQuery ? mediaQuery.matches : window.innerWidth < breakpointPx;
    }

    function isDirty(): boolean {
        if (!fieldBridge || !currentOptions) return false;
        const initial = currentOptions.initialValues ?? {};
        const current = fieldBridge.getValues();
        return JSON.stringify(current) !== JSON.stringify(initial);
    }

    /** Opens the styled "discard unsaved input?" confirm. Resolves true to proceed. */
    function confirmDiscard(): Promise<boolean> {
        return confirmDialog({
            message: label("editor.modal.cancel.confirmDirty", opts.labelKeys),
            confirmLabel: label("editor.modal.cancel.discardBtn", opts.labelKeys),
            cancelLabel: label("editor.modal.btn.cancel", opts.labelKeys),
        });
    }

    /**
     * Removes the modal and fires `onCancel` for a genuine cancel (button /
     * Escape / backdrop / confirmed discard) but NOT for a successful save —
     * otherwise the editor's cancel handler would discard the persisted feature.
     */
    function teardown(reason: "cancel" | "save"): void {
        if (!overlay) return;
        trap.deactivate();
        mediaQuery?.removeEventListener("change", onBreakpointChange);
        const onCancel = currentOptions?.onCancel;
        overlay.remove();
        overlay = null;
        fieldBridge = null;
        headerSlot = null;
        mediaQuery = null;
        currentOptions = null;
        if (reason === "cancel") onCancel?.();
    }

    /**
     * Closes the modal. On a dirty cancel (not forced), shows a styled confirm
     * dialog instead of the native `window.confirm`; the teardown is deferred
     * until the user confirms.
     */
    function doClose(force: boolean, reason: "cancel" | "save" = "cancel"): void {
        if (!overlay) return;
        if (!force && opts.confirmCancelOnDirty && isDirty()) {
            void confirmDiscard().then((ok) => {
                if (ok) teardown(reason);
            });
            return;
        }
        teardown(reason);
    }

    function onBreakpointChange(): void {
        const panel = overlay?.querySelector<HTMLElement>(".gl-form-modal-panel");
        if (!panel) return;
        if (isMobile()) {
            panel.classList.add("gl-form-modal-panel--drawer");
        } else {
            panel.classList.remove("gl-form-modal-panel--drawer");
            panel.style.maxWidth = `${maxWidthPx}px`;
        }
    }

    function build(options: ModalOpenOptions): void {
        currentOptions = options;

        // Initialise mediaQuery before isMobile() is first called.
        mediaQuery =
            typeof window.matchMedia === "function"
                ? window.matchMedia(`(max-width: ${breakpointPx - 1}px)`)
                : null;

        overlay = _el("div", "gl-form-modal-overlay");

        const panel = _el("div", "gl-form-modal-panel");
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-modal", "true");
        panel.setAttribute("aria-labelledby", "gl-form-modal-title");

        if (isMobile()) {
            panel.classList.add("gl-form-modal-panel--drawer");
        } else {
            panel.style.maxWidth = `${maxWidthPx}px`;
        }

        // ── Header ──────────────────────────────────────────────────────────
        const header = _el("div", "gl-form-modal__header");

        const titleEl = _el("h2", "gl-form-modal__title");
        titleEl.id = "gl-form-modal-title";
        titleEl.textContent = options.title;

        headerSlot = opts.createHeaderSlot?.(options.geometryType) ?? null;

        const btnClose = _el("button", "gl-form-modal__btn gl-form-modal__btn--close");
        btnClose.type = "button";
        btnClose.setAttribute("aria-label", label("editor.aria.closeModal", opts.labelKeys));
        btnClose.innerHTML =
            '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
            '<line x1="5" y1="5" x2="15" y2="15"/><line x1="15" y1="5" x2="5" y2="15"/></svg>';

        header.appendChild(titleEl);
        if (headerSlot) header.appendChild(headerSlot.el);
        header.appendChild(btnClose);

        // ── Body ─────────────────────────────────────────────────────────────
        const body = _el("div", "gl-form-modal__body");

        // Resolve the initial schema: prefer getSchemaForLayer if provided.
        const initialLayerId = headerSlot?.getValue() ?? "";
        const initialSchema = opts.getSchemaForLayer
            ? opts.getSchemaForLayer(initialLayerId)
            : options.schema;

        /**
         * Values to seed a bridge built on `schema`. Computed values are layered
         * over the caller's, never under: `computeValues` is derived from the
         * geometry and is authoritative for the fields it answers for, which the
         * bridge renders read-only anyway.
         */
        const seedValues = (
            schema: FieldConfig[],
            base: Record<string, unknown>
        ): Record<string, unknown> => ({ ...base, ...(options.computeValues?.(schema) ?? {}) });

        fieldBridge = createFieldRendererBridge(
            initialSchema,
            seedValues(initialSchema, options.initialValues ?? {}),
            { lang: getCurrentLang() }
        );
        body.appendChild(fieldBridge.el);

        // Reload the bridge whenever the header slot layer changes.
        if (opts.getSchemaForLayer && headerSlot) {
            const selectEl = headerSlot.el.querySelector("select");
            let prevLayerId = initialLayerId;

            /**
             * Rebuilds the field bridge for the given layer's schema. Entered
             * values are intentionally dropped (the new layer has different
             * fields), but computed values are re-derived: they describe the
             * geometry, which the layer change does not touch.
             */
            const reloadBridge = (layerId: string): void => {
                if (fieldBridge) fieldBridge.el.remove();
                const schema = opts.getSchemaForLayer!(layerId);
                fieldBridge = createFieldRendererBridge(schema, seedValues(schema, {}), {
                    lang: getCurrentLang(),
                });
                body.appendChild(fieldBridge.el);
            };

            selectEl?.addEventListener("change", () => {
                if (!headerSlot || !selectEl) return;
                const newLayerId = headerSlot.getValue() ?? "";
                // Confirm before discarding entered values; revert the select on cancel.
                if (opts.confirmCancelOnDirty && isDirty()) {
                    void confirmDiscard().then((ok) => {
                        if (!ok) {
                            selectEl.value = prevLayerId;
                            return;
                        }
                        prevLayerId = newLayerId;
                        reloadBridge(newLayerId);
                    });
                    return;
                }
                prevLayerId = newLayerId;
                reloadBridge(newLayerId);
            });
        }

        // ── Footer ───────────────────────────────────────────────────────────
        const footer = _el("div", "gl-form-modal__footer");

        const btnCancel = _el("button", "gl-form-modal__btn gl-form-modal__btn-cancel");
        btnCancel.type = "button";
        btnCancel.textContent = label("editor.modal.btn.cancel", opts.labelKeys);
        btnCancel.setAttribute("aria-label", label("editor.modal.btn.cancel", opts.labelKeys));

        const btnSave = _el("button", "gl-form-modal__btn gl-form-modal__btn-save");
        btnSave.type = "button";
        btnSave.textContent = label("editor.modal.btn.save", opts.labelKeys);
        btnSave.setAttribute("aria-label", label("editor.modal.btn.save", opts.labelKeys));

        // Delete is opt-in per open() call: no hook, no button, no layout shift.
        const btnDelete = options.onDelete
            ? _el("button", "gl-form-modal__btn gl-form-modal__btn-delete")
            : null;
        if (btnDelete) {
            btnDelete.type = "button";
            btnDelete.textContent = label("editor.modal.btn.delete", opts.labelKeys);
            btnDelete.setAttribute("aria-label", label("editor.modal.btn.delete", opts.labelKeys));
            footer.appendChild(btnDelete);
        }

        footer.appendChild(btnCancel);
        footer.appendChild(btnSave);

        panel.appendChild(header);
        panel.appendChild(body);
        panel.appendChild(footer);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        // ── Event wiring ─────────────────────────────────────────────────────
        trap = createFocusTrap(panel, () => doClose(false));

        btnClose.addEventListener("click", () => doClose(false));
        btnCancel.addEventListener("click", () => doClose(false));

        btnSave.addEventListener("click", () => {
            void handleSave();
        });

        btnDelete?.addEventListener("click", () => {
            void handleDelete();
        });

        /** Toggles the busy state (disabled buttons + save spinner) during persistence. */
        function setBusy(on: boolean): void {
            btnSave.disabled = on;
            btnCancel.disabled = on;
            if (btnDelete) btnDelete.disabled = on;
            btnSave.classList.toggle("gl-form-modal__btn-save--busy", on);
        }

        /**
         * Awaits `onDelete` under the busy state. Deliberately does NOT close:
         * see `ModalOpenOptions.onDelete` — the caller confirms and closes,
         * because a declined confirmation must leave the modal open and only
         * the caller knows it was declined. No validation runs first either:
         * deleting a form holding invalid values is legitimate.
         */
        async function handleDelete(): Promise<void> {
            const onDelete = currentOptions?.onDelete;
            if (!onDelete) return;
            setBusy(true);
            try {
                await onDelete();
            } catch {
                // Swallowed like handleSave's: the caller surfaces the failure.
                // Not optional — the click handler calls this as `void
                // handleDelete()`, so a rejection escaping here becomes an
                // unhandled rejection that fails the run.
            } finally {
                // Guard the teardown race: the caller normally closes inside the
                // hook, which nulls `overlay` and disposes these nodes.
                if (overlay) setBusy(false);
            }
        }

        /**
         * Validates, then awaits `onSave`. Closes on success WITHOUT firing
         * onCancel; on failure keeps the modal open (busy cleared) so the user
         * can retry — the caller has already surfaced the error.
         */
        async function handleSave(): Promise<void> {
            if (!fieldBridge || !overlay) return;
            if (!fieldBridge.validate()) return;
            const values = fieldBridge.getValues();
            const layerId = headerSlot?.getValue() ?? "";
            const onSave = currentOptions?.onSave;
            if (!onSave) {
                doClose(true, "save");
                return;
            }
            setBusy(true);
            try {
                await onSave(values, layerId);
                doClose(true, "save");
            } catch {
                setBusy(false);
            }
        }

        // Desktop: backdrop click closes modal
        overlay.addEventListener("click", (e) => {
            if (!isMobile() && e.target === overlay) doClose(false);
        });

        // Responsive breakpoint listener (mediaQuery already created above)
        mediaQuery?.addEventListener("change", onBreakpointChange);
    }

    return {
        open(options) {
            if (overlay) doClose(true);
            build(options);
            trap.activate();
        },
        close(force = false) {
            doClose(force);
        },
        isOpen() {
            return overlay !== null;
        },
        destroy() {
            if (overlay) doClose(true);
        },
    };
}
