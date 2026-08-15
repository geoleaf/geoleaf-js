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

/**
 * Motif du saut du SEUL test qui exige un cache de RUNTIME, ou `null` s'il peut jouer.
 * Mesuré une fois, asserté par le témoin. B-237.
 * @type {string | null}
 */
let skipReason = null;

/** Le `Cache-Control` que le harnais sert réellement. `null` = pas encore mesuré. */
let cacheControlMesure = null;

/**
 * 🛑 CE SAUT EST MESURÉ, PAS DÉCRÉTÉ — et il se réactive SEUL.
 *
 * Le worker HONORE `Cache-Control: no-store` (durcissement S8/8.3, motif écrit dans
 * `isCacheableResponse` → `refusesSharedCache`). Or les deux serveurs de ce dépôt l'envoient
 * sur TOUTES les ressources : `http-server -c-1`, que `playwright.config.js` démarre pour la
 * cible `ports`, répond `no-cache, no-store, must-revalidate` ; le nginx de dev pose
 * `add_header Cache-Control "no-store" always` sur ses quatre vhosts. Aucune ressource de même
 * origine n'entre donc en cache **au runtime** dans ce harnais — seul le pré-cache survit,
 * parce que `cache.addAll()` ne passe pas par `isCacheableResponse`.
 *
 * Le test du second chargement a besoin du profil, qui est de la DONNÉE et n'est pas pré-caché.
 * Il éprouve donc un scénario que sa propre configuration rend impossible.
 *
 * ✅ **Le produit, lui, fonctionne** : `SERVEUR.md` §8 — qui PART CHEZ LE CLIENT — prescrit
 * `no-cache` ou `max-age=3600` pour `profiles/**` et avertit nommément : « ne pas reprendre le
 * `no-store` du serveur de développement du projet : il est délibéré, et local ».
 *
 * ⚠️ **Ne pas "réparer" le produit pour verdir ce test.** Le seul geste qui le rendrait vert
 * sans toucher au harnais serait de pré-cacher le profil, c'est-à-dire élargir un `addAll`
 * TOUT-OU-RIEN à des données — ce que le §« Ce que ce fichier ne garde pas » met en garde de
 * faire, et que B-237 écarte explicitement.
 *
 * QUAND IL SE RÉACTIVE : le jour où le harnais cesse d'envoyer `no-store`. Aucune intervention
 * n'est requise — la condition est RE-MESURÉE à chaque run, ce qui est la différence entre ce
 * saut et un `.skip` qu'il faudrait penser à retirer.
 *
 * ✅ **ÉPROUVÉ DANS LES DEUX SENS le 13/08/2026, et un saut conditionnel jamais vu se LEVER est
 * indiscernable d'un `.skip` nu.** En remplaçant `-c-1` par `-c3600` sur le serveur de
 * `deploy-full` dans `playwright.config.js` : le témoin bascule sur sa branche « pas de saut »,
 * ce test JOUE, et il **PASSE en 3,9 s**. Configuration restaurée aussitôt.
 *
 * 🛑 Ce second sens dit plus que la mécanique du saut : il établit que **le produit n'a aucun
 * défaut ici**. Le second chargement hors ligne fonctionne dès que le serveur ne réclame pas
 * `no-store` — c'est-à-dire dans la configuration que `SERVEUR.md` prescrit à l'intégrateur.
 * Sans cette mesure, « en production ça marche » serait resté une inférence.
 */
test.beforeAll(async ({ request }) => {
    try {
        const r = await request.get(`${ORIGIN}/profiles/geoleaf.config.json`);
        cacheControlMesure = (r.headers()["cache-control"] ?? "").toLowerCase();
    } catch (e) {
        skipReason = `impossible de MESURER le Cache-Control du harnais (${String(e).slice(0, 80)}) — un saut non mesuré n'est pas un saut motivé`;
        return;
    }
    if (cacheControlMesure.includes("no-store")) {
        skipReason =
            `le harnais répond \`Cache-Control: ${cacheControlMesure}\` et le worker HONORE ` +
            `\`no-store\` : aucun cache de runtime ici, donc le profil ne peut pas être servi ` +
            `hors ligne. Défaut du HARNAIS, pas du produit — voir B-237 et \`SERVEUR.md\` §8. ` +
            `Se réactive seul quand le harnais cessera d'envoyer \`no-store\`.`;
    }
});

