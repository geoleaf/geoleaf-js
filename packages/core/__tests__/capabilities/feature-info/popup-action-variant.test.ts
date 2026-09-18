/**
 * @file popup-action-variant.test.ts
 * @description An action's declared visual weight reaches the DOM, consecutive actions
 * share one row, and the popup's close cross is a setting rather than a constant.
 *
 * Why this test exists (11/09/2026)
 * ---------------------------------
 * `variant: "primary"` / `"secondary"` on an `action` field was read by NOTHING: the
 * button's class was a literal, and the descriptor's `variant` only knew image and text
 * hints. A layer declaring two creation actions and three consultation actions got five
 * identical buttons, in silence — a key with no reader. The pre-extraction core emitted
 * `gl-poi-popup__action--<variant>` and grouped consecutive actions in
 * `.gl-poi-popup__actions`; the extraction preserved every other class name of the popup
 * and dropped these two.
 *
 * Same file for `closeButton`: written `false` in the surface, with no way to override it.
 *
 * ⚠️ The schema case is the one that keeps the three declarations honest: it renders
 * EVERY value `attributeOptions.variant` allows, so a value added to the schema that the
 * engine does not dress fails here, not in a profile.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { LayerAttributes } from "../../../src/contracts/attributes.contract.js";
import type {
    RenderContext,
    RenderField,
} from "../../../src/capabilities/feature-info/render/dom.js";
import type {
    GeoLeafFeatureClickDetail,
    SidePanelLayout,
} from "../../../src/capabilities/feature-info/types.js";

const { configGet } = vi.hoisted(() => ({
    configGet: vi.fn((_key: string, fallback?: unknown): unknown => fallback),
}));

// `getFeatureInfoConfig()` reads the typed core Config — the seam the popup surface now
// consults for `popup.closeButton`.
vi.mock("../../../src/kernel/config/config-primitives.js", () => ({
    Config: { get: (key: string, fallback?: unknown): unknown => configGet(key, fallback) },
}));

import { buildPopupContent } from "../../../src/capabilities/feature-info/render/popup-content.js";
import { buildSidePanelBody } from "../../../src/capabilities/feature-info/render/sidepanel-content.js";
import { fieldsForSurface } from "../../../src/capabilities/feature-info/attributes-binding.js";
import {
    destroyPopup,
    handleClick,
} from "../../../src/capabilities/feature-info/surfaces/popup.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA = resolve(__dirname, "../../../../../profiles/schemas/layer-config.schema.json");

const CTX: RenderContext = { layerId: "poi", featureId: 7, lngLat: { lat: 1, lng: 2 } };
const PROPS: Record<string, unknown> = { name: "Poste 12" };

/** The subset of the layer schema this test reads. */
interface SchemaView {
    readonly definitions: {
        readonly attributeOptions: {
            readonly properties: { readonly variant?: { readonly enum?: readonly string[] } };
        };
    };
}

/** An action descriptor — `field: "name"` so the side panel, which skips empty values, renders it too. */
const action = (actionId: string, extra: Partial<RenderField> = {}): RenderField => ({
    field: "name",
    type: "action",
    actionId,
    label: actionId,
    ...extra,
});

const popupOf = (fields: readonly RenderField[]): HTMLElement =>
    buildPopupContent(fields, PROPS, CTX, { hasSidepanel: false });

/** `querySelector`, but a missing node fails the test by name instead of as a null dereference. */
function mustFind<T extends Element>(root: ParentNode, selector: string): T {
    const found = root.querySelector<T>(selector);
    if (!found) throw new Error(`absent : ${selector}`);
    return found;
}

beforeEach(() => {
    configGet.mockImplementation((_key: string, fallback?: unknown) => fallback);
});

afterEach(() => {
    delete (globalThis as Record<string, unknown>).GeoLeaf;
    delete (globalThis as Record<string, unknown>).maplibregl;
    configGet.mockReset();
});

