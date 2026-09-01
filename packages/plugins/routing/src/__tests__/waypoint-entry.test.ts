/**
 * Unit tests — THE ENTRY PATH: what finally feeds the model.
 *
 * 🛑 `addWaypoint`, `moveWaypoint`, `roleAt` and `maxWaypoints` were shipped,
 * exposed and tested, and **nothing called them with a new point**. The panel
 * carried five controls and not one field. The composition tests exercised
 * the SINKS; these exercise the SOURCES.
 *
 * ⚠️ And they start from the DOM, not the API. An API-built oracle cannot tell
 * "three points can be composed" from "the model could do it if something
 * called it" — exactly the confusion that let the defect pass a closure review.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Waypoint } from "../model.js";

const { getNativeMapMock, searchMock } = vi.hoisted(() => ({
    getNativeMapMock: vi.fn(),
    searchMock: vi.fn(),
}));
vi.mock("@geoleaf/host-runtime", () => ({
    coreConfigGet: () => ({}),
    getNativeMap: () => getNativeMapMock(),
    Log: { warn: () => {}, error: () => {}, info: () => {} },
}));

const { parseTypedPoint } = await import("../parse-point.js");
const { pickWaypointOnMap } = await import("../pick-on-map.js");
const { createWaypointInput } = await import("../ui/waypoint-input.js");

/** The field's labels, reduced to what an assertion can read. */
const LABELS = {
    field: "champ",
    add: "ajouter",
    pickOnMap: "carte",
    picking: "cliquez…",
    refusal: (r: string) => `refus:${r}`,
};

describe("parseTypedPoint — l'ordre est `latitude, longitude`, et c'est le seul endroit", () => {
    it("🛑 rend le point dans l'ordre du MODÈLE, saisi dans celui de l'utilisateur", () => {
        // This repo carries `[lon, lat]` everywhere, rightly. The field is the
        // one place where the other order is correct: every consumer tool
        // prints `lat, lon`, and this package's stop list RE-DISPLAYS it in
        // that order. A field refusing what it just displayed fails on the
        // most obvious thing anyone tries.
        const r = parseTypedPoint("-21.0964, 55.4781");
        expect(r.ok).toBe(true);
        expect(r.ok && r.waypoint.coordinates).toEqual([55.4781, -21.0964]);
    });

    it("accepte l'espace et le point-virgule comme séparateurs", () => {
        for (const s of ["-21.0964 55.4781", "-21.0964;55.4781", "-21.0964 ; 55.4781"]) {
            const r = parseTypedPoint(s);
            expect(r.ok, s).toBe(true);
        }
    });

    it("🛑 accepte la VIRGULE DÉCIMALE quand le séparateur est explicite", () => {
        // It is what a French keyboard produces. Refusing it would make the field look broken.
        const r = parseTypedPoint("-21,0964 55,4781");
        expect(r.ok && r.waypoint.coordinates).toEqual([55.4781, -21.0964]);
    });

    it("virgule décimale ET virgule séparatrice : l'espace tranche", () => {
        // ⚠️ This test first asserted the OPPOSITE — that this form was
        // ambiguous and had to be refused. It is not: the space separates, the
        // commas decimalise, and it is exactly what a French keyboard
        // produces. Refusing it would have rejected the normal case. The
        // implementation was right; the claim was wider than its object.
        const r = parseTypedPoint("-21,0964, 55,4781");
        expect(r.ok && r.waypoint.coordinates).toEqual([55.4781, -21.0964]);
    });

    it("🛑 REFUSE la forme réellement ambiguë — quatre morceaux, aucune espace", () => {
        // `-21,0964,55,4781`: nothing says which comma separates. Guessing
        // puts the stop hundreds of kilometres away, and the user only sees a
        // point they did not ask for.
        expect(parseTypedPoint("-21,0964,55,4781").ok).toBe(false);
    });

    it("distingue « pas des coordonnées » de « hors limites »", () => {
        // The two call for different sentences: one invites searching for an
        // address, the other says the number itself is impossible.
        expect(parseTypedPoint("rue de la Paix")).toMatchObject({
            ok: false,
            reason: "not-coordinates",
        });
        expect(parseTypedPoint("200, 500")).toMatchObject({ ok: false, reason: "out-of-range" });
    });

    it("une latitude de 91 est refusée, 90 passe", () => {
        expect(parseTypedPoint("91, 0").ok).toBe(false);
        expect(parseTypedPoint("90, 0").ok).toBe(true);
    });

    it("le nom est optionnel — sans lui, la liste montrera les coordonnées", () => {
        expect(parseTypedPoint("1, 2").ok && parseTypedPoint("1, 2")).toMatchObject({
            waypoint: { coordinates: [2, 1] },
        });
        const named = parseTypedPoint("1, 2", "Chez moi");
        expect(named.ok && named.waypoint.name).toBe("Chez moi");
    });
});

