/**
 * Tests for S6 modal components — Sprint S6
 * Covers: focus-trap, layer-dropdown, field-renderer-bridge,
 *         editor-form-modal.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createLayerDropdown } from "../modal/layer-dropdown.js";
import { createEditorFormModal } from "../modal/editor-form-modal.js";
import { EDITOR_CONFIG_DEFAULTS } from "../config.js";
import type { EditorConfig } from "../types.js";
import { createFocusTrap } from "@geoleaf/host-runtime";
import {
    createFieldRendererBridge,
    ComponentRegistry,
    textComponent,
} from "@geoleaf/field-renderer";
import type { FieldConfig } from "@geoleaf/field-renderer";

/** Maps an EditorConfig to ResponsiveModalOptions (mirrors the production mapping in entry.ts). */
function cfgToModalOpts(cfg: EditorConfig) {
    return {
        desktopBreakpointPx: cfg.modal?.desktopBreakpointPx,
        maxWidthPx: cfg.modal?.maxWidthPx,
        confirmCancelOnDirty: cfg.confirmCancelOnDirty,
        createHeaderSlot: (geomType?: string) => createLayerDropdown(cfg, geomType),
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CFG: EditorConfig = {
    ...EDITOR_CONFIG_DEFAULTS,
    modal: { desktopBreakpointPx: 768, maxWidthPx: 640 },
    confirmDelete: true,
    confirmCancelOnDirty: true,
    defaultLayer: null,
};

function makeLayers(
    overrides?: Partial<{
        id: string;
        edition: { create?: boolean; update?: boolean; delete?: boolean };
        editableGeometryTypes: string[];
    }>[]
) {
    return (
        overrides ?? [
            {
                id: "layer-a",
                label: "Layer A",
                edition: { create: true, update: true },
                editableGeometryTypes: ["point", "polygon"],
            },
            {
                id: "layer-b",
                label: "Layer B",
                edition: { create: true, update: true },
                editableGeometryTypes: ["line"],
            },
            { id: "layer-c", label: "Layer C", edition: { create: false, update: false } },
        ]
    );
}

function installGeoLeafWithLayers(layers: ReturnType<typeof makeLayers>): void {
    (globalThis as any).GeoLeaf = {
        ...(globalThis as any).GeoLeaf,
        Core: {
            getMap: vi.fn(() => ({ getNativeMap: vi.fn(() => null) })),
        },
        Config: {
            getActiveProfile: vi.fn(() => ({ layers })),
        },
        I18n: {
            registerDict: vi.fn(),
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
// focus-trap
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
// layer-dropdown
// ---------------------------------------------------------------------------

describe("createLayerDropdown", () => {
    beforeEach(() => installGeoLeafWithLayers(makeLayers()));
    afterEach(() => {
        delete (globalThis as any).GeoLeaf;
    });

    it("returns a wrapper element with a select inside", () => {
        const dd = createLayerDropdown(CFG);
        expect(dd.el).toBeInstanceOf(HTMLElement);
        expect(dd.el.querySelector("select")).not.toBeNull();
    });

    it("only shows layers granting edition.create or edition.update", () => {
        const dd = createLayerDropdown(CFG);
        const options = Array.from(dd.el.querySelectorAll<HTMLOptionElement>("option"));
        const ids = options.map((o) => o.value);
        expect(ids).toContain("layer-a");
        expect(ids).toContain("layer-b");
        expect(ids).not.toContain("layer-c");
    });

    it("filters by geometryType when provided", () => {
        const dd = createLayerDropdown(CFG, "line");
        const options = Array.from(dd.el.querySelectorAll<HTMLOptionElement>("option"));
        const ids = options.map((o) => o.value);
        expect(ids).toContain("layer-b");
        expect(ids).not.toContain("layer-a");
    });

    it("respects cfg.defaultLayer", () => {
        const cfg = { ...CFG, defaultLayer: "layer-b" };
        const dd = createLayerDropdown(cfg);
        expect(dd.getValue()).toBe("layer-b");
    });

    it("shows a placeholder and selects nothing when several layers and no defaultLayer", () => {
        // makeLayers() exposes two editable layers (a + b) → placeholder expected.
        const dd = createLayerDropdown(CFG);
        const opts = Array.from(dd.el.querySelectorAll<HTMLOptionElement>("option"));
        const placeholder = opts.find((o) => o.value === "");
        expect(placeholder).toBeDefined();
        expect(placeholder!.disabled).toBe(true);
        expect(dd.getValue()).toBeNull();
    });

    it("pre-selects the single editable layer (no placeholder)", () => {
        installGeoLeafWithLayers([
            {
                id: "only",
                edition: { create: true, update: true },
                editableGeometryTypes: ["point"],
            },
        ]);
        const dd = createLayerDropdown(CFG);
        const opts = Array.from(dd.el.querySelectorAll<HTMLOptionElement>("option"));
        expect(opts.map((o) => o.value)).not.toContain("");
        expect(dd.getValue()).toBe("only");
    });

    it("setValue() changes the selected value", () => {
        const dd = createLayerDropdown(CFG);
        dd.setValue("layer-b");
        expect(dd.getValue()).toBe("layer-b");
    });

    it("setValue() ignores unknown layer ids", () => {
        const dd = createLayerDropdown(CFG);
        dd.setValue("unknown-id");
        expect(dd.getValue()).not.toBe("unknown-id");
    });

    it("shows a disabled empty option when no layers available", () => {
        installGeoLeafWithLayers([{ id: "x", edition: { create: false, update: false } }]);
        const dd = createLayerDropdown(CFG);
        const opts = dd.el.querySelectorAll<HTMLOptionElement>("option");
        expect(opts.length).toBe(1);
        expect(opts[0]!.disabled).toBe(true);
        expect(dd.getValue()).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// field-renderer-bridge
// ---------------------------------------------------------------------------

describe("createFieldRendererBridge", () => {
    beforeEach(() => ComponentRegistry.register(textComponent));

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
// delete-confirm-modal — SUPPRIMÉ à la tâche 5.2
// ---------------------------------------------------------------------------
//
// 97 lignes qui réimplémentaient `confirmDialog` de `@geoleaf/field-renderer` — même DOM,
// mêmes classes, même piège de focus. Ses 7 tests sont PORTÉS dans
// `packages/libs/field-renderer/src/__tests__/confirm-dialog.test.ts`, où le comportement
// vit désormais : la fonction partagée n'avait aucun test, donc les supprimer ici sans les
// porter aurait retiré l'unique couverture d'une action destructive.

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// editor-form-modal
// ---------------------------------------------------------------------------

describe("createEditorFormModal", () => {
    beforeEach(() => {
        ComponentRegistry.register(textComponent);
        installGeoLeafWithLayers(makeLayers());
        stubMatchMedia(false); // Desktop by default
    });

    afterEach(() => {
        document.body.querySelectorAll(".gl-form-modal-overlay").forEach((el) => el.remove());
        delete (globalThis as any).GeoLeaf;
    });

    const schema: FieldConfig[] = [{ id: "title", type: "text", label: "Title", required: false }];

    it("isOpen() returns false before open()", () => {
        const modal = createEditorFormModal(cfgToModalOpts(CFG));
        expect(modal.isOpen()).toBe(false);
    });

    it("open() mounts the overlay in document.body", () => {
        const modal = createEditorFormModal(cfgToModalOpts(CFG));
        modal.open({ title: "New feature", schema, onSave: vi.fn() });
        expect(document.body.querySelector(".gl-form-modal-overlay")).not.toBeNull();
        expect(modal.isOpen()).toBe(true);
        modal.close(true);
    });

    it("close(true) removes the overlay and sets isOpen() to false", () => {
        const modal = createEditorFormModal(cfgToModalOpts(CFG));
        modal.open({ title: "New feature", schema, onSave: vi.fn() });
        modal.close(true);
        expect(document.body.querySelector(".gl-form-modal-overlay")).toBeNull();
        expect(modal.isOpen()).toBe(false);
    });

    it("close(true) fires onCancel callback", () => {
        const onCancel = vi.fn();
        const modal = createEditorFormModal(cfgToModalOpts(CFG));
        modal.open({ title: "New", schema, onSave: vi.fn(), onCancel });
        modal.close(true);
        expect(onCancel).toHaveBeenCalledOnce();
    });

    it("clicking cancel button closes the modal without dirty check when not dirty", () => {
        const modal = createEditorFormModal(cfgToModalOpts(CFG));
        modal.open({ title: "New", schema, onSave: vi.fn() });
        const btn = document.body.querySelector<HTMLButtonElement>(".gl-form-modal__btn-cancel")!;
        btn.click();
        expect(modal.isOpen()).toBe(false);
    });

    it("clicking Save calls onSave with form values and layerId", () => {
        const onSave = vi.fn();
        const modal = createEditorFormModal(cfgToModalOpts(CFG));
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
        const modal = createEditorFormModal(cfgToModalOpts(CFG));
        modal.open({ title: "New", schema: requiredSchema, initialValues: { name: "" }, onSave });
        const btn = document.body.querySelector<HTMLButtonElement>(".gl-form-modal__btn-save")!;
        btn.click();
        expect(onSave).not.toHaveBeenCalled();
        modal.close(true);
    });

    it("modal has role=dialog and aria-modal=true on the panel", () => {
        const modal = createEditorFormModal(cfgToModalOpts(CFG));
        modal.open({ title: "New", schema, onSave: vi.fn() });
        const panel = document.body.querySelector<HTMLElement>(".gl-form-modal-panel")!;
        expect(panel.getAttribute("role")).toBe("dialog");
        expect(panel.getAttribute("aria-modal")).toBe("true");
        modal.close(true);
    });

    it("open() applied --drawer class when matchMedia.matches is true", () => {
        stubMatchMedia(true); // Mobile
        const modal = createEditorFormModal(cfgToModalOpts(CFG));
        modal.open({ title: "New", schema, onSave: vi.fn() });
        const panel = document.body.querySelector<HTMLElement>(".gl-form-modal-panel")!;
        expect(panel.classList.contains("gl-form-modal-panel--drawer")).toBe(true);
        modal.close(true);
    });

    it("destroy() closes modal if open", () => {
        const modal = createEditorFormModal(cfgToModalOpts(CFG));
        modal.open({ title: "New", schema, onSave: vi.fn() });
        modal.destroy();
        expect(modal.isOpen()).toBe(false);
    });

    it("confirmCancelOnDirty shows a styled JS confirm dialog and keeps the form open on 'keep editing'", () => {
        const modal = createEditorFormModal(cfgToModalOpts(CFG));
        modal.open({ title: "New", schema, initialValues: { title: "original" }, onSave: vi.fn() });

        // Simulate dirty state by changing the input value
        const input = document.body.querySelector<HTMLInputElement>("input")!;
        input.value = "something else";
        input.dispatchEvent(new Event("input", { bubbles: true }));

        document.body.querySelector<HTMLButtonElement>(".gl-form-modal__btn-cancel")!.click();

        // Styled JS dialog mounted (replaces the native window.confirm).
        const dialog = document.body.querySelector(".gl-form-modal-confirm");
        expect(dialog).not.toBeNull();

        // Keep editing → form stays open.
        dialog!.querySelector<HTMLButtonElement>(".gl-form-modal__btn-cancel")!.click();
        expect(modal.isOpen()).toBe(true);

        modal.close(true);
    });
});

// ---------------------------------------------------------------------------
// editor-form-modal — getSchemaForLayer (layer-driven schema)
// Regression: the boot modal omitted getSchemaForLayer, so the form fell back
// to the empty ModalOpenOptions.schema ([]) and rendered an empty body.
// ---------------------------------------------------------------------------

describe("createEditorFormModal — getSchemaForLayer", () => {
    beforeEach(() => {
        ComponentRegistry.register(textComponent);
        installGeoLeafWithLayers(makeLayers());
        stubMatchMedia(false);
    });

    afterEach(() => {
        document.body.querySelectorAll(".gl-form-modal-overlay").forEach((el) => el.remove());
        delete (globalThis as any).GeoLeaf;
    });

    const schemaByLayer: Record<string, FieldConfig[]> = {
        "layer-a": [
            { id: "nom", type: "text", label: "Nom", required: true },
            { id: "desc", type: "text", label: "Description" },
        ],
        "layer-b": [{ id: "ref", type: "text", label: "Ref" }],
    };

    function optsWithSchema() {
        return {
            ...cfgToModalOpts(CFG),
            getSchemaForLayer: (layerId: string) => schemaByLayer[layerId] ?? [],
        };
    }

    it("renders the schema of the single pre-selected layer, ignoring options.schema", () => {
        // A single editable layer is auto-selected → its schema renders at open,
        // even though options.schema is empty (as set by events.ts).
        installGeoLeafWithLayers([
            {
                id: "layer-a",
                edition: { create: true, update: true },
                editableGeometryTypes: ["point"],
            },
        ]);
        const modal = createEditorFormModal(optsWithSchema());
        modal.open({ title: "", schema: [], onSave: vi.fn() });
        const inputs = document.body.querySelectorAll(".gl-form-modal__body input");
        expect(inputs.length).toBe(2);
        modal.close(true);
    });

    it("renders an empty form until a layer is picked when several layers exist", () => {
        // makeLayers() → two editable layers → placeholder selected, no schema yet.
        const modal = createEditorFormModal(optsWithSchema());
        modal.open({ title: "", schema: [], onSave: vi.fn() });
        const inputs = document.body.querySelectorAll(".gl-form-modal__body input");
        expect(inputs.length).toBe(0);
        modal.close(true);
    });

    it("reloads the form when the layer dropdown changes", () => {
        const modal = createEditorFormModal(optsWithSchema());
        modal.open({ title: "", schema: [], onSave: vi.fn() });
        const select = document.body.querySelector<HTMLSelectElement>(
            ".gl-form-modal__header select"
        )!;
        select.value = "layer-b";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        const inputs = document.body.querySelectorAll(".gl-form-modal__body input");
        expect(inputs.length).toBe(1);
        modal.close(true);
    });
});
