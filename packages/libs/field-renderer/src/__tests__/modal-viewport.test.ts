/**
 * Witness — the form follows the VISUAL viewport, so an on-screen keyboard never hides it.
 *
 * ## What this file pins
 *
 * A mobile browser shrinks the visual viewport, not the layout viewport, when its keyboard opens
 * or the page pans under it. The modal's overlay therefore tracks `window.visualViewport` — its
 * offset and size, published as custom properties on the overlay — and releases that tracking on
 * every way out: a listener left on `visualViewport` after close would keep writing into a
 * detached overlay for the rest of the page's life.
 *
 * The CSS that consumes those properties is proven in a real browser
 * (`e2e/42-form-drawer-keyboard.touch.spec.js`): happy-dom applies no stylesheet and lays nothing
 * out, so the geometry a phone would report is stubbed where a case needs it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createResponsiveModal, type ResponsiveModal } from "../ui/responsive-modal.js";
import { ComponentRegistry } from "../registry.js";
import { textComponent } from "../types/text.js";
import type { FieldConfig } from "../contract.js";

function installI18n(): void {
    (globalThis as any).GeoLeaf = {
        ...(globalThis as any).GeoLeaf,
        I18n: { t: vi.fn((key: string) => key), lang: "fr" },
    };
}

/** `true` puts the modal in drawer mode (phone width), `false` in centred mode. */
function stubMatchMedia(matches: boolean): void {
    (globalThis as any).window.matchMedia = vi.fn(() => ({
        matches,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    }));
}

/** A controllable visual viewport — happy-dom has none. */
function installVisualViewport() {
    const vv = Object.assign(new EventTarget(), {
        width: 390,
        height: 844,
        offsetTop: 0,
        offsetLeft: 0,
        scale: 1,
    });
    const add = vi.spyOn(vv, "addEventListener");
    const remove = vi.spyOn(vv, "removeEventListener");
    Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
    return { vv, add, remove };
}

