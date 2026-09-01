/*!
 * Tests — the duplicate guard at capture time (`drawing/poi-snap.ts`)
 *
 * ⚠️ The mock REPRODUCES the real surface's constraints instead of ignoring
 * them: `Layers.getFeatures` THROWS for a declared but unloaded layer — what
 * the core does —, and `Config.getActiveProfile` returns `undefined` when no
 * profile is active. A mock more permissive than the surface would let through
 * what the browser sees immediately (measured trap: 340 green tests on a call
 * detached from its receiver).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const _host: {
    Config?: { getActiveProfile?(): unknown };
    Layers?: { getFeatures?(id: string): unknown[] };
} = {};

vi.mock("@geoleaf/host-runtime", () => ({
    getGeoLeaf: () => _host,
    Log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { findNearbyFeature } = await import("../drawing/poi-snap.js");

/** ~11.1 m per 0.0001° of latitude — used to place neighbours at a known distance. */
const BASE = { lat: -21.1, lng: 55.5 };

function pointFeature(id: string, lat: number, lng: number, title?: string) {
    return {
        id,
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: title ? { title } : {},
    };
}

function setProfile(layers: unknown[]) {
    _host.Config = { getActiveProfile: () => ({ layers }) };
}

const EDITABLE_POINT = {
    id: "candelabres",
    geometryType: "point",
    edition: { create: true, update: true },
};

beforeEach(() => {
    delete _host.Config;
    delete _host.Layers;
});

describe("findNearbyFeature — le domaine de recherche", () => {
    it("rend null sans profil actif", () => {
        _host.Layers = { getFeatures: () => [pointFeature("a", BASE.lat, BASE.lng)] };
        expect(findNearbyFeature(BASE, 50)).toBeNull();
    });

    it("ÉCARTE une couche qui n'est pas de géométrie point", () => {
        setProfile([
            { id: "zones", geometryType: "polygon", edition: { create: true, update: true } },
        ]);
        _host.Layers = { getFeatures: () => [pointFeature("a", BASE.lat, BASE.lng)] };
        expect(findNearbyFeature(BASE, 50)).toBeNull();
    });

    it("ÉCARTE une couche point NON éditable", () => {
        setProfile([{ id: "lecture", geometryType: "point" }]);
        _host.Layers = { getFeatures: () => [pointFeature("a", BASE.lat, BASE.lng)] };
        expect(findNearbyFeature(BASE, 50)).toBeNull();
    });

    it("ÉCARTE une couche qui n'accorde QUE le droit de supprimer", () => {
        // 🛑 THIS TEST IS THE INVERSION OF ITS PREDECESSOR, and the inversion
        // IS the change. It was called "accepts a point layer in
        // enableEditionFull" and asserted that the right to DELETE brought a
        // layer into the edition picker — a consequence of the patch set
        // earlier so this flag would not go readerless. The V1 decision says
        // the opposite: we do not offer to create on a layer where one only
        // has the right to erase. Renamed and flipped, not deleted — otherwise
        // we would lose the trace of what the behaviour was.
        setProfile([{ id: "sites", geometryType: "point", edition: { delete: true } }]);
        _host.Layers = { getFeatures: () => [pointFeature("a", BASE.lat, BASE.lng)] };
        expect(findNearbyFeature(BASE, 50)).toBeNull();
    });

    it("accepte une couche point qui n'accorde que `update`", () => {
        setProfile([{ id: "sites", geometryType: "point", edition: { update: true } }]);
        _host.Layers = { getFeatures: () => [pointFeature("a", BASE.lat, BASE.lng)] };
        expect(findNearbyFeature(BASE, 50)?.id).toBe("a");
    });
});

