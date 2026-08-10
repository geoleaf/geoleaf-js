// @ts-check
// VÉRIFICATION NAVIGATEUR — famille A, rendu carte et cycle de style. Scénarios A.1, A.2, A.3
// de `_docs_projet/travail/rapports/rapport_table-verification-navigateur.md` (backlog R.7b).
//
// Ces scénarios sont dans la table pour la première des quatre raisons qu'elle nomme : **il
// n'y a pas de moteur de rendu sous happy-dom**. MapLibre ne s'initialise pas, donc ni
// rechargement de style, ni cycle de zoom réel, ni couche `symbol` — rien de ce qui est
// observé ici.
//
// Contrat réellement émis (mesuré, pas déduit de la doc) :
//   - les labels ne sont PAS du DOM : `label-renderer.ts:92` ajoute une couche MapLibre
//     `symbol` d'id `gl-<layerId>-label-text`. On lit `getStyle().layers`, pas le DOM.
//   - profil `tourism` : `villes_principales` a ses labels actifs au boot ; sa couche symbol
//     est présente aux zooms 7/10/12 et **absente** au zoom 5 comme au zoom de boot (4,23).
//     C'est cette plage qui rend le cycle observable.
//
// ⚠️ DEUX PIÈGES ÉCARTÉS AU PRÉ-VOL, tous deux mesurés :
//   1. Basculer le THÈME (l'autre chemin d'échange d'adaptateur cité par A.3) fait
//      disparaître la couche symbol. Ce n'est PAS un défaut : le thème « tourisme » ne
//      contient pas `villes_principales`, la couche quitte le champ pour une raison légitime.
//   2. Basculer le FOND est aujourd'hui **cassé** sur ce profil — voir le `test.fixme` en bas
//      de fichier. Les trois scénarios de la table le supposent possible ; il ne l'est pas.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { bootMap, waitMapLoaded, captureConsole } from "./helpers/boot.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

const LABEL_LAYER = "gl-villes_principales-label-text";
const ZOOM_IN = 10; // la couche est dans son champ d'échelle
const ZOOM_OUT = 5; // elle en sort
const ALT_BASEMAP = "positron"; // ≠ terrain-terrarium, actif au boot

/** La couche symbol des labels est-elle dans le style natif ? */
const labelLayerPresent = (page) =>
    page.evaluate(
        (id) =>
            window.GeoLeaf.Core.getMap()
                .getNativeMap()
                .getStyle()
                .layers.some((l) => l.id === id),
        LABEL_LAYER
    );

/** Pose un zoom et attend que la couche symbol ait pris l'état attendu. */
async function zoomAndExpectLabels(page, zoom, present) {
    await page.evaluate((z) => window.GeoLeaf.Core.getMap().getNativeMap().setZoom(z), zoom);
    await expect
        .poll(() => labelLayerPresent(page), {
            timeout: 15000,
            message: `au zoom ${zoom}, la couche ${LABEL_LAYER} devrait être ${present ? "présente" : "absente"}`,
        })
        .toBe(present);
}

/**
 * Attend que le sous-système des fonds de carte soit réellement prêt.
 *
 * ⚠️ MESURÉ AU R.7b : `nativeMap.loaded()` peut être `true` alors que le registre des fonds
 * est encore **VIDE** (0 clé, aucun fond actif) — les 8 fonds du profil n'arrivent qu'environ
 * 1,5 s plus tard. Demander `setBaseLayer("positron")` dans cet intervalle donne
 * `[Baselayers] Unknown layer: positron`, et le boot applique ensuite le sien : de l'extérieur
 * cela ressemble trait pour trait à une bascule annulée, alors que la bascule n'a jamais eu
 * lieu. C'est ce qui rendait les tests de cette famille intermittents APRÈS le correctif du
 * report périmé — deux causes distinctes, un seul symptôme.
 */
async function waitBasemapsReady(page) {
    await page.waitForFunction(
        () => {
            const bl = window.GeoLeaf?.Baselayers;
            if (!bl?.getBaseLayers) return false;
            return Object.keys(bl.getBaseLayers() ?? {}).length > 0 && !!bl.getActiveId?.();
        },
        null,
        { timeout: 25000 }
    );
}

