// @ts-check
/**
 * 30 — LE CYCLE DE SYNCHRONISATION, CONTRE UN VRAI BACKEND (Sprint 4, tâche 4.H)
 *
 * Le critère de preuve du Sprint 4 :
 *
 *   > Coupure réseau → édition d'une entité **rapatriée** → rechargement de la page →
 *   > **l'édition est toujours visible** → retour du réseau → push → **l'entité porte son
 *   > identifiant serveur**, et une seconde synchronisation ne produit **aucune** requête.
 *
 * ✅ **CE FICHIER PROUVE CE PARCOURS, DE BOUT EN BOUT.** Il ne l'a pas toujours fait, et ce
 * qui lui manquait a CHANGÉ DE NATURE en cours de sprint : d'abord le cycle lui-même (4.1,
 * 4.3, 4.4, 4.5), puis — les quatre livrées — un **PRODUCTEUR**, les deux plugins d'édition
 * écrivant encore la file v3. C'est 4.4b qui l'a levé. Distinguer « il manque du code » de
 * « il manque un appelant » a demandé trois tentatives.
 *
 * ✅ **4.1 et 4.3 SONT livrées, et leur `fixme` est devenu un test vivant** : le store
 * `features` a désormais son écrivain (`GeoLeaf.Storage.pullLayer`) et son lecteur. ⚠️ Ses
 * attendus se **mesurent dans le run**, ils ne se recopient pas : les deux tests de push
 * ci-dessous insèrent des lignes que l'`afterAll` seul nettoie, donc un décompte écrit en dur
 * passe isolément et rougit dans le fichier complet. C'est arrivé à la 1ʳᵉ rédaction.
 *
 * Ce que ce fichier prouve **aujourd'hui**, c'est l'autre moitié du problème : que le backend
 * de la preuve existe, qu'il tient les propriétés dont 4.4/4.5/4.6 dépendront, et que la page
 * l'atteint **avec le connector actif**. Sans ça, écrire 4.4 puis 4.5 reviendrait à coder
 * contre un serveur supposé — et c'est précisément ce que le pré-vol 4.0 a trouvé : le
 * backend que le critère exige n'existait pas, `qgis.geoleaf.dev` répondait 404, et le seul
 * E2E authentifié du dépôt (`11-connector.spec.js`) mockait chaque réponse.
 *
 * ═══ POURQUOI CE SPEC PILOTE LE CONNECTOR AU LIEU DE LE LAISSER S'AMORCER ═══
 *
 * `apps/geoleaf-app/init.js` restreint le bootstrap dev à `localhost|127.0.0.1` et au vhost de
 * `deploy-local`, pour qu'un jeton ne s'active jamais sur une origine livrée. Le piloter depuis
 * le test est le patron que `11-connector.spec.js` a établi — la différence ici est qu'il vise
 * un backend RÉEL et non des `page.route()`.
 *
 * ⚠️ Ce paragraphe a nommé `demo.addpoi.geoleaf.local.test` jusqu'au 09/08/2026 : ce vhost
 * est parti avec la variante au Sprint 5, ce que ce fichier écrit pourtant lui-même 100 lignes
 * plus bas. Un motif juste adossé à un exemple mort se relit comme une preuve.
 *
 * 🛑 DEPUIS LE 09/08/2026, LE BOOTSTRAP NE S'ACTIVE PLUS SUR AUCUNE CIBLE DE CE SPEC, ET C'EST
 * UN GAIN. `build-deploy.cjs` n'écrit plus que le talon inerte dans les variantes livrables —
 * `deploy-full`, que ce fichier vise, en est une. La cible `ports` la servait depuis
 * `localhost`, donc le bootstrap S'Y ACTIVAIT, quand il ne s'activait jamais sous `nginx` :
 * les deux cibles n'éprouvaient pas le même état de départ, et le test « point 5 » plus bas ne
 * mesurait pas un état mais une fenêtre de course. Elles partent désormais du même endroit.
 *
 * Le jeton est lu côté Node dans `apps/geoleaf-app/connector.local.js` (git-ignoré), jamais
 * écrit dans ce fichier. Un test qui porterait un JWT en dur serait committé avec.
 *
 * ═══ CE QUE LA SONDE A MESURÉ AVANT QUE CE FICHIER SOIT ÉCRIT ═══
 *
 * 🛑 **`configure()` patche le `fetch` DE LA PAGE, donc TOUTE requête vers `baseUrl` porte le
 * jeton ensuite** — y compris celles qu'on croyait anonymes. Une première rédaction de la
 * sonde asserait « POST sans bearer → 401 » **après** avoir appelé `configure()`, et lisait
 * **201**. L'assertion était fausse, pas le serveur.
 *
 * C'est ce qui donne au test « point 5 du contrat » ci-dessous sa forme : la **même** requête,
 * avant puis après `configure()`. C'est aussi la démonstration directe de pourquoi le rejeu
 * doit tourner **sur la page** et non dans le Service Worker — le patch n'atteint jamais le
 * worker, et c'est le motif qui a fait supprimer le chemin Background Sync.
 *
 * ⚠️ `serviceWorkers: "block"`, comme `11-connector`. Sans blocage, le worker pourrait
 * s'interposer et on mesurerait le worker en croyant mesurer le réseau.
 *
 * 🛑 **AUCUN profil du dépôt ne déclare de `modules.offline.dataOrigins`** — mesuré, zéro
 * occurrence dans `profiles/`. Le contrat est figé depuis E1b.5, le Service Worker sait les
 * lire depuis 3.9, la gate de config connaît la clé, mais **personne ne lui en donne** : il
 * tourne toujours sur son routage d'AMORÇAGE, le chemin heuristique que 3.9 devait rendre
 * exceptionnel.
 *
 * ⚠️ **Et déclarer n'est PAS une ligne à ajouter — essayé le 03/08, mesuré, RETIRÉ.**
 * `routeRequest` (`sw-core.js:233-239`) bascule en mode déclaratif dès qu'UNE origine est
 * déclarée, et toute origine non déclarée cesse alors d'être mise en cache : « le silence
 * d'une déclaration est un refus, pas une permission ». Déclarer la seule origine du backend
 * a donc coupé le cache de l'origine de l'application elle-même, et `27-offline-idb.spec.js`
 * l'a attrapé (contrôle négatif rouge, vert dès le retrait). **La déclaration est
 * tout-ou-rien**, et l'origine propre de l'app n'est pas déclarable dans un profil portable —
 * elle change à chaque déploiement. Suivi en **B-119**.
 *
 * ⚠️ **Ce n'était pas non plus « câbler `matchDataOrigin` »**, comme trois documents l'ont
 * écrit avant le pré-vol du 03/08 : la fonction est privée, a déjà un consommateur
 * (`publishDataOrigins`), et son TSDoc réserve son export à 4.1/4.5 — « exporter pour un
 * appelant du Sprint 4 qui n'existe pas encore est exactement la posture que ce sprint
 * reproche ailleurs ».
 *
 * ═══ LE BACKEND N'EXISTE QUE SUR LA MACHINE DE DEV ═══
 *
 * Les conteneurs sont ceux de `docker-compose.dev.yml` (`docker/backend/README.md`). Sur un
 * runner GitHub il n'y en a aucun. Ce fichier **se saute intégralement** quand le backend ne
 * répond pas — mais il le fait **bruyamment** : le motif est nommé, et l'unique test qui
 * survit au saut asserte que la raison du saut a bien été relevée. Un fichier qui sortirait
 * vert en n'ayant rien joué serait la forme même du défaut que ce chantier combat.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { goOffline, goOnline, settleNetwork, assertZeroNetwork } from "./helpers/offline.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** Origine du backend de preuve — la même que celle de `connector.local.js`. */
