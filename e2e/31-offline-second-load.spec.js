// @ts-check
/**
 * 31 — LE SECOND CHARGEMENT HORS LIGNE (roadmap socle-init, S3.3)
 *
 * L'application se déclare PWA — manifeste, `installPrompt`, Service Worker — et **ne
 * pouvait pas booter hors ligne**. `STATIC_ASSETS` portait trois entrées écrites à la main
 * là où un premier chargement en demande une vingtaine : le shell était pré-caché, le
 * bundle d'entrée aussi, et **rien de ce que ce bundle importe**. Au second chargement hors
 * ligne, l'entrée sortait du cache et ses quatre imports statiques échouaient.
 *
 * 🛑 ET LA TROISIÈME ENTRÉE ÉTAIT MORTE. Elle pré-cachait
 * `dist/geoleaf-main.min.css?v=<horodatage>` pendant que le document demande le chemin NU —
 * le patch de cache-busting ne couvre que l'ESM et les plugins. `sw-core.js` appelle
 * `cache.match(request)` **sans `ignoreSearch`**, donc la query fait partie de la clé : la
 * feuille de style n'a jamais été servie depuis ce cache. Sur trois entrées, deux servaient.
 *
 * ═══ CE QUE CE SPEC ÉPROUVE, ET QU'AUCUNE SUITE UNITAIRE NE PEUT ÉPROUVER ═══
 *
 * Les tests unitaires exécutent le worker contre une Cache API **simulée**, et la dérivation
 * de `build-deploy.cjs` contre un `outDir` de fixture. Ni l'un ni l'autre ne dit ce que fait
 * le déployé — copié, patché par regex, minifié — dans un vrai moteur. C'est le seul endroit
 * où les deux moitiés se rencontrent.
 *
 * ⚠️ AUCUNE URL N'EST ÉCRITE ICI. Les noms de chunks sont hachés par le contenu et changent
 * à chaque build : le spec les lit dans le document servi, exactement comme le navigateur.
 * Un spec qui les écrirait mesurerait le build d'un jour donné, puis se tairait.
 */

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { bootMap } from "./helpers/boot.js";

const ORIGIN = baseURL("full");

/**
 * Attend que le worker CONTRÔLE la page. `activated` ne suffit pas : un worker actif qui
 * n'a pas encore réclamé ses clients n'intercepte rien, et un rechargement lancé dans cette
 * fenêtre éprouverait le réseau en croyant éprouver le cache.
 * @param {import('@playwright/test').Page} page
 */
async function waitForController(page) {
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, {
        timeout: 45000,
    });
}

/**
 * Rend les URL que le document déclare précharger, telles qu'écrites dans le markup.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string[]>}
 */
function readPreloadedChunks(page) {
    return page.evaluate(() =>
        [...document.querySelectorAll('link[rel="modulepreload"]')].map((l) =>
            l.getAttribute("href")
        )
    );
}

