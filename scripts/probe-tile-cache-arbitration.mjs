#!/usr/bin/env node
/**
 * TILE-CACHE ARBITRATION PROBE — deux chemins de tuiles, lequel sert réellement ?
 *
 * POURQUOI. La décision **A7** de `roadmap_collecte-terrain-offline.md` dit « IndexedDB seul
 * pour les tuiles, et le SW le lit », et la tâche **3.13** doit l'exécuter — mais dans un
 * ordre non négociable : *réparer → VOIR servir → puis supprimer*. Le pré-vol du sprint
 * l'écrit noir sur blanc : ⑦ « 3.13 ne se pré-vole PAS au grep de symbole ». Un décompte non
 * nul ne prouve pas la vie (les symboles s'appellent entre eux à l'intérieur de la région
 * morte), un décompte nul ne prouve pas la mort. **L'arbitrage se prend sur ce qu'un
 * navigateur montre.**
 *
 * 🛑 CE QUE 3.2 A PROUVÉ, ET CE QU'ELLE N'A PAS PROUVÉ. `e2e/27-offline-idb.spec.js` établit
 * qu'une tuile **semée à la main** dans le store `layers` est resservie hors ligne par le
 * chemin IndexedDB du worker. Elle ne dit rien du chemin d'**écriture** : personne n'a encore
 * vu le téléchargement de profil déposer une tuile en base. Supprimer la branche Cache API
 * sans cette mesure, ce serait retirer le seul chemin dont on sait qu'il fonctionne au profit
 * d'un chemin dont on n'a vu que la moitié.
 *
 * LES QUATRE MESURES, chacune imprimée avec son relevé :
 *   M1 — après affichage de la carte, que contient le cache `geoleaf-data-tiles` ?
 *        Le spike du 02/08 le trouvait ABSENT. S'il est encore vide, la branche Cache API de
 *        `tileCacheStrategy` ne cache rien pour les fournisseurs réellement employés — tous
 *        cross-origin, donc opaques, donc refusés par `isCacheableResponse` (tâche 3.11).
 *   M2 — le store `layers` porte-t-il des enregistrements `resourceType: "tile"` après un
 *        téléchargement de profil ? C'est le chemin d'ÉCRITURE, jamais observé.
 *   M3 — le drapeau `enableTileCache` atteint-il le moteur ? Mesuré par ce que
 *        `ResourceEnumerator` énumère, pas par ce que la config déclare.
 *   M4 — combien de requêtes de tuiles la page émet-elle, et vers quelles origines ? C'est
 *        ce qui dit si le sujet de l'arbitrage est un fond raster, vectoriel, ou les deux.
 *
 * ELLE VALIDE, ELLE NE GARDE PAS — même statut que `probe-sw-observability.mjs` et
 * `probe-boot-contract.mjs` : elle exige un déployé à jour et le nginx de dev, donc elle n'est
 * ni dans `ci:local` ni dans `package.json`.
 *
 * ⚠️ Régénérer le déployé avant de croire un run — en TROIS temps, le premier n'est pas
 * optionnel : `npx turbo run build`, puis `npm run build:deploy`, puis
 * `node scripts/build-deploy-coverage.cjs`. `build-deploy.cjs` assemble depuis les `dist/`
 * existants, **il ne compile rien** : l'enchaîner seul produit un déployé périmé EN SORTANT 0.
 *
 * ⚠️ Cible `full` par défaut, et ce n'est pas un détail : c'est la seule variante qui embarque
 * `offline-ui`, donc la seule où le téléchargement de profil est atteignable par l'interface.
 *
 * Usage : E2E_TARGET=nginx node scripts/probe-tile-cache-arbitration.mjs
 * Exit  : 0 = les quatre mesures sont prises · 2 = erreur de sonde
 */

import { chromium } from "@playwright/test";
import { SOFTWARE_GL_ARGS } from "../e2e/helpers/launch-options.js";
import { baseURL, hostResolverArgs } from "../e2e/helpers/base-url.js";

const VARIANT = process.env.PROBE_VARIANT || "full";
const TARGET_URL = `${baseURL(VARIANT)}/`;

/** Une mesure qui pend ne mesure rien : tout appel au navigateur est borné. */
const withTimeout = (promise, ms, label) =>
    Promise.race([
        Promise.resolve(promise).catch((e) => `__ERR__ ${e.message}`),
        new Promise((r) => setTimeout(() => r(`__TIMEOUT__ (${label}, ${ms} ms)`), ms)),
    ]);

const say = (label, detail) => console.log(`▸ ${label}\n     → ${detail}\n`);