describe("la variante d'une action atteint le DOM", () => {
    it.each(["primary", "secondary", "danger"] as const)(
        "`%s` pose le modificateur BEM et `data-gl-variant`",
        (variant) => {
            const btn = mustFind<HTMLButtonElement>(
                popupOf([action("a", { variant })]),
                "button.gl-poi-popup__action"
            );
            expect(btn.classList.contains(`gl-poi-popup__action--${variant}`)).toBe(true);
            expect(btn.dataset["glVariant"]).toBe(variant);
        }
    );

    it("sans variante, ni modificateur ni attribut — le bouton d'avant, à l'identique", () => {
        const btn = mustFind<HTMLButtonElement>(
            popupOf([action("a")]),
            "button.gl-poi-popup__action"
        );
        expect(Array.from(btn.classList)).toEqual(["gl-poi-popup__action"]);
        expect(btn.hasAttribute("data-gl-variant")).toBe(false);
    });

    it("une variante inconnue ne pose rien, et le dit UNE fois", () => {
        const warn = vi.fn();
        (globalThis as Record<string, unknown>).GeoLeaf = { Log: { warn } };
        const fields = [action("inconnue", { variant: "bogus" })];

        const first = mustFind<HTMLButtonElement>(popupOf(fields), "button.gl-poi-popup__action");
        popupOf(fields);

        expect(Array.from(first.classList)).toEqual(["gl-poi-popup__action"]);
        expect(first.hasAttribute("data-gl-variant")).toBe(false);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain("bogus");
    });

    it("une clé du prototype n'est pas une variante", () => {
        (globalThis as Record<string, unknown>).GeoLeaf = { Log: { warn: vi.fn() } };
        const btn = mustFind<HTMLButtonElement>(
            popupOf([action("proto", { variant: "constructor" })]),
            "button.gl-poi-popup__action"
        );
        expect(Array.from(btn.classList)).toEqual(["gl-poi-popup__action"]);
    });

    it("chaque valeur admise par le schéma est habillée par le moteur", () => {
        const schema = JSON.parse(readFileSync(SCHEMA, "utf8")) as SchemaView;
        const allowed = schema.definitions.attributeOptions.properties.variant?.enum ?? [];
        expect(allowed.length, "le schéma n'annonce aucune variante").toBeGreaterThan(0);
        for (const variant of allowed) {
            const btn = mustFind<HTMLButtonElement>(
                popupOf([action(`s-${variant}`, { variant })]),
                "button"
            );
            expect(btn.classList.contains(`gl-poi-popup__action--${variant}`), variant).toBe(true);
        }
    });

    it("le bloc `attributes` y arrive aussi, par `options.variant`", () => {
        const attributes: LayerAttributes = {
            fields: [
                {
                    field: "name",
                    label: "Voir",
                    primitive: "string",
                    widget: "action",
                    options: { actionId: "voir", variant: "secondary" },
                    display: { surfaces: ["popup"] },
                },
            ],
        };
        const [field] = fieldsForSurface(attributes, "popup");
        if (!field) throw new Error("aucun descripteur projeté sur la bulle");
        const btn = mustFind<HTMLButtonElement>(popupOf([field]), "button.gl-poi-popup__action");
        expect(btn.classList.contains("gl-poi-popup__action--secondary")).toBe(true);
    });

    it("le panneau latéral porte la même variante — la table de rendu est partagée", () => {
        const body = buildSidePanelBody([action("p", { variant: "primary" })], PROPS, CTX);
        expect(body.querySelector("button.gl-poi-popup__action--primary")).not.toBeNull();
    });
});

