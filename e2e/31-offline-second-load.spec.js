// @ts-check
/**
 * 31 — THE SECOND LOAD, OFFLINE
 *
 * The application declares itself a PWA — manifest, `installPrompt`, Service
 * Worker — and **could not boot offline**. `STATIC_ASSETS` carried three
 * hand-written entries where a first load requests some twenty: the shell was
 * pre-cached, the entry bundle too, and **nothing that bundle imports**. At the
 * second load offline, the entry came out of the cache and its four static
 * imports failed.
 *
 * 🛑 AND THE THIRD ENTRY WAS DEAD. It pre-cached
 * `dist/geoleaf-main.min.css?v=<timestamp>` while the document requests the
 * BARE path — the cache-busting patch only covers the ESM and the plugins.
 * `sw-core.js` calls `cache.match(request)` **without `ignoreSearch`**, so the
 * query is part of the key: the stylesheet was never served from that cache. Of
 * three entries, two served.
 *
 * ═══ WHAT THIS SPEC PROVES, AND THAT NO UNIT SUITE CAN ═══
 *
 * The unit tests run the worker against a **simulated** Cache API, and
 * `build-deploy.cjs`'s derivation against a fixture `outDir`. Neither says what
 * the deploy — copied, regex-patched, minified — does in a real engine. This is
 * the only place where the two halves meet.
 *
 * ⚠️ NO URL IS WRITTEN HERE. Chunk names are content-hashed and change at every
 * build: the spec reads them in the served document, exactly like the browser.
 * A spec that wrote them would measure one day's build, then fall silent.
 */

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { bootMap } from "./helpers/boot.js";

const ORIGIN = baseURL("full");

/**
 * Waits for the worker to CONTROL the page. `activated` does not suffice: an
 * active worker that has not yet claimed its clients intercepts nothing, and a
 * reload launched in that window would prove the network believing it proves
 * the cache.
 * @param {import('@playwright/test').Page} page
 */
async function waitForController(page) {
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, {
        timeout: 45000,
    });
}

/**
 * Returns the URLs the document declares for preload, as written in the markup.
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
 * Skip motive of the ONLY test requiring a RUNTIME cache, or `null` if it can
 * play. Measured once, asserted by the witness.
 * @type {string | null}
 */
let skipReason = null;

/** The `Cache-Control` the harness really serves. `null` = not yet measured. */
let cacheControlMesure = null;