describe("findNearbyFeature — la tolérance est une distance au SOL", () => {
    beforeEach(() => setProfile([EDITABLE_POINT]));

    it("accroche une entité située à ~11 m avec une tolérance de 50 m", () => {
        _host.Layers = {
            getFeatures: () => [pointFeature("proche", BASE.lat + 0.0001, BASE.lng, "Lampadaire")],
        };
        const hit = findNearbyFeature(BASE, 50);
        expect(hit).not.toBeNull();
        expect(hit!.id).toBe("proche");
        expect(hit!.title).toBe("Lampadaire");
        expect(hit!.layerId).toBe("candelabres");
        expect(hit!.distanceMeters).toBeGreaterThan(5);
        expect(hit!.distanceMeters).toBeLessThan(20);
    });

    it("n'accroche PAS la même entité avec une tolérance de 5 m", () => {
        _host.Layers = {
            getFeatures: () => [pointFeature("proche", BASE.lat + 0.0001, BASE.lng)],
        };
        expect(findNearbyFeature(BASE, 5)).toBeNull();
    });

    it("une tolérance de 0 DÉSACTIVE le garde-fou", () => {
        _host.Layers = { getFeatures: () => [pointFeature("pile", BASE.lat, BASE.lng)] };
        expect(findNearbyFeature(BASE, 0)).toBeNull();
    });

    it("retient la PLUS PROCHE quand plusieurs sont dans la tolérance", () => {
        _host.Layers = {
            getFeatures: () => [
                pointFeature("loin", BASE.lat + 0.0003, BASE.lng),
                pointFeature("pres", BASE.lat + 0.0001, BASE.lng),
                pointFeature("moyen", BASE.lat + 0.0002, BASE.lng),
            ],
        };
        expect(findNearbyFeature(BASE, 100)?.id).toBe("pres");
    });

    it("rend les coordonnées de l'ENTITÉ, pas celles du clic", () => {
        const exact = { lat: BASE.lat + 0.0001, lng: BASE.lng + 0.0001 };
        _host.Layers = { getFeatures: () => [pointFeature("a", exact.lat, exact.lng)] };
        expect(findNearbyFeature(BASE, 100)?.latlng).toEqual(exact);
    });
});

describe("findNearbyFeature — robustesse", () => {
    it("ignore les géométries non ponctuelles d'une couche point", () => {
        setProfile([EDITABLE_POINT]);
        _host.Layers = {
            getFeatures: () => [
                { id: "ligne", geometry: { type: "LineString", coordinates: [] }, properties: {} },
                { id: "vide", geometry: null, properties: {} },
                { id: "tronque", geometry: { type: "Point", coordinates: [55.5] }, properties: {} },
            ],
        };
        expect(findNearbyFeature(BASE, 500)).toBeNull();
    });

    it("🛑 une couche ILLISIBLE n'aveugle pas les autres", () => {
        setProfile([
            {
                id: "jamais-chargee",
                geometryType: "point",
                edition: { create: true, update: true },
            },
            EDITABLE_POINT,
        ]);
        _host.Layers = {
            getFeatures: (id: string) => {
                if (id === "jamais-chargee") throw new Error("layer not loaded");
                return [pointFeature("survivant", BASE.lat + 0.0001, BASE.lng)];
            },
        };
        expect(findNearbyFeature(BASE, 50)?.id).toBe("survivant");
    });

    it("rend null quand le seam Layers est absent", () => {
        setProfile([EDITABLE_POINT]);
        expect(findNearbyFeature(BASE, 50)).toBeNull();
    });

    it("se rabat sur properties.title puis properties.name", () => {
        setProfile([EDITABLE_POINT]);
        _host.Layers = {
            getFeatures: () => [
                {
                    geometry: { type: "Point", coordinates: [BASE.lng, BASE.lat] },
                    properties: { id: "p-7", name: "Sans titre mais nommé" },
                },
            ],
        };
        const hit = findNearbyFeature(BASE, 50);
        expect(hit?.id).toBe("p-7");
        expect(hit?.title).toBe("Sans titre mais nommé");
    });
});
