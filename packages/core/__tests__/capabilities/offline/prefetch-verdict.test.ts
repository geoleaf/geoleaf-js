/**
 * Witness — the origin rule of the offline preparation SAYS why it refuses, and the verdict is
 * reachable from the facade.
 *
 * The rule itself (what is allowed) is pinned by `tile-prefetch-origin.test.ts`. What this file
 * pins is the half an INTERFACE needs: a selector that offers a basemap the preparation will
 * skip had no way to know it before the download, and no way to say why afterwards — the refusal
 * was a console warning, and the download ended on a success toast.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ values: {} as Record<string, unknown> }));

vi.mock("../../../src/capabilities/offline/config-seam.js", () => ({
    coreConfigGet: vi.fn((key: string, fallback: unknown) =>
        key in config.values ? config.values[key] : fallback
    ),
}));
vi.mock("../../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { parseDataOrigins, prefetchVerdict, pullVerdict } =
    await import("../../../src/capabilities/offline/data-origins.ts");
const { prefetchVerdictOf } =
    await import("../../../src/capabilities/offline/cache/resource-enumerator.ts");
const { Storage } = await import("../../../src/kernel/storage/facade.js");

const PAGE = "https://app.example.test/index.html";
const THIRD = "https://tiles.example.test";

beforeEach(() => {
    config.values = {};
});

describe("pullVerdict — la source d'entités d'une couche", () => {
    const API = "https://api.example.test";
    const declared = (origin: string, extra: Record<string, unknown> = {}) =>
        parseDataOrigins([{ origin, roles: ["layerData"], cacheable: false, ...extra }]);

    it("aucune déclaration : toute source est admise, tierce comprise", () => {
        expect(pullVerdict(`${API}/ogc`, [], PAGE)).toEqual({ allowed: true, origin: API });
    });

    it("le profil déclare, pas cette origine : `undeclared`", () => {
        expect(pullVerdict(`${API}/ogc`, declared(THIRD), PAGE)).toEqual({
            allowed: false,
            origin: API,
            reason: "undeclared",
        });
    });

    it("origine déclarée : admise sans `prefetch` ni `cacheable`", () => {
        expect(pullVerdict(`${API}/ogc`, declared(API), PAGE).allowed).toBe(true);
    });

    it("origine déclarée `authenticated` : admise — là où `prefetchVerdict` refuse", () => {
        const origins = declared(API, { authenticated: true });
        expect(pullVerdict(`${API}/ogc`, origins, PAGE).allowed).toBe(true);
        expect(prefetchVerdict(`${API}/ogc`, origins, PAGE).allowed).toBe(false);
    });

    it("l'origine de la page reste implicite, source relative comprise", () => {
        expect(pullVerdict("/ogc", declared(THIRD), PAGE)).toEqual({
            allowed: true,
            origin: "https://app.example.test",
        });
    });

    it("URL illisible : refusée là où le profil déclare, laissée au chargeur ailleurs", () => {
        expect(pullVerdict("http://[", declared(THIRD), PAGE)).toEqual({
            allowed: false,
            origin: "http://[",
            reason: "unparsable",
        });
        expect(pullVerdict("http://[", [], PAGE).allowed).toBe(true);
    });
});

describe("prefetchVerdict — un refus dit pourquoi", () => {
    it("origine tierce non déclarée : `undeclared`", () => {
        expect(prefetchVerdict(`${THIRD}/1/2/3.png`, [], PAGE)).toEqual({
            allowed: false,
            origin: THIRD,
            reason: "undeclared",
        });
    });

    it("déclarée `cacheable` sans `prefetch` : `notPrefetchable`", () => {
        const origins = parseDataOrigins([{ origin: THIRD, roles: ["tiles"], cacheable: true }]);
        expect(prefetchVerdict(`${THIRD}/1/2/3.png`, origins, PAGE)).toEqual({
            allowed: false,
            origin: THIRD,
            reason: "notPrefetchable",
        });
    });

    it("déclarée `authenticated` : `notPrefetchable` — le drapeau lui est retiré", () => {
        const origins = parseDataOrigins([
            {
                origin: THIRD,
                roles: ["tiles"],
                cacheable: true,
                prefetch: true,
                authenticated: true,
            },
        ]);
        expect(prefetchVerdict(`${THIRD}/1/2/3.png`, origins, PAGE).reason).toBe("notPrefetchable");
    });

    it("URL illisible : `unparsable`", () => {
        expect(prefetchVerdict("http://[", [], PAGE)).toEqual({
            allowed: false,
            origin: "http://[",
            reason: "unparsable",
        });
    });

    it("un verdict favorable ne porte PAS de motif", () => {
        const verdict = prefetchVerdict("tiles/1/2/3.png", [], PAGE);
        expect(verdict.allowed).toBe(true);
        expect("reason" in verdict).toBe(false);
    });
});

describe("prefetchVerdictOf — le verdict tel que la préparation le rendra", () => {
    it("lit les origines déclarées du profil", () => {
        config.values = {
            "modules.offline.dataOrigins": [
                { origin: THIRD, roles: ["tiles"], cacheable: true, prefetch: true },
            ],
        };
        expect(prefetchVerdictOf(`${THIRD}/1/2/3.png`)).toEqual({ allowed: true, origin: THIRD });
    });

    it("🛑 un gabarit de tuiles est jugé comme la préparation le juge — `{s}` vaut `a`", () => {
        // The selector holds the TEMPLATE, the preparation judges a concrete tile. Judging the
        // template as written would compare `https://{s}.tile…` to the declared `https://a.tile…`
        // and refuse a basemap the download accepts.
        config.values = {
            "modules.offline.dataOrigins": [
                {
                    origin: "https://a.tiles.example.test",
                    roles: ["tiles"],
                    cacheable: true,
                    prefetch: true,
                },
            ],
        };
        expect(prefetchVerdictOf("https://{s}.tiles.example.test/{z}/{x}/{y}.png")).toEqual({
            allowed: true,
            origin: "https://a.tiles.example.test",
        });
    });
});

describe("Storage.prefetchVerdict — la couture publique", () => {
    it("délègue au moteur câblé", () => {
        const verdict = { allowed: false, origin: THIRD, reason: "undeclared" };
        const engine = vi.fn(() => verdict);
        Storage.wireModules({ report: { buildSyncReport: vi.fn(), prefetchVerdict: engine } });
        try {
            expect(Storage.prefetchVerdict(`${THIRD}/1/2/3.png`)).toBe(verdict);
            expect(engine).toHaveBeenCalledWith(`${THIRD}/1/2/3.png`);
        } finally {
            Storage.wireModules({});
        }
    });

    it("sans moteur câblé : un refus nommé, jamais un accord", () => {
        Storage.wireModules({});
        expect(Storage.prefetchVerdict(`${THIRD}/1/2/3.png`)).toEqual({
            allowed: false,
            origin: "",
            reason: "engineUnavailable",
        });
    });
});
