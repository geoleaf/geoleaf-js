/**
 * The editor hands the dropdowns of its forms the core's kept option lists.
 *
 * `@geoleaf/field-renderer` cannot keep a list itself (decision D5 of its spec); the core can
 * (`GeoLeaf.Storage.resolveOptions`, which keeps lists where the cache budget evicts nothing).
 * The editor is the host that renders the forms, so it is the one that joins the two — the
 * pattern of `initImageUpload`. Without it, a field loading its choices from a URL shows its
 * placeholder alone off-network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dropdownComponent } from "@geoleaf/field-renderer";

import { destroyOptionLists, initOptionLists } from "../persistence/option-lists.js";

const _g = globalThis as any;
const URL_ = "https://lists.example/statut.json";
const LIST = [{ value: "open", label: "Ouvert" }];
const settle = () => new Promise((r) => setTimeout(r, 0));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    fetchMock = vi.fn(async () => {
        throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
    destroyOptionLists();
    delete _g.GeoLeaf;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const render = () =>
    dropdownComponent.formRender!(
        "",
        { id: "statut", type: "dropdown", label: "Statut", fetchOptions: URL_ },
        vi.fn(),
        { lang: "fr" }
    );
const offered = (el: HTMLElement) =>
    [...el.querySelectorAll("option")].map((o) => o.value).filter(Boolean);

describe("a dropdown in an editor form reads the core's kept list", () => {
    it("the list comes from GeoLeaf.Storage.resolveOptions, with no request", async () => {
        const resolveOptions = vi.fn(async () => LIST);
        _g.GeoLeaf = { Storage: { resolveOptions } };
        initOptionLists();
        const el = render();
        await settle();
        expect(resolveOptions).toHaveBeenCalledWith(URL_);
        expect(offered(el)).toEqual(["open"]);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("a core without the member lets the dropdown fetch, as before", async () => {
        _g.GeoLeaf = { Storage: {} };
        initOptionLists();
        render();
        await settle();
        expect(fetchMock).toHaveBeenCalledWith(URL_);
    });

    it("destroy hands the dropdowns back to the network", async () => {
        const resolveOptions = vi.fn(async () => LIST);
        _g.GeoLeaf = { Storage: { resolveOptions } };
        initOptionLists();
        destroyOptionLists();
        render();
        await settle();
        expect(resolveOptions).not.toHaveBeenCalled();
    });
});
