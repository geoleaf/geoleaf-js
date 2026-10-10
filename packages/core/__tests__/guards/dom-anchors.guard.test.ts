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
    kind: "id" | "class" | "attr" | "other";
    name: string;
    value: string | null;
}
interface DomAnchors {
    datasetKeyOf(attr: string): string | null;
    needlesOf(selector: string): Needles;
    isPlaced(source: { text: string; css?: boolean }, needles: Needles): boolean;
    isPlacedInCorpus(sources: Array<{ text: string; css?: boolean }>, needles: Needles): boolean;
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

/** The same question, asked of a package: several files, scripts and stylesheets. */
const placedIn = (files: Array<string | { css: string }>, selector: string): boolean =>
    anchors.isPlacedInCorpus(
        files.map((f) => (typeof f === "string" ? { text: f } : { text: f.css, css: true })),
        anchors.needlesOf(selector)
    );

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
    it("garde l'aiguille historique d'un id et d'une classe, et dit leur forme", () => {
        expect(anchors.needlesOf("#gl-right-panel")).toEqual({
            literal: "gl-right-panel",
            datasetKey: null,
            kind: "id",
            name: "gl-right-panel",
            value: null,
        });
        expect(anchors.needlesOf(".gl-map-toolbar-wrapper")).toEqual({
            literal: ".gl-map-toolbar-wrapper",
            datasetKey: null,
            kind: "class",
            name: "gl-map-toolbar-wrapper",
            value: null,
        });
    });

    it("ajoute la clé `dataset` à un attribut `data-*` nu", () => {
        expect(anchors.needlesOf("[data-gl-action-id]")).toEqual({
            literal: "data-gl-action-id",
            datasetKey: "glActionId",
            kind: "attr",
            name: "data-gl-action-id",
            value: null,
        });
    });

