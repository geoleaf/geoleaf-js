// @ts-check
// Archi B.6 — E2E : pipeline mapping runtime (ANO-083) sur le bundle DÉPLOYÉ.
//
// ⚠️ Migré le 27/07/2026 (B-42) : visait guyane-biodiversite, profil de démonstration retiré.
// La couche `observations_gbif` et le bloc `gbif` de mapping ont été migrés dans `tourism`.
// Charge le profil tourism sur deploy-core (override `activeProfile`
// via monkeypatch fetch — deploy-core a un SW PWA, donc serviceWorkers:'block' +
// pas de page.route).
//
// ⚠️ Recâblé le 28/07/2026 (B-56). Ce test MOCKAIT `**/api.gbif.org/**` — ce qui rendait le
// test déterministe, mais laissait la couche interroger l'API pour de vrai au boot de TOUS
// les autres scénarios, donc dans le chemin de démarrage des 3 variantes livrées. La source
// de boot est désormais un fichier LOCAL du profil, à la forme d'une réponse GBIF ; le mock
// et sa `page.route` sont retirés. Conséquence directe : le test vérifie maintenant le
// LIVRÉ et non un mock — les valeurs assertées ci-dessous sont celles de
// `profiles/tourism/layers/observations_gbif/data/observations_gbif.json`, et ce couplage
// est voulu (même posture que `16-flatgeobuf` depuis B-42).
//
// Test DISCRIMINANT du câblage : la donnée est `{ results: [...] }` (objet, pas un
// tableau). SANS le pipeline mapping, `DataConverter.autoConvert` ne sait pas la
// convertir → 0 feature. AVEC le pipeline (data.mapping="gbif" +
// data.itemsPath="results" → normalizePoiWithMapping → autoConvert), elle devient
// une FeatureCollection de Points. On asserte donc qu'une source porte la feature
// mappée (title="Jaguar", coords issues de decimalLat/Lng).
//
// Préfixe `cfg-` (convention roadmap config-contract).

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

test.describe("cfg-b6 — pipeline mapping runtime (GBIF, bundle déployé)", () => {
    test('data.mapping="gbif" + itemsPath="results" → Points mappés sur la carte', async ({
        page,
    }) => {
        // page.route (not window.fetch) so the layer's Web Worker fetch is intercepted too.
        // VÉRIFIÉ empiriquement (21/07/2026, `page.on('request')` + compteur sur le handler) :
        // Playwright intercepte bien le fetch émis DEPUIS le Web Worker dédié
        // `geojson-worker.js` — seuls les *Service* Workers échappent à page.route, d'où le
        // serviceWorkers:'block' (deploy-core embarque un service worker PWA).
        await page.route("**/geoleaf.config.json**", async (route) => {
            const res = await route.fetch();
            const cfg = await res.json();
            cfg.data = cfg.data || {};
            cfg.data.activeProfile = "tourism";
            await route.fulfill({ json: cfg });
        });
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

        // Wait until a native source carries the MAPPED feature — proof that the raw
        // GBIF `{results}` went through normalizePoiWithMapping → autoConvert in the
        // deployed bundle (id "111" coerced to string, coords from decimalLat/Lng).
        //
        // ⚠️ La signature est `waitForFunction(fn, arg, options)`. Les 25 s ci-dessous
        // étaient passées en 2e argument : Playwright les sérialisait comme `arg` (ignoré
        // par le prédicat) et le wait retombait sur le timeout PAR DÉFAUT — soit
        // `actionTimeout`, qui valait 10 s à cette date (30 s depuis le 01/08/2026 ;
        // la valeur courante est dans `playwright.config.js`, pas ici).
        //
        // Ce test a ensuite expiré à 25 s pour une TOUTE AUTRE raison, et c'était un vrai
        // défaut de production : la couche passait par le Web Worker GeoJSON, dont
        // `_normalizeFeatures` ne garde que `.features` / un tableau racine. L'enveloppe
        // `{ results: [...] }` de GBIF était donc DÉTRUITE avant d'atteindre le thread
        // principal, `applyDataMapping` ne trouvait plus rien à `itemsPath="results"`, et la
        // couche rendait 0 feature — le pipeline mapping était mort dans le navigateur.
        // Corrigé dans `loader/single-layer.ts` (`data.mapping` ⇒ fetch main-thread).
        // Depuis, le prédicat passe en ~1,2 s : les 25 s sont un PLAFOND (boot WebGL logiciel
        // SwiftShader à froid), pas un délai attendu.
        const mapped = await page.waitForFunction(
            () => {
                const m = /** @type {any} */ (window).GeoLeaf;
                const native = m?.Core?.getMap?.()?.getNativeMap?.();
                if (!native || typeof native.getStyle !== "function") return null;
                const sources = native.getStyle()?.sources || {};
                for (const id of Object.keys(sources)) {
                    let data = sources[id] && sources[id].data;
                    if (!data || !Array.isArray(data.features)) {
                        try {
                            const ser = native.getSource(id)?.serialize?.();
                            data = ser && ser.data;
                        } catch {
                            data = null;
                        }
                    }
                    const feats = data && data.features;
                    if (Array.isArray(feats)) {
                        const jaguar = feats.find((f) => f?.properties?.title === "Jaguar");
                        if (jaguar) {
                            return {
                                sourceId: id,
                                count: feats.length,
                                id: jaguar.properties.id,
                                coords: jaguar.geometry?.coordinates,
                                species: jaguar.properties.species,
                            };
                        }
                    }
                }
                return null;
            },
            undefined,
            { timeout: 25000 }
        );

        const result = await mapped.jsonValue();
        expect(result.sourceId).toContain("observations_gbif");
        expect(result.count).toBe(2);
        expect(result.id).toBe("111"); // numeric GBIF key coerced to string
        expect(result.coords).toEqual([-57.45, -28.55]); // [lng, lat] from decimalLng/Lat
        expect(result.species).toBe("Panthera onca");
    });
});
