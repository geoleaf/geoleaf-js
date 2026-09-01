#!/usr/bin/env node
/**
 * SERVICE WORKER OBSERVABILITY PROBE — can a test assert anything through an ACTIVE SW?
 *
 * WHY THIS EXISTS. Until 02/08/2026 no spec in this repository had ever asserted anything
 * through a *running* Service Worker: all 26 specs that touch it set `serviceWorkers:
 * "block"`, and the two that do not only assert that buttons exist. That made five of the
 * six proof criteria of the offline groundwork uninstrumentable,
 * so this probe was written as the blocking spike that opens the sprint.
 *
 * 🛑 THE FINDING IT EXISTS TO CARRY, because it costs a day to rediscover:
 * `ignoreHTTPSErrors: true` is a CONTEXT flag. It covers navigation and page `fetch` — a
 * `HEAD /sw-core.js` returns 200 — but NOT the fetch of the SERVICE WORKER SCRIPT. Chromium
 * refuses the registration with «An SSL certificate error occurred when fetching the script».
 * The BROWSER-level `--ignore-certificate-errors` is required on the dev vhosts, whose
 * certificate is locally issued.
 *
 * ⚠️ And the trap inside the trap: `window.isSecureContext` returns `true` EITHER WAY. A
 * guard predicting `register()` success from origin trustworthiness goes GREEN while the
 * registration silently fails. Never use `isSecureContext` as that predictor.
 *
 * WHAT IT ANSWERS — five questions, each printed with its measurement:
 *   Q1  does the SW CONTROL the page on the first `goto`?
 *   Q2  is the origin trustworthy under `--host-resolver-rules`?
 *   Q3  does `context.setOffline(true)` cut the fetch OF THE WORKER ITSELF?
 *   Q4  is the worker console reachable?
 *   Q5  does `worker.evaluate()` run code INSIDE the SW?
 *
 * Q5 is the one that shapes the harness: arbitrary code can run inside the worker, so
 * "read a tile THROUGH THE SW PATH" needs no production-side marker header to be asserted.
 *
 * IT VALIDATES, IT DOES NOT GUARD — same standing as `probe-boot-contract.mjs`, and for the
 * same reason: it needs a built deploy plus the dev nginx, so it is not wired into
 * `ci:local` and carries no npm script. It starts NO server: the dev nginx already serves
 * `deploy/` permanently over https on the `*.geoleaf.local.test` vhosts.
 *
 * ⚠️ Regenerate the deploy before trusting a run — in THREE steps, the first is not
 * optional: `npx turbo run build`, then `npm run build:deploy`, then
 * `node scripts/build-deploy-coverage.cjs`. `build-deploy.cjs` assembles from existing
 * `dist/`, it compiles nothing.
 *
 * Usage: E2E_TARGET=nginx node scripts/probe-sw-observability.mjs
 *        E2E_TARGET=nginx SPIKE_VARIANT=addpoi node scripts/probe-sw-observability.mjs
 * Exit:  0 = the four blocking unknowns are lifted · 1 = at least one is not · 2 = probe error
 */

import { chromium } from "@playwright/test";
import { SOFTWARE_GL_ARGS } from "../e2e/helpers/launch-options.js";
import { baseURL, hostResolverArgs } from "../e2e/helpers/base-url.js";

const VARIANT = process.env.SPIKE_VARIANT || "core";
const TARGET_URL = `${baseURL(VARIANT)}/`;

/**
 * Every worker interaction is bounded. `evaluate()` on a busy SW can never return, and a
 * probe that hangs answers none of its questions.
 * @param {Promise<unknown>} promise
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<unknown>} the value, or a `__TIMEOUT__` / `__ERR__` marker string.
 */
const withTimeout = (promise, ms, label) =>
    Promise.race([
        Promise.resolve(promise).catch((e) => `__ERR__ ${e.message}`),
        new Promise((r) => setTimeout(() => r(`__TIMEOUT__ (${label}, ${ms} ms)`), ms)),
    ]);

const answers = [];
const say = (verdict, question, detail) => {
    answers.push({ verdict, question, detail });
    const icon = verdict === "OUI" ? "✅" : verdict === "NON" ? "❌" : "⚠️ ";
    console.log(`${icon} ${question}\n     → ${detail}\n`);
};