describe("les actions consécutives partagent une rangée", () => {
    it("un seul `.gl-poi-popup__actions`, dans l'ordre déclaré", () => {
        const root = popupOf([
            { field: "name", type: "text" },
            action("a"),
            action("b"),
            action("c"),
        ]);
        expect(root.querySelectorAll(".gl-poi-popup__actions")).toHaveLength(1);
        const row = mustFind<HTMLElement>(root, ".gl-poi-popup__actions");
        expect(
            Array.from(row.children).map((b) => (b as HTMLElement).dataset["glActionId"])
        ).toEqual(["a", "b", "c"]);
        expect(root.querySelector(".gl-poi-popup__body > button.gl-poi-popup__action")).toBeNull();
    });

    it("un champ intercalé coupe la rangée en deux", () => {
        const root = popupOf([action("a"), { field: "name", type: "text" }, action("b")]);
        expect(root.querySelectorAll(".gl-poi-popup__actions")).toHaveLength(2);
    });

    it("un badge suivi d'une action : deux conteneurs, chacun le sien", () => {
        const root = popupOf([{ field: "name", type: "badge" }, action("a")]);
        expect(root.querySelectorAll(".gl-poi-popup__badges")).toHaveLength(1);
        expect(root.querySelectorAll(".gl-poi-popup__actions")).toHaveLength(1);
        expect(root.querySelector(".gl-poi-popup__badges button")).toBeNull();
    });

    it("une rangée dont aucun bouton ne rend n'est pas posée vide", () => {
        const root = popupOf([{ field: "name", type: "action" }]);
        expect(root.querySelector(".gl-poi-popup__actions")).toBeNull();
    });

    it("le panneau latéral garde sa mise en page — la rangée est celle de la bulle", () => {
        const body = buildSidePanelBody([action("a"), action("b")], PROPS, CTX);
        expect(body.querySelector(".gl-poi-popup__actions")).toBeNull();
    });
});

describe("la croix du popup est un réglage, plus une constante", () => {
    class FakePopup {
        static instances: FakePopup[] = [];
        readonly opts: Record<string, unknown>;
        constructor(opts: Record<string, unknown> = {}) {
            this.opts = opts;
            FakePopup.instances.push(this);
        }
        setLngLat(): this {
            return this;
        }
        setDOMContent(): this {
            return this;
        }
        addTo(): this {
            return this;
        }
        remove(): this {
            return this;
        }
        on(): this {
            return this;
        }
    }

    const DETAIL: GeoLeafFeatureClickDetail = {
        layerId: "l1",
        featureId: "f1",
        properties: { name: "Poste 12" },
        geometry: null,
        lngLat: { lat: 42.9, lng: 0.1 },
        point: { x: 10, y: 10 },
    };
    const LAYOUT: SidePanelLayout = { layerId: "l1", fields: [{ field: "name", type: "text" }] };

    beforeEach(() => {
        FakePopup.instances = [];
        (globalThis as Record<string, unknown>).maplibregl = { Popup: FakePopup };
        (globalThis as Record<string, unknown>).GeoLeaf = {
            Core: { getMap: () => ({ getNativeMap: () => ({}) }) },
        };
    });

    afterEach(() => destroyPopup());

    const openedWith = (featureInfoBlock: Record<string, unknown>): Record<string, unknown> => {
        configGet.mockImplementation((key: string, fallback?: unknown) =>
            key === "modules.feature-info" ? featureInfoBlock : fallback
        );
        handleClick(DETAIL, LAYOUT);
        const last = FakePopup.instances.at(-1);
        if (!last) throw new Error("aucun popup construit");
        return last.opts;
    };

    it("par défaut, pas de croix — le comportement d'avant", () => {
        expect(openedWith({})["closeButton"]).toBe(false);
    });

    it("`popup.closeButton: true` la montre", () => {
        expect(openedWith({ popup: { closeButton: true } })["closeButton"]).toBe(true);
    });

    it("une valeur qui n'est pas exactement `true` ne l'allume pas", () => {
        expect(openedWith({ popup: { closeButton: "yes" } })["closeButton"]).toBe(false);
    });
});
