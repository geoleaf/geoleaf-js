/**
 * `types/dropdown.ts` — an option list loaded by URL, off-network.
 *
 * A dropdown declaring `fetchOptions` fetched its list at every render, with no cache. Off
 * the network it showed its placeholder alone: the list was empty, the SAVED value invisible
 * (it matched no option), and a field meant to be read-only became editable again when the
 * loading indicator went away.
 *
 * The library cannot keep a list itself: persisting would pull IndexedDB into a field
 * renderer (decision D5 of `docs/specs/libs/field-renderer.md`). A HOST can, and injects how
 * through `setOptionsResolver` — the pattern of `setImageUploadStrategy`. The resolver answers
 * first; when it has nothing (`null`), the component fetches as before.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { FieldConfig, RenderCtx } from "../contract.js";
import { dropdownComponent } from "../types/dropdown.js";
import { setOptionsResolver } from "../index.js";

const CTX: RenderCtx = { lang: "fr" };
const CTX_RO: RenderCtx = { lang: "fr", readOnly: true };
const URL_ = "https://lists.example/statut.json";
const LIST = [
    { value: "open", label: "Ouvert" },
    { value: "closed", label: "Fermé" },
];

function field(overrides: Partial<FieldConfig> = {}): FieldConfig {
    return { id: "statut", type: "dropdown", label: "Statut", fetchOptions: URL_, ...overrides };
}

/** Lets the pending promise chain settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

/** The options the select offers, placeholder excluded. */
function offered(el: HTMLElement): string[] {
    return [...el.querySelectorAll("option")].map((o) => o.value).filter((v) => v !== "");
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    document.body.innerHTML = "";
    fetchMock = vi.fn(async () => {
        throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
    setOptionsResolver(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("a host resolver answers first", () => {
    it("its list is shown, and the network is not asked", async () => {
        const resolver = vi.fn(async () => LIST);
        setOptionsResolver(resolver);
        const el = dropdownComponent.formRender!("", field(), vi.fn(), CTX);
        await settle();
        expect(resolver).toHaveBeenCalledWith(URL_);
        expect(offered(el)).toEqual(["open", "closed"]);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("a resolver with nothing (`null`) lets the component fetch, as before", async () => {
        setOptionsResolver(async () => null);
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => LIST });
        const el = dropdownComponent.formRender!("", field(), vi.fn(), CTX);
        await settle();
        expect(fetchMock).toHaveBeenCalledWith(URL_);
        expect(offered(el)).toEqual(["open", "closed"]);
    });
});

describe("with no list at all, the saved value stays visible", () => {
    it("the value the entity holds is offered and selected, and the failure said", async () => {
        const el = dropdownComponent.formRender!("closed", field(), vi.fn(), CTX);
        await settle();
        const select = el.querySelector("select")!;
        expect(select.value).toBe("closed");
        expect(offered(el)).toEqual(["closed"]);
        expect(el.querySelector<HTMLElement>(".gl-form-error")!.hidden).toBe(false);
    });

    it("a value the received list no longer carries is kept, not replaced by the placeholder", async () => {
        setOptionsResolver(async () => LIST);
        const el = dropdownComponent.formRender!("archived", field(), vi.fn(), CTX);
        await settle();
        expect(el.querySelector("select")!.value).toBe("archived");
        expect(offered(el)).toEqual(["open", "closed", "archived"]);
    });
});

describe("the static list is the fallback it looks like", () => {
    it("declared beside `fetchOptions`, it is offered when the list cannot be loaded — no error", async () => {
        const el = dropdownComponent.formRender!(
            "open",
            field({ options: [{ value: "open", label: "Ouvert (hors ligne)" }] }),
            vi.fn(),
            CTX
        );
        await settle();
        expect(offered(el)).toEqual(["open"]);
        expect(el.querySelector("select")!.value).toBe("open");
        expect(el.querySelector<HTMLElement>(".gl-form-error")!.hidden).toBe(true);
    });
});

describe("read-only stays read-only", () => {
    it("after a failure", async () => {
        const el = dropdownComponent.formRender!("closed", field(), vi.fn(), CTX_RO);
        await settle();
        expect(el.querySelector("select")!.disabled).toBe(true);
    });

    it("after a success", async () => {
        setOptionsResolver(async () => LIST);
        const el = dropdownComponent.formRender!("closed", field(), vi.fn(), CTX_RO);
        await settle();
        expect(el.querySelector("select")!.disabled).toBe(true);
    });
});