const run = async () => {
    const browser = await chromium.launch({
        // `--ignore-certificate-errors` is load-bearing — see the header. It now lives in
        // `hostResolverArgs` (nginx target only), so the whole Playwright suite gets it too
        // and not just this probe. Seen red without it: Q1, Q3, Q4 and Q5 fail, Q2 stays green.
        args: [...SOFTWARE_GL_ARGS, ...hostResolverArgs],
    });
    // The whole point: NO `serviceWorkers: "block"`. The SW is the subject under test.
    const context = await browser.newContext({ ignoreHTTPSErrors: true });

    // Instrumentation is armed BEFORE any navigation, or the install-time events are missed.
    const workers = [];
    const swConsole = [];
    const ctxRequests = [];
    const ctxFailed = [];

    context.on("serviceworker", (w) => {
        workers.push(w);
        w.on("console", (m) => swConsole.push(`[${m.type()}] ${m.text()}`));
    });
    context.on("request", (r) => ctxRequests.push(r.url()));
    context.on("requestfailed", (r) =>
        ctxFailed.push({ url: r.url(), err: r.failure()?.errorText || "?" })
    );

    const page = await context.newPage();

    console.log(
        `\n▸ ${TARGET_URL}   (variante « ${VARIANT} », E2E_TARGET=${process.env.E2E_TARGET || "ports"})\n`
    );
    console.log("── Les cinq inconnues ──\n");

    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

    // ── Q2 — trustworthy origin ─────────────────────────────────────────────────────────
    const sec = await page.evaluate(() => ({
        isSecureContext: window.isSecureContext,
        hasSW: "serviceWorker" in navigator,
        origin: location.origin,
    }));
    say(
        sec.isSecureContext && sec.hasSW ? "OUI" : "NON",
        "Q2 — l'origine est-elle « trustworthy » pour register() ?",
        `isSecureContext=${sec.isSecureContext} · navigator.serviceWorker=${sec.hasSW} · ${sec.origin}` +
            ` ⚠️ vrai dans les DEUX cas — ne jamais en déduire que register() réussira`
    );

    // ── Q1 — control, and how fast ──────────────────────────────────────────────────────
    // `controller` and not `.ready`: a registered-but-not-controlling SW serves nothing.
    const t0 = Date.now();
    let controlled = true;
    try {
        await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {
            timeout: 20000,
        });
    } catch {
        controlled = false;
    }
    const tControl = Date.now() - t0;

    const reg = await page.evaluate(async () => {
        const r = await navigator.serviceWorker.getRegistration();
        if (!r) return { registered: false };
        const sw = r.active || r.waiting || r.installing;
        return {
            registered: true,
            state: sw?.state ?? null,
            scriptURL: sw?.scriptURL ?? null,
            controller: navigator.serviceWorker.controller?.scriptURL ?? null,
        };
    });

    say(
        controlled ? "OUI" : "NON",
        "Q1 — le SW CONTRÔLE-t-il la page au premier goto ?",
        controlled
            ? `oui en ${tControl} ms · state=${reg.state} · controller=${reg.controller}`
            : `NON après 20 s · registered=${reg.registered} state=${reg.state ?? "—"}` +
                  ` — si registered=false, relire l'en-tête de ce fichier : c'est le certificat`
    );

    // ── Q5 — code execution inside the worker ───────────────────────────────────────────
    const worker = workers[0] ?? null;
    let workerEval = null;
    let workerEvalErr = null;
    if (worker) {
        const res = await withTimeout(
            worker.evaluate(() => ({
                scope: self.registration?.scope ?? null,
                hasCaches: typeof caches !== "undefined",
                hasIDB: typeof indexedDB !== "undefined",
            })),
            10000,
            "Q5"
        );
        if (typeof res === "string") workerEvalErr = res;
        else workerEval = res;
    }
    say(
        workerEval ? "OUI" : "NON",
        "Q5 — worker.evaluate() exécute-t-il du code DANS le SW ?",
        workerEval
            ? `oui · scope=${workerEval.scope} · caches=${workerEval.hasCaches} · indexedDB=${workerEval.hasIDB}`
            : `non — ${workerEvalErr ?? `aucun worker capté (context.on('serviceworker') a rendu ${workers.length})`}`
    );

    // ── The measurement that matters: root cause n°2, seen from inside the SW ───────────
    //
    // TWO opens, on purpose, because one alone proves nothing:
    //  - VERSIONLESS is what the worker does since task 3.1. It must SUCCEED and expose the
    //    `layers` store — that is the repair, observed rather than argued.
    //  - PINNED AT 2 is the historical witness. It must STILL fail with `VersionError`, which
    //    is what made `openIndexedDB()` resolve null in every deployment before 3.1. Drop it
    //    and the success above loses its contrast: a green would look the same on a browser
    //    that simply had no database.
    //
    // ⚠️ This block used to run ONLY the pinned open, described as "exactly what the SW
    // does". After 3.1 that sentence was false and the probe kept printing a VersionError
    // that no longer had anything to do with production — an instrument drifting from the
    // code it claims to mirror. Corrected the day 3.1 landed.
    if (worker) {
        const rootCause = await withTimeout(
            worker.evaluate(async () => {
                const names = (await caches.keys()).slice(0, 8);
                let dbs;
                try {
                    dbs = (await indexedDB.databases()).map((d) => `${d.name}@v${d.version}`);
                } catch {
                    dbs = ["__databases()_indisponible__"];
                }
                const tryOpen = (version) =>
                    new Promise((resolve) => {
                        let settled = false;
                        const done = (v) => {
                            if (!settled) {
                                settled = true;
                                resolve(v);
                            }
                        };
                        const req =
                            version === undefined
                                ? indexedDB.open("geoleaf-db")
                                : indexedDB.open("geoleaf-db", version);
                        req.onsuccess = () => {
                            const db = req.result;
                            done({
                                ok: true,
                                version: db.version,
                                hasLayers: db.objectStoreNames.contains("layers"),
                            });
                            db.close();
                        };
                        req.onerror = () => done({ ok: false, err: String(req.error?.name) });
                        req.onblocked = () => done({ ok: false, err: "BLOCKED" });
                        setTimeout(() => done({ ok: false, err: "TIMEOUT" }), 4000);
                    });

                return {
                    caches: names,
                    dbs,
                    versionless: await tryOpen(undefined),
                    pinnedAt2: await tryOpen(2),
                };
            }),
            15000,
            "cause racine"
        );

        if (typeof rootCause === "string") {
            say(
                "INFO",
                "MESURE — la cause racine n° 2, vue DEPUIS le SW",
                `indisponible : ${rootCause}`
            );
        } else {
            const vl = rootCause.versionless;
            const repaired = vl.ok === true && vl.hasLayers === true;
            say(
                repaired ? "OUI" : "NON",
                "3.1 — l'ouverture VERSIONLESS aboutit-elle, vue depuis le SW ?",
                `sans version → ${JSON.stringify(vl)}\n` +
                    `       épinglée à 2 (témoin historique) → ${JSON.stringify(rootCause.pinnedAt2)}\n` +
                    `       bases=[${rootCause.dbs.join(", ") || "aucune"}]\n` +
                    `       caches=[${rootCause.caches.join(", ") || "aucun"}]`
            );
        }
    }

    // ── Q3 — does setOffline cut the WORKER's fetch? ────────────────────────────────────
    // Decisive experiment: call fetch() FROM INSIDE the worker, online then offline. Doing
    // it from the page would not discriminate — a page fetch travels through the SW anyway.
    const probeUrl = `${TARGET_URL}manifest.json?probe=${Date.now()}`;
    const fetchFromWorker = async () => {
        if (!worker) return "(pas de worker)";
        return withTimeout(
            worker.evaluate(
                (u) =>
                    fetch(u, { cache: "no-store" })
                        .then((r) => `HTTP ${r.status}`)
                        .catch((e) => `REJECTED: ${e.name}: ${e.message}`),
                probeUrl
            ),
            15000,
            "fetch worker"
        );
    };

    const onlineResult = await fetchFromWorker();
    await context.setOffline(true);
    const offlineResult = await fetchFromWorker();
    const pageOffline = await withTimeout(
        page.evaluate(
            (u) =>
                fetch(u, { cache: "no-store" })
                    .then((r) => `HTTP ${r.status}`)
                    .catch((e) => `REJECTED: ${e.name}`),
            `${probeUrl}&from=page`
        ),
        15000,
        "fetch page"
    );
    await context.setOffline(false);

    const workerCut =
        typeof onlineResult === "string" &&
        onlineResult.startsWith("HTTP") &&
        typeof offlineResult === "string" &&
        offlineResult.startsWith("REJECTED");

    say(
        workerCut ? "OUI" : "NON",
        "Q3 — context.setOffline(true) coupe-t-il le fetch DU WORKER ?",
        `worker en ligne: ${onlineResult} · worker hors ligne: ${offlineResult} · page hors ligne: ${pageOffline}`
    );

    // ── Q4 — worker console ─────────────────────────────────────────────────────────────
    say(
        swConsole.length > 0 ? "OUI" : "NON",
        "Q4 — la console du worker est-elle captée ?",
        swConsole.length > 0
            ? `${swConsole.length} ligne(s), ex. : ${swConsole.slice(0, 3).join(" | ")}`
            : `0 ligne captée (workers vus : ${workers.length})`
    );

    console.log("── Contexte ──");
    console.log(`  workers captés                    : ${workers.length}`);
    console.log(`  requêtes vues au niveau contexte  : ${ctxRequests.length}`);
    console.log(`  requêtes en échec (dont hors-ligne): ${ctxFailed.length}`);
    console.log(
        `  sw-core.js demandé                : ${ctxRequests.some((u) => /sw-core\.js/.test(u))}`
    );

    await browser.close();

    console.log("\n── Verdict ──");
    const blocking = answers.filter((a) => a.verdict === "NON" && /^Q[1-4]/.test(a.question));
    if (blocking.length === 0) {
        console.log("✅ Les quatre inconnues bloquantes sont levées — le harnais peut s'écrire.\n");
        return 0;
    }
    console.log(`❌ ${blocking.length} inconnue(s) NON levée(s) :`);
    blocking.forEach((b) => console.log(`   • ${b.question}`));
    console.log(
        '   → repli : page.route("**", r => r.abort()) posé AVANT goto, combiné à setOffline.\n'
    );
    return 1;
};

run().then(
    (code) => process.exit(code),
    (err) => {
        console.error("\n❌ Sonde en erreur :", err?.stack || err);
        process.exit(2);
    }
);
