/**
 * Option lists kept for off-network use — the `fetchOptions` of a dropdown field.
 *
 * A dropdown loading its choices from a URL had no copy of them anywhere the device keeps:
 * the service worker may hold one, network-first, never for an authenticated request, and
 * lost at each release. Off the network the field showed its placeholder alone.
 *
 * The lists are kept in the `preferences` store, and NOT in `layers` — where the offline
 * preparation keeps its other resources — because `layers` is the store the cache budget
 * evicts, oldest first, and configuration resources are downloaded first: a list stored
 * there would be the first thing to go (`db/eviction.ts`, whose scope is asserted by
 * `schema-v4.test.js`). `preferences` is evicted by nothing.
 *
 * Cache first: a held list is answered at once; online, it is refreshed behind the answer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
    prefetchOptionLists,
    resolveOptionList,
} from "../../../src/capabilities/offline/options/option-lists.js";
import { IndexedDB, clearMockStore } from "../../__mocks__/indexeddb.js";

const LIST = [
    { value: "open", label: "Ouvert" },
    { value: "closed", label: "Fermé" },
];
const URL_ = "https://lists.example/statut.json";

let online: boolean;
let fetchMock: ReturnType<typeof vi.fn>;

/** Lets background work settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

function answer(body: unknown, ok = true) {
    return { ok, status: ok ? 200 : 500, json: async () => body };
}

beforeEach(() => {
    clearMockStore();
    online = true;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    fetchMock = vi.fn(async () => answer(LIST));
    vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/** What was written to `preferences`, by key. */
function kept(setPreference: ReturnType<typeof vi.spyOn>): Map<string, unknown> {
    return new Map(setPreference.mock.calls.map(([k, v]: unknown[]) => [String(k), v]));
}

describe("where a list is kept", () => {
    it("a list fetched online is kept under its absolute URL, in `preferences` — never in `layers`", async () => {
        const cacheLayer = vi.spyOn(IndexedDB, "cacheLayer");
        const setPreference = vi.spyOn(IndexedDB, "setPreference");
        expect(await resolveOptionList(URL_)).toEqual(LIST);
        expect(kept(setPreference).get(`offline.optionList:${URL_}`)).toMatchObject({
            options: LIST,
        });
        expect(cacheLayer).not.toHaveBeenCalled();
    });

    it("a relative URL and its absolute form are one list", async () => {
        await resolveOptionList("lists/a.json");
        online = false;
        expect(await resolveOptionList(new URL("lists/a.json", document.baseURI).href)).toEqual(
            LIST
        );
    });
});

describe("cache first", () => {
    it("off-network, a held list is answered and the network is not asked", async () => {
        await resolveOptionList(URL_);
        fetchMock.mockClear();
        online = false;
        expect(await resolveOptionList(URL_)).toEqual(LIST);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("online, a held list is answered at once, and refreshed behind the answer", async () => {
        await resolveOptionList(URL_);
        const newer = [...LIST, { value: "works", label: "En travaux" }];
        fetchMock.mockResolvedValueOnce(answer(newer));
        expect(await resolveOptionList(URL_)).toEqual(LIST);
        await settle();
        expect(await resolveOptionList(URL_)).toEqual(newer);
    });

    it("off-network with nothing held, it answers null — and asks nothing", async () => {
        online = false;
        expect(await resolveOptionList(URL_)).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("what is not a list is not kept", () => {
    it.each([
        ["an object", { options: LIST }],
        ["items without a value", [{ label: "x" }]],
        ["a failed answer", null],
    ])("%s", async (_what, body) => {
        const setPreference = vi.spyOn(IndexedDB, "setPreference");
        fetchMock.mockResolvedValueOnce(answer(body, body !== null));
        expect(await resolveOptionList(URL_)).toBeNull();
        expect(setPreference).not.toHaveBeenCalled();
    });

    it("numeric values are kept as text, the form a select holds", async () => {
        fetchMock.mockResolvedValueOnce(answer([{ value: 3, label: "Trois" }]));
        expect(await resolveOptionList(URL_)).toEqual([{ value: "3", label: "Trois" }]);
    });
});

describe("prefetch — the offline preparation", () => {
    it("keeps every list it can reach, and counts the others", async () => {
        const other = "https://lists.example/type.json";
        fetchMock.mockImplementation(async (url: string) =>
            url === other ? answer(null, false) : answer(LIST)
        );
        expect(await prefetchOptionLists([URL_, other, URL_])).toEqual({ stored: 1, failed: 1 });
        online = false;
        expect(await resolveOptionList(URL_)).toEqual(LIST);
    });
});
