// @ts-check
// S5.3 — E2E géocodage (@geoleaf-plugins/geocoding) sur deploy-coverage (port 8769).
//
// Garde de bout en bout pour l'extraction du géocodage core → plugin : prouve que,
// une fois la balise <script> du plugin injectée dans les variantes deploy (S5.2), le
// pill de recherche d'adresse se monte réellement dans un profil déployé et que la
// chaîne recherche → résultats → sélection → recentrage + événement tient en navigateur.
//
// Cible : deploy-coverage (roadmap S5.3) — copie de deploy-core (profil actif `tourism`,
// `modules.geocoding.enabled: true`, provider nominatim). Le port 8769 est démarré par
// le webServer de playwright.config.js ; `npm run build:deploy-coverage` doit avoir peuplé
// `deploy/deploy-coverage` au préalable (après `build:deploy:all`).
//
// Mécanisme de mock (cf. cfg-c2) : monkeypatch `window.fetch` posé en addInitScript —
// il court-circuite les hôtes des providers géocodage et renvoie un FeatureCollection
// GeoCodeJSON canné « Rosario » SANS toucher le réseau (déterministe + indépendant de
// la CSP `connect-src`). Tous les providers (addok/nominatim/photon) parsent ce format.
// La localité cannée doit rester DANS l'emprise du profil (`positionFixed` → maxBounds
// MapLibre) sinon le recentrage est clampé — voir le commentaire de ROSARIO_GEOJSON.
//
// La porte « désactivé ⇒ pill absent » est gérée par le registre côté plugin
// (`_onMapReady` retourne tôt si `!config.enabled`) et couverte au niveau unitaire ;
// ici on valide le chemin nominal sur un profil qui active le géocodage.
//
// `serviceWorkers: 'block'` : empêche le SW PWA de médier (et donc d'échapper à) le
// monkeypatch fetch — même précaution que les specs plugin sur variantes PWA.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("coverage"), serviceWorkers: "block" });

// Hôtes des providers intégrés (provider.ts) — interceptés quel que soit le provider
// du profil actif, pour que la spec reste verte si le profil bascule addok/photon.
const PROVIDER_HOSTS = [
    "nominatim.openstreetmap.org",
    "api-adresse.data.gouv.fr",
    "photon.komoot.io",
];

// Réponse cannée au format GeoCodeJSON FeatureCollection (parsée par _parseGeoJSON).
// bbox présent ⇒ la sélection emprunte le chemin fitBounds (recentrage sur la ville).
//
// ⚠️ La localité DOIT tomber dans l'emprise du profil actif. `tourism` déclare
// `map.positionFixed: true` + `map.bounds` [[-55,-73.5],[-21.78,-53.5]] (Argentine) ;
// `core-map.module.ts:135` en fait un `maxBounds` MapLibre (padBounds, boundsMargin 0.7
// ⇒ lat ≤ 1.47, lng ∈ [-87.5,-39.5]). Un fitBounds hors de cette boîte est CLAMPÉ par
// MapLibre : la carte ne bouge pas, quel que soit le géocodeur. Rosario (la ville du
// profil, cf. la couche `sites_rosario`) est dans l'emprise — c'est ce qui rend
// l'assertion de recentrage vérifiable. Cohérent avec `modules.geocoding.countrycodes:
// "ar"` du profil, et avec 19-permalink qui n'utilise que des coordonnées in-bounds.
const ROSARIO_GEOJSON = {
    type: "FeatureCollection",
    features: [
        {
            type: "Feature",
            geometry: { type: "Point", coordinates: [-60.63932, -32.94682] },
            properties: { geocoding: { label: "Rosario, Santa Fe, Argentine" } },
            bbox: [-60.7503, -33.0201, -60.5503, -32.8501],
        },
    ],
};

/**
 * Pose le harnais géocodage AVANT tout script de page :
 *  - enregistre les événements `geoleaf:geocoding:result` dans `window.__geocodingEvents`,
 *  - monkeypatche `window.fetch` pour renvoyer `geojson` sur les hôtes providers.
 * Arguments passés explicitement (pas via closure : addInitScript sérialise la fonction).
 */
