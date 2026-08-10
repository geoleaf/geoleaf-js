#!/usr/bin/env node
/**
 * TILE-CACHE TRIM PROBE — VOIR l'éviction s'exécuter, dans un vrai navigateur.
 *
 * POURQUOI ELLE EXISTE. La tâche 1.2 de `roadmap_socle-init.md` borne `CACHE_TILES`, et sa
 * propre section de vérification pose la condition : « **Voir le trim s'exécuter** : forcer le
 * seuil bas, naviguer, et voir le nombre de clés redescendre. ⚠️ *Une éviction jamais vue
 * s'exécuter ne borne rien* — même exigence que pour les gates. »
 *
 * Les suites unitaires exécutent le worker contre une Cache API simulée. Elles prouvent la
 * logique ; elles ne prouvent pas que `cache.keys()` rend l'ordre d'insertion dans un moteur
 * réel, ni que `cache.delete()` sur des milliers de clés aboutit, ni que le worker DÉPLOYÉ —
 * copié, patché par regex, minifié — porte encore le code qu'on a écrit. C'est ce que cette
 * sonde regarde.
 *
 * CE QU'ELLE MESURE, dans l'ordre :
 *   T0 — le worker déployé porte-t-il le bornage ? (sinon les mesures suivantes n'ont pas de
 *        sujet, et un déployé périmé sort vert en n'ayant rien éprouvé)
 *   T1 — semer `geoleaf-data-tiles` AU-DESSUS du plafond LIVRÉ, pas d'un plafond de test :
 *        ce qui est éprouvé est la configuration que l'intégrateur reçoit.
 *   T2 — le cache durable SURVIT à une ré-inscription du worker (re-preuve de la tâche 3.5 :
 *        son nom ne porte pas de version, donc `activate` ne peut pas le raser).
 *   T3 — après une navigation qui fait écrire une tuile, le compte REDESCEND, et il redescend
 *        à la marge basse (80 % du plafond), pas à zéro.
 *
 * 🛑 POURQUOI UNE RÉ-INSCRIPTION AU MILIEU. Le contrôle est amorti : il tourne au premier
 * `put` de tuile de chaque démarrage de worker, puis par lots de 50. Un worker déjà chaud a un
 * compteur dans un état inconnu, donc une mesure non déterministe. Désinscrire puis recharger
 * donne un worker neuf — et comme `CACHE_TILES` n'est pas versionné, les entrées semées
 * traversent l'opération. La sonde fait donc d'une pierre deux coups.
 *
 * ELLE VALIDE, ELLE NE GARDE PAS — même statut que `probe-tile-cache-arbitration.mjs` : elle
 * exige un déployé à jour et le nginx de dev, donc elle n'est ni dans `ci:local` ni dans
 * `package.json`.
 *
 * ⚠️ Régénérer le déployé avant de croire un run — en TROIS temps, le premier n'est pas
 * optionnel : `npx turbo run build`, puis `npm run build:deploy`, puis
 * `node scripts/build-deploy-coverage.cjs`. `build-deploy.cjs` assemble depuis les `dist/`
 * existants, **il ne compile rien** : l'enchaîner seul produit un déployé périmé EN SORTANT 0.
 *
 * Usage : E2E_TARGET=nginx node scripts/probe-tile-cache-trim.mjs
 * Exit  : 0 = le trim a été VU s'exécuter · 1 = il ne s'est pas exécuté · 2 = erreur de sonde
 */

import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { SOFTWARE_GL_ARGS } from "../e2e/helpers/launch-options.js";
import { baseURL, hostResolverArgs } from "../e2e/helpers/base-url.js";

const VARIANT = process.env.PROBE_VARIANT || "full";
const TARGET_URL = `${baseURL(VARIANT)}/`;
const TILE_CACHE = "geoleaf-data-tiles";

const say = (label, detail) => console.log(`▸ ${label}\n     → ${detail}\n`);

/** Le plafond LIVRÉ, lu dans le worker déployé — jamais recopié en prose ici. */
function deployedCeiling() {
    const src = readFileSync(
        new URL(`../deploy/deploy-${VARIANT}/sw-core.js`, import.meta.url),
        "utf8"
    );
    const max = src.match(/const TILE_CACHE_MAX_ENTRIES = (\d+);/);
    const ratio = src.match(/const TILE_CACHE_TRIM_RATIO = ([\d.]+);/);
    return {
        hasTrim: /_maybeTrimTiles/.test(src) && /_trimTileCache/.test(src),
        max: max ? Number(max[1]) : null,
        ratio: ratio ? Number(ratio[1]) : null,
    };
}

/** Compte les clés de `CACHE_TILES` depuis la page. */
const countTiles = (page) =>
    page.evaluate(async (name) => {
        if (!(await caches.keys()).includes(name)) return -1;
        return (await caches.open(name)).keys().then((k) => k.length);
    }, TILE_CACHE);

