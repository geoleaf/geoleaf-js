/*!
 * Tests — the `AddForm` half, absent from `editor` until now
 *
 * ⚠️ The doubles REPRODUCE three measured constraints, they do not bypass them:
 *
 * 1. **`getWiring` is a PROVIDER that may return `null`.** The real case of a
 *    boot without a map, and above all the one `events.ts`'s wiring produced:
 *    its `_wiring` is only set at Terra Draw's LAZY load, so a POI placed
 *    without ever arming a tool would have gone into the void. The save must
 *    fail LOUDLY.
 * 2. **The placement callback is REPEATED** — `placement-mode.ts` keeps the
 *    marker after the tap and its `dragend` replays the callback. The double
 *    therefore calls twice.
 * 3. **`submitFeature` returns a promise** whose rejection leaves the modal
 *    open so the user can retry. The double returns it, it does not replace
 *    it with a boolean.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const _submitFeature = vi.fn();
const _clearMarker = vi.fn();
const _activate = vi.fn();
const _notify = vi.fn();

vi.mock("../persistence/submit.js", () => ({
    submitFeature: (...args: unknown[]) => _submitFeature(...args),
}));
vi.mock("../events.js", () => ({
    buildSubmitContext: (w: unknown) => ({ wiring: w }),
}));
vi.mock("../drawing/placement-mode.js", () => ({
    PlacementMode: { clearMarker: () => _clearMarker() },
}));
vi.mock("../drawing/placement-api.js", () => ({
    buildPlacementApi: () => ({
        activate: (map: unknown, cb: unknown) => _activate(map, cb),
    }),
}));
vi.mock("../drawing/geo-compute.js", () => ({
    applyComputedFields: (_schema: unknown, geometry: unknown) => ({ _geom: geometry }),
}));
vi.mock("../internal.js", () => ({
    _getLabel: (k: string) => k,
    _notify: (kind: string, msg: string) => _notify(kind, msg),
}));
vi.mock("@geoleaf/host-runtime", () => ({
    getGeoLeaf: () => (globalThis as Record<string, unknown>).GeoLeaf,
}));

let _cfg: Record<string, unknown> = {};
let _accuracyField: string | null = null;
vi.mock("../config.js", () => ({
    getEditorConfig: () => _cfg,
    accuracyFieldOf: () => _accuracyField,
}));

const { initAddForm, destroyAddForm, openAddForm, startPoiCapture, buildAddFormApi } =
    await import("../add-form/placement-form.js");

/** Captures the options handed to the modal, so the test can drive onSave/onCancel. */
let opened: Record<string, unknown>[] = [];
const wiring = { adapter: {}, strategy: "prompt" } as unknown;

/** The "modify the existing one" seam, injected by `entry.ts` in production. */
const _editExisting = vi.fn(async () => true);

function mount(getWiring: () => unknown = () => wiring) {
    opened = [];
    initAddForm({
        openForm: (o: unknown) => opened.push(o as Record<string, unknown>),
        getWiring: getWiring as () => never,
        editExisting: _editExisting,
    });
}

beforeEach(() => {
    _submitFeature.mockReset().mockResolvedValue(undefined);
    _clearMarker.mockReset();
    _activate.mockReset();
    _notify.mockReset();
    _editExisting.mockReset().mockResolvedValue(true);
    _accuracyField = null;
    _cfg = { poiAddDefaultPosition: "placement-mode" };
    mount();
});

afterEach(() => {
    destroyAddForm();
    delete (globalThis as Record<string, unknown>).GeoLeaf;
});

// --- ouverture -------------------------------------------------------------------

