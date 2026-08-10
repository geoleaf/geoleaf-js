/**
 * Tests for @geoleaf/field-renderer modal components.
 * Covers: focus-trap, field-renderer-bridge, responsive-modal.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createFocusTrap } from "@geoleaf/host-runtime";
import { createFieldRendererBridge } from "../field-renderer-bridge.js";
import { createResponsiveModal } from "../ui/responsive-modal.js";
import { ComponentRegistry } from "../registry.js";
import { textComponent } from "../types/text.js";
import { dropdownComponent } from "../types/dropdown.js";
import type { FieldConfig } from "../contract.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function installI18n(): void {
    (globalThis as any).GeoLeaf = {
        ...(globalThis as any).GeoLeaf,
        I18n: {
            t: vi.fn((key: string) => key),
            lang: "fr",
        },
    };
}

/** Stub matchMedia so happy-dom doesn't fail on it. Desktop by default (non-matching). */
function stubMatchMedia(matches = false): void {
    (globalThis as any).window.matchMedia = vi.fn(() => ({
        matches,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    }));
    if (!(globalThis as any).matchMedia) {
        (globalThis as any).matchMedia = (globalThis as any).window.matchMedia;
    }
}

// ---------------------------------------------------------------------------
// createFocusTrap
// ---------------------------------------------------------------------------