describe("pickWaypointOnMap — ce qui compte est la SORTIE, pas l'entrée", () => {
    /** The subscriptions the doubled map received and returned. */
    let on: ReturnType<typeof vi.fn>;
    let off: ReturnType<typeof vi.fn>;
    let canvas: HTMLElement;

    beforeEach(() => {
        document.body.replaceChildren();
        canvas = document.createElement("div");
        canvas.style.cursor = "grab";
        document.body.append(canvas);
        on = vi.fn();
        off = vi.fn();
        getNativeMapMock.mockReturnValue({ on, off, getCanvas: () => canvas });
    });

    /**
     * The click handler the mode set.
     *
     * @returns The handler.
     */
    const handler = () => on.mock.calls[0]?.[1] as (e: unknown) => void;

    it("pose un gestionnaire de clic et passe le curseur en croix", () => {
        const mode = pickWaypointOnMap(() => {});
        expect(on).toHaveBeenCalledWith("click", expect.any(Function));
        expect(canvas.style.cursor).toBe("crosshair");
        expect(mode.active).toBe(true);
    });

    it("🛑 un clic RETIRE le gestionnaire avant même de rendre le point", () => {
        // One click, one stop. If the handler survived, an absent-minded
        // second click would add a point the user stopped expecting.
        const picked: Waypoint[] = [];
        pickWaypointOnMap((wp) => picked.push(wp));
        handler()({ lngLat: { lng: 55.4, lat: -21.1 } });
        expect(off).toHaveBeenCalledTimes(1);
        expect(picked).toEqual([{ coordinates: [55.4, -21.1] }]);
    });

    it("🛑 Échap sort du mode", () => {
        // Without a keyboard exit, the mode is a trap for anyone not using a
        // mouse. And it listens on the DOCUMENT because the canvas does not
        // hold focus reliably.
        const mode = pickWaypointOnMap(() => {});
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(mode.active).toBe(false);
        expect(off).toHaveBeenCalledTimes(1);
    });

    it("🛑 le curseur est RESTAURÉ à ce qu'il était, jamais vidé", () => {
        // Another layer may own the cursor; clearing it would cancel its
        // signal without stopping its mode.
        const mode = pickWaypointOnMap(() => {});
        mode.stop();
        expect(canvas.style.cursor).toBe("grab");
    });

    it("arrêter deux fois ne retire qu'une fois", () => {
        const mode = pickWaypointOnMap(() => {});
        mode.stop();
        mode.stop();
        expect(off).toHaveBeenCalledTimes(1);
    });

    it("🛑 un clic SANS position n'ajoute rien et ne sort pas du mode", () => {
        // Adding `[0, 0]` would drop a stop off the coast of Africa, which
        // reads as a bug of the computer and not of this handler.
        const picked: Waypoint[] = [];
        const mode = pickWaypointOnMap((wp) => picked.push(wp));
        handler()({});
        expect(picked).toHaveLength(0);
        expect(mode.active).toBe(true);
    });

    it("🛑 sans carte, le mode est INERTE et le dit", () => {
        // A button stuck on "click on the map" would wait for an impossible click.
        getNativeMapMock.mockReturnValue(undefined);
        const mode = pickWaypointOnMap(() => {});
        expect(mode.active).toBe(false);
        expect(() => mode.stop()).not.toThrow();
    });
});

