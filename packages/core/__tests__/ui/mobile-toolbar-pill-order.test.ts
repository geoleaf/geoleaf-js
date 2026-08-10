/**
 * Gate 7.5 (socle-init) — les pastilles du pill toolbar sortent dans l'ordre DÉCLARÉ,
 * plus dans l'ordre d'enregistrement.
 *
 * ## Le défaut, et pourquoi il ne se voyait pas
 *
 * `_appendRegistryIcons()` itérait `registry.getAll()` tel quel, et son commentaire le
 * disait : « Icons are rendered in module registration order (set in boot.ts) ». La mise en
 * page de la barre était donc une propriété **émergente** de `presets/manifest.full.ts`,
 * dont l'ordre porte déjà **trois** contraintes sans rapport — départage du tri topologique
 * de Kahn, séquence des `sharedLifecycle` (#7 `pwa` → #8 `offline`), arêtes de dépendance.
 * Réordonner le manifeste pour l'une des trois déplaçait les boutons, et **aucun test ne
 * l'aurait vu** : `legend` précédait `share` par coïncidence de manifeste, pas par décision.
 *
 * `IModuleUISlot.filterTab` portait **déjà** un `order: number`. 7.5 aligne les deux moitiés
 * de la même interface plutôt que d'en inventer une seconde.
 *
 * ## Ce que la gate exige
 *
 * Enregistrer `share` **AVANT** `legend` — donc à l'envers de la production — et exiger que
 * les pastilles sortent quand même `legend` → `share`. C'est rouge avant le tri, vert après :
 * le test ne peut pas passer par accident, puisque l'ordre d'entrée est l'inverse de la
 * sortie attendue.
 *
 * @see roadmap_socle-init.md 📦 (archivée le 09/08/2026) §Sprint 7, tâche 7.5
 * @see packages/core/src/contracts/core-module.contract.ts — `IModuleUISlot.mobileIcon.order`
 */
vi.mock("../../src/utils/i18n/i18n.js", () => ({
    getLabel: (k) => k,
}));

const _ICON = '<svg viewBox="0 0 24 24"><rect x="0" y="0" width="1" height="1"/></svg>';

/** Module minimal porteur d'un `mobileIcon`, tel que `registry.getAll()` le rend. */
function mod(id, order) {
    return {
        id,
        ui: {
            mobileIcon: {
                icon: _ICON,
                labelKey: `${id}.label`,
                profileKey: `modules.${id}.enabled`,
                defaultVisible: true,
                ...(order === undefined ? {} : { order }),
            },
        },
    };
}

function setupGeoLeaf(modules) {
    globalThis.GeoLeaf = {
        registry: { getAll: () => modules },
        plugins: { getLazyUISlots: () => [] },
    };
}

/**
 * Les ids des pastilles issues du REGISTRE, dans l'ordre du DOM.
 *
 * ⚠️ Le filtre sur `only` n'est pas cosmétique : la barre porte aussi des boutons statiques
 * (`geoloc`, `proximity`, …) construits avant la boucle du registre et qui portent le même
 * attribut `data-gl-sheet`. Comparer le DOM entier ferait échouer ce test sur des boutons
 * qui n'ont rien à voir avec l'ordre qu'il éprouve — c'est ce qui est arrivé à sa première
 * version.
 */
async function renderPillIds(only) {
    const { createToolbarDom } = await import("../../src/kernel/ui/mobile/mobile-toolbar-pill.ts");
    const toolbar = createToolbarDom();
    const ids = [...toolbar.querySelectorAll("[data-gl-sheet]")].map((b) =>
        b.getAttribute("data-gl-sheet")
    );
    return only ? ids.filter((id) => only.includes(id)) : ids;
}

afterEach(() => {
    delete globalThis.GeoLeaf;
    document.body.innerHTML = "";
    vi.resetModules();
});

describe("mobile-toolbar-pill — ordre déclaré des pastilles (socle-init 7.5)", () => {
    it("rend legend AVANT share même enregistrés à l'envers", async () => {
        // Ordre d'entrée INVERSE de la sortie attendue : sans tri, ce test sort share, legend.
        setupGeoLeaf([mod("share", 20), mod("legend", 10)]);

        expect(await renderPillIds(["legend", "share"])).toEqual(["legend", "share"]);
    });

    it("les modules SANS order gardent leur ordre d'enregistrement, après les ordonnés", async () => {
        // `b` et `a` n'ont pas d'ordre : ils doivent rester dans cet ordre-là entre eux, et
        // passer derrière `legend` malgré leur position d'entrée. C'est ce qui rend le geste
        // additif — un module existant qui ne déclare rien ne bouge pas relativement aux
        // autres non-déclarants.
        setupGeoLeaf([mod("b"), mod("a"), mod("legend", 10)]);

        expect(await renderPillIds(["legend", "b", "a"])).toEqual(["legend", "b", "a"]);
    });

    it("trie sur la valeur, pas sur l'ordre de déclaration des valeurs", async () => {
        setupGeoLeaf([mod("third", 30), mod("first", 5), mod("second", 20)]);

        expect(await renderPillIds(["first", "second", "third"])).toEqual([
            "first",
            "second",
            "third",
        ]);
    });
});
