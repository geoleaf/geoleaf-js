/**
 * Sprint 3, tâches 3.1 et 3.3 — QUELLES sous-couches reçoivent quel geste.
 *
 * Fichier distinct de `feature-interaction-events.test.js`, qui porte l'autre question :
 * *ce que* dispatche un handler une fois déclenché. Ici on ne regarde jamais la charge utile,
 * seulement la **sélection** — c'est le sujet du défaut.
 *
 * 🛑 LE DÉFAUT, ET POURQUOI IL DÉBORDE CE QUE LA ROADMAP DÉCRIT
 *
 * La boucle de clic itère sur **toutes** les sous-couches, là où le survol passe par
 * `_interactionSubLayerIds`. `maplibre-primitives.ts` (`_addSubLayers`) empile les sous-couches
 * **par géométrie et cumulativement** : un polygone reçoit `_addPolygonSubLayers` PUIS
 * `_addLineSubLayers`. Le double événement n'est donc pas propre aux points à icône —
 * mesuré : point+icône **2**, ligne+casing **2**, polygone+casing **3**, tuile vectorielle **4**.
 *
 * ⚠️ HYPOTHÈSE DE MODÉLISATION, ÉCRITE PARCE QU'ELLE EST PORTANTE : `map.on(type, layerId, fn)`
 * enregistre un écouteur **délégué par sous-couche liée**, et MapLibre exécute chacun de ceux
 * dont la sous-couche est touchée par le geste. Rejouer ici tous les handlers capturés avec le
 * MÊME événement modélise donc un clic unique sur une entité rendue par plusieurs sous-couches.
 * Sans cette phrase, le test affirmerait plus qu'il ne mesure.
 *
 * L'assertion de CONVERGENCE (dernier bloc) est celle qui a le plus de valeur dans le temps :
 * elle empêche les deux gestes de re-diverger, ce qu'aucun commentaire ne peut faire.
 */

import { vi, describe, test, expect, beforeEach } from "vitest";

vi.mock("../../src/kernel/events/event-bus.js", async (importActual) => ({
    ...((await importActual()) as object),
    dispatchGeoLeafEvent: vi.fn(),
}));

vi.mock("../../src/adapters/maplibre/maplibre-event-subscriptions.js", async (importActual) => ({
    ...((await importActual()) as object),
    trackMapCleanup: vi.fn(),
}));

const { bindFeatureInteractionEvents } =
    await import("../../src/kernel/geojson/feature-interaction.js");
const { dispatchGeoLeafEvent } = await import("../../src/kernel/events/event-bus.js");

type Handler = (e: unknown) => void;

/** Fausse carte MapLibre : retient chaque abonnement `(type, sous-couche)` et son handler. */
function fakeMap(layers: string[]) {
    const bound: Array<{ type: string; id: string; fn: Handler }> = [];
    return {
        __geoleafExclusiveMode: false,
        getLayer: (id: string) => layers.includes(id),
        getCanvas: () => ({ style: {} as Record<string, string> }),
        on: vi.fn((type: string, id: string, fn: Handler) => bound.push({ type, id, fn })),
        off: vi.fn(),
        _bound: bound,
    };
}

/** Les sous-couches sur lesquelles `type` a été branché, dans l'ordre de liaison. */
function idsFor(map: ReturnType<typeof fakeMap>, type: string): string[] {
    return map._bound.filter((b) => b.type === type).map((b) => b.id);
}

/**
 * Rejoue le même clic sur tous les handlers `click` liés, et rend le nombre de
 * `geoleaf:feature:click` émis. C'est l'oracle de comptage de la tâche 3.1.
 */
function clicksEmitted(map: ReturnType<typeof fakeMap>): number {
    const e = {
        features: [{ id: 7, properties: {}, geometry: { type: "Point" } }],
        lngLat: { lat: 1, lng: 2 },
        point: { x: 10, y: 20 },
    };
    for (const b of map._bound) if (b.type === "click") b.fn(e);
    return vi
        .mocked(dispatchGeoLeafEvent)
        .mock.calls.filter((c) => c[0] === "geoleaf:feature:click").length;
}

/** Lie le binder sur une carte dont TOUTES les sous-couches existent. */
function bind(subLayerIds: string[]) {
    const map = fakeMap(subLayerIds);
    bindFeatureInteractionEvents("L", {}, map as never, subLayerIds);
    return map;
}

/**
 * Les quatre empilements réels, tels que `_addSubLayers` les produit.
 * `primary` est la sous-couche que la précédence `fill → circle → line → all` désigne.
 */
const GEOMETRIES = [
    { nom: "point + icône", subs: ["a-circle", "a-symbol"], primary: "a-circle", avant: 2 },
    { nom: "ligne + casing", subs: ["a-casing", "a-line"], primary: "a-line", avant: 2 },
    {
        nom: "polygone + casing",
        subs: ["a-fill", "a-casing", "a-line"],
        primary: "a-fill",
        avant: 3,
    },
    {
        nom: "tuile vectorielle",
        subs: ["a-fill", "a-casing", "a-line", "a-circle"],
        primary: "a-fill",
        avant: 4,
    },
] as const;

beforeEach(() => vi.clearAllMocks());

describe("garde de non-vacuité — le binder lie bien quelque chose", () => {
    test("une couche à sous-couche unique reçoit clic ET survol", () => {
        const map = bind(["a-fill"]);
        expect(idsFor(map, "click")).toEqual(["a-fill"]);
        expect(idsFor(map, "mousemove")).toEqual(["a-fill"]);
    });
});

describe("un geste = un événement, quelle que soit la géométrie", () => {
    for (const g of GEOMETRIES) {
        test(`${g.nom} — le clic ne se lie qu'à \`${g.primary}\` (${g.avant} événements avant)`, () => {
            const map = bind([...g.subs]);
            expect(idsFor(map, "click")).toEqual([g.primary]);
        });

        test(`${g.nom} — un clic n'émet qu'UN \`geoleaf:feature:click\``, () => {
            const map = bind([...g.subs]);
            expect(clicksEmitted(map)).toBe(1);
        });
    }
});

describe("le clic et le survol partagent la MÊME précédence", () => {
    for (const g of GEOMETRIES) {
        test(`${g.nom} — les deux gestes visent les mêmes sous-couches`, () => {
            const map = bind([...g.subs]);
            expect(idsFor(map, "click")).toEqual(idsFor(map, "mousemove"));
        });
    }
});

describe("ce que le correctif ne doit PAS emporter", () => {
    test("une sous-couche absente de la carte reste non branchée", () => {
        const map = fakeMap(["a-fill"]);
        bindFeatureInteractionEvents("L", {}, map as never, ["a-fill", "fantome-fill"]);
        expect(idsFor(map, "click")).toEqual(["a-fill"]);
    });

    test("le primaire absent de la carte ne branche aucun clic", () => {
        const map = fakeMap([]);
        bindFeatureInteractionEvents("L", {}, map as never, ["a-fill", "a-line"]);
        expect(idsFor(map, "click")).toEqual([]);
    });
});
