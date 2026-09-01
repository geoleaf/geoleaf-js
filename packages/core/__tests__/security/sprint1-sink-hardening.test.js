/**
 * @fileoverview Security hardening — Correctifs P1.
 * Integration tests for the wired-at-the-sink hardening:
 *   - H1: POI link/image sinks reject javascript:/unsafe URLs (links.ts, media-renderers.ts).
 *   - M1: the profile sprite fetch is not emitted for an unsafe spriteUrl.
 *   - M3: Config deepMerge/set/merge filter __proto__/constructor/prototype.
 */

const mockLog = vi.hoisted(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

vi.mock("../../src/utils/log/index.js", () => ({ Log: mockLog }));

// 🗑️ A `vi.mock` of `kernel/config/config-primitives.js` lived here,
// setting a single `Config.getIconsConfig` — a member existing in NONE of
// the repo's 923 sources. Removed on 17/08/2026, and not on the faith of
// that absence: the counter-proof was taken, this file passes WITHOUT it.
// Neither `kernel/config/storage.js` nor
// `utils/loaders/profile-sprite-loader.js` — the only two subjects —
// imports this module. The mock was thus inert twice: it stubbed a module
// not loaded, with a member that no longer exists.

import { ConfigStore } from "../../src/kernel/config/storage.js";
import { ensureProfileSpriteInjectedSync } from "../../src/utils/loaders/profile-sprite-loader.js";

afterEach(() => {
    vi.clearAllMocks();
    // Scrub any prototype pollution that may have leaked from a failing assertion.
    delete Object.prototype.polluted;
    delete Object.prototype.isAdmin;
});

// ─────────────────────────────────────────────────────────────────────────────
// H1 — POI sinks reject unsafe href/src
// ─────────────────────────────────────────────────────────────────────────────

// H1 (POI link/image sinks) removed — `poi/renderers/links.ts` and
// `poi/renderers/media-renderers.ts` were deleted (attribute rendering delegates
// entirely to `@geoleaf-plugins/feature-info`). Equivalent URL-safety coverage
// (isUrlSafe / javascript: / vbscript: / data:text/html rejection for image, url,
// hero, gallery fields) now lives in `plugin-feature-info/src/__tests__/render.test.ts`.

// ─────────────────────────────────────────────────────────────────────────────
// M1 — sprite fetch not emitted for an unsafe URL
// ─────────────────────────────────────────────────────────────────────────────

describe("M1 — sprite loader validates the URL before fetching", () => {
    let originalFetch;
    let originalGeoLeaf;
    beforeEach(() => {
        originalFetch = globalThis.fetch;
        originalGeoLeaf = globalThis.GeoLeaf;
        document
            .querySelectorAll('svg[data-geoleaf-sprite="profile"]')
            .forEach((el) => el.remove());
    });
    afterEach(() => {
        globalThis.fetch = originalFetch;
        globalThis.GeoLeaf = originalGeoLeaf;
    });

    it("does NOT call fetch when spriteUrl uses a non-http protocol", async () => {
        // The sprite loader reads `modules.taxonomy.icons` via the taxonomy seam.
        globalThis.GeoLeaf = {
            Taxonomy: { getIcons: () => ({ spriteUrl: "javascript:alert(1)" }) },
        };
        const fetchSpy = vi.fn();
        globalThis.fetch = fetchSpy;

        await ensureProfileSpriteInjectedSync();

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(document.querySelector('svg[data-geoleaf-sprite="profile"]')).toBeNull();
    });

    it("DOES fetch a valid http sprite URL", async () => {
        globalThis.GeoLeaf = {
            Taxonomy: { getIcons: () => ({ spriteUrl: "https://cdn.example.com/sprite.svg" }) },
        };
        const fetchSpy = vi.fn(() =>
            Promise.resolve({
                ok: true,
                text: () => Promise.resolve('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
            })
        );
        globalThis.fetch = fetchSpy;

        await ensureProfileSpriteInjectedSync();

        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// M3 — config merge/set filter prototype-polluting keys
// ─────────────────────────────────────────────────────────────────────────────

describe("M3 — Config deepMerge/set/merge block prototype pollution", () => {
    it("deepMerge drops __proto__ from a JSON-parsed source", () => {
        const malicious = JSON.parse('{"__proto__":{"polluted":true},"safe":1}');
        const result = ConfigStore.deepMerge({}, malicious);

        expect(result.safe).toBe(1);
        expect(result.polluted).toBeUndefined();
        expect(Object.prototype.polluted).toBeUndefined();
        expect(mockLog.warn).toHaveBeenCalledWith(
            "[GeoLeaf.Config.Storage] Prototype pollution attempt blocked",
            { key: "__proto__" }
        );
    });

    it("deepMerge drops constructor/prototype keys", () => {
        const malicious = { constructor: { prototype: { isAdmin: true } }, ok: 2 };
        const result = ConfigStore.deepMerge({}, malicious);

        expect(result.ok).toBe(2);
        expect(Object.prototype.isAdmin).toBeUndefined();
    });

    it("set() refuses a __proto__ path segment", () => {
        ConfigStore.init({});
        ConfigStore.set("__proto__.polluted", true);

        expect(Object.prototype.polluted).toBeUndefined();
        expect({}.polluted).toBeUndefined();
    });

    it("set() still writes a legitimate nested path", () => {
        ConfigStore.init({});
        ConfigStore.set("ui.theme", "dark");
        expect(ConfigStore.get("ui.theme")).toBe("dark");
    });

    it("merge() blocks pollution while merging legitimate keys", () => {
        ConfigStore.init({ foo: 1 });
        ConfigStore.merge(JSON.parse('{"__proto__":{"polluted":true},"bar":2}'));

        expect(ConfigStore.get("bar")).toBe(2);
        expect(Object.prototype.polluted).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// S5 — setValueByPath, the sink M3 missed
// ─────────────────────────────────────────────────────────────────────────────
// M3 (above) hardened set/deepMerge/merge but `setValueByPath` was out of its scope,
// so it stayed unguarded — the one write path reachable from the layer-loading
// pipeline (normalizePoiWithMapping, whose target paths are mapping.json keys).
// The reachable impact was a SCOPED prototype injection, not global pollution: the
// `hasOwnProperty` check on line 167 replaces the intermediate with a fresh {} and
// breaks the classic constructor.prototype chain. Both are asserted below.

describe("S5 — setValueByPath blocks polluting path segments", () => {
    it("refuses a leading __proto__ segment", () => {
        const target = { attributes: {} };
        ConfigStore.setValueByPath(target, "__proto__.polluted", "PWNED");

        expect(target.polluted).toBeUndefined();
        expect(Object.getPrototypeOf(target)).toBe(Object.prototype);
        expect({}.polluted).toBeUndefined();
        expect(mockLog.warn).toHaveBeenCalledWith(
            "[GeoLeaf.Config.Storage] Prototype pollution attempt blocked",
            { key: "__proto__" }
        );
    });

    it("refuses a __proto__ segment nested under an existing own object", () => {
        const target = { attributes: {} };
        ConfigStore.setValueByPath(target, "attributes.__proto__.injected", "PWNED");

        expect(target.attributes.injected).toBeUndefined();
        expect(Object.getPrototypeOf(target.attributes)).toBe(Object.prototype);
        expect({}.injected).toBeUndefined();
    });

    // ⚠️ Verified: this one stays GREEN with the guard removed — it passes for a
    // different reason. The `hasOwnProperty` check on line 172 finds no OWN `constructor`
    // and overwrites it with a fresh {}, so the descent never reaches the real
    // Object.prototype. Kept as a regression guard on THAT behaviour: it bites if the
    // own-property check is ever relaxed to `in`. Do not read it as proof the blocklist works.
    //
    // Retitled: the comment was accurate but the old title ("refuses
    // constructor/prototype segments") credited the blocklist for a pass it does not
    // earn. Re-confirmed by a mutation run — neutralising `isUnsafeKey` kills
    // 13 tests across 4 files, and this is not one of them. The blocklist's own
    // coverage of these two keys is the single-segment case below.
    it("own-property descent never reaches the real Object.prototype (constructor hop)", () => {
        const target = {};
        ConfigStore.setValueByPath(target, "constructor.prototype.owned", "PWNED");

        expect(Object.prototype.owned).toBeUndefined();
        expect({}.owned).toBeUndefined();
    });

    it.each(["constructor", "prototype"])(
        "blocks a single-segment `%s` path — blocklist only, no descent to absorb it",
        (key) => {
            // One segment means the descent loop never runs, so the own-property check
            // above cannot stand in for the guard: only the blocklist can refuse this.
            // Verified to die under mutation — this is the assertion that
            // actually pins `constructor`/`prototype` for setValueByPath.
            const target = {};
            ConfigStore.setValueByPath(target, key, "PWNED");

            expect(Object.prototype.hasOwnProperty.call(target, key)).toBe(false);
            expect(target[key]).not.toBe("PWNED");
            expect(mockLog.warn).toHaveBeenCalledWith(
                "[GeoLeaf.Config.Storage] Prototype pollution attempt blocked",
                { key }
            );
        }
    );

    it("refuses a single-segment __proto__ path", () => {
        // A one-segment path skips the descent loop and lands on the final write —
        // guarding only the loop would leave this open.
        const target = {};
        ConfigStore.setValueByPath(target, "__proto__", { polluted: true });

        expect(Object.getPrototypeOf(target)).toBe(Object.prototype);
        expect({}.polluted).toBeUndefined();
    });

    it("still writes legitimate nested paths and creates intermediates", () => {
        const target = {};
        ConfigStore.setValueByPath(target, "location.lat", 48.85);
        ConfigStore.setValueByPath(target, "attributes.kind", "airport");

        expect(target.location.lat).toBe(48.85);
        expect(target.attributes.kind).toBe("airport");
    });
});
