/*!
 * Tests — tâche 5.1-a : le garde-fou de doublon à la saisie (`drawing/poi-snap.ts`)
 *
 * ⚠️ Le mock REPRODUIT les contraintes de la surface réelle au lieu de les ignorer :
 * `Layers.getFeatures` JETTE pour une couche déclarée mais non chargée — c'est ce que fait
 * le core —, et `Config.getActiveProfile` rend `undefined` quand aucun profil n'est actif.
 * Un mock plus permissif que la surface laisserait passer ce que le navigateur voit tout de
 * suite (piège mesuré au Sprint 4 : 340 tests verts sur un appel détaché de son récepteur).
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

/** ~11,1 m par 0,0001° de latitude — sert à placer des voisins à distance connue. */
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
        // 🛑 CE TEST EST L'INVERSION DE SON PRÉDÉCESSEUR, et l'inversion EST la tâche 5.9.
        // Il s'appelait « accepte une couche point en enableEditionFull » et affirmait que
        // le droit de SUPPRIMER faisait entrer une couche dans le sélecteur d'édition —
        // conséquence de la rustine posée en 5.2 pour ne pas laisser ce drapeau sans lecteur.
        // La décision V1 dit l'inverse : on ne propose pas de créer sur une couche où l'on
        // n'a que le droit d'effacer. Renommé et retourné, pas supprimé — sinon on perdrait
        // la trace de ce que le comportement était.
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
