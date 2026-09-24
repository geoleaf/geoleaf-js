/**
 * @file dom-anchors.guard.test.ts
 * @description Guard test — the DOM contract (CC-08) finds an anchor where it is placed, in
 * the form it is placed, and only in the package that places it.
 *
 * Why this guard exists
 * ------------------------------------------------------------------------------------
 * A consumer declares the selectors it reads in our DOM; the inverse contract must find
 * each one in our sources, or an anchor it depends on can vanish in silence. Two blind spots
 * made live anchors undeclarable: an anchor set through `dataset` is written in camelCase
 * and never as its `data-*` name, and an anchor placed by a lib was searched in the core.
 * Widening the corpus to every package would have closed the second by opening a worse
 * one: a selector is not unique across the monorepo, so foreign witnesses would green an
 * anchor its real placer dropped. These cases pin both halves: what counts as placing, and
 * which package is searched.
 *
 * The rule end to end — a fixture manifest spawned through the real gate — is exercised by
 * `scripts/probe-gate-visibility.cjs`.
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const requireCjs = createRequire(import.meta.url);

interface Needles {
    literal: string;
    datasetKey: string | null;
}
interface DomAnchors {
    datasetKeyOf(attr: string): string | null;
    needlesOf(selector: string): Needles;
    isPlaced(source: { text: string }, needles: Needles): boolean;
    resolveAnchorProvider(
        provider: unknown,
        registry: unknown
    ): { pkg: { dirName: string } } | { refusal: string };
    anchorCorpus(pkg: unknown): string[];
}

const anchors: DomAnchors = requireCjs("../../../../scripts/lib/dom-anchors.cjs");
const registry = requireCjs("../../../../scripts/lib/packages.cjs");

const placed = (text: string, selector: string): boolean =>
    anchors.isPlaced({ text }, anchors.needlesOf(selector));

describe("CC-08 — la clé `dataset` d'un attribut", () => {
    it("dérive la clé comme le DOM", () => {
        expect(anchors.datasetKeyOf("data-gl-action-id")).toBe("glActionId");
        expect(anchors.datasetKeyOf("data-gl-rp-tab")).toBe("glRpTab");
        expect(anchors.datasetKeyOf("data-layer-id")).toBe("layerId");
    });

    it("ne retire que le premier préfixe `data-`", () => {
        expect(anchors.datasetKeyOf("data-data-x")).toBe("dataX");
    });

    it("garde un tiret suivi d'autre chose qu'une minuscule", () => {
        expect(anchors.datasetKeyOf("data-col-2")).toBe("col-2");
    });

    it("n'a pas de clé hors `data-*`, ni pour un nom vide", () => {
        expect(anchors.datasetKeyOf("aria-label")).toBeNull();
        expect(anchors.datasetKeyOf("data-")).toBeNull();
    });
});

describe("CC-08 — les aiguilles d'un sélecteur", () => {
    it("garde l'aiguille historique d'un id et d'une classe, sans clé `dataset`", () => {
        expect(anchors.needlesOf("#gl-right-panel")).toEqual({
            literal: "gl-right-panel",
            datasetKey: null,
        });
        expect(anchors.needlesOf(".gl-map-toolbar-wrapper")).toEqual({
            literal: ".gl-map-toolbar-wrapper",
            datasetKey: null,
        });
    });

    it("ajoute la clé `dataset` à un attribut `data-*` nu", () => {
        expect(anchors.needlesOf("[data-gl-action-id]")).toEqual({
            literal: "data-gl-action-id",
            datasetKey: "glActionId",
        });
    });

    it("n'en ajoute pas à un sélecteur valué, qui garde son aiguille historique", () => {
        expect(anchors.needlesOf("[data-gl-sheet='filters']")).toEqual({
            literal: "data-gl-sheet='filters'",
            datasetKey: null,
        });
    });
});

describe("CC-08 — ce qui POSE une ancre", () => {
    it("le nom `data-*` écrit en toutes lettres", () => {
        expect(placed(`el.setAttribute("data-layer-id", id);`, "[data-layer-id]")).toBe(true);
    });

    it("les trois positions d'écriture de la clé `dataset`", () => {
        expect(placed(`btn.dataset.glActionId = id;`, "[data-gl-action-id]")).toBe(true);
        expect(placed(`btn.dataset["glActionId"] = id;`, "[data-gl-action-id]")).toBe(true);
        expect(placed(`btn.dataset['glActionId'] =\n    id;`, "[data-gl-action-id]")).toBe(true);
        expect(
            placed(`_el("div", { dataset: { glActionId: id, other: 1 } });`, "[data-gl-action-id]")
        ).toBe(true);
    });

    it("pas une LECTURE de la clé", () => {
        expect(placed(`if (btn.dataset.glActionId === id) {}`, "[data-gl-action-id]")).toBe(false);
        expect(placed(`const a = btn.dataset["glActionId"];`, "[data-gl-action-id]")).toBe(false);
    });

    it("pas une clé qui n'en est que le préfixe ou le suffixe", () => {
        expect(placed(`btn.dataset.glAction = id;`, "[data-gl-action-id]")).toBe(false);
        expect(placed(`btn.dataset.glActionIdx = id;`, "[data-gl-action-id]")).toBe(false);
    });

    it("pas la clé camelCase nue, hors d'une position `dataset`", () => {
        expect(placed(`const glActionId = 1;`, "[data-gl-action-id]")).toBe(false);
    });

    it("pas la clé `dataset` pour un id : seul le littéral compte", () => {
        expect(placed(`el.dataset.glRightPanel = "1";`, "#gl-right-panel")).toBe(false);
    });
});

describe("CC-08 — le paquet où l'on cherche", () => {
    const dirOf = (provider: unknown): string | undefined => {
        const r = anchors.resolveAnchorProvider(provider, registry);
        return "pkg" in r ? r.pkg.dirName : undefined;
    };
    const refuses = (provider: unknown): boolean =>
        "refusal" in anchors.resolveAnchorProvider(provider, registry);

    it("le cœur par défaut", () => {
        expect(dirOf(undefined)).toBe("core");
        expect(dirOf("core")).toBe("core");
    });

    it("une lib, un plugin, sous leur préfixe", () => {
        expect(dirOf("lib:field-renderer")).toBe("field-renderer");
        expect(dirOf("plugin:editor")).toBe("editor");
    });

    it("refuse l'application de démo : elle pose ce que pose un hôte", () => {
        expect(refuses("lib:geoleaf-app")).toBe(true);
    });

    it("refuse un paquet désigné sous le mauvais préfixe", () => {
        expect(refuses("lib:editor")).toBe(true);
        expect(refuses("lib:core")).toBe(true);
        expect(refuses("plugin:field-renderer")).toBe(true);
    });

    it("refuse un répertoire inconnu, une forme inconnue, une valeur non chaîne", () => {
        expect(refuses("lib:nexiste-pas")).toBe(true);
        expect(refuses("package:core")).toBe(true);
        expect(refuses(42)).toBe(true);
    });

    it("le corpus d'un paquet exclut ses tests et ses déclarations", () => {
        const core = registry.requireByDirName("core");
        const renderer = registry.requireByDirName("field-renderer");
        const files = [...anchors.anchorCorpus(core), ...anchors.anchorCorpus(renderer)];
        expect(files.length).toBeGreaterThan(0);
        expect(files.some((f) => f.endsWith(".css"))).toBe(true);
        expect(files.filter((f) => /__tests__|\.test\.|\.d\.ts$/.test(f))).toEqual([]);
    });
});