describe("openAddForm", () => {
    it("ouvre le formulaire sur un Point construit depuis la position", () => {
        openAddForm({ lat: -21.11, lng: 55.53 });
        expect(opened).toHaveLength(1);
        expect(opened[0]!["geometryType"]).toBe("Point");
        const compute = opened[0]!["computeValues"] as (s: unknown) => { _geom: unknown };
        expect(compute([])._geom).toEqual({ type: "Point", coordinates: [55.53, -21.11] });
    });

    it("laisse la modale résoudre titre et schéma par couche cible", () => {
        openAddForm({ lat: 1, lng: 2 });
        expect(opened[0]!["title"]).toBe("");
        expect(opened[0]!["schema"]).toEqual([]);
    });

    it("sans câblage injecté, prévient au lieu de s'ouvrir en silence", () => {
        destroyAddForm();
        openAddForm({ lat: 1, lng: 2 });
        expect(opened).toHaveLength(0);
        expect(_notify).toHaveBeenCalledWith("error", "editor.addform.unavailable");
    });
});

// --- drag re-entrance --------------------------------------------------------------

describe("Le rappel répété du marqueur glissé", () => {
    it("NE rouvre PAS le formulaire au second appel", () => {
        openAddForm({ lat: 1, lng: 2 });
        openAddForm({ lat: 9, lng: 8 });
        expect(opened).toHaveLength(1);
    });

    it("sauvegarde à la position CORRIGÉE, pas à celle du tap", async () => {
        openAddForm({ lat: 1, lng: 2 });
        openAddForm({ lat: 9, lng: 8 }); // le glisser
        const onSave = opened[0]!["onSave"] as (v: unknown, l: string) => Promise<void>;
        await onSave({ nom: "x" }, "couche");
        expect(_submitFeature).toHaveBeenCalledTimes(1);
        const args = _submitFeature.mock.calls[0]![1] as { feature: { geometry: unknown } };
        expect(args.feature.geometry).toEqual({ type: "Point", coordinates: [8, 9] });
    });

    it("rouvre après une annulation — la capture est terminée", () => {
        openAddForm({ lat: 1, lng: 2 });
        (opened[0]!["onCancel"] as () => void)();
        openAddForm({ lat: 3, lng: 4 });
        expect(opened).toHaveLength(2);
    });
});

// --- the save --------------------------------------------------------------------

describe("La sauvegarde", () => {
    it("passe par submitFeature en création, sur la couche choisie", async () => {
        openAddForm({ lat: 1, lng: 2 });
        const onSave = opened[0]!["onSave"] as (v: unknown, l: string) => Promise<void>;
        await onSave({ nom: "x" }, "candelabres");
        const args = _submitFeature.mock.calls[0]![1] as Record<string, unknown>;
        expect(args["layerId"]).toBe("candelabres");
        expect(args["isUpdate"]).toBe(false);
        expect((args["feature"] as { properties: unknown }).properties).toEqual({ nom: "x" });
    });

    it("retire le marqueur temporaire une fois la sauvegarde réglée", async () => {
        openAddForm({ lat: 1, lng: 2 });
        const onSave = opened[0]!["onSave"] as (v: unknown, l: string) => Promise<void>;
        expect(_clearMarker).not.toHaveBeenCalled();
        await onSave({}, "c");
        expect(_clearMarker).toHaveBeenCalledTimes(1);
    });

    it("retire le marqueur à l'annulation aussi", () => {
        openAddForm({ lat: 1, lng: 2 });
        (opened[0]!["onCancel"] as () => void)();
        expect(_clearMarker).toHaveBeenCalledTimes(1);
    });

    it("🛑 REJETTE quand le câblage manque — jamais un succès muet", async () => {
        mount(() => null);
        openAddForm({ lat: 1, lng: 2 });
        const onSave = opened[0]!["onSave"] as (v: unknown, l: string) => Promise<void>;
        await expect(onSave({ nom: "perdu" }, "c")).rejects.toThrow(/wiring/i);
        expect(_submitFeature).not.toHaveBeenCalled();
        expect(_notify).toHaveBeenCalledWith("error", "editor.addform.unavailable");
        // The capture stays in the modal: nothing is removed, the user can retry.
        expect(_clearMarker).not.toHaveBeenCalled();
    });

    it("ne retire pas le marqueur si la persistance échoue", async () => {
        _submitFeature.mockRejectedValue(new Error("réseau"));
        openAddForm({ lat: 1, lng: 2 });
        const onSave = opened[0]!["onSave"] as (v: unknown, l: string) => Promise<void>;
        await expect(onSave({}, "c")).rejects.toThrow("réseau");
        expect(_clearMarker).not.toHaveBeenCalled();
    });
});

