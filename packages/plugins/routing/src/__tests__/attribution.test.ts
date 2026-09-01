/**
 * Unit tests — ODbL compliance: the legal notice, from declaration to display.
 *
 * 🛑 **It is a licence obligation, not a feature.** Both shipped engines
 * compute on OpenStreetMap, whose ODbL requires attribution wherever the
 * derived work is shown. A route displayed without credit is not missing a
 * nicety: it is out of compliance — and it is the INTEGRATOR who is, since
 * they publish the map.
 *
 * This file guards the three halves: what a provider must declare, what
 * happens to one declaring nothing, and the fact the credit lives and dies
 * with the line.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { getNativeMapMock, warnMock } = vi.hoisted(() => ({
    getNativeMapMock: vi.fn(),
    warnMock: vi.fn(),
}));
vi.mock("@geoleaf/host-runtime", () => ({
    coreConfigGet: () => ({}),
    getNativeMap: () => getNativeMapMock(),
    Log: { warn: (...a: unknown[]) => warnMock(...a), error: () => {}, info: () => {} },
}));

const { createProvider, getProvider, registerProvider } = await import("../provider.js");
const { showRouteAttribution, removeRouteAttribution, currentRouteAttribution } =
    await import("../ui/attribution.js");
const { OSM_ATTRIBUTION } = await import("../providers/http.js");
const { publishRoute, clearRoute, routeFeatures } = await import("../publish.js");
const { showStepLabels, hideStepLabels } = await import("../labels-seam.js");

/** A minimal route carrying its credit. */
const ROUTE_WITH_CREDIT = {
    distance: 1000,
    duration: 100,
    geometry: "",
    provider: "valhalla",
    attribution: "© OpenStreetMap contributors",
    waypoints: [],
    legs: [],
} as never;

const here = path.dirname(fileURLToPath(import.meta.url));
const providersDir = path.join(here, "..", "providers");

/** A minimal configuration. */
const cfg = (over: Record<string, unknown> = {}) =>
    ({ enabled: true, showButton: false, provider: "valhalla", endpoint: "", ...over }) as never;

/** A complete provider. */
const good = (id: string) => (endpoint: string) => ({
    id,
    attribution: "© Test contributors",
    route: async () => ({ ok: false, reason: "no-route" }) as const,
    endpoint,
});

/** A provider that declared no notice. */
const silent = (id: string) => (endpoint: string) => ({
    id,
    route: async () => ({ ok: false, reason: "no-route" }) as const,
    endpoint,
});

/** A provider whose notice is an empty string — the "filled to fill it" case. */
const blank = (id: string) => (endpoint: string) => ({
    id,
    attribution: "   ",
    route: async () => ({ ok: false, reason: "no-route" }) as const,
    endpoint,
});

describe("🛑 GATE — un fournisseur sans mention légale est REFUSÉ", () => {
    beforeEach(() => {
        warnMock.mockClear();
        // ⚠️ Registered EXPLICITLY and not taken from `registeredProviders()`:
        // this file does not import `builtins.js`, so the registry is empty
        // here and the loop would set nothing. A guard leaning on an empty
        // registry comes out green having exercised nothing.
        registerProvider("valhalla", good("valhalla") as never);
    });

    it("un fournisseur complet passe", () => {
        expect(createProvider(cfg())).not.toBeNull();
    });

    it("🛑 un fournisseur SANS `attribution` est refusé, pas toléré", () => {
        // Refused and not substituted: inventing "© OpenStreetMap
        // contributors" for an unknown engine would be worse than silence — it
        // would attribute data to a source that may not have produced it. A
        // false claim, instead of a missing one.
        registerProvider("valhalla", silent("valhalla") as never);
        expect(createProvider(cfg())).toBeNull();
    });

    it("🛑 une mention VIDE est refusée aussi — « rempli pour remplir » ne compte pas", () => {
        registerProvider("valhalla", blank("valhalla") as never);
        expect(createProvider(cfg())).toBeNull();
    });

    it("le refus est DIT, et il nomme le fournisseur", () => {
        // A mute refusal reads "the engine is not answering" and sends people hunting network-side.
        registerProvider("valhalla", silent("valhalla") as never);
        createProvider(cfg());
        expect(warnMock).toHaveBeenCalledTimes(1);
        expect(String(warnMock.mock.calls[0]?.[0])).toContain("valhalla");
    });

    it("`getProvider()` rend l'identifiant ET la mention", () => {
        const p = getProvider(cfg());
        expect(p).toEqual({ id: "valhalla", attribution: "© Test contributors" });
    });

    it("`getProvider()` rend `null` quand le fournisseur est refusé", () => {
        registerProvider("valhalla", silent("valhalla") as never);
        expect(getProvider(cfg())).toBeNull();
    });
});