describe("createFocusTrap", () => {
    let container: HTMLElement;
    let btns: HTMLButtonElement[];

    beforeEach(() => {
        container = document.createElement("div");
        btns = [0, 1, 2].map(() => {
            const b = document.createElement("button");
            container.appendChild(b);
            return b;
        });
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    it("activate() focuses the first focusable element", () => {
        const trap = createFocusTrap(container);
        trap.activate();
        expect(document.activeElement).toBe(btns[0]);
        trap.deactivate();
    });

    it("Tab on last element wraps to first", () => {
        const trap = createFocusTrap(container);
        trap.activate();
        btns[2]!.focus();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
        expect(document.activeElement).toBe(btns[0]);
        trap.deactivate();
    });

    it("Shift+Tab on first element wraps to last", () => {
        const trap = createFocusTrap(container);
        trap.activate();
        btns[0]!.focus();
        document.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })
        );
        expect(document.activeElement).toBe(btns[2]);
        trap.deactivate();
    });

    it("Escape fires the onEscape callback", () => {
        const onEscape = vi.fn();
        const trap = createFocusTrap(container, onEscape);
        trap.activate();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(onEscape).toHaveBeenCalledOnce();
        trap.deactivate();
    });

    it("deactivate() restores previously focused element", () => {
        const outside = document.createElement("button");
        document.body.appendChild(outside);
        outside.focus();

        const trap = createFocusTrap(container);
        trap.activate();
        trap.deactivate();

        expect(document.activeElement).toBe(outside);
        outside.remove();
    });

    it("deactivate() removes the keydown listener (no more callbacks)", () => {
        const onEscape = vi.fn();
        const trap = createFocusTrap(container, onEscape);
        trap.activate();
        trap.deactivate();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(onEscape).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// createFieldRendererBridge
// ---------------------------------------------------------------------------

describe("createFieldRendererBridge", () => {
    beforeEach(() => {
        installI18n();
        ComponentRegistry.register(textComponent);
    });

    afterEach(() => {
        delete (globalThis as any).GeoLeaf;
    });

    const schema: FieldConfig[] = [
        { id: "name", type: "text", label: "Name", required: true },
        { id: "notes", type: "text", label: "Notes" },
    ];

    it("returns an element containing rendered fields", () => {
        const bridge = createFieldRendererBridge(schema, {}, { lang: "fr" });
        expect(bridge.el).toBeInstanceOf(HTMLElement);
        const inputs = bridge.el.querySelectorAll("input");
        expect(inputs.length).toBeGreaterThanOrEqual(2);
    });

    it("getValues() returns initialValues on construction", () => {
        const bridge = createFieldRendererBridge(schema, { name: "Alice" }, { lang: "fr" });
        expect(bridge.getValues()["name"]).toBe("Alice");
    });

    it("setValues() updates the value map", () => {
        const bridge = createFieldRendererBridge(schema, {}, { lang: "fr" });
        bridge.setValues({ name: "Bob" });
        expect(bridge.getValues()["name"]).toBe("Bob");
    });

    it("validate() returns false when required field is empty", () => {
        const bridge = createFieldRendererBridge(schema, { name: "" }, { lang: "fr" });
        expect(bridge.validate()).toBe(false);
    });

    it("validate() returns true when all required fields are filled", () => {
        const bridge = createFieldRendererBridge(schema, { name: "Charlie" }, { lang: "fr" });
        expect(bridge.validate()).toBe(true);
    });

    it("getErrors() includes error for invalid field after validate()", () => {
        const bridge = createFieldRendererBridge(schema, { name: "" }, { lang: "fr" });
        bridge.validate();
        expect(bridge.getErrors()["name"]).not.toBeNull();
    });

    it("getErrors() is null for valid fields after validate()", () => {
        const bridge = createFieldRendererBridge(schema, { name: "Alice" }, { lang: "fr" });
        bridge.validate();
        expect(bridge.getErrors()["name"]).toBeNull();
    });

    it("computed fields are rendered read-only", () => {
        const computedSchema: FieldConfig[] = [
            { id: "len", type: "text", label: "Length", computed: "geometry.length" },
        ];
        const bridge = createFieldRendererBridge(computedSchema, { len: "12.5 m" }, { lang: "fr" });
        const input = bridge.el.querySelector<HTMLInputElement>("input");
        expect(input?.disabled).toBe(true);
    });

    it("falls back to text component for unknown type", () => {
        const unknownSchema: FieldConfig[] = [{ id: "x", type: "unknown-type-xyz", label: "X" }];
        expect(() => createFieldRendererBridge(unknownSchema, {}, { lang: "fr" })).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// createFieldRendererBridge — cascade dependsOn / optionsByCategory
// ---------------------------------------------------------------------------

describe("createFieldRendererBridge — cascade dependsOn", () => {
    beforeEach(() => {
        installI18n();
        ComponentRegistry.register(dropdownComponent);
    });

    const optionsByCategory = {
        nature: [
            { value: "forest", label: "Forêt" },
            { value: "lake", label: "Lac" },
        ],
        urban: [{ value: "park", label: "Parc" }],
    };

    const cascadeSchema: FieldConfig[] = [
        {
            id: "category",
            type: "dropdown",
            label: "Catégorie",
            options: [
                { value: "nature", label: "Nature" },
                { value: "urban", label: "Urbain" },
            ],
            emptyLabel: "—",
        },
        {
            id: "subcategory",
            type: "dropdown",
            label: "Sous-catégorie",
            options: [
                { value: "forest", label: "Forêt" },
                { value: "lake", label: "Lac" },
                { value: "park", label: "Parc" },
            ],
            optionsByCategory,
            dependsOn: "category",
            emptyLabel: "—",
        },
    ];

    it("filters subcategory options when category changes", () => {
        const bridge = createFieldRendererBridge(cascadeSchema, {}, { lang: "fr" });
        const selects = bridge.el.querySelectorAll<HTMLSelectElement>("select");
        const catSelect = selects[0];
        const subSelect = selects[1];

        // Select "nature"
        catSelect.value = "nature";
        catSelect.dispatchEvent(new Event("change"));

        const subValues = Array.from(subSelect.options).map((o) => o.value);
        expect(subValues).toContain("forest");
        expect(subValues).toContain("lake");
        expect(subValues).not.toContain("park");
    });

    it("updates subcategory options when category changes again", () => {
        const bridge = createFieldRendererBridge(cascadeSchema, {}, { lang: "fr" });
        const selects = bridge.el.querySelectorAll<HTMLSelectElement>("select");
        const catSelect = selects[0];
        const subSelect = selects[1];

        catSelect.value = "nature";
        catSelect.dispatchEvent(new Event("change"));
        catSelect.value = "urban";
        catSelect.dispatchEvent(new Event("change"));

        const subValues = Array.from(subSelect.options).map((o) => o.value);
        expect(subValues).toContain("park");
        expect(subValues).not.toContain("forest");
    });

    it("resets subcategory value when category changes", () => {
        const bridge = createFieldRendererBridge(
            cascadeSchema,
            { category: "nature", subcategory: "forest" },
            { lang: "fr" }
        );
        const selects = bridge.el.querySelectorAll<HTMLSelectElement>("select");
        const catSelect = selects[0];
        catSelect.value = "urban";
        catSelect.dispatchEvent(new Event("change"));
        expect(bridge.getValues()["subcategory"]).toBe("");
    });

    it("preserves emptyLabel option in filtered list", () => {
        const bridge = createFieldRendererBridge(cascadeSchema, {}, { lang: "fr" });
        const selects = bridge.el.querySelectorAll<HTMLSelectElement>("select");
        const catSelect = selects[0];
        const subSelect = selects[1];

        catSelect.value = "urban";
        catSelect.dispatchEvent(new Event("change"));

        expect(subSelect.options[0].value).toBe("");
        expect(subSelect.options[0].textContent).toBe("—");
    });
});

// ---------------------------------------------------------------------------
// createResponsiveModal
// ---------------------------------------------------------------------------

describe("createResponsiveModal", () => {
    beforeEach(() => {
        ComponentRegistry.register(textComponent);
        installI18n();
        stubMatchMedia(false); // Desktop by default
    });

    afterEach(() => {
        document.body.querySelectorAll(".gl-form-modal-overlay").forEach((el) => el.remove());
        delete (globalThis as any).GeoLeaf;
    });

    const schema: FieldConfig[] = [{ id: "title", type: "text", label: "Title", required: false }];

    const baseOpts = { desktopBreakpointPx: 768, maxWidthPx: 640 };

    it("isOpen() returns false before open()", () => {
        const modal = createResponsiveModal(baseOpts);
        expect(modal.isOpen()).toBe(false);
    });

    it("open() mounts the overlay in document.body", () => {
        const modal = createResponsiveModal(baseOpts);
        modal.open({ title: "New feature", schema, onSave: vi.fn() });
        expect(document.body.querySelector(".gl-form-modal-overlay")).not.toBeNull();
        expect(modal.isOpen()).toBe(true);
        modal.close(true);
    });

    it("close(true) removes the overlay and sets isOpen() to false", () => {
        const modal = createResponsiveModal(baseOpts);
        modal.open({ title: "New feature", schema, onSave: vi.fn() });
        modal.close(true);
        expect(document.body.querySelector(".gl-form-modal-overlay")).toBeNull();
        expect(modal.isOpen()).toBe(false);
    });

    it("close(true) fires onCancel callback", () => {
        const onCancel = vi.fn();
        const modal = createResponsiveModal(baseOpts);
        modal.open({ title: "New", schema, onSave: vi.fn(), onCancel });
        modal.close(true);
        expect(onCancel).toHaveBeenCalledOnce();
    });

    it("clicking cancel button closes the modal", () => {
        const modal = createResponsiveModal(baseOpts);
        modal.open({ title: "New", schema, onSave: vi.fn() });
        const btn = document.body.querySelector<HTMLButtonElement>(".gl-form-modal__btn-cancel")!;
        btn.click();
        expect(modal.isOpen()).toBe(false);
    });

    it("clicking Save calls onSave with form values", () => {
        const onSave = vi.fn();
        const modal = createResponsiveModal(baseOpts);
        modal.open({ title: "New", schema, initialValues: { title: "Hello" }, onSave });
        const btn = document.body.querySelector<HTMLButtonElement>(".gl-form-modal__btn-save")!;
        btn.click();
        expect(onSave).toHaveBeenCalledOnce();
        const [values] = onSave.mock.calls[0] as [Record<string, unknown>, string];
        expect(values["title"]).toBe("Hello");
    });

    it("Save does not fire when validation fails", () => {
        const requiredSchema: FieldConfig[] = [
            { id: "name", type: "text", label: "Name", required: true },
        ];
        const onSave = vi.fn();
        const modal = createResponsiveModal(baseOpts);
        modal.open({ title: "New", schema: requiredSchema, initialValues: { name: "" }, onSave });
        const btn = document.body.querySelector<HTMLButtonElement>(".gl-form-modal__btn-save")!;
        btn.click();
        expect(onSave).not.toHaveBeenCalled();
        modal.close(true);
    });

    it("modal panel has role=dialog and aria-modal=true", () => {
        const modal = createResponsiveModal(baseOpts);
        modal.open({ title: "New", schema, onSave: vi.fn() });
        const panel = document.body.querySelector<HTMLElement>(".gl-form-modal-panel")!;
        expect(panel.getAttribute("role")).toBe("dialog");
        expect(panel.getAttribute("aria-modal")).toBe("true");
        modal.close(true);
    });

    it("open() applies --drawer class when matchMedia.matches is true", () => {
        stubMatchMedia(true); // Mobile
        const modal = createResponsiveModal(baseOpts);
        modal.open({ title: "New", schema, onSave: vi.fn() });
        const panel = document.body.querySelector<HTMLElement>(".gl-form-modal-panel")!;
        expect(panel.classList.contains("gl-form-modal-panel--drawer")).toBe(true);
        modal.close(true);
    });

    it("destroy() closes modal if open", () => {
        const modal = createResponsiveModal(baseOpts);
        modal.open({ title: "New", schema, onSave: vi.fn() });
        modal.destroy();
        expect(modal.isOpen()).toBe(false);
    });

    /** Makes the open form dirty and clicks its Cancel button. */
    function makeDirtyAndCancel(modal: ReturnType<typeof createResponsiveModal>): void {
        modal.open({ title: "New", schema, initialValues: { title: "original" }, onSave: vi.fn() });
        const input = document.body.querySelector<HTMLInputElement>("input")!;
        input.value = "something else";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        // At this point only the form's cancel button exists.
        document.body.querySelector<HTMLButtonElement>(".gl-form-modal__btn-cancel")!.click();
    }

    it("confirmCancelOnDirty shows a styled JS confirm dialog (not window.confirm)", () => {
        const modal = createResponsiveModal({ ...baseOpts, confirmCancelOnDirty: true });
        makeDirtyAndCancel(modal);
        // A styled dialog is mounted (the form modal is still open behind it).
        expect(document.body.querySelector(".gl-form-modal-confirm")).not.toBeNull();
        expect(modal.isOpen()).toBe(true);
        modal.close(true);
    });

    it("confirm dialog → keep editing leaves the form open", () => {
        const modal = createResponsiveModal({ ...baseOpts, confirmCancelOnDirty: true });
        makeDirtyAndCancel(modal);
        const dialog = document.body.querySelector(".gl-form-modal-confirm")!;
        // The dialog's cancel button = keep editing.
        dialog.querySelector<HTMLButtonElement>(".gl-form-modal__btn-cancel")!.click();
        expect(modal.isOpen()).toBe(true);
        expect(document.body.querySelector(".gl-form-modal-confirm")).toBeNull();
        modal.close(true);
    });

    it("confirm dialog → discard closes the form and fires onCancel", async () => {
        const onCancel = vi.fn();
        const modal = createResponsiveModal({ ...baseOpts, confirmCancelOnDirty: true });
        modal.open({
            title: "New",
            schema,
            initialValues: { title: "original" },
            onSave: vi.fn(),
            onCancel,
        });
        const input = document.body.querySelector<HTMLInputElement>("input")!;
        input.value = "edited";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        document.body.querySelector<HTMLButtonElement>(".gl-form-modal__btn-cancel")!.click();
        // The dialog's destructive button = discard.
        document.body
            .querySelector(".gl-form-modal-confirm")!
            .querySelector<HTMLButtonElement>(".gl-form-modal__btn-delete")!
            .click();
        await new Promise((r) => setTimeout(r, 0));
        expect(modal.isOpen()).toBe(false);
        expect(onCancel).toHaveBeenCalledOnce();
    });

    it("headerSlot element is appended to the header when createHeaderSlot is provided", () => {
        const slotEl = document.createElement("select");
        slotEl.setAttribute("data-testid", "header-slot");
        const modal = createResponsiveModal({
            ...baseOpts,
            createHeaderSlot: () => ({ el: slotEl, getValue: () => "layer-1" }),
        });
        modal.open({ title: "New", schema, onSave: vi.fn() });
        expect(document.body.querySelector("[data-testid=header-slot]")).not.toBeNull();
        modal.close(true);
    });
});

// ---------------------------------------------------------------------------
// createResponsiveModal — save / cancel semantics (Sprint S10, EDT.10.4)
// Regression: a successful Save must NOT fire onCancel (which the editor uses to
// discard the drawn geometry); a failed Save must keep the modal open.
// ---------------------------------------------------------------------------

describe("createResponsiveModal — save/cancel semantics (S10)", () => {
    const schema: FieldConfig[] = [{ id: "title", type: "text", label: "Title", required: false }];
    const baseOpts = { desktopBreakpointPx: 768, maxWidthPx: 640 };

    beforeEach(() => {
        ComponentRegistry.register(textComponent);
        installI18n();
        stubMatchMedia(false);
    });

    afterEach(() => {
        document.body.querySelectorAll(".gl-form-modal-overlay").forEach((el) => el.remove());
        delete (globalThis as any).GeoLeaf;
    });

    /** Lets queued microtasks (await continuations) settle. */
    const flush = () => new Promise((r) => setTimeout(r, 0));

    function clickSave(): void {
        document.body.querySelector<HTMLButtonElement>(".gl-form-modal__btn-save")!.click();
    }

    it("Save fires onSave and does NOT fire onCancel, then closes", async () => {
        const onSave = vi.fn();
        const onCancel = vi.fn();
        const modal = createResponsiveModal(baseOpts);
        modal.open({ title: "New", schema, onSave, onCancel });
        clickSave();
        await flush();
        expect(onSave).toHaveBeenCalledOnce();
        expect(onCancel).not.toHaveBeenCalled();
        expect(modal.isOpen()).toBe(false);
    });

    it("Cancel button fires onCancel and not onSave", () => {
        const onSave = vi.fn();
        const onCancel = vi.fn();
        const modal = createResponsiveModal(baseOpts);
        modal.open({ title: "New", schema, onSave, onCancel });
        document.body.querySelector<HTMLButtonElement>(".gl-form-modal__btn-cancel")!.click();
        expect(onCancel).toHaveBeenCalledOnce();
        expect(onSave).not.toHaveBeenCalled();
    });

    it("shows the busy state synchronously while an async onSave is pending", () => {
        let resolveSave: () => void = () => {};
        const onSave = vi.fn(() => new Promise<void>((r) => (resolveSave = r)));
        const modal = createResponsiveModal(baseOpts);
        modal.open({ title: "New", schema, onSave });
        const btn = document.body.querySelector<HTMLButtonElement>(".gl-form-modal__btn-save")!;
        btn.click();
        expect(btn.classList.contains("gl-form-modal__btn-save--busy")).toBe(true);
        expect(btn.disabled).toBe(true);
        resolveSave();
    });

    it("keeps the modal open and clears busy when onSave rejects", async () => {
        const onSave = vi.fn(() => Promise.reject(new Error("network")));
        const onCancel = vi.fn();
        const modal = createResponsiveModal(baseOpts);
        modal.open({ title: "New", schema, onSave, onCancel });
        const btn = document.body.querySelector<HTMLButtonElement>(".gl-form-modal__btn-save")!;
        btn.click();
        await flush();
        expect(modal.isOpen()).toBe(true);
        expect(onCancel).not.toHaveBeenCalled();
        expect(btn.classList.contains("gl-form-modal__btn-save--busy")).toBe(false);
        modal.close(true);
    });

    it("re-opening over an existing modal still fires the prior onCancel", () => {
        const firstCancel = vi.fn();
        const modal = createResponsiveModal(baseOpts);
        modal.open({ title: "First", schema, onSave: vi.fn(), onCancel: firstCancel });
        modal.open({ title: "Second", schema, onSave: vi.fn() });
        expect(firstCancel).toHaveBeenCalledOnce();
        modal.close(true);
    });

    // ── onDelete (PLUGINS S3) ───────────────────────────────────────────────
    //
    // Opt-in delete button. Unlike onSave, the modal does NOT close when the
    // hook resolves: deletion has three outcomes — done, failed, or declined at
    // the caller's confirmation step — and only the caller can tell them apart.

    describe("onDelete", () => {
        const deleteBtn = () =>
            document.body.querySelector<HTMLButtonElement>(".gl-form-modal__btn-delete");

        it("renders no delete button when onDelete is omitted", () => {
            const modal = createResponsiveModal(baseOpts);
            modal.open({ title: "Edit", schema, onSave: vi.fn() });
            expect(deleteBtn()).toBeNull();
            modal.close(true);
        });

        it("renders the delete button when onDelete is provided", () => {
            const modal = createResponsiveModal(baseOpts);
            modal.open({ title: "Edit", schema, onSave: vi.fn(), onDelete: vi.fn() });
            expect(deleteBtn()).not.toBeNull();
            modal.close(true);
        });

        it("clicking it invokes onDelete", async () => {
            const onDelete = vi.fn();
            const modal = createResponsiveModal(baseOpts);
            modal.open({ title: "Edit", schema, onSave: vi.fn(), onDelete });
            deleteBtn()!.click();
            await flush();
            expect(onDelete).toHaveBeenCalledOnce();
            modal.close(true);
        });

        it("does not validate first — deleting an invalid form is legitimate", async () => {
            const required: FieldConfig[] = [
                { id: "title", type: "text", label: "Title", required: true },
            ];
            const onDelete = vi.fn();
            const modal = createResponsiveModal(baseOpts);
            modal.open({ title: "Edit", schema: required, onSave: vi.fn(), onDelete });
            deleteBtn()!.click();
            await flush();
            expect(onDelete).toHaveBeenCalledOnce();
            modal.close(true);
        });

        it("leaves the modal open when onDelete resolves — the caller closes it", async () => {
            const onCancel = vi.fn();
            const modal = createResponsiveModal(baseOpts);
            modal.open({ title: "Edit", schema, onSave: vi.fn(), onCancel, onDelete: vi.fn() });
            deleteBtn()!.click();
            await flush();
            // A declined confirmation resolves exactly like a completed one, so
            // auto-closing here would dismiss a form the user chose to keep.
            expect(modal.isOpen()).toBe(true);
            expect(onCancel).not.toHaveBeenCalled();
            modal.close(true);
        });

        it("keeps the modal open and clears busy when onDelete rejects", async () => {
            const onDelete = vi.fn(() => Promise.reject(new Error("network")));
            const modal = createResponsiveModal(baseOpts);
            modal.open({ title: "Edit", schema, onSave: vi.fn(), onDelete });
            const btn = deleteBtn()!;
            btn.click();
            await flush();
            expect(modal.isOpen()).toBe(true);
            expect(btn.disabled).toBe(false);
            modal.close(true);
        });

        it("disables the whole footer while onDelete is pending", async () => {
            let release: () => void = () => {};
            const onDelete = vi.fn(() => new Promise<void>((r) => (release = r)));
            const modal = createResponsiveModal(baseOpts);
            modal.open({ title: "Edit", schema, onSave: vi.fn(), onDelete });

            deleteBtn()!.click();
            await flush();

            const save = document.body.querySelector<HTMLButtonElement>(
                ".gl-form-modal__btn-save"
            )!;
            const cancel = document.body.querySelector<HTMLButtonElement>(
                ".gl-form-modal__btn-cancel"
            )!;
            expect(deleteBtn()!.disabled).toBe(true);
            expect(save.disabled).toBe(true);
            expect(cancel.disabled).toBe(true);

            release();
            await flush();
            modal.close(true);
        });
    });
});

// ---------------------------------------------------------------------------
// createResponsiveModal — computeValues (PLUGINS S4)
// The `computed` contract was declared here and rendered read-only, but nothing
// ever produced a value. This hook is the join point: the modal owns no geometry
// math, it just asks the caller with the schema it has actually resolved.
// ---------------------------------------------------------------------------

describe("createResponsiveModal — computeValues", () => {
    const baseOpts = { desktopBreakpointPx: 768, maxWidthPx: 640 };
    const schema: FieldConfig[] = [
        { id: "title", type: "text", label: "Title" },
        { id: "len", type: "text", label: "Length", computed: "geometry.length" },
    ];

    beforeEach(() => {
        ComponentRegistry.register(textComponent);
        installI18n();
        stubMatchMedia(false);
    });

    afterEach(() => {
        document.body.querySelectorAll(".gl-form-modal-overlay").forEach((el) => el.remove());
        delete (globalThis as any).GeoLeaf;
    });

    const valueOf = (id: string): string =>
        document.body.querySelectorAll<HTMLInputElement>(".gl-form-input")[
            schema.findIndex((f) => f.id === id)
        ]!.value;

    it("seeds computed fields from the hook, called with the resolved schema", () => {
        const computeValues = vi.fn(() => ({ len: "1234" }));
        const modal = createResponsiveModal(baseOpts);
        modal.open({ title: "New", schema, onSave: vi.fn(), computeValues });

        expect(computeValues).toHaveBeenCalledExactlyOnceWith(schema);
        expect(valueOf("len")).toBe("1234");
        modal.close(true);
    });

    it("computed values win over initialValues for the same id", () => {
        const modal = createResponsiveModal(baseOpts);
        modal.open({
            title: "New",
            schema,
            onSave: vi.fn(),
            initialValues: { len: "stale", title: "kept" },
            computeValues: () => ({ len: "fresh" }),
        });

        expect(valueOf("len")).toBe("fresh");
        expect(valueOf("title")).toBe("kept"); // untouched keys survive
        modal.close(true);
    });

    it("is optional — omitting it leaves computed fields empty, as before S4", () => {
        const modal = createResponsiveModal(baseOpts);
        modal.open({ title: "New", schema, onSave: vi.fn() });
        expect(valueOf("len")).toBe("");
        modal.close(true);
    });

    it("re-derives computed values when the header slot changes layer", () => {
        // A layer change drops entered values (different fields) but must NOT drop
        // computed ones: they describe the geometry, which the layer change leaves
        // alone. Before the hook was wired into reloadBridge they went blank here.
        // Mirror createLayerDropdown's shape: the slot element WRAPS the select
        // (the modal reaches it with headerSlot.el.querySelector("select")).
        const slotEl = document.createElement("div");
        const selectEl = document.createElement("select");
        for (const id of ["layer-1", "layer-2"]) {
            const o = document.createElement("option");
            o.value = id;
            selectEl.appendChild(o);
        }
        slotEl.appendChild(selectEl);
        const computeValues = vi.fn(() => ({ len: "1234" }));
        const modal = createResponsiveModal({
            ...baseOpts,
            createHeaderSlot: () => ({ el: slotEl, getValue: () => selectEl.value }),
            getSchemaForLayer: () => schema,
        });
        modal.open({ title: "New", schema, onSave: vi.fn(), computeValues });

        selectEl.value = "layer-2";
        selectEl.dispatchEvent(new Event("change"));

        expect(computeValues).toHaveBeenCalledTimes(2);
        expect(valueOf("len")).toBe("1234");
        modal.close(true);
    });
});

describe("B-132 — le pont adresse un champ IMBRIQUÉ, pas seulement une clé plate", () => {
    /**
     * 🛑 `values[field.id]` est un accès PLAT, sur les quatre sites du pont (lecture,
     * écriture, remise à zéro d'un dépendant, validation). Un `id` pointé comme
     * `attributes.short_desc` y cherche une propriété LITTÉRALEMENT nommée
     * « attributes.short_desc », jamais le chemin.
     *
     * ⚠️ Le sujet vivant a disparu entre-temps — `candelabres`, la couche que la ligne
     * citait, n'est plus éditable depuis la tâche 7.2, et la seule couche éditable
     * (`sites_rosario`) n'utilise que des chemins `properties.*`, aplatis en amont par
     * `attributesToFormSchema`. Le défaut est LATENT : il mord au premier profil qui
     * déclare un champ capturable sous un autre objet.
     *
     * 🛑 UNE PREMIÈRE VERSION DE CETTE GARDE PASSAIT AVANT LE CORRECTIF. Elle assertait
     * sur `getValues()`, qui recopie `initialValues` en bloc — la forme imbriquée y était
     * donc présente sans que le pont ait résolu quoi que ce soit. Elle porte désormais sur
     * ce que le COMPOSANT reçoit et sur l'endroit où la saisie ATTERRIT, les deux seuls
     * points que `values[field.id]` gouverne.
     */
    let seen: unknown;
    let emit: ((v: unknown) => void) | null;

    /** Composant sonde : capture l'initial reçu et expose son `onChange`. */
    const probe = {
        id: "b132probe",
        defaults: undefined as unknown,
        formRender(initial: unknown, _f: unknown, onChange: (v: unknown) => void) {
            seen = initial;
            emit = onChange;
            return document.createElement("div");
        },
    };

    beforeEach(() => {
        installI18n();
        seen = undefined;
        emit = null;
        ComponentRegistry.register(probe as never);
    });

    const schema = (id: string): FieldConfig[] => [{ id, type: "b132probe", label: id }];

    it("le composant REÇOIT la valeur qui est au bout du chemin", () => {
        createFieldRendererBridge(
            schema("attributes.short_desc"),
            { attributes: { short_desc: "vu" } },
            {} as never
        );
        expect(seen).toBe("vu");
    });

    it("le TÉMOIN plat reçoit la sienne — la garde ne passerait pas sur un pont muet", () => {
        createFieldRendererBridge(schema("titre"), { titre: "témoin" }, {} as never);
        expect(seen).toBe("témoin");
    });

    it("la saisie ATTERRIT au bout du chemin, pas sous une clé littérale pointée", () => {
        const bridge = createFieldRendererBridge(
            schema("attributes.short_desc"),
            { attributes: { short_desc: "avant" } },
            {} as never
        );
        emit?.("après");
        const v = bridge.getValues();
        expect((v["attributes"] as Record<string, unknown>)["short_desc"]).toBe("après");
        expect(v["attributes.short_desc"]).toBeUndefined();
    });

    it("elle CRÉE les niveaux manquants plutôt que d'écrire à plat", () => {
        const bridge = createFieldRendererBridge(schema("meta.bloc.champ"), {}, {} as never);
        emit?.("écrit");
        const v = bridge.getValues();
        expect(
            ((v["meta"] as Record<string, Record<string, unknown>>) ?? {})["bloc"]?.["champ"]
        ).toBe("écrit");
    });

    it("une clé LITTÉRALE pointée l'emporte — le changement reste purement additif", () => {
        // Ce qui marchait avant doit continuer : un consommateur qui range réellement sa
        // valeur sous la clé "a.b" ne doit pas la voir déménager dans un objet imbriqué.
        createFieldRendererBridge(schema("a.b"), { "a.b": "littérale" }, {} as never);
        expect(seen).toBe("littérale");
    });
});
