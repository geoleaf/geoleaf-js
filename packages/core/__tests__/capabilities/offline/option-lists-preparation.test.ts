/**
 * The offline preparation fetches the option lists a profile declares — and keeps them where
 * nothing evicts them.
 *
 * ## Why both branches, and both keys
 *
 * Layers reach the enumerator by two paths — `_addConfigFileResources` for a layer carrying a
 * `configFile`, `_addInlineConfigResource` for a `layerTemplates` instance — and a resource
 * added to one only leaves the other family without it: that defect happened on this file for
 * the data, then was avoided for the styles. And a field declares its list either on the field
 * (`options.fetchOptions`) or on its edit block (`edit.options.fetchOptions`, which REPLACES
 * the field's bag in the editor's projection): both are read.
 *
 * ## Why the lists leave the download
 *
 * The downloader keeps what it fetches in the `layers` store — the one the cache budget
 * evicts. A list routed there would be evicted first; it is routed to `preferences` instead.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ResourceEnumerator } =
    await import("../../../src/capabilities/offline/cache/resource-enumerator.js");
const { CacheManager } = await import("../../../src/capabilities/offline/cache/cache-manager.js");
const { Downloader } = await import("../../../src/capabilities/offline/cache/downloader.js");
const { resolveOptionList } =
    await import("../../../src/capabilities/offline/options/option-lists.js");
const { clearMockStore } = await import("../../__mocks__/indexeddb.js");

type Res = { url: string; type: string; layerId?: string };
/** The enumerator's two private adders, reached for the case each one owns. */
type Adder = (this: unknown, ...args: unknown[]) => unknown;
const E = ResourceEnumerator as never as {
    _addConfigFileResources: Adder;
    _addInlineConfigResource: Adder;
};

/** The manager's private steps this suite stubs around the one under test. */
type Step = (...args: unknown[]) => Promise<unknown>;
type ManagerSteps = { _config: unknown } & Record<
    | "_loadProfileConfig"
    | "estimateProfileSize"
    | "getStorageQuota"
    | "_pullEntities"
    | "_saveManifest"
    | "_enforceCacheQuota",
    Step
>;

const LIST_A = "https://lists.example/statut.json";
const LIST_B = "https://lists.example/type.json";

/** A layer configuration declaring two lists: one on the field, one on its edit block. */
const ATTRIBUTES = {
    fields: [
        { field: "properties.statut", options: { fetchOptions: LIST_A } },
        {
            field: "properties.type",
            edit: { widget: "dropdown", options: { fetchOptions: LIST_B } },
        },
        { field: "properties.nom" },
    ],
};

const lists = (resources: Res[]) =>
    resources.filter((r) => r.type === "optionList").map((r) => r.url);

beforeEach(() => {
    clearMockStore();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("the enumerator lists every declared option list", () => {
    it("① a layer carrying a configFile — both keys", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => ({ ok: true, json: async () => ({ attributes: ATTRIBUTES }) }))
        );
        const resources: Res[] = [];
        await E._addConfigFileResources.call(
            ResourceEnumerator,
            resources,
            { id: "sites", configFile: "layers/sites/sites_config.json" },
            "tourism",
            "../profiles",
            { layerId: "sites" }
        );
        expect(lists(resources)).toEqual([LIST_A, LIST_B]);
        expect(
            resources.filter((r) => r.type === "optionList").every((r) => r.layerId === "sites")
        ).toBe(true);
    });

    it("② a layerTemplates instance — even one that declares no data file", () => {
        const resources: Res[] = [];
        E._addInlineConfigResource.call(
            ResourceEnumerator,
            resources,
            { id: "tpl", inlineConfig: { attributes: ATTRIBUTES } },
            "tourism",
            "../profiles",
            { layerId: "tpl" }
        );
        expect(lists(resources)).toEqual([LIST_A, LIST_B]);
    });
});

describe("cacheProfile keeps the lists out of the evictable store", () => {
    it("the downloader never sees them; `preferences` holds them", async () => {
        const LIST = [{ value: "open", label: "Ouvert" }];
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => ({ ok: true, json: async () => LIST }))
        );
        const config = {
            url: "../profiles/tourism/layers/sites/sites_config.json",
            type: "config",
        };
        vi.spyOn(ResourceEnumerator, "enumerateAll").mockResolvedValue([
            { url: LIST_A, type: "optionList", layerId: "sites" },
            config,
        ] as never);
        const download = vi
            .spyOn(Downloader, "cacheProfile")
            .mockResolvedValue({ profileId: "tourism" } as never);
        const cm = CacheManager as never as ManagerSteps;
        cm._config = { enableProfileCache: true };
        vi.spyOn(cm, "_loadProfileConfig").mockResolvedValue({});
        vi.spyOn(cm, "estimateProfileSize").mockResolvedValue({ totalSize: 0 });
        vi.spyOn(cm, "getStorageQuota").mockResolvedValue({ available: 0 });
        vi.spyOn(cm, "_pullEntities").mockResolvedValue(undefined);
        vi.spyOn(cm, "_saveManifest").mockResolvedValue(undefined);
        vi.spyOn(cm, "_enforceCacheQuota").mockResolvedValue(undefined);

        await CacheManager.cacheProfile("tourism");

        const handed = download.mock.calls[0]?.[2] as Res[];
        expect(handed).toEqual([config]);
        // Kept: off-network, it is answered with no request.
        vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
        expect(await resolveOptionList(LIST_A)).toEqual(LIST);
    });
});