async function installGeocodingHarness(page, geojson, hosts) {
    await page.addInitScript(
        ({ geojson, hosts }) => {
            /** @type {any[]} */
            (window).__geocodingEvents = [];
            document.addEventListener("geoleaf:geocoding:result", (e) => {
                /** @type {any[]} */ (window).__geocodingEvents.push(/** @type {any} */ (e).detail);
            });
            const origFetch = window.fetch.bind(window);
            window.fetch = async (input, init) => {
                const url = typeof input === "string" ? input : (input && input.url) || "";
                if (url && hosts.some((h) => url.includes(h))) {
                    return new Response(JSON.stringify(geojson), {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                    });
                }
                return origFetch(input, init);
            };
        },
        { geojson, hosts }
    );
}

async function bootMap(page) {
    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
    await page.waitForFunction(
        () => {
            const native = /** @type {any} */ (window).GeoLeaf?.Core?.getMap?.()?.getNativeMap?.();
            return !!(native && typeof native.loaded === "function" && native.loaded());
        },
        null,
        { timeout: 20000 }
    );
    await page
        .locator("#gl-loader")
        .waitFor({ state: "hidden", timeout: 10000 })
        .catch(() => {});
}

test.describe("20-geocoding — pill + recherche + événement (deploy-coverage, tourism)", () => {
    test("le plugin se charge et le pill se monte (modules.geocoding.enabled)", async ({
        page,
    }) => {
        await installGeocodingHarness(page, ROSARIO_GEOJSON, PROVIDER_HOSTS);
        await bootMap(page);

        // Le bundle plugin est bien injecté et la façade montée sur le namespace.
        const enabled = await page.evaluate(
            () => /** @type {any} */ (window).GeoLeaf?.Geocoding?.isEnabled?.() === true
        );
        expect(enabled).toBe(true);

        // Desktop (viewport 1280px > breakpoint 768px) : le pill est visible par défaut.
        const input = page.locator('.gl-geocoding-ctrl input[role="combobox"]');
        await expect(input).toBeVisible({ timeout: 10000 });
    });

    test("recherche → résultats → sélection émet geoleaf:geocoding:result + recentre", async ({
        page,
    }) => {
        await installGeocodingHarness(page, ROSARIO_GEOJSON, PROVIDER_HOSTS);
        await bootMap(page);

        const input = page.locator('.gl-geocoding-ctrl input[role="combobox"]');
        await expect(input).toBeVisible({ timeout: 10000 });

        // Saisie ≥ minChars (3) ⇒ recherche débouncée ⇒ provider mocké ⇒ dropdown.
        await input.fill("Rosario");
        const items = page.locator(".gl-geocoding-result-item");
        await expect(items.first()).toBeVisible({ timeout: 10000 });
        await expect(items.first()).toContainText("Rosario");

        // Sélection du 1er résultat.
        await items.first().click();

        // 1) L'événement public est émis avec la localité sélectionnée.
        await page.waitForFunction(
            () => /** @type {any} */ (window.__geocodingEvents || []).length > 0,
            null,
            { timeout: 10000 }
        );
        const ev = await page.evaluate(() => /** @type {any} */ (window).__geocodingEvents[0]);
        expect(String(ev.label)).toContain("Rosario");
        expect(ev.lat).toBeGreaterThan(-33.5);
        expect(ev.lat).toBeLessThan(-32.5);
        expect(ev.lng).toBeGreaterThan(-61);
        expect(ev.lng).toBeLessThan(-60);

        // 2) La carte recentre près de Rosario (fitBounds sur le bbox du résultat).
        //    3e argument = options : `waitForFunction(fn, arg, options)` — passer le
        //    timeout en 2e position en fait un `arg` silencieusement ignoré.
        await page.waitForFunction(
            () => {
                const c = /** @type {any} */ (window).GeoLeaf?.Core?.getMap?.()
                    ?.getNativeMap?.()
                    ?.getCenter?.();
                return !!c && Math.abs(c.lat - -32.935) < 0.6 && Math.abs(c.lng - -60.65) < 0.6;
            },
            null,
            // ⚠️ B-99 — mesuré : ce test dure **14 109 ms** au total sur une machine à
            // 24 cœurs. Un budget de 10 s pour une seule de ses attentes n'avait aucune
            // marge sur un runner ~5× plus lent. L'attente porte sur le bon prédicat (le
            // centre natif de la carte après `fitBounds`) : rien à mieux synchroniser,
            // seulement un budget à recalibrer. Généreux ne coûte rien au cas passant.
            { timeout: 30000 }
        );
    });
});
