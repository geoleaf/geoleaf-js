/**
 * Regression tests for the Import tab of the offline cache modal.
 *
 * Bug A (introduced in S2 rewrite 68df50a5): ExportLogic.initializeCacheContent
 * built the cache control DOM via onAdd but never appended it to
 * #gl-cache-modal-body — it only cleared the body — leaving the Import tab blank.
 *
 * Bug B: the layer list was read from profile.json (`profile.layers`), but the
 * served profile.json has no `layers` array; layers live in the file referenced
 * by Files.layersFile (layers.json). resolveProfileLayers sources them correctly.
 */
"use strict";

import { ExportLogic } from "../ui/cache-button/export-logic.js";
import { ButtonControl } from "../ui/cache-button/button-control.js";
import { createElement } from "../utils/dom-helpers.js";
import { resolveProfileLayers } from "@core/config/profile-layers.js";
// `export-logic.js` imports `CacheControl` from `../../cache/cache-control.js`,
// which `vitest.config.ts:252` aliases to `__mocks__/empty-module.js` (an empty
// stub). We need to inject a working CacheControl into what export-logic resolves.
//
// This used to be done by importing the stub as a namespace and assigning onto it.
// That is invalid ESM — a module namespace object is sealed, and `import { X }`
// from a module that exports no `X` is a link-time error. It only ever worked
// because Vitest's transform turns namespaces into plain mutable objects.
// `no-import-assign` flagged it correctly (Q1.2).
//
// The holder is `vi.hoisted` because `vi.mock` factories are lifted above the
// imports and would otherwise close over an uninitialised binding.
const cacheControlStub = vi.hoisted(() => ({ CacheControl: undefined }));
vi.mock("../../__mocks__/empty-module.js", () => cacheControlStub);

// ── Bug A — the built cache control is mounted into the modal body ─────────────

describe("ExportLogic.initializeCacheContent — mounts the control (Bug A)", () => {
    let body;
    let built;

    beforeEach(() => {
        ButtonControl.init({ id: "map" }, { ui: { showCacheButton: true } });

        body = document.createElement("div");
        body.id = "gl-cache-modal-body";
        document.body.appendChild(body);

        built = document.createElement("div");
        cacheControlStub.CacheControl = {
            create: vi.fn(() => ({ onAdd: vi.fn(() => built) })),
        };
    });

    afterEach(() => {
        delete cacheControlStub.CacheControl;
        if (body && body.parentNode) body.parentNode.removeChild(body);
    });

    test("appends the .gl-cache-control element into #gl-cache-modal-body", () => {
        ExportLogic.initializeCacheContent();

        expect(cacheControlStub.CacheControl.create).toHaveBeenCalled();
        // The control must actually be in the DOM (the missing append was the bug).
        expect(body.querySelector(".gl-cache-control")).not.toBeNull();
        expect(body.contains(built)).toBe(true);
        expect(body.getAttribute("data-initialized")).toBe("true");
    });

    test("does not re-create the control when already initialized", () => {
        ExportLogic.initializeCacheContent();
        cacheControlStub.CacheControl.create.mockClear();
        // Second call hits the already-initialized branch.
        ExportLogic.initializeCacheContent();
        expect(cacheControlStub.CacheControl.create).not.toHaveBeenCalled();
    });
});

// ── Bug C — the layer table is appended INTO the CONFIG container ──────────────
// Regression: the layer-selector built its <table> with the CORE createElement
// (signature `(tag, props, ...children)`) but passed the container as the 3rd arg,
// so the container was appended AS A CHILD of the detached <table> — ripping
// `.gl-cache-layers__content` out of the modal and leaving CONFIG empty. The plugin
// createElement (`(tag, className, parent)`) appends the new element to the parent.

describe("layer-selector createElement signature (Bug C: empty CONFIG)", () => {
    test("createElement(tag, className, parent) appends the new element INTO parent", () => {
        const container = document.createElement("div");
        container.className = "gl-cache-layers__content";

        const table = createElement("table", "gl-cache-layers__table", container);

        // The table is inside the container — NOT the other way around.
        expect(container.contains(table)).toBe(true);
        expect(table.contains(container)).toBe(false);
        expect(container.querySelector("table.gl-cache-layers__table")).toBe(table);
        // Container stays put (not detached/moved).
        expect(table.parentElement).toBe(container);
    });
});

// ── Bug B — resolveProfileLayers sources layers from Files.layersFile ──────────

describe("resolveProfileLayers (Bug B)", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    test("returns inlined profile.layers unchanged when present", async () => {
        const layers = [{ id: "a", configFile: "x.json" }];
        const res = await resolveProfileLayers({ layers }, "p", "profiles");
        expect(res).toBe(layers);
    });

    test("fetches Files.layersFile (leading slash) when layers are absent", async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            json: async () => ({ layers: [{ id: "gares", configFile: "c.json" }] }),
        }));
        vi.stubGlobal("fetch", fetchMock);

        const res = await resolveProfileLayers(
            { Files: { layersFile: "layers.json" } },
            "france-rail",
            "profiles",
            { leadingSlash: true }
        );

        expect(fetchMock).toHaveBeenCalledWith("/profiles/france-rail/layers.json");
        expect(res).toEqual([{ id: "gares", configFile: "c.json" }]);
    });

    test("runs the validateUrl guard before fetch (download convention)", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => ({ ok: true, json: async () => ({ layers: [] }) }))
        );
        const validateUrl = vi.fn();

        await resolveProfileLayers({ Files: { layersFile: "layers.json" } }, "p", "../profiles", {
            validateUrl,
        });

        expect(validateUrl).toHaveBeenCalledWith("../profiles/p/layers.json");
    });

    test("returns [] when fetch fails", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => ({ ok: false, status: 404 }))
        );
        const res = await resolveProfileLayers(
            { Files: { layersFile: "layers.json" } },
            "p",
            "profiles",
            { leadingSlash: true }
        );
        expect(res).toEqual([]);
    });

    test("returns [] when neither layers nor Files.layersFile exist", async () => {
        const res = await resolveProfileLayers({}, "p", "profiles");
        expect(res).toEqual([]);
    });
});