const run = async () => {
    const browser = await chromium.launch({
        args: [...SOFTWARE_GL_ARGS, ...hostResolverArgs],
    });
    // Aucun `serviceWorkers: "block"` : le worker est le sujet.
    const context = await browser.newContext({ ignoreHTTPSErrors: true });

    /** @type {{url: string, from: 'page'|'sw', phase: 'sent'|'failed'}[]} */
    const traffic = [];
    context.on("request", (r) =>
        traffic.push({ url: r.url(), from: r.serviceWorker() ? "sw" : "page", phase: "sent" })
    );
    context.on("requestfailed", (r) =>
        traffic.push({ url: r.url(), from: r.serviceWorker() ? "sw" : "page", phase: "failed" })
    );

    const page = await context.newPage();
    console.log(
        `\n▸ ${TARGET_URL}   (variante « ${VARIANT} », E2E_TARGET=${process.env.E2E_TARGET || "ports"})\n`
    );

    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {
        timeout: 25000,
    });

    // La carte doit avoir demandé des tuiles : sans ça, M1 mesurerait un cache qu'on n'a pas
    // encore eu l'occasion de remplir, et son vide ne dirait rien.
    await page
        .waitForFunction(
            () => {
                const m = /** @type {any} */ (globalThis).GeoLeaf?.Map?.getMap?.();
                return !!m && typeof m.isStyleLoaded === "function" && m.isStyleLoaded();
            },
            null,
            { timeout: 25000 }
        )
        .catch(() => console.log("  (style non signalé chargé — on poursuit, M4 le dira)"));
    await page.waitForTimeout(4000);

    // ── M4 d'abord : de quoi parle-t-on ? ───────────────────────────────────────────────
    const tileLike = traffic.filter((t) => /\.(png|jpe?g|webp|pbf|mvt)(\?|$)/i.test(t.url));
    const byOrigin = new Map();
    for (const t of tileLike) {
        const o = new URL(t.url).origin;
        byOrigin.set(o, (byOrigin.get(o) ?? 0) + 1);
    }
    say(
        "M4 — trafic de tuiles observé (origine → nombre, `sw:` = émis par le worker)",
        byOrigin.size === 0
            ? "AUCUNE requête de tuile — la carte n'en a pas demandé, les autres mesures sont à lire avec ça en tête"
            : [...byOrigin.entries()]
                  .map(([o, n]) => {
                      const viaSw = tileLike.filter(
                          (t) => new URL(t.url).origin === o && t.from === "sw"
                      ).length;
                      return `${o} → ${n}${viaSw ? ` (dont ${viaSw} sw:)` : ""}`;
                  })
                  .join("\n       ")
    );

    // ── M1 — la branche Cache API cache-t-elle quoi que ce soit ? ───────────────────────
    const caches0 = await withTimeout(
        page.evaluate(async () => {
            const names = await caches.keys();
            const out = [];
            for (const n of names) {
                const c = await caches.open(n);
                out.push({ name: n, keys: (await c.keys()).length });
            }
            return out;
        }),
        15000,
        "M1"
    );
    const tilesBucket = Array.isArray(caches0)
        ? caches0.find((c) => c.name === "geoleaf-data-tiles")
        : null;
    say(
        "M1 — contenu de `geoleaf-data-tiles` (la branche Cache API de tileCacheStrategy)",
        !Array.isArray(caches0)
            ? String(caches0)
            : `${tilesBucket ? `${tilesBucket.keys} entrée(s)` : "cache ABSENT"}` +
                  `\n       tous les caches : ${caches0.map((c) => `${c.name}=${c.keys}`).join(" · ") || "aucun"}`
    );

    // ── M2 — le chemin d'écriture dépose-t-il des tuiles en IndexedDB ? ─────────────────
    // On appelle le moteur, pas l'interface : c'est le chemin que garderait A7.
    const before = await withTimeout(
        page.evaluate(async () => {
            const rows = await /** @type {any} */ (
                globalThis
            ).GeoLeaf?.Storage?.DB?.getAllLayers?.();
            return Array.isArray(rows) ? rows.length : null;
        }),
        15000,
        "M2-avant"
    );

    const download = await withTimeout(
        page.evaluate(async () => {
            const gl = /** @type {any} */ (globalThis).GeoLeaf;
            const cm = gl?.Storage?.CacheManager;
            if (!cm?.cacheProfile) return { ok: false, why: "CacheManager.cacheProfile absent" };
            const profileId = gl?.Config?.getActiveProfile?.()?.id ?? "tourism";
            try {
                const res = await cm.cacheProfile(profileId, {});
                return { ok: true, profileId, res: JSON.stringify(res)?.slice(0, 300) };
            } catch (e) {
                return { ok: false, why: String(e?.message ?? e) };
            }
        }),
        120000,
        "M2-download"
    );

    const stored = await withTimeout(
        page.evaluate(async () => {
            return new Promise((resolve) => {
                const req = indexedDB.open("geoleaf-db");
                req.onerror = () => resolve({ err: String(req.error?.name) });
                req.onsuccess = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains("layers")) {
                        db.close();
                        resolve({ err: "no layers store" });
                        return;
                    }
                    const all = db
                        .transaction(["layers"], "readonly")
                        .objectStore("layers")
                        .getAll();
                    all.onsuccess = () => {
                        /** @type {Record<string, number>} */
                        const byType = {};
                        for (const r of all.result ?? []) {
                            const t = String(r.resourceType ?? "—");
                            byType[t] = (byType[t] ?? 0) + 1;
                        }
                        db.close();
                        resolve({ total: (all.result ?? []).length, byType });
                    };
                    all.onerror = () => {
                        db.close();
                        resolve({ err: String(all.error?.name) });
                    };
                };
            });
        }),
        20000,
        "M2-après"
    );
    say(
        "M2 — le TÉLÉCHARGEMENT écrit-il des tuiles dans le store `layers` ?",
        `cacheProfile: ${JSON.stringify(download)}` +
            `\n       layers avant : ${before ?? "?"}` +
            `\n       layers après : ${JSON.stringify(stored)}`
    );

    // ── M3 — le drapeau atteint-il le moteur ? ──────────────────────────────────────────
    const flag = await withTimeout(
        page.evaluate(async () => {
            const gl = /** @type {any} */ (globalThis).GeoLeaf;
            const declared = gl?.Config?.get?.("modules.offline.cache.enableTileCache");
            const sel = await gl?.Storage?.Cache?.Storage?.loadLayerSelection?.(
                gl?.Config?.getActiveProfile?.()?.id ?? "tourism"
            ).catch(() => null);
            return {
                declaredByProfile: declared,
                persistedSelection: sel ? { includeTiles: sel.includeTiles } : null,
            };
        }),
        15000,
        "M3"
    );
    say(
        "M3 — `enableTileCache` : ce que le profil déclare vs ce que le moteur LIT",
        `${JSON.stringify(flag)}` +
            "\n       ⚠️ le moteur ne lit JAMAIS le drapeau : il lit `selection.includeTiles`," +
            "\n          écrit par l'interface (`selection-cache.ts`). Sans sélection persistée," +
            "\n          `ResourceEnumerator` n'énumère AUCUNE tuile — quel que soit le drapeau."
    );

    // ── M5 — la branche Cache API est-elle EFFECTIVE hors ligne ? ───────────────────────
    // C'est la mesure qui décide : un cache peuplé ne prouve pas qu'il SERT. Si une tuile
    // qu'il contient revient hors réseau, alors le retirer perd du comportement qui marche.
    const cachedTileUrl = await withTimeout(
        page.evaluate(async () => {
            const c = await caches.open("geoleaf-data-tiles");
            const keys = await c.keys();
            return keys[0]?.url ?? null;
        }),
        15000,
        "M5-url"
    );

    let offlineVerdict = "aucune tuile en cache — rien à éprouver";
    if (typeof cachedTileUrl === "string" && cachedTileUrl) {
        await context.setOffline(true);
        await page.waitForFunction(() => navigator.onLine === false, null, { timeout: 5000 });
        const served = await withTimeout(
            page.evaluate(async (url) => {
                const res = await fetch(url, { cache: "no-store" });
                const buf = await res.arrayBuffer();
                return {
                    status: res.status,
                    type: res.headers.get("content-type"),
                    bytes: buf.byteLength,
                    placeholder: res.headers.get("X-GeoLeaf-Placeholder"),
                };
            }, cachedTileUrl),
            20000,
            "M5-fetch"
        );
        await context.setOffline(false);
        offlineVerdict =
            `${cachedTileUrl}\n       → ${JSON.stringify(served)}` +
            `\n       (status 504 + X-GeoLeaf-Placeholder=tile ⟹ la branche n'a PAS servi)`;
    }
    say("M5 — une tuile du cache API revient-elle HORS LIGNE ?", offlineVerdict);

    await context.close();
    await browser.close();
    console.log("── sonde terminée : les cinq mesures sont prises, l'arbitrage se prend dessus.\n");
};

run().catch((e) => {
    console.error("PROBE ERROR:", e);
    process.exitCode = 2;
});
