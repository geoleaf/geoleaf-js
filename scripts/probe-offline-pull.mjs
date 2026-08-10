/**
 * Sonde — le rapatriement borné écrit-il RÉELLEMENT dans le store `features` ? (tâche 4.1)
 *
 * Quatre mesures, dans un vrai Chromium, contre le bundle livré et le backend pygeoapi :
 *
 *   M1 — le store `features` est-il vide au départ ? (sans quoi M2 ne prouve rien)
 *   M2 — après `GeoLeaf.Storage.pullLayer()`, que porte-t-il, et sous quelle forme ?
 *   M3 — l'emprise BORNE-t-elle le rapatriement ? (contrôle discriminant, pas décoratif)
 *   M4 — le plafond `maxFeatures` tronque-t-il DUREMENT ?
 *
 * 🛑 POURQUOI CETTE SONDE EST VERSIONNÉE. La tâche 4.3 a prouvé sa lecture locale avec une
 * sonde ad hoc, jamais committée : sa mesure ne peut plus être rejouée, donc plus être
 * contredite. C'est le mode d'échec n° 5 du pré-vol — un chiffre qu'on ne peut pas
 * re-mesurer ne se périme pas, il se fossilise.
 *
 * ⚠️ Cible `full` par défaut, comme `e2e/30-sync-cycle.spec.js` : depuis la fusion du Sprint 5
 * c'est la SEULE variante portant l'édition et `offline-ui`, donc la seule où le
 * moteur offline et le connector cohabitent. `sites_rosario` n'est chargée par AUCUN thème —
 * sans importance ici, le rapatriement ne passe pas par le chargeur de couche.
 *
 * Prérequis : le backend doit tourner.
 *   docker compose -f docker-compose.dev.yml up -d geoleaf-postgrest geoleaf-featureserv
 *
 * Usage : E2E_TARGET=nginx node scripts/probe-offline-pull.mjs
 * Exit  : 0 = les quatre mesures sont prises · 2 = erreur de sonde
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
 * Lit le store `features` depuis la page.
 *
 * Garde `objectStoreNames.contains` avant toute transaction (une base v3 lèverait
 * `NotFoundError`), `onerror` sur chaque requête (sans quoi la promesse ne résout JAMAIS et
 * le symptôme est un timeout illisible), et `db.close()` avant de rendre la main.
 */
const readFeatures = () =>
    new Promise((resolve) => {
        const req = indexedDB.open("geoleaf-db");
        req.onerror = () => resolve({ err: String(req.error?.name) });
        req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("features")) {
                db.close();
                resolve({ err: "store `features` absent (base v3 ?)" });
                return;
            }
            const all = db.transaction(["features"], "readonly").objectStore("features").getAll();
            all.onerror = () => {
                db.close();
                resolve({ err: String(all.error?.name) });
            };
            all.onsuccess = () => {
                const rows = all.result ?? [];
                db.close();
                resolve({
                    total: rows.length,
                    byLayer: rows.reduce((acc, r) => {
                        acc[r.layerId] = (acc[r.layerId] ?? 0) + 1;
                        return acc;
                    }, {}),
                    withServerId: rows.filter((r) => r.serverId).length,
                    withVersion: rows.filter((r) => r.version?.kind === "timestamp").length,
                    states: [...new Set(rows.map((r) => r.syncState))],
                    sampleLocalIds: rows.slice(0, 3).map((r) => r.localId),
                });
            };
        };
    });

/** Vide le store entre deux mesures — sinon M3 compterait ce que M2 a laissé. */
const wipeFeatures = () =>
    new Promise((resolve) => {
        const req = indexedDB.open("geoleaf-db");
        req.onerror = () => resolve(false);
        req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("features")) {
                db.close();
                resolve(false);
                return;
            }
            const tx = db.transaction(["features"], "readwrite");
            tx.objectStore("features").clear();
            tx.oncomplete = () => {
                db.close();
                resolve(true);
            };
            tx.onerror = () => {
                db.close();
                resolve(false);
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
    // Le moteur de stockage est un chunk DIFFÉRÉ : sans cette attente, `pullLayer` mesurerait
    // l'attente bornée de la façade et non le rapatriement.
    await page.waitForFunction(() => !!globalThis.GeoLeaf?.Storage?.DB, null, { timeout: 25000 });

    // ── M1 — l'état de départ, sans quoi M2 ne prouve rien ──────────────────────────────
    const before = await withTimeout(page.evaluate(readFeatures), 20000, "M1");
    say("M1 — store `features` AVANT tout rapatriement", JSON.stringify(before));

    // ── M2 — le rapatriement complet ────────────────────────────────────────────────────
    const full = await withTimeout(
        page.evaluate((layer) => globalThis.GeoLeaf.Storage.pullLayer(layer), LAYER),
        90000,
        "M2-pull"
    );
    const after = await withTimeout(page.evaluate(readFeatures), 20000, "M2-read");
    say("M2 — rapport du rapatriement", JSON.stringify(full));
    say("M2 — store `features` APRÈS", JSON.stringify(after));

    // ── M3 — l'emprise borne-t-elle ? ───────────────────────────────────────────────────
    // bbox mesurée au pré-vol : 11 des 27 entités. Une emprise qui rendrait les 27 ne
    // prouverait rien — c'est le contrôle discriminant qui fait la mesure.
    await withTimeout(page.evaluate(wipeFeatures), 20000, "M3-wipe");
    const bounded = await withTimeout(
        page.evaluate(
            (layer) =>
                globalThis.GeoLeaf.Storage.pullLayer(layer, {
                    bbox: [-60.66, -32.95, -60.62, -32.93],
                }),
            LAYER
        ),
        90000,
        "M3-pull"
    );
    const boundedStore = await withTimeout(page.evaluate(readFeatures), 20000, "M3-read");
    say(
        "M3 — emprise bornante",
        `rapport ${JSON.stringify(bounded)} · store ${JSON.stringify(boundedStore)}`
    );

    // ── M4 — le plafond tronque-t-il durement ? ─────────────────────────────────────────
    // Le serveur pagine à 10 : `ogc-api-loader` coupe APRÈS une page entière et ne tronque
    // pas. Un plafond de 15 lui fait rendre 20 ; seul l'orchestrateur ramène à 15.
    await withTimeout(page.evaluate(wipeFeatures), 20000, "M4-wipe");
    const capped = await withTimeout(
        page.evaluate((layer) => {
            const layers = globalThis.GeoLeaf.Config.getActiveProfile().layers;
            const target = layers.find((l) => l.id === layer);
            target.offline.maxFeatures = 15;
            return globalThis.GeoLeaf.Storage.pullLayer(layer);
        }, LAYER),
        90000,
        "M4-pull"
    );
    const cappedStore = await withTimeout(page.evaluate(readFeatures), 20000, "M4-read");
    say(
        "M4 — plafond DUR (`maxFeatures: 15`, pages de 10)",
        `rapport ${JSON.stringify(capped)} · store ${JSON.stringify(cappedStore)}`
    );

    await browser.close();
};

run().catch((e) => {
    console.error("✗ sonde en erreur :", e);
    process.exit(2);
});
