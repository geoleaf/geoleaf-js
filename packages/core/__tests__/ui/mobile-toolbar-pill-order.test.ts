/**
 * The pill toolbar's badges come out in DECLARED order, no longer in
 * registration order.
 *
 * ## The defect, and why it went unseen
 *
 * `_appendRegistryIcons()` iterated `registry.getAll()` as-is, and its
 * comment said so: "Icons are rendered in module registration order (set in
 * boot.ts)". The bar's layout was thus an **emergent** property of
 * `presets/manifest.full.ts`, whose order already carries **three**
 * unrelated constraints — Kahn topological-sort tie-breaking, the
 * `sharedLifecycle` sequence (#7 `pwa` → #8 `offline`), dependency edges.
 * Reordering the manifest for any of the three moved the buttons, and **no
 * test would have seen it**: `legend` preceded `share` by manifest
 * coincidence, not by decision.
 *
 * `IModuleUISlot.filterTab` **already** carried an `order: number`. The fix
 * aligns the two halves of the same interface rather than inventing a second one.
 *
 * ## What the gate demands
 *
 * Register `share` **BEFORE** `legend` — i.e. backwards from production —
 * and demand that the badges still come out `legend` → `share`. Red before
 * the sort, green after: the test cannot pass by accident, since the input
 * order is the inverse of the expected output.
 *
 * @see packages/core/src/contracts/core-module.contract.ts — `IModuleUISlot.mobileIcon.order`
 */
vi.mock("../../src/utils/i18n/i18n.js", () => ({
    getLabel: (k) => k,
}));

const _ICON = '<svg viewBox="0 0 24 24"><rect x="0" y="0" width="1" height="1"/></svg>';

/** Minimal module carrying a `mobileIcon`, as `registry.getAll()` returns it. */
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
 * The ids of the badges coming from the REGISTRY, in DOM order.
 *
 * ⚠️ The `only` filter is not cosmetic: the bar also carries static buttons
 * (`geoloc`, `proximity`, …) built before the registry loop and carrying
 * the same `data-gl-sheet` attribute. Comparing the whole DOM would fail
 * this test on buttons unrelated to the order it exercises — which is what
 * happened to its first version.
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
        // Input order INVERSE of the expected output: without the sort, this test yields share, legend.
        setupGeoLeaf([mod("share", 20), mod("legend", 10)]);

        expect(await renderPillIds(["legend", "share"])).toEqual(["legend", "share"]);
    });

    it("les modules SANS order gardent leur ordre d'enregistrement, après les ordonnés", async () => {
        // `b` and `a` have no order: they must stay in that order between
        // themselves, and go behind `legend` despite their input position.
        // That is what makes the change additive — an existing module
        // declaring nothing does not move relative to the other non-declarers.
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