const schema: FieldConfig[] = [{ id: "title", type: "text", label: "Title", required: false }];
const baseOpts = { desktopBreakpointPx: 768, maxWidthPx: 640 };
const overlay = () => document.body.querySelector<HTMLElement>(".gl-form-modal-overlay");
const prop = (el: HTMLElement | null, name: string) => el?.style.getPropertyValue(name) ?? "";
/** Lets queued microtasks (await continuations) settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
    ComponentRegistry.register(textComponent);
    installI18n();
    stubMatchMedia(true);
});

afterEach(() => {
    document.body.querySelectorAll(".gl-form-modal-overlay").forEach((el) => el.remove());
    delete (globalThis as any).GeoLeaf;
    Reflect.deleteProperty(window, "visualViewport");
    vi.restoreAllMocks();
});

describe("responsive modal — following the visual viewport", () => {
    it("without visualViewport, nothing is tracked and nothing throws", () => {
        const modal = createResponsiveModal(baseOpts);
        expect(() => modal.open({ title: "New", schema, onSave: vi.fn() })).not.toThrow();
        expect(overlay()?.classList.contains("gl-form-modal-overlay--viewport")).toBe(false);
        expect(prop(overlay(), "--gl-form-viewport-height")).toBe("");
        modal.close(true);
    });

    it.each([
        ["drawer", true],
        ["centred modal", false],
    ])("publishes the visual viewport on the overlay — %s", (_mode, mobile) => {
        stubMatchMedia(mobile);
        installVisualViewport();
        const modal = createResponsiveModal(baseOpts);
        modal.open({ title: "New", schema, onSave: vi.fn() });

        const el = overlay();
        expect(el?.classList.contains("gl-form-modal-overlay--viewport")).toBe(true);
        expect(prop(el, "--gl-form-viewport-top")).toBe("0px");
        expect(prop(el, "--gl-form-viewport-left")).toBe("0px");
        expect(prop(el, "--gl-form-viewport-width")).toBe("390px");
        expect(prop(el, "--gl-form-viewport-height")).toBe("844px");
        modal.close(true);
    });

    it("a keyboard (resize) and a pan (scroll) update the published viewport", () => {
        const { vv } = installVisualViewport();
        const modal = createResponsiveModal(baseOpts);
        modal.open({ title: "New", schema, onSave: vi.fn() });

        vv.height = 508;
        vv.dispatchEvent(new Event("resize"));
        expect(prop(overlay(), "--gl-form-viewport-height")).toBe("508px");

        vv.offsetTop = 120;
        vv.dispatchEvent(new Event("scroll"));
        expect(prop(overlay(), "--gl-form-viewport-top")).toBe("120px");
        modal.close(true);
    });

    const exits: [string, (modal: ResponsiveModal) => void | Promise<void>][] = [
        ["close(true)", (modal) => modal.close(true)],
        [
            "the Cancel button",
            () =>
                document.body
                    .querySelector<HTMLButtonElement>(".gl-form-modal__btn-cancel")
                    ?.click(),
        ],
        [
            "a successful save",
            async () => {
                document.body.querySelector<HTMLButtonElement>(".gl-form-modal__btn-save")?.click();
                await flush();
            },
        ],
        ["destroy()", (modal) => modal.destroy()],
        [
            "open() over an open form",
            (modal) => modal.open({ title: "Again", schema, onSave: vi.fn() }),
        ],
    ];

    it.each(exits)("%s releases the very listeners it added", async (_exit, leave) => {
        const { vv, add, remove } = installVisualViewport();
        const modal = createResponsiveModal(baseOpts);
        modal.open({ title: "New", schema, onSave: vi.fn() });
        const first = overlay();

        await leave(modal);

        for (const type of ["resize", "scroll"]) {
            const added = add.mock.calls.find(([t]) => t === type)?.[1];
            expect(added, `no \`${type}\` listener was added`).toBeTypeOf("function");
            expect(
                remove.mock.calls.some(([t, listener]) => t === type && listener === added),
                `the \`${type}\` listener was not released`
            ).toBe(true);
        }
        // What a leaked listener would do: keep writing into the overlay that is gone.
        vv.height = 400;
        vv.dispatchEvent(new Event("resize"));
        expect(prop(first, "--gl-form-viewport-height")).not.toBe("400px");
        modal.close(true);
    });

    it("re-opening does not stack listeners", () => {
        const { add, remove } = installVisualViewport();
        const live = (type: string) =>
            add.mock.calls.filter(([t]) => t === type).length -
            remove.mock.calls.filter(([t]) => t === type).length;
        const modal = createResponsiveModal(baseOpts);

        modal.open({ title: "New", schema, onSave: vi.fn() });
        modal.close(true);
        modal.open({ title: "New", schema, onSave: vi.fn() });
        expect(live("resize")).toBe(1);
        expect(live("scroll")).toBe(1);

        modal.close(true);
        expect(live("resize")).toBe(0);
        expect(live("scroll")).toBe(0);
    });

    /**
     * The body spans 100–500 and the focused field sits at 560–596, below it: the field must be
     * scrolled up by its overflow (96) plus a margin (8).
     */
    function stubHiddenField() {
        const body = document.body.querySelector<HTMLElement>(".gl-form-modal__body")!;
        const input = body.querySelector<HTMLInputElement>("input")!;
        input.focus();
        vi.spyOn(body, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 100, 390, 400));
        vi.spyOn(input, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 560, 370, 36));
        body.scrollTop = 0;
        return { body, input };
    }

    it("brings the focused field back inside the form's body when the keyboard opens", () => {
        const { vv } = installVisualViewport();
        const modal = createResponsiveModal(baseOpts);
        modal.open({ title: "New", schema, onSave: vi.fn() });
        const { body } = stubHiddenField();

        vv.height = 508;
        vv.dispatchEvent(new Event("resize"));

        expect(body.scrollTop).toBe(104);
        modal.close(true);
    });

    it("brings a field focused later back inside the form's body", () => {
        installVisualViewport();
        const modal = createResponsiveModal(baseOpts);
        modal.open({ title: "New", schema, onSave: vi.fn() });
        const { body, input } = stubHiddenField();

        input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

        expect(body.scrollTop).toBe(104);
        modal.close(true);
    });
});