    it("un sélecteur valué garde son aiguille historique, et rend sa valeur à part", () => {
        const expected = {
            literal: "data-gl-sheet='filters'",
            datasetKey: null,
            kind: "attr",
            name: "data-gl-sheet",
            value: "filters",
        };
        expect(anchors.needlesOf("[data-gl-sheet='filters']")).toEqual(expected);
        // Quoted either way, or not at all: one attribute, one value.
        expect(anchors.needlesOf('[data-gl-sheet="filters"]')).toMatchObject({
            kind: "attr",
            name: "data-gl-sheet",
            value: "filters",
        });
        expect(anchors.needlesOf("[data-gl-sheet=filters]")).toMatchObject({ value: "filters" });
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

// ═══════════════════════════════════════════════════════════════════════════════════════════
// A placement, by selector form
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// The search was a SUBSTRING: an anchor the package stopped placing stayed green as long as one
// of its files read it, styled it or named it in a comment. What places a node depends on the
// form of the selector, and each form has its own definition below.
//
// Cases marked 🛑 are TARGETS, seen red before the rule; plain titles are guards against the
// opposite failure — a real placement that would turn red. Their idioms are the ones the core
// uses, measured: of the classes its stylesheets target, more are placed through a helper, a
// ternary or a lookup table than by `className =`.

describe("CC-08 — un id se pose, il ne se lit pas", () => {
    it("🛑 une lecture ne pose rien", () => {
        expect(
            placed(`const p = document.getElementById("gl-right-panel");`, "#gl-right-panel")
        ).toBe(false);
        expect(placed(`root.querySelector("#gl-right-panel")?.remove();`, "#gl-right-panel")).toBe(
            false
        );
        expect(placed(`if (el.id === "gl-right-panel") return;`, "#gl-right-panel")).toBe(false);
    });

    it("🛑 ni une feuille de style, ni un commentaire", () => {
        expect(placedIn([{ css: `#gl-right-panel { display: none; }` }], "#gl-right-panel")).toBe(
            false
        );
        // A comment that SPELLS a write is still a comment — on a line, or in a block.
        expect(placed(`// panel.id = "gl-right-panel";`, "#gl-right-panel")).toBe(false);
        expect(placed(`/* panel.id = "gl-right-panel"; */`, "#gl-right-panel")).toBe(false);
    });

    it("🛑 ni un nom plus long qui le contient", () => {
        expect(placed(`panel.id = "gl-right-panel-open";`, "#gl-right-panel")).toBe(false);
        expect(placed(`document.body.classList.add("gl-right-panel");`, "#gl-right-panel")).toBe(
            false
        );
    });

    it("les écritures directes : l'affectation, la clé d'objet, l'attribut, le HTML", () => {
        expect(placed(`panel.id = "gl-left-panel";`, "#gl-left-panel")).toBe(true);
        expect(
            placed(`createEl("div", {\n    id: "gl-filter-panel",\n});`, "#gl-filter-panel")
        ).toBe(true);
        expect(placed(`el.setAttribute("id", "gl-x");`, "#gl-x")).toBe(true);
        expect(placed('root.innerHTML = `<div id="gl-x"></div>`;', "#gl-x")).toBe(true);
    });

    it("un id posé par une constante — la constante ET son écriture", () => {
        expect(
            placed(`const PANEL_ID = "gl-right-panel";\npanel.id = PANEL_ID;`, "#gl-right-panel")
        ).toBe(true);
        // …wherever the two live in the package.
        expect(
            placedIn(
                [
                    `export const PANEL_ID = "gl-right-panel";`,
                    `import { PANEL_ID } from "./c.js";\nel.id = PANEL_ID;`,
                ],
                "#gl-right-panel"
            )
        ).toBe(true);
    });

    it("🛑 une constante qui ne sert qu'à LIRE ne pose rien", () => {
        // The real shape of the filter panel's id in the permalink: a constant, handed to
        // `getElementById`. It kept the anchor green whatever became of the panel.
        expect(
            placedIn(
                [
                    `export const FILTER_PANEL_ID = "gl-filter-panel";`,
                    `document.getElementById(FILTER_PANEL_ID);`,
                ],
                "#gl-filter-panel"
            )
        ).toBe(false);
    });

    it("un id construit par préfixe : le préfixe écrit, le reste calculé", () => {
        expect(placed(`pane.id = "gl-rp-pane-" + id;`, "#gl-rp-pane-layers")).toBe(true);
        expect(placed("pane.id = `gl-rp-pane-${id}`;", "#gl-rp-pane-layers")).toBe(true);
        // A prefix that is not one of this id proves nothing.
        expect(placed(`pane.id = "gl-lp-pane-" + id;`, "#gl-rp-pane-layers")).toBe(false);
    });
});

describe("CC-08 — une classe se pose par son nom, elle se lit par son point", () => {
    it("🛑 un sélecteur, une feuille, un commentaire ne posent rien", () => {
        const sel = ".gl-map-toolbar-wrapper";
        expect(placed(`root.querySelector(".gl-map-toolbar-wrapper");`, sel)).toBe(false);
        expect(placed(`el.closest("div.gl-map-toolbar-wrapper > span");`, sel)).toBe(false);
        expect(placedIn([{ css: `.gl-map-toolbar-wrapper { display: flex; }` }], sel)).toBe(false);
        expect(placed(`// wrapper.className = "gl-map-toolbar-wrapper";`, sel)).toBe(false);
        // A stylesheet can QUOTE a class name; it still places nothing.
        expect(
            placedIn([{ css: `.gl-a::after { content: "gl-map-toolbar-wrapper"; }` }], sel)
        ).toBe(false);
    });

    it("🛑 ni une lecture ou un retrait par `classList`", () => {
        const sel = ".gl-is-open";
        expect(placed(`if (el.classList.contains("gl-is-open")) return;`, sel)).toBe(false);
        expect(placed(`el.classList.remove("gl-is-open");`, sel)).toBe(false);
        expect(placed(`document.getElementsByClassName("gl-is-open");`, sel)).toBe(false);
    });

    it("🛑 ni un nom plus long qui le contient", () => {
        expect(
            placed(`document.body.classList.add("gl-right-panel-open");`, ".gl-right-panel")
        ).toBe(false);
        expect(placed(`el.className = "x-gl-right-panel";`, ".gl-right-panel")).toBe(false);
    });

    it("les écritures du cœur, telles qu'il les écrit", () => {
        const sel = ".gl-poi-tag";
        expect(placed(`wrapper.className = "gl-poi-tag";`, sel)).toBe(true);
        expect(placed(`el.classList.add("gl-a", "gl-poi-tag");`, sel)).toBe(true);
        expect(placed(`const tag = el("span", "gl-poi-tag");`, sel)).toBe(true);
        expect(placed(`const c = domCreate("div", "gl-x gl-poi-tag", parent);`, sel)).toBe(true);
        expect(placed(`createEl("div", { className: "gl-poi-tag" });`, sel)).toBe(true);
        expect(placed(`const cls = on ? "gl-poi-tag active" : "gl-poi-tag";`, sel)).toBe(true);
        expect(placed(`const VARIANT = { primary: "gl-poi-tag" };`, sel)).toBe(true);
        expect(placed("node.className = `gl-poi-tag${variant}`;", sel)).toBe(true);
        expect(placed('root.innerHTML = `<i class="gl-x gl-poi-tag"></i>`;', sel)).toBe(true);
    });
});

describe("CC-08 — un attribut se pose par une écriture", () => {
    it("🛑 une lecture, un retrait, un sélecteur ne posent rien", () => {
        const sel = "[data-gl-sheet]";
        expect(placed(`const id = btn.getAttribute("data-gl-sheet");`, sel)).toBe(false);
        expect(placed(`btn.removeAttribute("data-gl-sheet");`, sel)).toBe(false);
        expect(placed(`bar.querySelector('[data-gl-sheet="geoloc"]');`, sel)).toBe(false);
        expect(placedIn([{ css: `[data-gl-sheet] { cursor: pointer; }` }], sel)).toBe(false);
    });

    it("l'écriture par `setAttribute`, par `toggleAttribute`, dans du HTML", () => {
        const sel = "[data-gl-sheet]";
        expect(placed(`btn.setAttribute("data-gl-sheet", b.id);`, sel)).toBe(true);
        expect(placed(`btn.toggleAttribute("data-gl-sheet", true);`, sel)).toBe(true);
        expect(placed('bar.innerHTML = `<button data-gl-sheet="${id}"></button>`;', sel)).toBe(
            true
        );
    });

    it("🛑 un sélecteur VALUÉ est trouvé par la valeur écrite — il ne l'était jamais", () => {
        const sel = "[data-gl-sheet='filters']";
        expect(placed(`btn.setAttribute("data-gl-sheet", "filters");`, sel)).toBe(true);
        expect(placed(`btn.dataset.glSheet = "filters";`, sel)).toBe(true);
        expect(placed('bar.innerHTML = `<button data-gl-sheet="filters"></button>`;', sel)).toBe(
            true
        );
        // Another value, or a value that is computed, does not place THIS one.
        expect(placed(`btn.setAttribute("data-gl-sheet", "layers");`, sel)).toBe(false);
        expect(placed(`btn.setAttribute("data-gl-sheet", b.id);`, sel)).toBe(false);
    });
});

describe("CC-08 — une forme que la règle ne sait pas juger", () => {
    it("un sélecteur composé garde la recherche du littéral, feuilles comprises", () => {
        const sel = ".gl-a > .gl-b";
        expect(anchors.needlesOf(sel).kind).toBe("other");
        expect(placedIn([{ css: `.gl-a > .gl-b { color: red; }` }], sel)).toBe(true);
        expect(placedIn([`el.className = "gl-b";`], sel)).toBe(false);
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