// --- l'orchestration de capture --------------------------------------------------

describe("startPoiCapture", () => {
    it("arme le mode placement par défaut", () => {
        startPoiCapture(null);
        expect(_activate).toHaveBeenCalledTimes(1);
        expect(opened).toHaveLength(0);
    });

    it("ouvre le formulaire quand le tap rend une position libre", () => {
        startPoiCapture(null);
        const cb = _activate.mock.calls[0]![1] as (r: unknown) => void;
        cb({ latlng: { lat: 5, lng: 6 }, snapped: null, intent: "create" });
        expect(opened).toHaveLength(1);
    });

    // 🛑 THE DEFECT THIS REPLACES. This callback used to read `result?.latlng` alone, so a
    // placement SNAPPED onto an existing feature opened a CREATION form on that feature's
    // own coordinates — two records at the same point, indistinguishable in the ERP.
    it("« modifier l'existant » ouvre l'entité voisine et n'ouvre AUCUN formulaire de création", async () => {
        startPoiCapture(null);
        const cb = _activate.mock.calls[0]![1] as (r: unknown) => void;
        cb({
            latlng: { lat: 5, lng: 6 },
            snapped: { latlng: { lat: 5, lng: 6 }, layerId: "candelabres", id: "c-7" },
            intent: "edit",
        });
        await vi.waitFor(() => expect(_editExisting).toHaveBeenCalledWith("candelabres", "c-7"));
        expect(opened).toHaveLength(0);
    });

    it("dit franchement que l'entité existante n'a pas pu être ouverte", async () => {
        _editExisting.mockResolvedValue(false);
        startPoiCapture(null);
        const cb = _activate.mock.calls[0]![1] as (r: unknown) => void;
        cb({
            latlng: { lat: 5, lng: 6 },
            snapped: { latlng: { lat: 5, lng: 6 }, layerId: "candelabres", id: "c-7" },
            intent: "edit",
        });
        await vi.waitFor(() =>
            expect(_notify).toHaveBeenCalledWith("error", "editor.placement.editUnavailable")
        );
    });

    it("« abandon » n'ouvre rien et rend la main", () => {
        const settled = vi.fn();
        startPoiCapture(null, settled);
        const cb = _activate.mock.calls[0]![1] as (r: unknown) => void;
        cb({ latlng: { lat: 5, lng: 6 }, snapped: { id: "c-7" }, intent: "abandon" });
        expect(opened).toHaveLength(0);
        expect(_editExisting).not.toHaveBeenCalled();
        expect(settled).toHaveBeenCalledTimes(1);
    });

    it("rend la main à l'appelant quand la capture est abandonnée", () => {
        const settled = vi.fn();
        startPoiCapture(null, settled);
        (_activate.mock.calls[0]![1] as (r: unknown) => void)(null);
        expect(settled).toHaveBeenCalledTimes(1);
        expect(opened).toHaveLength(0);
    });

    it("utilise le point GPS quand il existe ET que la config le demande", () => {
        _cfg = { poiAddDefaultPosition: "geolocation" };
        (globalThis as Record<string, unknown>).GeoLeaf = {
            Geolocation: { getState: () => ({ userPosition: { lat: 7, lng: 8 } }) },
        };
        startPoiCapture(null);
        expect(_activate).not.toHaveBeenCalled();
        expect(opened).toHaveLength(1);
    });

    // --- la précision GPS -------------------------------------------------
    //
    // 🛑 The core measures `accuracy` and this module used to DROP it, in a way the compiler
    // could not see: `startPoiCapture` re-typed the core's snapshot to `{ lat; lng }` when
    // reading it. A field position with no recorded precision cannot be told apart from a
    // surveyed one.

    it("écrit la précision GPS quand le profil a nommé le champ", async () => {
        _cfg = { poiAddDefaultPosition: "geolocation" };
        _accuracyField = "precision_gps_m";
        (globalThis as Record<string, unknown>).GeoLeaf = {
            Geolocation: { getState: () => ({ userPosition: { lat: 7, lng: 8, accuracy: 4.2 } }) },
        };
        startPoiCapture(null);
        await (opened[0]!["onSave"] as (v: unknown, l: string) => Promise<void>)(
            { nom: "L7" },
            "candelabres"
        );
        expect(_submitFeature.mock.calls[0]![1].feature.properties).toEqual({
            nom: "L7",
            precision_gps_m: 4.2,
        });
    });

    // 🛑 `buildCollectionBody` only copies the keys the layer whitelists, so a property no
    // profile declared is dropped on the wire. Writing one anyway would look like it worked.
    it("n'écrit RIEN quand le profil n'a nommé aucun champ", async () => {
        _cfg = { poiAddDefaultPosition: "geolocation" };
        _accuracyField = null;
        (globalThis as Record<string, unknown>).GeoLeaf = {
            Geolocation: { getState: () => ({ userPosition: { lat: 7, lng: 8, accuracy: 4.2 } }) },
        };
        startPoiCapture(null);
        await (opened[0]!["onSave"] as (v: unknown, l: string) => Promise<void>)(
            { nom: "L7" },
            "candelabres"
        );
        expect(_submitFeature.mock.calls[0]![1].feature.properties).toEqual({ nom: "L7" });
    });

    // 🛑 A tap carries no measurement. Attributing a GPS precision to a finger-placed point
    // would be a FALSE value, which is worse than a missing one.
    it("n'invente aucune précision pour un point posé au doigt sur la carte", async () => {
        _accuracyField = "precision_gps_m";
        startPoiCapture(null);
        const cb = _activate.mock.calls[0]![1] as (r: unknown) => void;
        cb({ latlng: { lat: 5, lng: 6 }, snapped: null, intent: "create" });
        await (opened[0]!["onSave"] as (v: unknown, l: string) => Promise<void>)(
            { nom: "L7" },
            "candelabres"
        );
        expect(_submitFeature.mock.calls[0]![1].feature.properties).toEqual({ nom: "L7" });
    });

    it("🛑 retombe sur le placement quand le GPS n'a pas de point, sans échouer", () => {
        _cfg = { poiAddDefaultPosition: "geolocation" };
        (globalThis as Record<string, unknown>).GeoLeaf = {
            Geolocation: { getState: () => ({ userPosition: null }) },
        };
        startPoiCapture(null);
        expect(_activate).toHaveBeenCalledTimes(1);
    });

    it("ignore le GPS quand la config demande le placement", () => {
        (globalThis as Record<string, unknown>).GeoLeaf = {
            Geolocation: { getState: () => ({ userPosition: { lat: 7, lng: 8 } }) },
        };
        startPoiCapture(null);
        expect(_activate).toHaveBeenCalledTimes(1);
        expect(opened).toHaveLength(0);
    });

    it("ne jette pas quand la capacité de géolocalisation est absente", () => {
        _cfg = { poiAddDefaultPosition: "geolocation" };
        expect(() => startPoiCapture(null)).not.toThrow();
        expect(_activate).toHaveBeenCalledTimes(1);
    });
});

// --- the facade ------------------------------------------------------------------

describe("buildAddFormApi", () => {
    it("expose openAddForm sous la clé que le créneau appelle", () => {
        const api = buildAddFormApi();
        expect(typeof api.openAddForm).toBe("function");
        api.openAddForm({ lat: 1, lng: 2 });
        expect(opened).toHaveLength(1);
    });
});
