/**
 * Sonde — le rapport voit-il ce que le magasin contient, et la purge épargne-t-elle le
 * travail ? (tâches 4.8 et 4.10)
 *
 * Six mesures, dans un vrai Chromium, contre le bundle livré et le backend pygeoapi :
 *
 *   M1 — une couche déclarée hors-ligne, jamais rapatriée → `declaredNeverPulled` ?
 *   M2 — après `pullLayer()` → `pulled`, avec `featureCount` et `lastPullAt` peuplés ?
 *   M3 — `getStats()` compte-t-il enfin `features` et `outbox` ? (B-121)
 *   M4 — après une saisie locale → `pendingCount` monte ?
 *   M5 — l'export rend-il cette saisie, avec sa géométrie ?
 *   M6 — la purge retire-t-elle le CACHE en laissant l'outbox INTACTE ?
 *
 * 🛑 M6 EST LA MESURE QUI COMPTE, et c'est la seule qui ne peut pas se prouver en unitaire :
 * B-115 décrivait un bouton qui détruisait des saisies jamais poussées. Le test unitaire
 * éprouve la règle ; ici on éprouve que le bouton câblé au bundle livré applique bien cette
 * règle-là. Entre les deux il y a une façade, un contrat de plugin et un chunk différé.
 *
 * ⚠️ Versionnée pour la même raison que `probe-offline-pull.mjs` : une mesure qu'on ne peut
 * pas rejouer ne peut pas être contredite, donc elle se fossilise (mode d'échec n° 5).
 *
 * Prérequis : le backend doit tourner.
 *   docker compose -f docker-compose.dev.yml up -d geoleaf-postgrest geoleaf-featureserv
 *
 * Usage : E2E_TARGET=nginx node scripts/probe-sync-report.mjs
 * Exit  : 0 = les six mesures sont prises · 2 = erreur de sonde
 */

import { chromium } from "@playwright/test";
import { SOFTWARE_GL_ARGS } from "../e2e/helpers/launch-options.js";
import { baseURL, hostResolverArgs } from "../e2e/helpers/base-url.js";

const VARIANT = process.env.PROBE_VARIANT || "full";
const TARGET_URL = `${baseURL(VARIANT)}/`;
const LAYER = "sites_rosario";

/** Une mesure qui pend ne mesure rien : tout appel au navigateur est borné. */
const withTimeout = (promise, ms, label) =>
    Promise.race([
        Promise.resolve(promise).catch((e) => `__ERR__ ${e.message}`),
        new Promise((r) => setTimeout(() => r(`__TIMEOUT__ (${label}, ${ms} ms)`), ms)),
    ]);

const say = (label, detail) => console.log(`▸ ${label}\n     → ${detail}\n`);

/**
 * Compte les deux magasins v4 directement, sans passer par la façade.
 *
 * ⚠️ Lecture INDÉPENDANTE, et c'est délibéré : si on interrogeait `getStats()` pour vérifier
 * `getStats()`, on ne prouverait que sa cohérence avec elle-même. Ici la base est lue par un
 * chemin que le code mesuré n'emprunte pas.
 */
const readStores = () =>
    new Promise((resolve) => {
        const req = indexedDB.open("geoleaf-db");
        req.onerror = () => resolve({ err: String(req.error?.name) });
        req.onsuccess = () => {
            const db = req.result;
            const has = (n) => db.objectStoreNames.contains(n);
            if (!has("features") || !has("outbox")) {
                db.close();
                resolve({ err: "magasins v4 absents (base v3 ?)" });
                return;
            }
            const tx = db.transaction(["features", "outbox"], "readonly");
            const f = tx.objectStore("features").getAll();
            const o = tx.objectStore("outbox").getAll();
            tx.onerror = () => {
                db.close();
                resolve({ err: String(tx.error?.name) });
            };
            tx.oncomplete = () => {
                const rows = f.result ?? [];
                const entries = o.result ?? [];
                db.close();
                resolve({
                    features: rows.length,
                    featuresSynced: rows.filter((r) => r.syncState === "synced").length,
                    featuresPending: rows.filter((r) => r.syncState !== "synced").length,
                    outbox: entries.length,
                    outboxStates: [...new Set(entries.map((e) => e.state))],
                });
            };
        };
    });