test.describe("VN — rendu carte et cycle de style (A.1, A.2, A.3)", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/");
        await bootMap(page);
        await waitMapLoaded(page);
        await waitBasemapsReady(page);
    });

    // ── A.2 🔴 (part vérifiable, sans bascule de fond) ────────────────────────────────
    // Contre-épreuve S2 : « le `catch` va **dans** le `forEach`, `.clear()` dehors ;
    // l'envelopper laisserait la Map non vide et les labels ne reviendraient jamais ».
    // L'assertion qui discrimine est donc le RETOUR, pas la disparition : un `.clear()` mal
    // placé laisse la Map peuplée d'entrées mortes, et la reconstruction au zoom entrant n'a
    // plus lieu. Un test qui ne vérifierait que la disparition passerait sous le bug.
    //
    // La table écrit ce scénario « après la bascule de fond » ; la bascule étant cassée
    // (fixme ci-dessous), le cycle est éprouvé ici sur l'adaptateur d'origine. C'est la
    // moitié du scénario qui est **observable aujourd'hui**, et elle garde le défaut visé.
    // Déterminisme mesuré avant écriture : 5/5.
    test("A.2 — les labels sortent du champ au dézoom et REVIENNENT au zoom entrant", async ({
        page,
    }) => {
        const console_ = captureConsole(page);

        await zoomAndExpectLabels(page, ZOOM_IN, true);
        await zoomAndExpectLabels(page, ZOOM_OUT, false); // sortie du champ d'échelle
        await zoomAndExpectLabels(page, ZOOM_IN, true); // ← LE point du scénario

        expect(
            console_.errors,
            `exceptions pendant le cycle : ${console_.errors.join(" | ")}`
        ).toEqual([]);
    });

    // ── A.1 + A.3 🔴 ─────────────────────────────────────────────────────────────────
    //
    // Contre-épreuves : S2 (« les closures de la `Map` jettent sur style rechargé ») pour la
    // reconstruction des labels, et B.40 (`_ensureZoomListener` sortait tôt sans comparer la
    // carte) pour la réaction au zoom après échange d'adaptateur.
    //
    // ⚠️ CE QUE LA MISE AU POINT DE CE TEST A APPRIS — deux causes, un seul symptôme, et il
    // ne faut pas les confondre :
    //
    //   1. **Un défaut produit RÉEL**, trouvé ici et corrigé : `setBaseLayer` se reporte sur
    //      `map.once("idle")` quand le style n'est pas chargé, en capturant sa clé dans la
    //      closure. Rien n'y faisait remarquer qu'une demande postérieure l'avait remplacée,
    //      donc l'activation du BOOT pouvait se ré-appliquer **par-dessus le choix de
    //      l'utilisateur**. Corrigé par un ticket d'activation (`_nextActivationRequest`,
    //      `basemaps-state.ts`). **Sa contre-épreuve est au tier UNITAIRE** —
    //      `__tests__/baselayers/registry.test.js`, « un report sur idle n'écrase PAS une
    //      activation plus récente » —, vue rouge avant le correctif (`Received: "boot"`).
    //
    //   2. **Une précondition manquante DANS CE TEST** : `nativeMap.loaded()` peut être `true`
    //      alors que le registre des fonds est encore vide. La bascule échouait alors sur
    //      `Unknown layer`, et le boot appliquait le sien — vu de l'extérieur, indiscernable
    //      d'une bascule annulée. C'est `waitBasemapsReady()` qui le règle.
    //
    // ⚠️ **Ce test ne prouve PAS le correctif du point 1** : mutation faite, garde du ticket
    // neutralisée puis déployée, il reste vert 3/3 — parce qu'avec la précondition ci-dessus
    // le report du boot a déjà été consommé, donc la fenêtre du défaut n'est plus ouverte.
    // La fenêtre en question dépend d'un enchaînement de millisecondes ; l'épingler ici
    // donnerait un test intermittent, ce qui est pire que pas de test. **Le tier unitaire est
    // le bon endroit pour cette garde, et il l'a.**
    //
    // ⚠️ À RETENIR DE LA MÉTHODE. Les premières versions de ce test passaient parfois,
    // exactement quand `setBaseLayer` n'avait AUCUN effet — donc aucun rechargement de style,
    // aucun label retiré, rien à reconstruire. **Il était vert quand la manipulation avait
    // échoué.** D'où l'assertion n°1 ci-dessous : un scénario doit asserter que sa
    // manipulation a eu lieu avant de juger de son effet.
    test("A.1/A.3 — la bascule de fond tient et les labels sont reconstruits", async ({ page }) => {
        await zoomAndExpectLabels(page, ZOOM_IN, true);

        const console_ = captureConsole(page);
        await page.evaluate((id) => window.GeoLeaf.Baselayers.setBaseLayer(id), ALT_BASEMAP);

        // 1 — PRÉCONDITION : la bascule doit TENIR. Avant le correctif, elle revenait au fond
        // du boot en ~1 s, et c'est cette annulation qui rendait le reste inobservable.
        await expect
            .poll(() => page.evaluate(() => window.GeoLeaf.Baselayers.getActiveId()), {
                timeout: 20000,
                message: "la bascule de fond a été annulée toute seule (report périmé ?)",
            })
            .toBe(ALT_BASEMAP);

        // 2 — A.1 : les labels sont reconstruits sur le nouveau style.
        await expect
            .poll(() => labelLayerPresent(page), {
                timeout: 20000,
                message: "les labels n'ont pas été reconstruits après le rechargement de style",
            })
            .toBe(true);

        // 3 — A.3 : le zoom pilote encore les labels après l'échange d'adaptateur — la
        // souscription `zoomend` a bien suivi la nouvelle carte.
        await zoomAndExpectLabels(page, ZOOM_OUT, false);
        await zoomAndExpectLabels(page, ZOOM_IN, true);

        expect(console_.errors, `exceptions : ${console_.errors.join(" | ")}`).toEqual([]);
    });
});