// 🛑 SANS CE TÉMOIN, LE SAUT SERAIT SILENCIEUX. Un test sauté est indiscernable, dans un rapport
// lu vite, d'un test vert — c'est exactement ce que `e2e/30-sync-cycle.spec.js` a consigné.
test("TÉMOIN — si le second chargement se saute, le motif est MESURÉ et NOMMÉ", async () => {
    expect(
        cacheControlMesure,
        "le `Cache-Control` du harnais doit avoir été mesuré — sinon le saut serait décrété"
    ).not.toBeNull();

    if (skipReason) {
        test.info().annotations.push({ type: "skip-reason", description: skipReason });
        expect(skipReason.length, "un saut doit porter un motif lisible").toBeGreaterThan(40);
        expect(skipReason, "le motif doit nommer sa ligne de registre").toContain("B-237");
        return;
    }
    // Pas de saut ⇒ l'affirmation inverse doit tenir, et être vérifiée plutôt que supposée.
    expect(
        cacheControlMesure,
        "sans `no-store`, le test du second chargement DOIT jouer"
    ).not.toContain("no-store");
});

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

    // ═══════════════════════════════════════════════════════════════════════════════════
    // GARDE DE CLASSE — B-236. Elle ne garde pas UNE entrée, elle garde l'invariant.
    // ═══════════════════════════════════════════════════════════════════════════════════
    test("CLASSE — chaque entrée du pré-cache est SERVIE hors ligne, par le ROUTEUR", async ({
        page,
        context,
    }) => {
        // 🛑 CE QUE CETTE GARDE AJOUTE AU TEST DU DESSUS, ET POURQUOI IL LA FALLAIT.
        //
        // Le test de pré-cache interroge `caches.match()`, qui BALAIE TOUS les caches de
        // l'origine. Il répond donc « le fichier est quelque part », ce qui est vrai et
        // insuffisant : le worker, lui, lit dans UN seau nommé, choisi par sa route. B-236 est
        // né exactement dans cet écart — `profiles/geoleaf.config.json` était pré-caché dans
        // `CACHE_STATIC` et la route le cherchait dans un `…-profile-geoleaf.config.json` vide,
        // créé par le `caches.open()` de la stratégie elle-même. Le test du dessus était VERT
        // pendant que l'application ne bootait pas.
        //
        // Ici on ne regarde aucun cache : on COUPE le réseau et on demande la ressource. Ce qui
        // répond est le routeur, ou rien. C'est la seule question qui compte pour un intégrateur.
        //
        // ⚠️ Cette garde peut rougir sur PLUSIEURS entrées d'un coup. C'est de l'information :
        // chaque rouge est une entrée pré-cachée que personne ne sait servir.
        await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
        await waitForController(page);
        await bootMap(page);
        await page.waitForTimeout(2000);

        // La liste n'est PAS écrite ici : elle est injectée dans le worker au build, et les
        // noms de chunks sont hachés par le contenu. On la lit là où le navigateur la lit.
        const assets = await page.evaluate(async () => {
            const src = await (await fetch("sw-core.js")).text();
            const m = src.match(/STATIC_ASSETS\s*=\s*\[([\s\S]*?)\]/);
            if (!m) return null;
            return m[1]
                .split(",")
                .map((x) => x.trim().replace(/^["']|["']$/g, ""))
                .filter(Boolean);
        });

        // Plancher de non-vacuité : une liste vide rendrait cette garde verte sans rien éprouver.
        expect(assets, "STATIC_ASSETS illisible dans le worker servi").not.toBeNull();
        expect(assets.length, "pré-cache vide — la garde ne garderait rien").toBeGreaterThan(5);

        await context.setOffline(true);

        const verdict = await page.evaluate(async (list) => {
            const out = [];
            for (const url of list) {
                try {
                    const r = await fetch(url);
                    out.push({ url, ok: r.ok, status: r.status });
                } catch (e) {
                    out.push({ url, ok: false, status: `THROW ${e.message}` });
                }
            }
            return out;
        }, assets);

        const morts = verdict.filter((v) => !v.ok);
        expect(
            morts,
            `pré-caché mais NON SERVI hors ligne — la route ne sait pas où le chercher :\n` +
                morts.map((m) => `  ${m.url} → ${m.status}`).join("\n")
        ).toEqual([]);
    });

    test("hors ligne, un second chargement affiche la carte", async ({ page, context }) => {
        // B-237 — saut MESURÉ, jamais décrété. Motif, précédent et condition de réactivation :
        // voir le bandeau de `skipReason` en tête de fichier. Ce saut ne couvre QUE ce test :
        // le pré-cache et la garde de classe jouent dans tous les cas.
        test.skip(skipReason !== null, skipReason ?? "");

        // ── 1er passage : le worker s'INSTALLE pendant que l'application démarre ──────────
        await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
        await waitForController(page);
        await bootMap(page);
        await page.waitForTimeout(2000);

        // ── 2e passage EN LIGNE, ET IL N'EST PAS FACULTATIF ───────────────────────────────
        //
        // 🛑 LA TOUTE PREMIÈRE VISITE NE PEUT PAS PEUPLER LE CACHE DE RUNTIME, et ce n'est pas
        // un défaut : l'application demande sa configuration AVANT que le worker n'ait réclamé
        // ses clients. Ces requêtes-là ne traversent donc pas le worker et ne sont écrites nulle
        // part. `waitForController` atteste que le contrôle finit par arriver, pas qu'il était
        // là quand le config est parti.
        //
        // Mesuré le 13/08/2026, sur trois chargements : après le 1er, `profile.json` est
        // ABSENT de tous les caches ; après le 2e EN LIGNE, il est présent sous `?t=0` ; au 3e,
        // hors ligne, la carte s'affiche et AUCUNE requête n'échoue.
        //
        // ⚠️ Ce passage manquait, et son absence a produit un rouge qu'on a d'abord pris pour
        // un défaut du produit. Le scénario réel d'un utilisateur est bien celui-ci : il ouvre
        // l'application une première fois (le worker s'installe), revient, PUIS part sur le
        // terrain. La promesse hors ligne commence au second chargement — pas au premier.
        await page.reload({ waitUntil: "domcontentloaded" });
        await bootMap(page);
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
