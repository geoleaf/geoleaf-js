#!/usr/bin/env node
/**
 * TILE-CACHE TRIM PROBE — SEE the eviction execute, in a real browser.
 *
 * WHY IT EXISTS. The bounding of `CACHE_TILES` is decided, and its own
 * verification section sets the condition: "**See the trim execute**: force the
 * threshold low, navigate, and watch the key count come back down. ⚠️ *An eviction
 * never seen executing bounds nothing* — same requirement as for gates."
 *
 * The unit suites run the worker against a simulated Cache API. They prove the
 * logic; they do not prove that `cache.keys()` returns insertion order in a real
 * engine, nor that `cache.delete()` over thousands of keys completes, nor that the
 * DEPLOYED worker — copied, regex-patched, minified — still carries the code that
 * was written. That is what this probe looks at.
 *
 * WHAT IT MEASURES, in order:
 *   T0 — does the deployed worker carry the bounding? (else the next measurements
 *        have no subject, and a stale deploy goes green having proven nothing)
 *   T1 — seed `geoleaf-data-tiles` ABOVE the SHIPPED ceiling, not a test ceiling:
 *        what is proven is the configuration the integrator receives.
 *   T2 — the durable cache SURVIVES a worker re-registration (re-proof: its name
 *        carries no version, so `activate` cannot raze it).
 *   T3 — after a navigation that makes a tile write, the count COMES DOWN, and it
 *        comes down to the low-water mark (80 % of the ceiling), not to zero.
 *
 * 🛑 WHY A RE-REGISTRATION IN THE MIDDLE. The check is amortised: it runs at each
 * worker start's first tile `put`, then in batches of 50. An already-warm worker
 * has a counter in an unknown state, hence a non-deterministic measurement.
 * Unregistering then reloading gives a fresh worker — and since `CACHE_TILES` is
 * unversioned, the seeded entries survive the operation. The probe thus kills two
 * birds with one stone.
 *
 * IT VALIDATES, IT DOES NOT GUARD — same status as
 * `probe-tile-cache-arbitration.mjs`: it requires an up-to-date deploy and the dev
 * nginx, so it is neither in `ci:local` nor in `package.json`.
 *
 * ⚠️ Regenerate the deploy before believing a run — in THREE steps, the first not
 * optional: `npx turbo run build`, then `npm run build:deploy`, then
 * `node scripts/build-deploy-coverage.cjs`. `build-deploy.cjs` assembles from the
 * existing `dist/`, **it compiles nothing**: chaining it alone produces a stale
 * deploy WHILE EXITING 0.
 *
 * Usage : E2E_TARGET=nginx node scripts/probe-tile-cache-trim.mjs
 * Exit  : 0 = the trim was SEEN executing · 1 = it did not execute · 2 = probe error
 */

import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { SOFTWARE_GL_ARGS } from "../e2e/helpers/launch-options.js";
import { baseURL, hostResolverArgs } from "../e2e/helpers/base-url.js";

const VARIANT = process.env.PROBE_VARIANT || "full";
const TARGET_URL = `${baseURL(VARIANT)}/`;
const TILE_CACHE = "geoleaf-data-tiles";

const say = (label, detail) => console.log(`▸ ${label}\n     → ${detail}\n`);

/** The SHIPPED ceiling, read in the deployed worker — never copied into prose here. */
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

/** Counts `CACHE_TILES` keys from the page. */
const countTiles = (page) =>
    page.evaluate(async (name) => {
        if (!(await caches.keys()).includes(name)) return -1;
        return (await caches.open(name)).keys().then((k) => k.length);
    }, TILE_CACHE);

const run = async () => {
    // ── T0 — does the deploy carry the subject? ─────────────────────────────────────────
    const { hasTrim, max, ratio } = deployedCeiling();
    say(
        "T0 — le worker DÉPLOYÉ porte le bornage",
        hasTrim && max
            ? `oui — plafond ${max}, marge basse ${Math.floor(max * ratio)} (${ratio})`
            : "NON — déployé périmé ? Régénérer en trois temps avant de relancer"
    );
    if (!hasTrim || !max) return 2;

    const browser = await chromium.launch({ args: [...SOFTWARE_GL_ARGS, ...hostResolverArgs] });
    // No `serviceWorkers: "block"`: the worker IS the subject.
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

        // ── T1 — seed ABOVE the shipped ceiling ─────────────────────────────────────────
        const seedTarget = max + 100;
        const seeded = await page.evaluate(
            async ({ name, target }) => {
                const cache = await caches.open(name);
                const already = (await cache.keys()).length;
                // In batches: a few thousand sequential `put` are far slower.
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

        // ── T2 — FRESH worker, and the durable cache must cross over ────────────────────
        // Amortised counter: only a freshly started worker checks at its first `put`.
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

        // ── T3 — navigate, and SEE the count come down ──────────────────────────────────
        // The trim fires on a tile WRITE by the worker. Let the map load its
        // background, then move it to request more.
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

        // What the worker said of itself — the worker's console is not the page's.
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