describe("createWaypointInput — la source, vue depuis le DOM", () => {
    let host: HTMLElement;
    let added: Waypoint[];
    let pickAsked: number;

    beforeEach(() => {
        document.body.replaceChildren();
        host = document.createElement("div");
        document.body.append(host);
        added = [];
        pickAsked = 0;
        searchMock.mockReset();
        delete (globalThis as Record<string, unknown>).GeoLeaf;
    });

    /**
     * Mounts the field and returns its elements.
     *
     * @returns The field, its input and its add button.
     */
    function mount() {
        const input = createWaypointInput(LABELS, {
            onAdd: (wp) => added.push(wp),
            onPickOnMap: () => {
                pickAsked += 1;
            },
        });
        host.append(input.element);
        return {
            input,
            field: host.querySelector<HTMLInputElement>(
                ".gl-routing-add__field"
            ) as HTMLInputElement,
            add: host.querySelector<HTMLButtonElement>(
                ".gl-routing-add__submit"
            ) as HTMLButtonElement,
            pick: host.querySelector<HTMLButtonElement>(
                ".gl-routing-add__pick"
            ) as HTMLButtonElement,
            message: host.querySelector(".gl-routing-add__message") as HTMLElement,
        };
    }

    /** Installs a doubled geocoding plugin. */
    function withGeocoding() {
        (globalThis as Record<string, unknown>).GeoLeaf = { Geocoding: { search: searchMock } };
    }

    it("🛑 des coordonnées saisies deviennent une étape — c'est ce qui manquait", () => {
        const { field, add } = mount();
        field.value = "-21.0964, 55.4781";
        add.click();
        expect(added).toEqual([{ coordinates: [55.4781, -21.0964] }]);
        expect(field.value).toBe("");
    });

    it("Entrée vaut le bouton — le champ est utilisable sans souris", () => {
        const { field } = mount();
        field.value = "1, 2";
        field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        expect(added).toHaveLength(1);
    });

    it("🛑 SANS `geocoding`, une adresse est refusée par une phrase qui dit quoi faire", () => {
        // The integration is optional per the spec, and optional must mean
        // something: the field stays usable with coordinates, and says so.
        const { field, add, message } = mount();
        field.value = "rue de la Paix";
        add.click();
        expect(added).toHaveLength(0);
        expect(message.textContent).toBe("refus:not-coordinates");
    });

    it("🛑 des coordonnées HORS LIMITES ne partent PAS à la recherche", () => {
        // `200, 500` is a mistyped pair, not a place name. Searching it would
        // return something plausible and wrong — the worst of the three outcomes.
        withGeocoding();
        const { field, add, message } = mount();
        field.value = "200, 500";
        add.click();
        expect(searchMock).not.toHaveBeenCalled();
        expect(message.textContent).toBe("refus:out-of-range");
    });

    it("🛑 les coordonnées sont essayées AVANT la recherche — aucun quota dépensé", () => {
        withGeocoding();
        const { field, add } = mount();
        field.value = "1, 2";
        add.click();
        expect(searchMock).not.toHaveBeenCalled();
        expect(added).toHaveLength(1);
    });

    it("avec `geocoding`, une adresse rend des choix, et le choix devient l'étape", async () => {
        withGeocoding();
        searchMock.mockResolvedValue([{ label: "Rue de la Paix, Paris", lat: 48.86, lng: 2.33 }]);
        const { field, add } = mount();
        field.value = "rue de la Paix";
        add.click();
        await vi.waitFor(() =>
            expect(host.querySelectorAll(".gl-routing-add__result")).toHaveLength(1)
        );
        host.querySelector<HTMLButtonElement>(".gl-routing-add__result")?.click();
        expect(added).toEqual([{ coordinates: [2.33, 48.86], name: "Rue de la Paix, Paris" }]);
    });

    it("une recherche sans résultat le DIT, et ne se confond pas avec l'absence du plugin", async () => {
        withGeocoding();
        searchMock.mockResolvedValue([]);
        const { field, add, message } = mount();
        field.value = "zzzz";
        add.click();
        await vi.waitFor(() => expect(message.textContent).toBe("refus:no-match"));
    });

    it("une recherche qui échoue le dit AUTREMENT qu'une recherche vide", async () => {
        withGeocoding();
        searchMock.mockRejectedValue(new Error("réseau"));
        const { field, add, message } = mount();
        field.value = "zzzz";
        add.click();
        await vi.waitFor(() => expect(message.textContent).toBe("refus:search-failed"));
    });

    it("🛑 une recherche LENTE n'écrase pas une plus récente", async () => {
        // The user would pick among answers to a question they already replaced.
        withGeocoding();
        let releaseSlow: (v: unknown) => void = () => {};
        searchMock
            .mockImplementationOnce(() => new Promise((r) => (releaseSlow = r)))
            .mockResolvedValueOnce([{ label: "Récent", lat: 1, lng: 2 }]);
        const { field, add } = mount();
        field.value = "lent";
        add.click();
        field.value = "récent";
        add.click();
        await vi.waitFor(() =>
            expect(host.querySelector(".gl-routing-add__result")?.textContent).toBe("Récent")
        );
        releaseSlow([{ label: "Périmé", lat: 3, lng: 4 }]);
        // ⚠️ `await Promise.resolve()` is NOT enough, and the mutation showed
        // it: the slow search's `await` chain needs more than one microtask
        // turn to resume, so the assertion landed before the stale result had
        // its chance to overwrite. The guard came out GREEN having exercised
        // nothing. One macrotask turn lets the promise run to the end — and it
        // is the only way to assert a NON-event.
        await new Promise((r) => setTimeout(r, 0));
        expect(host.querySelector(".gl-routing-add__result")?.textContent).toBe("Récent");
        expect(host.querySelectorAll(".gl-routing-add__result")).toHaveLength(1);
    });

    it("le bouton « carte » délègue, il n'attache rien lui-même", () => {
        const { pick } = mount();
        pick.click();
        expect(pickAsked).toBe(1);
    });

    it("l'état de sélection se lit sur le bouton, pas seulement dans son texte", () => {
        const { input, pick } = mount();
        input.setPicking(true);
        expect(pick.textContent).toBe("cliquez…");
        expect(pick.getAttribute("aria-pressed")).toBe("true");
        input.setPicking(false);
        expect(pick.getAttribute("aria-pressed")).toBe("false");
    });

    it("le champ porte un nom accessible qui SURVIT à la première frappe", () => {
        // A placeholder vanishes at the first keystroke, and nothing
        // guarantees a screen reader announces it. Both, then.
        const { field } = mount();
        expect(field.getAttribute("aria-label")).toBe("champ");
        expect(field.placeholder).toBe("champ");
    });

    it("le libellé d'un résultat passe par `textContent`", () => {
        withGeocoding();
        searchMock.mockResolvedValue([{ label: '<img src=x onerror="alert(1)">', lat: 1, lng: 2 }]);
        const { field, add } = mount();
        field.value = "x";
        add.click();
        return vi.waitFor(() => {
            const r = host.querySelector(".gl-routing-add__result");
            expect(r?.querySelector("img")).toBeNull();
            expect(r?.textContent).toContain("<img");
        });
    });
});