const run = async () => {
    // ── T0 — le déployé porte-t-il le sujet ? ───────────────────────────────────────────
    const { hasTrim, max, ratio } = deployedCeiling();
    say(
        "T0 — le worker DÉPLOYÉ porte le bornage",
        hasTrim && max
            ? `oui — plafond ${max}, marge basse ${Math.floor(max * ratio)} (${ratio})`
            : "NON — déployé périmé ? Régénérer en trois temps avant de relancer"
    );
    if (!hasTrim || !max) return 2;

    const browser = await chromium.launch({ args: [...SOFTWARE_GL_ARGS, ...hostResolverArgs] });
    // Aucun `serviceWorkers: "block"` : le worker EST le sujet.
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    console.log(
        `\n▸ ${TARGET_URL}   (variante « ${VARIANT} », E2E_TARGET=${process.env.E2E_TARGET || "ports"})\n`
    );

    try {
        await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {
            timeout: 25000,
        });

        // ── T1 — semer AU-DESSUS du plafond livré ───────────────────────────────────────
        const seedTarget = max + 100;
        const seeded = await page.evaluate(
            async ({ name, target }) => {
                const cache = await caches.open(name);
                const already = (await cache.keys()).length;
                // Par lots : quelques milliers de `put` séquentiels sont bien plus lents.
                for (let i = already; i < target; i += 200) {
                    await Promise.all(
                        Array.from({ length: Math.min(200, target - i) }, (_, k) =>
                            cache.put(
                                new Request(`https://seed.invalid/tile/${i + k}.pbf`),
                                new Response(new Uint8Array(8), { status: 200 })
                            )
                        )
                    );
                }
                return (await cache.keys()).length;
            },
            { name: TILE_CACHE, target: seedTarget }
        );
        say(
            `T1 — cache semé au-dessus du plafond livré (${max})`,
            `${seeded} entrée(s) dans \`${TILE_CACHE}\``
        );
        if (seeded <= max) {
            say("ABANDON", "le semis n'a pas dépassé le plafond — rien à observer");
            return 2;
        }

        // ── T2 — worker NEUF, et le cache durable doit traverser ────────────────────────
        // Compteur amorti : seul un worker fraîchement démarré vérifie dès son premier `put`.
        await page.evaluate(async () => {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map((r) => r.unregister()));
        });
        await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {
            timeout: 25000,
        });

        const survived = await countTiles(page);
        say(
            "T2 — le cache durable survit à une ré-inscription du worker",
            survived === seeded
                ? `oui — ${survived} entrée(s) intactes (le nom ne porte pas de version, tâche 3.5)`
                : `⚠️ ${survived} au lieu de ${seeded} — quelque chose a purgé un cache non versionné`
        );

        // ── T3 — naviguer, et VOIR le compte redescendre ────────────────────────────────
        // Le trim se déclenche sur une ÉCRITURE de tuile par le worker. On laisse la carte
        // charger son fond, puis on la déplace pour en demander d'autres.
        await page
            .waitForFunction(
                () => {
                    const m = globalThis.GeoLeaf?.Map?.getMap?.();
                    return !!m && typeof m.isStyleLoaded === "function" && m.isStyleLoaded();
                },
                null,
                { timeout: 25000 }
            )
            .catch(() => console.log("  (style non signalé chargé — on poursuit)"));

        for (const [lng, lat, zoom] of [
            [55.45, -21.05, 12],
            [55.52, -20.95, 13],
            [55.38, -21.15, 11],
        ]) {
            await page.evaluate(
                ([x, y, z]) =>
                    globalThis.GeoLeaf?.Map?.getMap?.()?.jumpTo({ center: [x, y], zoom: z }),
                [lng, lat, zoom]
            );
            await page.waitForTimeout(3500);
        }

        const after = await countTiles(page);
        const lowWater = Math.floor(max * ratio);
        const ok = after < seeded && after <= lowWater + 50;
        say(
            "T3 — après navigation, le compte de `geoleaf-data-tiles`",
            `${seeded} → ${after}   (marge basse attendue ≈ ${lowWater})\n       ` +
                (after < seeded
                    ? `✅ le trim S'EST EXÉCUTÉ — ${seeded - after} entrée(s) retirées`
                    : `❌ AUCUNE éviction : le trim ne s'est pas déclenché`)
        );

        // Ce que le worker a dit de lui-même — la console du worker n'est pas celle de la page.
        const swLogs = [];
        context.on("console", (m) => swLogs.push(m.text()));
        say(
            "Verdict",
            ok
                ? "le bornage est VU à l'œuvre sur le déployé"
                : "le bornage n'a PAS été observé — ne pas croire les suites unitaires seules"
        );
        return ok ? 0 : 1;
    } finally {
        await context.close();
        await browser.close();
    }
};

run()
    .then((code) => process.exit(code))
    .catch((err) => {
        console.error("✖ sonde en erreur :", err);
        process.exit(2);
    });