const run = async () => {
    const browser = await chromium.launch({ args: [...SOFTWARE_GL_ARGS, ...hostResolverArgs] });
    const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        serviceWorkers: "block",
    });
    const page = await context.newPage();

    console.log(
        `\n▸ ${TARGET_URL}   (variante « ${VARIANT} », E2E_TARGET=${process.env.E2E_TARGET || "ports"})\n`
    );

    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("#geoleaf-map", { timeout: 25000 });
    // Le moteur de stockage est un chunk DIFFÉRÉ : sans cette attente, le rapport mesurerait
    // l'attente bornée de la façade et non le moteur.
    await page.waitForFunction(() => !!globalThis.GeoLeaf?.Storage?.DB, null, { timeout: 25000 });
    // Repartir d'une base propre : sinon M1 compterait ce qu'une exécution antérieure a laissé,
    // et « jamais rapatriée » serait faux sans qu'on le voie.
    await page.evaluate(
        () =>
            new Promise((resolve) => {
                const r = indexedDB.open("geoleaf-db");
                r.onerror = () => resolve(false);
                r.onsuccess = () => {
                    const db = r.result;
                    const names = ["features", "outbox", "preferences"].filter((n) =>
                        db.objectStoreNames.contains(n)
                    );
                    const tx = db.transaction(names, "readwrite");
                    names.forEach((n) => tx.objectStore(n).clear());
                    tx.oncomplete = () => {
                        db.close();
                        resolve(true);
                    };
                    tx.onerror = () => {
                        db.close();
                        resolve(false);
                    };
                };
            })
    );

    const report = (label, ms = 30000) =>
        withTimeout(
            page.evaluate(() => globalThis.GeoLeaf.Storage.getSyncReport()),
            ms,
            label
        );
    const forLayer = (r) => (Array.isArray(r) ? r.find((x) => x.layerId === LAYER) : r);

    // ── M1 — le cas qui n'a AUCUN observable jusqu'à la coupure ─────────────────────────
    say("M1 — rapport AVANT tout rapatriement", JSON.stringify(forLayer(await report("M1"))));

    // ── M2 — après un rapatriement réel ────────────────────────────────────────────────
    const pull = await withTimeout(
        page.evaluate((layer) => globalThis.GeoLeaf.Storage.pullLayer(layer), LAYER),
        90000,
        "M2-pull"
    );
    say("M2 — rapport du rapatriement", JSON.stringify(pull));
    say("M2 — rapport APRÈS", JSON.stringify(forLayer(await report("M2"))));

    // ── M3 — B-121 : la façade voit-elle enfin les magasins v4 ? ────────────────────────
    const stats = await withTimeout(
        page.evaluate(() => globalThis.GeoLeaf.Storage.getStats()),
        20000,
        "M3"
    );
    say(
        "M3 — getStats() (B-121)",
        JSON.stringify({ features: stats?.features, outbox: stats?.outbox, layers: stats?.layers })
    );
    say(
        "M3 — magasins lus DIRECTEMENT (contrôle)",
        JSON.stringify(await page.evaluate(readStores))
    );

    // ── M4 — une saisie locale, c'est-à-dire du travail qui n'a aucune autre copie ──────
    const edit = await withTimeout(
        page.evaluate(
            (layer) =>
                globalThis.GeoLeaf.Storage.applyEdit({
                    layerId: layer,
                    kind: "update",
                    localId: "srv:1",
                    feature: {
                        type: "Feature",
                        geometry: { type: "Point", coordinates: [-60.64, -32.94] },
                        properties: { title: "saisie de terrain (sonde)" },
                    },
                }),
            LAYER
        ),
        20000,
        "M4-edit"
    );
    say("M4 — applyEdit", JSON.stringify(edit));
    say("M4 — rapport APRÈS la saisie", JSON.stringify(forLayer(await report("M4"))));

    // ── M5 — l'export : le panneau rendait 0, il doit rendre la saisie ──────────────────
    const pending = await withTimeout(
        page.evaluate(() => globalThis.GeoLeaf.Storage.DB.listPendingEdits()),
        20000,
        "M5"
    );
    say(
        "M5 — listPendingEdits()",
        JSON.stringify(
            Array.isArray(pending)
                ? pending.map((p) => ({
                      kind: p.kind,
                      localId: p.localId,
                      state: p.state,
                      hasGeometry: !!p.feature?.geometry,
                  }))
                : pending
        )
    );

    // ── M6 — LA MESURE QUI COMPTE : la purge épargne-t-elle le travail ? ────────────────
    const beforePurge = await page.evaluate(readStores);
    const purge = await withTimeout(
        page.evaluate(() => globalThis.GeoLeaf.Storage.DB.purgeCachedFeatures()),
        20000,
        "M6"
    );
    const afterPurge = await page.evaluate(readStores);
    say("M6 — magasins AVANT purge", JSON.stringify(beforePurge));
    say("M6 — purgeCachedFeatures()", JSON.stringify(purge));
    say("M6 — magasins APRÈS purge", JSON.stringify(afterPurge));

    const outboxIntact = beforePurge?.outbox === afterPurge?.outbox && afterPurge?.outbox > 0;
    const cacheParti = afterPurge?.featuresSynced === 0 && beforePurge?.featuresSynced > 0;
    say(
        "M6 — VERDICT",
        `outbox intacte : ${outboxIntact ? "OUI" : "NON"} · cache purgé : ${cacheParti ? "OUI" : "NON"} · ` +
            `saisie conservée : ${afterPurge?.featuresPending > 0 ? "OUI" : "NON"}`
    );

    await browser.close();
};

run().catch((e) => {
    console.error("✗ sonde en échec :", e.message);
    process.exit(2);
});