describe("🛑 GATE DE SOURCE — tout adaptateur livré déclare sa mention", () => {
    // ⚠️ A SOURCE guard and not a behaviour one, deliberately. The two current
    // adapters are covered by the tests above; the THIRD, the one someone will
    // add in six months, will not be — and it would turn red nowhere before
    // shipping creditless. This guard reads the directory, so it sees what
    // does not exist yet.
    const files = fs
        .readdirSync(providersDir)
        .filter((f) => f.endsWith(".ts") && f !== "http.ts" && f !== "builtins.ts");

    it("le répertoire contient bien des adaptateurs — la garde n'est pas vide", () => {
        // Without this assertion, renaming the directory would make the guard
        // green scanning nothing. The "guard that comes out green having
        // guarded nothing" mode.
        expect(files.length).toBeGreaterThanOrEqual(2);
    });

    for (const f of files) {
        it(`${f} déclare une \`attribution\` non vide`, () => {
            const src = fs.readFileSync(path.join(providersDir, f), "utf8");
            // Either the shared constant, or a literal specific to this adapter.
            const declares =
                /attribution:\s*OSM_ATTRIBUTION\b/.test(src) ||
                /attribution:\s*"[^"]+"/.test(src) ||
                /attribution:\s*`[^`]+`/.test(src);
            expect(declares).toBe(true);
        });
    }
});

describe("L'attribution vit et meurt avec le TRACÉ", () => {
    let container: HTMLElement;

    beforeEach(() => {
        document.body.replaceChildren();
        container = document.createElement("div");
        document.body.append(container);
        getNativeMapMock.mockReturnValue({ getContainer: () => container });
        removeRouteAttribution();
    });

    it("affichée, elle est DANS le conteneur de la carte", () => {
        // In the map and not in the panel: the panel closes, the line stays,
        // and ODbL has no grace period for "the panel was closed".
        showRouteAttribution(OSM_ATTRIBUTION);
        const el = container.querySelector(".gl-routing-attribution");
        expect(el).not.toBeNull();
        expect(el?.textContent).toBe("© OpenStreetMap contributors");
    });

    it("🛑 l'afficher deux fois ne l'EMPILE pas", () => {
        showRouteAttribution(OSM_ATTRIBUTION);
        showRouteAttribution(OSM_ATTRIBUTION);
        expect(container.querySelectorAll(".gl-routing-attribution")).toHaveLength(1);
    });

    it("un crédit différent REMPLACE le précédent", () => {
        // Recomputing with another engine must not leave both credits side by
        // side: one of the two would be wrong.
        showRouteAttribution(OSM_ATTRIBUTION);
        showRouteAttribution("© Autre source");
        expect(container.querySelectorAll(".gl-routing-attribution")).toHaveLength(1);
        expect(currentRouteAttribution()).toBe("© Autre source");
    });

    it("retirée, elle ne laisse rien", () => {
        showRouteAttribution(OSM_ATTRIBUTION);
        removeRouteAttribution();
        expect(container.querySelector(".gl-routing-attribution")).toBeNull();
        expect(currentRouteAttribution()).toBeNull();
    });

    it("une chaîne vide n'affiche pas une boîte vide", () => {
        showRouteAttribution("   ");
        expect(container.querySelector(".gl-routing-attribution")).toBeNull();
    });

    it("🛑 sans carte, rien n'est affiché et rien ne jette", () => {
        // A caller without a map — a computation for an export — shows the
        // route to nobody: there is nothing to credit on screen. Failing here
        // would break the computation for a display reason.
        getNativeMapMock.mockReturnValue(undefined);
        expect(() => showRouteAttribution(OSM_ATTRIBUTION)).not.toThrow();
        expect(currentRouteAttribution()).toBeNull();
    });

    it("le texte passe par `textContent` — un crédit n'injecte rien", () => {
        showRouteAttribution('<img src=x onerror="alert(1)">');
        const el = container.querySelector(".gl-routing-attribution");
        expect(el?.querySelector("img")).toBeNull();
        expect(el?.textContent).toContain("<img");
    });
});

describe("🛑 LE CÂBLAGE — `publishRoute` monte le crédit, `clearRoute` le retire", () => {
    // 🛑 This block exists because its absence is THE defect this repo just
    // paid for elsewhere: three interface modules written, tested, published —
    // and imported by nothing. The tests above prove `showRouteAttribution`
    // works; none proved a publication sets one. A module can be entirely
    // correct and entirely unreachable, and only a test starting from the
    // PUBLIC ENTRY sees it.
    let container: HTMLElement;

    beforeEach(() => {
        document.body.replaceChildren();
        container = document.createElement("div");
        document.body.append(container);
        getNativeMapMock.mockReturnValue({ getContainer: () => container });
        removeRouteAttribution();
        (globalThis as Record<string, unknown>).GeoLeaf = {
            Layers: { hasLayer: () => true, setData: () => {}, clear: () => {} },
        };
    });

    it("🛑 publier un itinéraire POSE son crédit dans la carte", () => {
        expect(container.querySelector(".gl-routing-attribution")).toBeNull();
        publishRoute(ROUTE_WITH_CREDIT, "itineraire");
        expect(container.querySelector(".gl-routing-attribution")?.textContent).toBe(
            "© OpenStreetMap contributors"
        );
    });

    it("🛑 le crédit vient de l'ITINÉRAIRE, pas du fournisseur configuré", () => {
        // A route computed by one engine then left on screen while the
        // profile is repointed to another would credit the wrong source if we
        // read the configuration.
        publishRoute({ ...ROUTE_WITH_CREDIT, attribution: "© Source du tracé" }, "itineraire");
        expect(currentRouteAttribution()).toBe("© Source du tracé");
    });

    it("vider l'itinéraire RETIRE le crédit", () => {
        publishRoute(ROUTE_WITH_CREDIT, "itineraire");
        clearRoute("itineraire");
        expect(container.querySelector(".gl-routing-attribution")).toBeNull();
    });
});

describe("🛑 Q-01 DISSOUTE — la couture d'étiquettes était déjà ouverte", () => {
    // 🛑 An architecture question blocked this feature three days, asking
    // whether to widen the map adapter's contract or open a seam on `labels`.
    // Measured: the seam IS open. `enableLabels` comes from `LabelsApi`, with
    // which `LabelsPublicApi` is composed; the rendering does
    // `["get", labelConfig.labelId]`; and `_hasConfigLabel` requires only
    // `enabled` and `labelId`.
    //
    // ⚠️ What made the question hard was reading `public-api.ts` ALONE — that
    // file only adds `isEnabled` and `getConfig`. A seam can be open and look
    // closed to whoever stops at the facade.
    let calls: unknown[][];

    beforeEach(() => {
        document.body.replaceChildren();
        const container = document.createElement("div");
        document.body.append(container);
        getNativeMapMock.mockReturnValue({ getContainer: () => container });
        removeRouteAttribution();
        calls = [];
        (globalThis as Record<string, unknown>).GeoLeaf = {
            Layers: { hasLayer: () => true, setData: () => {}, clear: () => {} },
            Labels: {
                enableLabels: (...a: unknown[]) => calls.push(["enable", ...a]),
                disableLabels: (...a: unknown[]) => calls.push(["disable", ...a]),
            },
        };
    });

    it("🛑 demande les DEUX clés que la capacité exige, et pas d'autres", () => {
        // `_hasConfigLabel` refuses a config without `enabled` or without
        // `labelId`. Passing only one would return `null` and nothing would
        // show — with no error, which is the worse of the two.
        expect(showStepLabels("itineraire")).toBe(true);
        expect(calls[0]).toEqual([
            "enable",
            "itineraire",
            { enabled: true, labelId: "step" },
            true,
        ]);
    });

    it("🛑 la propriété demandée est celle que `routeFeatures` ÉCRIT", () => {
        // Two literals in two files that must agree. This test is the only
        // place their divergence would turn red: renamed on one side, the
        // label would silently stop appearing.
        showStepLabels("x");
        const cfg = calls[0]?.[2] as { labelId: string };
        // ⚠️ A route REALLY carrying stops: `ROUTE_WITH_CREDIT` has none, so
        // `routeFeatures` would have produced no entity to inspect and the
        // assertion would have run on `undefined` — green for a test that read nothing.
        const withStops = {
            ...ROUTE_WITH_CREDIT,
            waypoints: [{ coordinates: [55.4, -21.1] }, { coordinates: [55.5, -21.2] }],
        } as never;
        const stop = routeFeatures(withStops).find((f) => f.properties?.["role"] !== undefined);
        expect(stop, "aucune entité d'étape produite").toBeDefined();
        expect(stop?.properties).toHaveProperty(cfg.labelId);
    });

    it("publier un itinéraire NUMÉROTE ses étapes", () => {
        publishRoute(ROUTE_WITH_CREDIT, "itineraire");
        expect(calls.some((c) => c[0] === "enable" && c[1] === "itineraire")).toBe(true);
    });

    it("vider l'itinéraire RETIRE la numérotation", () => {
        publishRoute(ROUTE_WITH_CREDIT, "itineraire");
        clearRoute("itineraire");
        expect(calls.some((c) => c[0] === "disable" && c[1] === "itineraire")).toBe(true);
    });

    it("🛑 sans la capacité `labels`, publier fonctionne quand même", () => {
        // A profile may disable it. The line then shows without numbers — the
        // state this package lived in until now, and not an outage.
        (globalThis as Record<string, unknown>).GeoLeaf = {
            Layers: { hasLayer: () => true, setData: () => {}, clear: () => {} },
        };
        expect(showStepLabels("x")).toBe(false);
        expect(() => hideStepLabels("x")).not.toThrow();
        expect(publishRoute(ROUTE_WITH_CREDIT, "itineraire").ok).toBe(true);
    });
});