const API = "https://qgis.geoleaf.dev";
/** Surface OGC API Features (pygeoapi), lue par `ogc-api-loader.ts` à la tâche 4.1. */
const OGC = `${API}/ogc/collections/sites_rosario/items`;
/** Surface d'écriture (PostgREST), dialecte `collection` des adaptateurs. */
const REST = `${API}/sites_rosario`;

/**
 * Préfixe de toutes les identités clientes que ce fichier crée. Sert au nettoyage : ce spec
 * écrit dans une base partagée, et laisser ses lignes derrière lui ferait dériver le décompte
 * sur lequel la pagination est assertée (27 lignes, 3 pages).
 */
const LOCAL_ID_PREFIX = "e2e30-";

/**
 * Lit le bootstrap dev pour en extraire l'origine et le jeton.
 * @returns {{ baseUrl: string, token: string } | null} `null` si le fichier est absent —
 *   c'est le cas nominal sur un runner, pas une anomalie.
 */
function readDevConnector() {
    const p = path.join(ROOT, "apps", "geoleaf-app", "connector.local.js");
    if (!fs.existsSync(p)) return null;
    const src = fs.readFileSync(p, "utf-8");
    const token = src.match(/["'](ey[A-Za-z0-9._-]{20,})["']/)?.[1];
    const url = src.match(/baseUrl:\s*["']([^"']+)["']/)?.[1];
    return token && url ? { baseUrl: url, token } : null;
}

const DEV = readDevConnector();

/**
 * Motif du saut, ou `null` si tout est réuni. Calculé une fois, asserté par le test témoin.
 * @type {string | null}
 */
let skipReason = null;

// ⚠️ 5.5 — `deploy-addpoi` a disparu avec le plugin fusionné ; `deploy-full` est désormais
// la seule variante portant l'édition ET `offline-ui`, donc la seule où ce cycle existe.
test.use({ baseURL: baseURL("full"), serviceWorkers: "block" });

// 🛑 CE HOOK EST AU SCOPE DU FICHIER, PAS DU `describe`, ET C'EST LE TÉMOIN QUI L'EXIGE.
// Placé dans le `describe`, il s'exécutait bien — mais le `beforeEach` qui l'accompagnait
// sautait AUSSI le témoin, et le fichier sortait « 9 skipped » sans qu'une seule ligne ne dise
// pourquoi. Mesuré en arrêtant les conteneurs : c'était très exactement le silence que ce
// fichier prétend empêcher, et il était dans le mécanisme censé l'empêcher.
test.beforeAll(async ({ request }) => {
    if (!DEV) {
        skipReason =
            "apps/geoleaf-app/connector.local.js absent — pas de bootstrap dev sur cette machine";
        return;
    }
    try {
        const r = await request.get(`${OGC}?f=json&limit=1`, { timeout: 8000 });
        if (!r.ok()) skipReason = `backend joignable mais répond ${r.status()} sur ${OGC}`;
    } catch (e) {
        skipReason = `backend injoignable sur ${API} — conteneurs de docker-compose.dev.yml non démarrés (${String(e).slice(0, 80)})`;
    }
    if (skipReason) return;

    // ── 3e condition — la VARIANTE SERVIE déclare-t-elle encore une source de rapatriement ?
    //
    // 🛑 AJOUTÉE LE 09/08/2026, ET C'EST UN SAUT DE PLUS ASSUMÉ, PAS UNE RÉGRESSION MASQUÉE.
    // Depuis cette date, `build-deploy.cjs` (étape 9a) retire des variantes LIVRABLES les
    // liaisons vers le backend de preuve : `qgis.geoleaf.dev` ne résout que sur ce poste, et il
    // partait tel quel chez un client. Or ce fichier vise `deploy-full`, qui EST un livrable, et
    // `pullLayer()` lit `offline.source.url` dans le profil servi — sans override possible
    // (`capabilities/offline/pull/layer-pull.ts`). Sans cette condition, les tests de
    // rapatriement rougiraient sur un déployé pourtant CORRECT.
    //
    // ⚠️ Les deux conditions ci-dessus mesurent la MACHINE (bootstrap, conteneurs) ; celle-ci
    // mesure l'ARTEFACT. Un backend qui répond ne dit rien de ce que la variante servie déclare
    // — c'est précisément l'écart qui rendait le diagnostic illisible sans elle.
    try {
        const cfg = await request.get(
            `${baseURL("full")}/profiles/tourism/layers/sites_rosario/sites_rosario_config.json`,
            { timeout: 8000 }
        );
        const declaresSource = cfg.ok() && Boolean((await cfg.json())?.offline?.source?.url);
        if (!declaresSource) {
            skipReason =
                "la variante servie est un LIVRABLE : ses liaisons vers le backend de preuve ont " +
                "été retirées au build (build-deploy.cjs étape 9a), donc `sites_rosario` ne " +
                "déclare plus d'`offline.source`. Pour éprouver le cycle complet, reconstruire " +
                "avec l'origine explicite : " +
                "GEOLEAF_BACKEND_BASE_URL=https://qgis.geoleaf.dev npm run build:deploy";
        }
    } catch (e) {
        skipReason = `profil de la variante servie illisible (${String(e).slice(0, 80)})`;
    }
});

test("TÉMOIN — si ce fichier se saute, le motif est NOMMÉ et non silencieux", async () => {
    // ⚠️ HORS du `describe`, donc hors de portée de son `beforeEach` : c'est le seul test du
    // fichier qui doit s'exécuter même sans backend. Sa valeur n'est pas d'asserter que le
    // backend tourne — c'est d'empêcher que ce fichier passe pour « vert » alors qu'il n'a
    // rien joué. Un fichier entièrement sauté est indiscernable, dans un rapport lu vite,
    // d'un fichier entièrement vert.
    if (skipReason) {
        test.info().annotations.push({ type: "skip-reason", description: skipReason });
        expect(skipReason.length, "un saut doit porter un motif lisible").toBeGreaterThan(20);
        return;
    }
    expect(DEV, "le bootstrap dev doit être lisible quand le backend répond").not.toBeNull();
});

test.describe("30 — Cycle de synchronisation (backend réel, connector actif)", () => {
    test.beforeEach(() => {
        test.skip(skipReason !== null, skipReason ?? "");
    });

    test.afterAll(async ({ request }) => {
        // Nettoyage de TOUT ce que ce fichier a pu écrire, y compris après un échec en cours
        // de route. Sans lui, une exécution répétée ferait grossir la table et le décompte de
        // pagination (27) cesserait d'être vrai — un test qui casse le test d'à côté.
        if (skipReason || !DEV) return;
        await request
            .delete(`${REST}?local_id=like.${LOCAL_ID_PREFIX}*`, {
                headers: { Authorization: `Bearer ${DEV.token}` },
            })
            .catch(() => {});
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Ce qui est PROUVÉ aujourd'hui — les propriétés dont 4.1 à 4.6 dépendront.
    // ─────────────────────────────────────────────────────────────────────────

    test("4.1 (transport) — la surface OGC a la forme que `ogc-api-loader` exige", async ({
        page,
    }) => {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

        const shape = await page.evaluate(async (url) => {
            const r = await fetch(`${url}?f=json&limit=10`);
            const d = await r.json();
            return {
                status: r.status,
                type: d.type,
                featuresIsArray: Array.isArray(d.features),
                matched: d.numberMatched,
                hasNext: (d.links || []).some(
                    (l) => l.rel === "next" && typeof l.href === "string"
                ),
                geometryType: d.features?.[0]?.geometry?.type ?? null,
            };
        }, OGC);

        // Ces trois-là sont exactement ce que `_validateOgcResponse` contrôle, et ce que
        // `_extractNextUrl` cherche. Les asserter ici, c'est asserter que 4.1 n'aura AUCUN
        // code de transport à écrire — la promesse du point 6 du contrat.
        expect(shape.status).toBe(200);
        expect(shape.type).toBe("FeatureCollection");
        expect(shape.featuresIsArray).toBe(true);
        expect(shape.hasNext, "sans lien `next`, la pagination de 4.1 serait improuvable").toBe(
            true
        );
        expect(shape.geometryType).toBe("Point");
    });

    test("4.1 (transport) — la pagination tourne RÉELLEMENT les pages, depuis la page", async ({
        page,
    }) => {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

        // Marche identique à celle de `fetchOgcApiFeatures` : suivre `links[rel=next]` jusqu'à
        // épuisement. Le plafond de 10 tours n'est pas un réglage, c'est un garde-fou : sans
        // lui, un backend qui renverrait toujours le même `next` boucherait le runner.
        const walk = await page.evaluate(async (url) => {
            let next = `${url}?f=json&limit=10`;
            let pages = 0;
            let total = 0;
            let matched = null;
            while (next && pages < 10) {
                const r = await fetch(next);
                const d = await r.json();
                pages++;
                total += (d.features || []).length;
                matched = d.numberMatched ?? matched;
                next = (d.links || []).find((l) => l.rel === "next")?.href ?? null;
            }
            return { pages, total, matched };
        }, OGC);

        // 🛑 `pages > 1` est l'assertion qui compte, et elle est là pour une raison mesurée :
        // pg_featureserv 1.3.1 — le premier serveur monté à la tâche 4.H — sert `bbox` et
        // `limit` correctement mais n'émet AUCUN lien `next`. La marche s'y arrêtait à la
        // première page en rendant un total plausible. Un test qui n'asserterait que le total
        // serait passé au vert contre un serveur incapable de paginer.
        expect(walk.pages, "une seule page ⇒ le lien `next` n'est pas suivi").toBeGreaterThan(1);
        expect(walk.total).toBe(walk.matched);
    });

    test("4.1 (transport) — l'emprise BORNE le rapatriement", async ({ page }) => {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

        // 🛑 `numberMatched` ET NON `features.length`. La première rédaction comptait les
        // features rendues avec `limit=1000`, et lisait **10 contre 10** : pygeoapi ÉCRÊTE la
        // taille de page à son `server.limit` (10 ici, choisi petit exprès pour que la
        // pagination reste testable). Les deux mesures comparaient donc deux pages tronquées
        // identiques, et le test rougissait en accusant l'emprise.
        //
        // ⚠️ L'instrument portait le biais qu'il mesurait : compter une PAGE pour prouver un
        // filtre sur un ENSEMBLE. `numberMatched` est le cardinal du résultat, pas de la page —
        // 27 sans emprise, 12 avec.
        const counts = await page.evaluate(async (url) => {
            const at = async (q) =>
                (await (await fetch(`${url}?f=json&limit=1${q}`)).json()).numberMatched;
            return {
                all: await at(""),
                inBbox: await at("&bbox=-60.67,-32.95,-60.64,-32.93"),
            };
        }, OGC);

        // Une emprise qui ne retire rien ne prouve pas qu'elle filtre — elle prouve seulement
        // qu'elle n'a pas provoqué d'erreur.
        expect(counts.inBbox).toBeGreaterThan(0);
        expect(counts.inBbox).toBeLessThan(counts.all);
    });

    test("POINT 5 DU CONTRAT — le connector patche le `fetch` DE LA PAGE, et c'est ce qui autorise l'écriture", async ({
        page,
    }) => {
        // 🛑 CAPTURER `fetch` AVANT TOUT SCRIPT DE PAGE — sans quoi ce test serait une COURSE.
        //
        // ⚠️ L'HISTORIQUE VAUT D'ÊTRE GARDÉ, PARCE QUE LA FORME DU TEST EN DÉCOULE. Jusqu'au
        // 09/08/2026, `deploy-full` embarquait le VRAI `connector.local.js` : sur la cible
        // `ports` — celle de `ci:local` — l'origine est `localhost`, donc le bootstrap dev
        // s'activait et configurait le connector au boot, quand sous `E2E_TARGET=nginx` il ne
        // s'activait jamais. La mesure « avant `configure()` » ne mesurait alors pas un état
        // mais une FENÊTRE : elle ne valait que si elle gagnait la course contre ce bootstrap.
        // Vue basculer le 08/08/2026 au passage à MapLibre 6, dont le boot ajoute deux requêtes
        // sérialisées (`global.mjs` → `maplibre-gl.mjs` → `-shared.mjs`) et décale la fenêtre —
        // la v6 n'a rien cassé, elle a révélé que l'assertion reposait sur un timing.
        //
        // La course a disparu à sa racine : les variantes livrables ne reçoivent plus que le
        // talon inerte, donc `window.GEOLEAF_DEV_CONNECTOR` est `undefined` au boot sur les
        // DEUX cibles.
        //
        // `addInitScript` reste néanmoins, et ce n'est pas de la ceinture-bretelles : il
        // s'exécute avant tout script du document, donc la référence capturée ici n'est JAMAIS
        // patchée. Le « avant » devient vrai par CONSTRUCTION plutôt que par une propriété du
        // build — ce qui rend au test ce qu'il prétend prouver : c'est bien le patch de `fetch`
        // qui autorise l'écriture, et non l'ordre dans lequel deux scripts se sont chargés.
        await page.addInitScript(() => {
            /** @type {any} */ (window).__origFetch = window.fetch.bind(window);
        });
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

        const body = {
            local_id: `${LOCAL_ID_PREFIX}point5`,
            title: "Saisie de terrain",
            geom: "SRID=4326;POINT(-60.655 -32.945)",
        };

        // AVANT `configure()` — aucun jeton n'est injecté, PostgREST retombe sur
        // `geoleaf_anon`, qui n'a que le SELECT. C'est l'invariant S6 tenu côté SQL :
        // le rapatriement ne confère jamais l'écriture.
        const before = await page.evaluate(
            async ({ url, payload }) => {
                // `__origFetch` — la référence d'avant tout patch (voir `addInitScript`).
                const r = await /** @type {any} */ (window).__origFetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                });
                return r.status;
            },
            { url: REST, payload: body }
        );
        expect(before, "sur un `fetch` NON patché, l'écriture doit être REFUSÉE").toBe(401);

        // APRÈS `configure()` — la MÊME requête, sur la même page, sans qu'aucun en-tête ne
        // soit posé par l'appelant. C'est le connector qui l'ajoute, en patchant `fetch`.
        const after = await page.evaluate(
            async ({ url, payload, api, tok }) => {
                const w = /** @type {any} */ (window);
                await w.GeoLeaf.Connector.configure({ baseUrl: api, getToken: async () => tok });
                const r = await fetch(url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Prefer: "return=representation",
                    },
                    body: JSON.stringify(payload),
                });
                return { status: r.status, rows: r.status === 201 ? await r.json() : null };
            },
            { url: REST, payload: body, api: API, tok: /** @type {string} */ (DEV?.token) }
        );

        expect(after.status, "avec connector, la MÊME requête doit passer").toBe(201);

        // 🛑 C'est ici que se joue la raison d'être du point 5 : ce patch vit dans la PAGE. Le
        // Service Worker ne le voit pas, et c'est pour ça que le rejeu depuis le worker ne
        // pouvait pas résoudre l'authentification — le chemin Background Sync a été supprimé
        // pour ce motif, pas par hygiène.
        expect(after.rows?.[0]?.local_id).toBe(body.local_id);
    });

    test("4.5 (préalable) — le push rend l'IDENTIFIANT SERVEUR, matière de la réconciliation", async ({
        page,
    }) => {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

        // ⚠️ ATTENDRE le plugin, pas un proxy. `connector` est PARESSEUX (`init.js` →
        // `registerLazy`), donc `#geoleaf-map` visible ne dit RIEN de sa disponibilité :
        // `GeoLeaf.Connector` était encore `undefined` ici, par intermittence. Attendre l'état
        // qu'on va utiliser est la seule forme qui ne dépende pas du temps de boot — lequel a
        // changé au passage à MapLibre 6 (deux requêtes sérialisées de plus).
        await page.waitForFunction(
            () => typeof window.GeoLeaf?.Connector?.configure === "function",
            null,
            { timeout: 20000 }
        );

        const pushed = await page.evaluate(
            async ({ url, api, tok, localId }) => {
                const w = /** @type {any} */ (window);
                await w.GeoLeaf.Connector.configure({ baseUrl: api, getToken: async () => tok });
                const r = await fetch(url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Prefer: "return=representation",
                    },
                    body: JSON.stringify({
                        local_id: localId,
                        title: "Entité créée hors réseau",
                        geom: "SRID=4326;POINT(-60.66 -32.946)",
                    }),
                });
                const rows = await r.json();
                return { status: r.status, row: rows?.[0] ?? null };
            },
            {
                url: REST,
                api: API,
                tok: /** @type {string} */ (DEV?.token),
                localId: `${LOCAL_ID_PREFIX}push`,
            }
        );

        expect(pushed.status).toBe(201);
        // `localId` → `serverId` : c'est LA donnée que 4.5 devra reporter dans l'enregistrement.
        expect(typeof pushed.row?.id, "le serveur doit rendre son identifiant").toBe("number");
        expect(pushed.row?.local_id).toBe(`${LOCAL_ID_PREFIX}push`);
        // Le marqueur de version relevé au push — matière de la détection de conflit (4.6).
        expect(pushed.row?.updated_at, "sans marqueur, un conflit est indétectable").toBeTruthy();
    });

    test("4.5 (préalable) — le REJEU du même `localId` est refusé par la BASE, pas par une convention d'appelant", async ({
        page,
    }) => {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

        // ⚠️ ATTENDRE le plugin, pas un proxy. `connector` est PARESSEUX (`init.js` →
        // `registerLazy`), donc `#geoleaf-map` visible ne dit RIEN de sa disponibilité :
        // `GeoLeaf.Connector` était encore `undefined` ici, par intermittence. Attendre l'état
        // qu'on va utiliser est la seule forme qui ne dépende pas du temps de boot — lequel a
        // changé au passage à MapLibre 6 (deux requêtes sérialisées de plus).
        await page.waitForFunction(
            () => typeof window.GeoLeaf?.Connector?.configure === "function",
            null,
            { timeout: 20000 }
        );

        const replay = await page.evaluate(
            async ({ url, api, tok, localId }) => {
                const w = /** @type {any} */ (window);
                await w.GeoLeaf.Connector.configure({ baseUrl: api, getToken: async () => tok });
                const send = () =>
                    fetch(url, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            local_id: localId,
                            title: "Rejeu",
                            geom: "SRID=4326;POINT(-60.661 -32.947)",
                        }),
                    });
                const first = await send();
                const second = await send();
                const count = await (await fetch(`${url}?local_id=eq.${localId}&select=id`)).json();
                return { first: first.status, second: second.status, rows: count.length };
            },
            {
                url: REST,
                api: API,
                tok: /** @type {string} */ (DEV?.token),
                localId: `${LOCAL_ID_PREFIX}replay`,
            }
        );

        expect(replay.first).toBe(201);
        // 409 sur la contrainte UNIQUE. L'idempotence que 4.5 doit tenir n'est donc pas une
        // discipline d'appelant — un rejeu accidentel ne PEUT pas dupliquer.
        expect(replay.second, "un rejeu doit collisionner, pas dupliquer").toBe(409);
        expect(replay.rows, "une seule ligne, quoi qu'il arrive").toBe(1);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // ✅ PLUS AUCUN `fixme` DANS CE FICHIER. Il en portait deux, un par tâche non livrée ;
    // les deux sont devenus des tests vivants — 4.1 d'abord, puis le parcours complet une
    // fois les producteurs basculés (4.4b). C'était leur seul rôle : rougir à la livraison.
    // ─────────────────────────────────────────────────────────────────────────

    // ⚠️ CE TEST ÉTAIT UN `fixme` JUSQU'À LA TÂCHE 4.1 — il est vivant depuis.
    //
    // Trois choses ont changé en le réveillant, et aucune n'est cosmétique :
    //
    //  1. `GeoLeaf.Offline.pullLayer` N'A JAMAIS EXISTÉ et n'existera pas : le rapatriement
    //     est monté sur `GeoLeaf.Storage`, la façade du moteur hors-ligne, plutôt que dans un
    //     namespace neuf. Le `fixme` le disait — « le nom est une hypothèse, pas un contrat ».
    //  2. L'appel PERD SON CHAÎNAGE OPTIONNEL. `w.GeoLeaf?.Offline?.pullLayer?.(…)` ne
    //     jetait pas quand rien ne répondait : il ne faisait RIEN, et le test n'aurait accusé
    //     que le décompte. Un appel qui doit avoir lieu s'écrit sans `?.`.
    //  3. Le critère monte. « `features` n'est plus vide » se satisfait d'un seul
    //     enregistrement vide de sens ; on assert ici que les entités portent leur identité
    //     serveur et leur marqueur de version — ce que 4.6 comparera —, et surtout qu'une
    //     EMPRISE borne réellement le lot (11 des 27, mesuré).
    test("4.1 — le rapatriement borné ÉCRIT dans `features`, et l'emprise le BORNE", async ({
        page,
        request,
    }) => {
        // 🛑 LES ATTENDUS SE MESURENT DANS LE MÊME RUN, ILS NE SE RECOPIENT PAS.
        // La graine vaut 27 lignes — mais les deux tests de push ci-dessus en INSÈRENT, et
        // leur nettoyage n'a lieu qu'en `afterAll`. Un `toBe(27)` écrit ici passe seul et
        // rougit dans le fichier complet : c'est ce qui s'est produit à la 1ʳᵉ rédaction.
        // On demande donc son propre décompte au serveur, et la preuve devient l'ÉCART.
        const numberMatched = async (bbox) => {
            const response = await request.get(
                `${OGC}?f=json&limit=1${bbox ? `&bbox=${bbox}` : ""}`
            );
            return (await response.json()).numberMatched;
        };
        const BBOX = "-60.66,-32.95,-60.62,-32.93";
        const onServer = await numberMatched();
        const onServerBounded = await numberMatched(BBOX);

        await page.goto("/", { waitUntil: "domcontentloaded" });
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

        // Le moteur de stockage est un chunk DIFFÉRÉ : sans cette attente, on mesurerait
        // l'attente bornée de la façade au lieu du rapatriement (tâche 4.3, même piège).
        await page.waitForFunction(() => !!window.GeoLeaf?.Storage?.DB, null, { timeout: 20000 });

        /**
         * Lit le store. Garde `objectStoreNames.contains` (une base v3 lèverait
         * `NotFoundError`) et `onerror` sur la requête — sans lui la promesse ne résout
         * jamais, et le symptôme est un timeout Playwright au lieu d'un rouge lisible.
         */
        const readStore = async () =>
            page.evaluate(
                () =>
                    new Promise((resolve) => {
                        const q = indexedDB.open("geoleaf-db");
                        q.onerror = () => resolve({ err: String(q.error?.name) });
                        q.onsuccess = () => {
                            const db = q.result;
                            if (!db.objectStoreNames.contains("features")) {
                                db.close();
                                resolve({ err: "store `features` absent" });
                                return;
                            }
                            const all = db.transaction("features").objectStore("features").getAll();
                            all.onerror = () => {
                                db.close();
                                resolve({ err: String(all.error?.name) });
                            };
                            all.onsuccess = () => {
                                const rows = all.result ?? [];
                                db.close();
                                resolve({
                                    total: rows.length,
                                    withServerId: rows.filter((r) => r.serverId).length,
                                    withVersion: rows.filter((r) => r.version?.kind === "timestamp")
                                        .length,
                                    states: [...new Set(rows.map((r) => r.syncState))],
                                });
                            };
                        };
                    })
            );

        const full = await page.evaluate(() => window.GeoLeaf.Storage.pullLayer("sites_rosario"));
        expect(full.refused, "le rapatriement ne doit pas refuser").toBeNull();

        const stored = await readStore();
        expect(stored.total, "après un pull, `features` porte ce que la source a rendu").toBe(
            onServer
        );
        expect(stored.withServerId, "chaque entité porte son identité serveur").toBe(onServer);
        // Le marqueur relevé DÈS le premier pull : c'est lui, et rien d'autre, qui rendra le
        // conflit détectable en 4.6. Le relever plus tard aurait imposé une migration.
        expect(stored.withVersion, "chaque entité porte son VersionMarker").toBe(onServer);
        // Invariant S6 — le rapatriement ne confère JAMAIS l'éditabilité.
        expect(stored.states).toEqual(["synced"]);

        // ── L'emprise BORNE, et le contrôle est discriminant ────────────────────────────
        // L'emprise est passée à la page, jamais réécrite : la chaîne interrogée au serveur et
        // le tableau donné au rapatriement doivent être le MÊME littéral, sinon la comparaison
        // porte sur deux emprises différentes sans que rien ne le dise.
        const bounded = await page.evaluate(async (bboxText) => {
            await new Promise((resolve) => {
                const q = indexedDB.open("geoleaf-db");
                q.onerror = () => resolve(null);
                q.onsuccess = () => {
                    const db = q.result;
                    const tx = db.transaction("features", "readwrite");
                    tx.objectStore("features").clear();
                    tx.oncomplete = tx.onerror = () => {
                        db.close();
                        resolve(null);
                    };
                };
            });
            return window.GeoLeaf.Storage.pullLayer("sites_rosario", {
                bbox: bboxText.split(",").map(Number),
            });
        }, BBOX);

        // ⚠️ Le contrôle qui fait la preuve : une emprise qui rendrait TOUT ne prouverait
        // rien. On asserte d'abord qu'elle discrimine réellement, PUIS que le rapatriement
        // s'y tient. Sans la première ligne, la seconde resterait verte le jour où la donnée
        // se déplace hors de l'emprise.
        expect(
            onServerBounded,
            "l'emprise doit DISCRIMINER, sinon la mesure ne prouve rien"
        ).toBeLessThan(onServer);
        expect(bounded.written, "l'emprise borne le rapatriement").toBe(onServerBounded);
        expect((await readStore()).total).toBe(onServerBounded);
    });

    /**
     * LE CRITÈRE DE PREUVE DU SPRINT 4, joué de bout en bout.
     *
     * 🛑 CE TEST A ÉTÉ UN `fixme` PENDANT TOUT LE SPRINT, ET CE QUI LUI MANQUAIT A CHANGÉ DE
     * NATURE EN COURS DE ROUTE. Au départ il manquait le cycle : rapatrier (4.1), lire local
     * (4.3), écrire optimiste (4.4), pousser (4.5). Une fois ces quatre livrées il manquait
     * encore quelque chose — non pas du code de cycle, mais un PRODUCTEUR : les deux plugins
     * d'édition écrivaient toujours la file v3, chacun dans son vocabulaire. C'est 4.4b qui
     * l'a levé. Le distinguer a demandé trois tentatives.
     *
     * ⚠️ Il édite une entité RAPATRIÉE, pas une entité créée : c'est le mot du critère, et
     * c'est le cas qui a du sens — une identité serveur existe déjà, donc la réconciliation
     * porte sur quelque chose. Il restaure le titre d'origine en sortant : ce spec écrit dans
     * une base partagée, et laisser dériver la graine ferait mentir les décomptes des autres.
     */
    test("PREUVE DU SPRINT 4 — édition hors réseau, rechargement, push, identité réconciliée", async ({
        page,
        context,
    }) => {
        const LAYER = "sites_rosario";
        const EDITED = `hors-réseau-${Date.now()}`;
        /** Tout ce qui n'est PAS le backend est toléré : l'étape 9 ne parle que de LUI. */
        const ONLY_BACKEND = [/^(?!.*qgis\.geoleaf\.dev).*/];

        const bootAndConfigure = async () => {
            await page.goto("/", { waitUntil: "domcontentloaded" });
            await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

            // ⚠️ ATTENDRE le plugin, pas un proxy. `connector` est PARESSEUX (`init.js` →
            // `registerLazy`), donc `#geoleaf-map` visible ne dit RIEN de sa disponibilité :
            // `GeoLeaf.Connector` était encore `undefined` ici, par intermittence. Attendre l'état
            // qu'on va utiliser est la seule forme qui ne dépende pas du temps de boot — lequel a
            // changé au passage à MapLibre 6 (deux requêtes sérialisées de plus).
            await page.waitForFunction(
                () => typeof window.GeoLeaf?.Connector?.configure === "function",
                null,
                { timeout: 20000 }
            );
            // Le moteur de stockage est un chunk DIFFÉRÉ — sans cette attente on mesurerait
            // l'attente bornée de la façade au lieu du cycle.
            await page.waitForFunction(() => !!window.GeoLeaf?.Storage?.DB, null, {
                timeout: 20000,
            });
            await page.evaluate(
                async ({ api, tok }) => {
                    await window.GeoLeaf.Connector.configure({
                        baseUrl: api,
                        getToken: async () => tok,
                    });
                },
                { api: API, tok: DEV.token }
            );
        };

        const readRecord = (localId) =>
            page.evaluate(
                ({ layer, id }) =>
                    new Promise((resolve) => {
                        const q = indexedDB.open("geoleaf-db");
                        q.onerror = () => resolve({ err: String(q.error?.name) });
                        q.onsuccess = () => {
                            const db = q.result;
                            if (!db.objectStoreNames.contains("features")) {
                                db.close();
                                resolve({ err: "store absent" });
                                return;
                            }
                            const get = db
                                .transaction("features")
                                .objectStore("features")
                                .get([layer, id]);
                            get.onerror = () => {
                                db.close();
                                resolve({ err: String(get.error?.name) });
                            };
                            get.onsuccess = () => {
                                db.close();
                                resolve(get.result ?? null);
                            };
                        };
                    }),
                { layer: LAYER, id: localId }
            );

        // ── 1. RAPATRIER ────────────────────────────────────────────────────────────────
        await bootAndConfigure();
        const pull = await page.evaluate((l) => window.GeoLeaf.Storage.pullLayer(l), LAYER);
        expect(pull.refused, "le rapatriement doit avoir lieu").toBeNull();
        expect(pull.written).toBeGreaterThan(0);

        // L'entité éditée est une entité RAPATRIÉE : son identité locale est dérivée de son
        // identité serveur par 4.1, et c'est ce qui rendra la réconciliation vérifiable.
        const localId = "srv:1";
        const before = await readRecord(localId);
        expect(before?.serverId, "l'entité rapatriée porte son identité serveur").toBe("1");
        const originalTitle = before.feature.properties.title;

        // ── 2. COUPER · 3. ÉDITER ───────────────────────────────────────────────────────
        await goOffline(context, page);
        const edit = await page.evaluate(
            async ({ layer, id, title }) => {
                const rec = await new Promise((resolve) => {
                    const q = indexedDB.open("geoleaf-db");
                    q.onsuccess = () => {
                        const db = q.result;
                        const g = db
                            .transaction("features")
                            .objectStore("features")
                            .get([layer, id]);
                        g.onsuccess = () => {
                            db.close();
                            resolve(g.result);
                        };
                    };
                });
                const feature = { ...rec.feature };
                feature.properties = { ...feature.properties, title };
                return window.GeoLeaf.Storage.applyEdit({
                    layerId: layer,
                    kind: "update",
                    localId: id,
                    feature,
                });
            },
            { layer: LAYER, id: localId, title: EDITED }
        );
        expect(edit.refused, "éditer hors réseau ne doit rien refuser").toBeNull();

        // ── 4. RECHARGER · 5. L'ÉDITION EST TOUJOURS LÀ ─────────────────────────────────
        // 🛑 LE CŒUR DU CRITÈRE. C'est ici que la chaîne casse si l'écriture optimiste n'a pas
        // atterri dans `features`, ou si la lecture locale de 4.3 ne la relit pas : une saisie
        // de terrain qui disparaît au rechargement est le défaut que ce sprint existe à fermer.
        await goOnline(context, page);
        await bootAndConfigure();
        const afterReload = await readRecord(localId);
        expect(afterReload?.feature?.properties?.title, "l'édition survit au rechargement").toBe(
            EDITED
        );
        expect(afterReload.syncState, "elle est toujours due au serveur").toBe("pending");

        const served = await page.evaluate(
            (l) => window.GeoLeaf.Storage.DB.getLayerFeatureCollection(l),
            LAYER
        );
        expect(
            served.features.some((f) => f?.properties?.title === EDITED),
            "et le magasin la SERT — c'est ce que « toujours visible » veut dire"
        ).toBe(true);

        // ── 6. RÉTABLIR (déjà fait) · 7. POUSSER · 8. IDENTITÉ RÉCONCILIÉE ──────────────
        const push = await page.evaluate(() => window.GeoLeaf.Storage.pushOutbox());
        expect(push.refused).toBeNull();
        expect(push.pushed, "l'édition part au serveur").toBeGreaterThan(0);

        const afterPush = await readRecord(localId);
        expect(afterPush.serverId, "l'entité porte son identifiant serveur").toBe("1");
        expect(afterPush.syncState, "et elle n'est plus due").toBe("synced");

        // ── 9. UNE SECONDE SYNCHRONISATION NE PRODUIT AUCUNE REQUÊTE ────────────────────
        // ⚠️ Scopé sur l'origine du backend, et précédé de `settleNetwork` : sur une page de
        // carte le réseau n'est JAMAIS calme (les tuiles arrivent bien après le boot), et
        // conclure « zéro requête tout court » sur une variante puis l'appliquer à une autre
        // est la faute que le helper documente. L'instrument compte des INITIATIONS.
        await settleNetwork(page);
        await assertZeroNetwork(
            page,
            async () => {
                const second = await page.evaluate(() => window.GeoLeaf.Storage.pushOutbox());
                expect(second.attempted, "la file est vide, il n'y a rien à repousser").toBe(0);
            },
            { allow: ONLY_BACKEND }
        );

        // Remise en état de la graine — ce spec écrit dans une base partagée.
        await page.evaluate(
            async ({ url, title }) => {
                await fetch(`${url}?id=eq.1`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ title }),
                });
            },
            { url: REST, title: originalTitle }
        );
    });
});