/**
 * 🛑 THIS SKIP IS MEASURED, NOT DECREED — and it re-arms ITSELF.
 *
 * The worker HONOURS `Cache-Control: no-store` (a deliberate hardening, motive
 * written in `isCacheableResponse` → `refusesSharedCache`). Yet both servers of
 * this repo send it on ALL resources: `http-server -c-1`, which
 * `playwright.config.js` starts for the `ports` target, answers
 * `no-cache, no-store, must-revalidate`; the dev nginx sets
 * `add_header Cache-Control "no-store" always` on its four vhosts. No
 * same-origin resource thus enters the cache **at runtime** in this harness —
 * only the pre-cache survives, because `cache.addAll()` does not go through
 * `isCacheableResponse`.
 *
 * The second-load test needs the profile, which is DATA and is not pre-cached.
 * It thus proves a scenario its own configuration makes impossible.
 *
 * ✅ **The product itself works**: `SERVEUR.md` §8 — which SHIPS TO THE CLIENT —
 * prescribes `no-cache` or `max-age=3600` for `profiles/**` and warns by name:
 * "do not take up the project's development server's `no-store`: it is
 * deliberate, and local".
 *
 * ⚠️ **Do not "repair" the product to green this test.** The only gesture that
 * would green it without touching the harness would be pre-caching the profile,
 * i.e. widening an ALL-OR-NOTHING `addAll` to data — what the §"what this file
 * does not guard" warns against, and what the arbitration explicitly rules out.
 *
 * WHEN IT RE-ARMS: the day the harness stops sending `no-store`. No
 * intervention required — the condition is RE-MEASURED at every run, which is
 * the difference between this skip and a `.skip` one would have to remember to
 * remove.
 *
 * ✅ **PROVEN IN BOTH DIRECTIONS on 2026-08-13, and a conditional skip never
 * seen LIFTING is indistinguishable from a bare `.skip`.** Replacing `-c-1`
 * with `-c3600` on `deploy-full`'s server in `playwright.config.js`: the
 * witness flips to its "no skip" branch, this test PLAYS, and it **PASSES in
 * 3.9 s**. Configuration restored immediately.
 *
 * 🛑 That second direction says more than the skip's mechanics: it establishes
 * that **the product has no defect here**. The second load offline works as
 * soon as the server does not demand `no-store` — i.e. in the configuration
 * `SERVEUR.md` prescribes to the integrator. Without that measurement, "it
 * works in production" would have stayed an inference.
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
            `hors ligne. Défaut du HARNAIS, pas du produit — voir \`SERVEUR.md\` §8. ` +
            `Se réactive seul quand le harnais cessera d'envoyer \`no-store\`.`;
    }
});

// 🛑 WITHOUT THIS WITNESS, THE SKIP WOULD BE SILENT. A skipped test is
// indistinguishable, in a quickly-read report, from a green one — exactly what
// `e2e/30-sync-cycle.spec.js` recorded.
test("TÉMOIN — si le second chargement se saute, le motif est MESURÉ et NOMMÉ", async () => {
    expect(
        cacheControlMesure,
        "le `Cache-Control` du harnais doit avoir été mesuré — sinon le saut serait décrété"
    ).not.toBeNull();

    if (skipReason) {
        test.info().annotations.push({ type: "skip-reason", description: skipReason });
        expect(skipReason.length, "un saut doit porter un motif lisible").toBeGreaterThan(40);
        expect(skipReason, "le motif doit nommer sa source durable").toContain("SERVEUR.md");
        return;
    }
    // No skip ⇒ the inverse claim must hold, and be verified rather than assumed.
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

        // The document must declare the chunks the entry imports STATICALLY — and
        // them alone. `dist/chunks/` carries more: preloading a lazy chunk would
        // fetch in advance exactly what its `import()` exists to defer.
        expect(preloaded.length).toBeGreaterThan(0);
        for (const href of preloaded) {
            expect(href).toMatch(/^dist\/chunks\/.+\.js$/);
        }

        // `caches.match` sweeps all the origin's caches: the spec thus need not
        // know the cache's name, which carries the package version.
        const verdict = await page.evaluate(async (chunks) => {
            const probe = async (url) => ({ url, hit: !!(await caches.match(url)) });
            return {
                shell: await probe("index.html"),
                // ⚠️ THE BARE KEY, the one the document's <link rel="stylesheet">
                // carries. The entry that was dead: it was pre-cached with a `?v=`.
                css: await probe("dist/geoleaf-main.min.css"),
                config: await probe("profiles/geoleaf.config.json"),
                chunks: await Promise.all(chunks.map(probe)),
                // The ENGINE, in full. Since MapLibre 6 it is no longer a file but
                // a graph: the document names only the shim, which imports the
                // entry, which imports the shared chunk, which instantiates the
                // worker. Three of the four are named NOWHERE in the markup — so
                // no naive derivation sees them.
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
    // CLASS GUARD. It does not guard ONE entry, it guards the invariant.
    // ═══════════════════════════════════════════════════════════════════════════════════
    test("CLASSE — chaque entrée du pré-cache est SERVIE hors ligne, par le ROUTEUR", async ({
        page,
        context,
    }) => {
        // 🛑 WHAT THIS GUARD ADDS TO THE TEST ABOVE, AND WHY IT WAS NEEDED.
        //
        // The pre-cache test queries `caches.match()`, which SWEEPS ALL the
        // origin's caches. It thus answers "the file is somewhere", which is
        // true and insufficient: the worker reads from ONE named bucket, chosen
        // by its route. The class was born exactly in that gap —
        // `profiles/geoleaf.config.json` was pre-cached in `CACHE_STATIC` and
        // the route looked for it in an empty `…-profile-geoleaf.config.json`,
        // created by the strategy's own `caches.open()`. The test above was
        // GREEN while the application did not boot.
        //
        // Here no cache is looked at: the network is CUT and the resource
        // requested. What answers is the router, or nothing. The only question
        // that counts for an integrator.
        //
        // ⚠️ This guard can redden on SEVERAL entries at once. That is
        // information: each red is a pre-cached entry nobody knows how to
        // serve.
        await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
        await waitForController(page);
        await bootMap(page);
        await page.waitForTimeout(2000);

        // The list is NOT written here: it is injected into the worker at build,
        // and chunk names are content-hashed. It is read where the browser reads
        // it.
        const assets = await page.evaluate(async () => {
            const src = await (await fetch("sw-core.js")).text();
            const m = src.match(/STATIC_ASSETS\s*=\s*\[([\s\S]*?)\]/);
            if (!m) return null;
            return m[1]
                .split(",")
                .map((x) => x.trim().replace(/^["']|["']$/g, ""))
                .filter(Boolean);
        });

        // Non-emptiness floor: an empty list would render this guard green having proven nothing.
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
        // MEASURED skip, never decreed. Motive, precedent and re-arming
        // condition: see the `skipReason` banner at the file's head. This skip
        // covers ONLY this test: the pre-cache and the class guard play in every
        // case.
        test.skip(skipReason !== null, skipReason ?? "");

        // ── 1st pass: the worker INSTALLS while the application starts ────────────────────
        await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
        await waitForController(page);
        await bootMap(page);
        await page.waitForTimeout(2000);

        // ── 2nd pass ONLINE, AND IT IS NOT OPTIONAL ───────────────────────────────────────
        //
        // 🛑 THE VERY FIRST VISIT CANNOT POPULATE THE RUNTIME CACHE, and that is
        // no defect: the application requests its configuration BEFORE the
        // worker has claimed its clients. Those requests thus do not traverse
        // the worker and are written nowhere. `waitForController` attests
        // control eventually arrives, not that it was there when the config
        // left.
        //
        // Measured on 2026-08-13, over three loads: after the 1st,
        // `profile.json` is ABSENT from all caches; after the 2nd ONLINE, it is
        // present under `?t=0`; at the 3rd, offline, the map displays and NO
        // request fails.
        //
        // ⚠️ This pass was missing, and its absence produced a red first taken
        // for a product defect. A user's real scenario is indeed this one: they
        // open the application a first time (the worker installs), come back,
        // THEN go into the field. The offline promise starts at the second
        // load — not the first.
        await page.reload({ waitUntil: "domcontentloaded" });
        await bootMap(page);
        await page.waitForTimeout(2000);

        await context.setOffline(true);
        await page.reload({ waitUntil: "domcontentloaded" });

        // The only assertion that is worth it: a native `maplibregl.Map`, with a
        // live style. The document can well display — that is the shell — while
        // the bundle is missing. Requiring the map is requiring the import
        // closure to have resolved.
        await bootMap(page);
    });

    // ⚠️ WHAT THIS FILE DOES NOT GUARD, AND WHY — to read before adding a test
    // here.
    //
    // The test above loads the page ONLINE before cutting. That first pass
    // fills the caches along the way, so an asset ABSENT from `STATIC_ASSETS`
    // still answers: it thus proves the cache as it is AFTER a visit, not the
    // pre-cache itself.
    //
    // A third test was attempted at the MapLibre 6 move to fill that angle —
    // install the worker without ever requesting the engine, or reinstall it
    // after a purge, then cut. It was REMOVED: in both variants it came out
    // green on a pre-cache missing three modules of five, so it guarded nothing
    // while looking like it guarded. Two causes, both measured:
    // `isStaticAsset()` recognising `.mjs`, `cacheFirstStrategy` WRITES the
    // missing modules into `CACHE_STATIC` from the first online load; and a
    // reinstallation via `unregister()` + `register()` does not replay
    // `cache.addAll()` observably within the test's window.
    //
    // The targeted property — the pre-cache carries the WHOLE engine — is thus
    // asserted where it is deterministic: in the first test, which reads the
    // cache's real content. An integration test that cannot redden is worth
    // less than a direct assertion that can.
});