test.describe("31 — le second chargement hors ligne", () => {
    test("le pré-cache porte le shell, les chunks EAGER et le CSS SOUS LA CLÉ DEMANDÉE", async ({
        page,
    }) => {
        await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
        await waitForController(page);

        const preloaded = await readPreloadedChunks(page);

        // Le document doit déclarer les chunks que l'entrée importe STATIQUEMENT — et eux
        // seuls. `dist/chunks/` en porte davantage : précharger un chunk paresseux irait
        // chercher d'avance exactement ce que son `import()` existe pour différer.
        expect(preloaded.length).toBeGreaterThan(0);
        for (const href of preloaded) {
            expect(href).toMatch(/^dist\/chunks\/.+\.js$/);
        }

        // `caches.match` balaie tous les caches de l'origine : le spec n'a donc pas à
        // connaître le nom du cache, qui porte la version du paquet.
        const verdict = await page.evaluate(async (chunks) => {
            const probe = async (url) => ({ url, hit: !!(await caches.match(url)) });
            return {
                shell: await probe("index.html"),
                // ⚠️ LA CLÉ NUE, celle que porte le <link rel="stylesheet"> du document.
                // C'est l'entrée qui était morte : elle était pré-cachée avec un `?v=`.
                css: await probe("dist/geoleaf-main.min.css"),
                config: await probe("profiles/geoleaf.config.json"),
                chunks: await Promise.all(chunks.map(probe)),
                // Le MOTEUR, en entier. Depuis MapLibre 6 il n'est plus un fichier mais un
                // graphe : le document ne nomme que le shim, qui importe l'entrée, qui importe
                // le chunk partagé, qui instancie le worker. Trois des quatre ne sont nommés
                // NULLE PART dans le markup — donc aucune dérivation naïve ne les voit.
                engine: await Promise.all(
                    [
                        "vendor/maplibre-gl/global.mjs",
                        "vendor/maplibre-gl/maplibre-gl.mjs",
                        "vendor/maplibre-gl/maplibre-gl-shared.mjs",
                        "vendor/maplibre-gl/maplibre-gl-worker.mjs",
                        "vendor/maplibre-gl/maplibre-gl.css",
                    ].map(probe)
                ),
            };
        }, preloaded);

        expect(verdict.shell.hit, "le shell doit être pré-caché sous `index.html`").toBe(true);
        expect(
            verdict.css.hit,
            "le CSS doit être pré-caché sous la clé NUE que le document demande"
        ).toBe(true);
        expect(verdict.config.hit, "le config racine doit être pré-caché").toBe(true);
        for (const c of verdict.chunks) {
            expect(c.hit, `chunk eager non pré-caché : ${c.url}`).toBe(true);
        }
        for (const e of verdict.engine) {
            expect(
                e.hit,
                `module du moteur non pré-caché : ${e.url} — hors ligne, la carte ne peindrait pas`
            ).toBe(true);
        }
    });

    test("hors ligne, un second chargement affiche la carte", async ({ page, context }) => {
        await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
        await waitForController(page);
        await bootMap(page);

        // Laisse le worker finir d'écrire ce qu'il met en cache au fil de l'eau (les
        // origines tierces passent par networkFirst, qui écrit APRÈS avoir répondu).
        await page.waitForTimeout(2000);

        await context.setOffline(true);
        await page.reload({ waitUntil: "domcontentloaded" });

        // La seule assertion qui vaut : une `maplibregl.Map` native, avec un style vivant.
        // Le document peut très bien s'afficher — c'est le shell — pendant que le bundle
        // manque. Exiger la carte, c'est exiger que la clôture des imports ait résolu.
        await bootMap(page);
    });

    // ⚠️ CE QUE CE FICHIER NE GARDE PAS, ET POURQUOI — à lire avant d'ajouter un test ici.
    //
    // Le test ci-dessus charge la page EN LIGNE avant de couper. Ce premier passage remplit les
    // caches au fil de l'eau, si bien qu'un asset ABSENT de `STATIC_ASSETS` répond quand même :
    // il éprouve donc le cache tel qu'il est APRÈS une visite, pas le pré-cache lui-même.
    //
    // Un troisième test a été tenté au passage à MapLibre 6 pour combler cet angle — installer
    // le worker sans jamais demander le moteur, ou le réinstaller après purge, puis couper. Il
    // a été RETIRÉ : dans les deux variantes il sortait vert sur un pré-cache amputé de trois
    // modules sur cinq, donc il ne gardait rien tout en ayant l'air de garder. Deux causes,
    // toutes deux mesurées : `isStaticAsset()` reconnaissant `.mjs`, `cacheFirstStrategy` ÉCRIT
    // les modules manquants dans `CACHE_STATIC` dès le premier chargement en ligne ; et une
    // réinstallation par `unregister()` + `register()` ne rejoue pas `cache.addAll()` de façon
    // observable dans la fenêtre du test.
    //
    // La propriété visée — le pré-cache porte le moteur ENTIER — est donc assertée là où elle
    // est déterministe : dans le premier test, qui lit le contenu réel du cache. Un test
    // d'intégration qui ne peut pas rougir vaut moins qu'une assertion directe qui le peut.
});
