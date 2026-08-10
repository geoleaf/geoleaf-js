// @ts-check
/**
 * 28 — LA FILE HORS-LIGNE REJOUE CE QU'ELLE DOIT (critère de preuve n° 4)
 *
 * Deux propriétés, et toutes deux se vérifient sur le BUNDLE LIVRÉ, pas sur la source :
 *
 *   1. **Une entrée `failed` redevient traitable.** Jusqu'au 03/08/2026, la lecture de file
 *      n'interrogeait que l'index `pending` : une saisie qui échouait une fois ne revenait
 *      JAMAIS. Sur un appareil de terrain c'est le mode de perte le plus probable de toute
 *      la chaîne — une capture n'a ni copie serveur ni export, donc une entrée que la file
 *      cesse d'offrir est du travail perdu, en silence. Le contrat le grave : `failed`
 *      **n'est pas terminal**.
 *   2. **L'ordre de rejeu suit l'ordre de saisie** (B-03), y compris à la milliseconde près,
 *      et il le suit APRÈS un boot réel — à travers la façade, le registre de modules et le
 *      vrai IndexedDB du navigateur.
 *
 * ## ⚠️ PORTÉ SUR L'OUTBOX (tâche 4.11 / B-127) — ET DEUX CHOSES ONT CHANGÉ DE NATURE
 *
 * Ce fichier semait un vidage de base **v3** et pilotait `sync_queue` par
 * `getPendingSyncQueue` / `updateSyncQueueStatus`. Le magasin est retiré (B-124), et avec
 * lui ces deux méthodes. Le port n'est donc pas un remplacement de noms :
 *
 * - **La graine passe par le MOTEUR, plus par un vidage.** `Storage.applyEdit` est l'unique
 *   écrivain depuis 4.4b, et il **valide la couche** — la file v3 acceptait n'importe quel
 *   identifiant, ce qui laissait ce fichier semer un `poi_tourisme` que le profil ne porte
 *   pas. Semer par le moteur, c'est semer ce que le produit peut réellement écrire.
 * - **L'ordre ne se lit plus au même endroit.** `listPendingEdits()` groupe **par état** ;
 *   c'est le DRAIN qui tient l'ordre global, parce qu'il lit `outbox.list()` (B-126). La
 *   propriété B-03 s'assert donc sur le magasin, dont la clé `seq` EST l'ordre d'insertion.
 *
 * 🛑 CE QUI NE PROUVERAIT RIEN :
 *   - un vert sur la seule entrée `failed` : sans contre-épreuve, un requeue qui rendrait
 *     TOUT le magasin passerait aussi. Une entrée `synced` est donc éprouvée comme ne
 *     revenant PAS.
 *
 * ⚠️ Le Service Worker n'est ni bloqué ni sollicité. Le sujet est le moteur DE LA PAGE —
 * c'est là que tourne le rejeu (point 5 du contrat de synchronisation : l'authentification
 * du connector patche le `fetch` de la page et n'atteint jamais le worker). On laisse donc
 * l'environnement réel en place plutôt que de le simplifier.
 */

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { wipeOnOrigin } from "./helpers/db-seed.js";
import { GEOLEAF_DB, readStore } from "./helpers/idb.js";

const ORIGIN = baseURL("core");

/**
 * La couche que la graine emprunte.
 *
 * ⚠️ `applyEdit` refuse `layerUnknown` : le profil `tourism` ne porte que quatre couches
 * éditables, et celle-ci est la seule à déclarer un bloc `write` — **dans la SOURCE**.
 * ⚠️ Cette phrase s'arrêtait là, et l'artefact la dément depuis le 09/08/2026 : la variante
 * servie est un LIVRABLE, et `dev-backend.cjs` (DNS-05) y retire `write.endpoint` en passant
 * `write.enabled` à `false`. Voir {@link ensureWriteTarget}, qui est la réponse.
 */
const LAYER = "sites_rosario";

/**
 * Repose une cible d'écriture sur la couche, DANS LA PAGE, avant tout drain (B-201).
 *
 * 🛑 **CE HELPER EXISTE PARCE QUE LE TEST NE DOIT PAS DÉPENDRE DE CE QUE LE LIVRABLE
 * DÉCLARE.** Depuis DNS-05, les variantes livrables n'emportent plus les liaisons vers le
 * backend de preuve : `sites_rosario` y porte `write.enabled: false` et aucun `endpoint`.
 * Le drain écartait donc les trois entrées en `layerNoLongerWritable` **avant tout envoi**,
 * et le test du plafond sortait rouge en n'ayant jamais atteint son sujet — il n'éprouvait
 * plus le budget de rejeu, seulement l'absence de cible. Le durcissement est correct ; c'est
 * le test qui empruntait une propriété que le livrable n'a plus le droit d'avoir.
 *
 * ⚠️ **L'origine est délibérément INJOIGNABLE** (`.invalid`, réservé par la RFC 2606). Ce
 * fichier éprouve le budget HORS RÉSEAU : ce qu'il lui faut est une cible **déclarée**, pas
 * une cible qui répond. Y mettre le backend de preuve rendrait le test dépendant des
 * conteneurs, ce que `30-sync-cycle.spec.js` doit assumer et que celui-ci n'a aucune raison de
 * partager.
 *
 * La mutation porte sur le profil ACTIF, dont `getActiveProfile()` rend la référence vivante
 * (`profile.ts` → `this._activeProfile`) ; c'est la même source que celle lue par
 * `resolveWriteTarget` via `profileLayers()`.
 *
 * @param {import('@playwright/test').Page} page
 */
async function ensureWriteTarget(page) {
    const posed = await page.evaluate((layer) => {
        const gl = /** @type {any} */ (globalThis).GeoLeaf;
        const profile = gl?.Config?.getActiveProfile?.();
        const cfg = profile?.layers?.find((/** @type {any} */ l) => l.id === layer);
        if (!cfg) return false;
        cfg.write = {
            enabled: true,
            endpoint: `https://e2e-offline.invalid/${layer}`,
            dialect: "collection",
            geometryProperty: "geom",
            properties: ["nom"],
        };
        return true;
    }, LAYER);
    // Une garde qui ne peut pas rendre faux ne garde rien : si le profil change de forme, ce
    // test doit le DIRE, pas retomber silencieusement dans le `layerNoLongerWritable` qu'il
    // vient de quitter.
    expect(posed, `la couche "${LAYER}" doit exister dans le profil actif`).toBe(true);
}

/** Les trois saisies de la graine, dans l'ordre de capture. */
const CAPTURE_ORDER = ["cap-1", "cap-2", "cap-3"];

/**
 * Boote l'application et attend que le moteur hors-ligne soit CÂBLÉ.
 *
 * ⚠️ On attend `Storage.DB.<méthode>` et non `Storage.applyEdit` : la façade monte `applyEdit`
 * dès le boot, donc l'attendre rendrait `true` avec `Storage.DB` encore `null`. Mesuré à la
 * tâche 4.11 — le témoin doit prouver le CÂBLAGE, pas l'existence de la façade.
 *
 * @param {import('@playwright/test').Page} page
 */
async function boot(page) {
    await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
        () =>
            typeof (/** @type {any} */ (globalThis).GeoLeaf?.Storage?.DB?.listPendingEdits) ===
            "function",
        null,
        { timeout: 25000 }
    );
}

/**
 * Sème trois saisies PAR LE MOTEUR, puis force l'état de l'une d'elles.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} failedLocalId identifiant local dont l'entrée passe `failed`
 * @returns {Promise<string[]>} les identifiants d'entrée, dans l'ordre de capture
 */
function seedThroughEngine(page, failedLocalId) {
    return page.evaluate(
        async ({ layer, order, failed }) => {
            const gl = /** @type {any} */ (globalThis).GeoLeaf;
            /** @type {string[]} */
            const ids = [];
            for (const localId of order) {
                const res = await gl.Storage.applyEdit({
                    layerId: layer,
                    kind: "create",
                    localId,
                    feature: {
                        type: "Feature",
                        geometry: { type: "Point", coordinates: [-60.64, -32.94] },
                        properties: { nom: localId },
                    },
                });
                if (!res.entryId) throw new Error(`applyEdit refusé : ${res.refused}`);
                ids.push(res.entryId);
            }
            // L'état se force par le MODULE, pas par une écriture brute : c'est le chemin que
            // le drain emprunte lui-même pour marquer un échec.
            const outbox = gl.Storage.DB._ensureModule("Outbox");
            const rows = await outbox.list();
            const target = rows.find((/** @type {any} */ r) => r.localId === failed);
            await outbox.updateState(target.id, "failed");
            return ids;
        },
        { layer: LAYER, order: CAPTURE_ORDER, failed: failedLocalId }
    );
}

/**
 * Ce que le MOTEUR déclare encore dû au serveur — la surface que les plugins appellent.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{entryId: string, localId: string, state: string}[]>}
 */
function due(page) {
    return page.evaluate(async () => {
        const db = /** @type {any} */ (globalThis).GeoLeaf?.Storage?.DB;
        if (!db) throw new Error("GeoLeaf.Storage.DB absent — l'app n'a pas booté son moteur");
        const rows = await db.listPendingEdits();
        return rows.map((/** @type {any} */ r) => ({
            entryId: r.entryId,
            localId: r.localId,
            state: r.state,
        }));
    });
}

test.describe("28 — la file hors-ligne rejoue ce qu'elle doit", () => {
    test.beforeEach(async ({ page }) => {
        await wipeOnOrigin(page, ORIGIN);
        await boot(page);
    });

    test("CRITÈRE 4 — une entrée `failed` reste DUE, et garde son rang de saisie", async ({
        page,
    }) => {
        await seedThroughEngine(page, "cap-2");

        // ── ① Le critère : elle est encore due. `failed` n'est pas terminal.
        const rows = await due(page);
        const failed = rows.find((e) => e.localId === "cap-2");
        expect(failed, "une entrée `failed` doit rester traitable").toBeTruthy();
        expect(failed?.state).toBe("failed");

        // ── ② Son RANG. `listPendingEdits()` groupe par état, donc l'ordre global ne s'y lit
        // pas — c'est le magasin qui le porte, par sa clé `seq`, et c'est lui que le drain lit
        // depuis B-126. Une entrée `failed` ne « remonte » ni ne « descend » : elle reste où
        // la saisie l'a mise.
        const outbox = await readStore(page, { db: GEOLEAF_DB, store: "outbox" });
        expect(outbox.map((/** @type {any} */ e) => e.localId)).toEqual(CAPTURE_ORDER);
    });

    test("CONTRÔLE NÉGATIF — une entrée `synced` ne revient PAS", async ({ page }) => {
        // Sans ce test, un requeue qui rendrait tout le magasin passerait le précédent. Une
        // garde qui ne peut pas rendre faux ne garde rien.
        await seedThroughEngine(page, "cap-2");

        await page.evaluate(async () => {
            const gl = /** @type {any} */ (globalThis).GeoLeaf;
            const outbox = gl.Storage.DB._ensureModule("Outbox");
            const rows = await outbox.list();
            const first = rows.find((/** @type {any} */ r) => r.localId === "cap-1");
            await outbox.updateState(first.id, "synced");
        });

        const ids = (await due(page)).map((e) => e.localId).sort();
        expect(ids).not.toContain("cap-1");
        expect(ids).toEqual(["cap-2", "cap-3"]);
    });

    test("le plafond d'essais met l'entrée en QUARANTAINE — écartée du rejeu, pas du magasin", async ({
        page,
        context,
    }) => {
        // ⚠️ **CE TEST A ÉTÉ EN `test.fixme` QUELQUES HEURES** (B-125), et le motif mérite
        // d'être lu : le plafond qu'il garde n'existait PAS. `MAX_REPLAY_ATTEMPTS` était
        // appliqué à l'écriture dans la file v3 et il est parti avec elle à la tâche 4.11 ;
        // mesuré alors, `push-engine` n'incrémentait ni ne plafonnait `attempts` — le budget
        // était déjà absent du chemin v4. Le laisser vert en assouplissant l'assertion aurait
        // refermé le critère sur une fiction. Il est réactivé parce que le budget existe.
        await seedThroughEngine(page, "cap-2");

        // 🛑 SANS CETTE LIGNE, LE TEST N'ATTEINT PAS SON SUJET (B-201) — les trois entrées
        // partent en `layerNoLongerWritable` avant tout envoi, et le `setOffline` ci-dessous
        // n'a plus aucun effet sur l'issue. Vu rouge exactement ainsi le 09/08/2026.
        await ensureWriteTarget(page);

        // Hors réseau, les trois envois échouent en `networkError` : c'est le chemin pour
        // lequel le budget existe — un échec qui PEUT être transitoire, donc qu'on rejoue,
        // mais pas indéfiniment.
        await context.setOffline(true);
        await page.evaluate(async () => {
            const gl = /** @type {any} */ (globalThis).GeoLeaf;
            for (let i = 0; i < 3; i += 1) await gl.Storage.pushOutbox();
        });
        await context.setOffline(false);

        // Écartée du rejeu…
        const stillDue = (await due(page)).filter((e) => e.state !== "quarantined");
        expect(stillDue, "aucune entrée ne doit rester rejouable").toEqual([]);

        // …mais TOUJOURS EN BASE, et MOTIVÉE. C'est ce qui la distingue d'une disparition :
        // lecture directe du magasin, parce qu'ici le sujet est bien ce qui est PERSISTÉ.
        const outbox = await readStore(page, { db: GEOLEAF_DB, store: "outbox" });
        expect(outbox, "le contrat interdit de détruire une entrée").toHaveLength(3);
        for (const row of outbox) {
            expect(row.state).toBe("quarantined");
            expect(row.attempts).toBe(3);
            expect(row.quarantine).toBe("retryBudgetExhausted");
        }
    });

    test("B-03 — trois captures dans la MÊME milliseconde gardent leur ordre", async ({ page }) => {
        // 🛑 L'HORLOGE EST FIGÉE, ET C'EST LE SUJET. Une première version se contentait de
        // trois écritures d'affilée en pariant qu'elles tomberaient dans la même
        // milliseconde : mesuré, elles n'y tombent pas — chaque écriture attend une
        // transaction IndexedDB réelle, ce qui coûte plus d'une ms. Le test passait donc au
        // vert sans jamais éprouver la condition de B-03. Figer `Date.now` REPRODUIT la
        // condition au lieu de l'espérer.
        //
        // ⚠️ On ne fige que `Date.now`, jamais les minuteries : IndexedDB résout ses requêtes
        // sur la boucle d'événements, et geler celle-ci pendrait chaque `onsuccess`.
        //
        // ⚠️ **Ce que le port change** : en v3 la clé était `sync_<ms>_<random>` et B-03 était
        // le défaut d'un TRI sur cette clé. L'outbox mint un `seq` monotone — l'ordre est tenu
        // **par construction**, pas par un tri. Le test éprouve donc que la construction tient
        // sur le déployé, ce qu'aucun unitaire ne peut dire.
        const written = await page.evaluate(async (layer) => {
            const gl = /** @type {any} */ (globalThis).GeoLeaf;
            const realNow = Date.now;
            const frozen = realNow.call(Date);
            Date.now = () => frozen;
            /** @type {string[]} */
            const ids = [];
            try {
                for (const localId of ["b03-1", "b03-2", "b03-3"]) {
                    const res = await gl.Storage.applyEdit({
                        layerId: layer,
                        kind: "create",
                        localId,
                        feature: {
                            type: "Feature",
                            geometry: { type: "Point", coordinates: [-60.64, -32.94] },
                            properties: { nom: localId },
                        },
                    });
                    if (!res.entryId) throw new Error(`applyEdit refusé : ${res.refused}`);
                    ids.push(localId);
                }
            } finally {
                Date.now = realNow;
            }
            return ids;
        }, LAYER);

        expect(written).toEqual(["b03-1", "b03-2", "b03-3"]);

        const outbox = await readStore(page, { db: GEOLEAF_DB, store: "outbox" });

        // CONTRÔLE DU CONTRÔLE : sans horodatage commun, le vert ci-dessous viendrait de
        // millisecondes distinctes et ne dirait rien de B-03.
        const stamps = new Set(outbox.map((/** @type {any} */ e) => e.createdAt));
        expect(stamps.size, "les 3 écritures doivent partager la milliseconde").toBe(1);

        expect(outbox.map((/** @type {any} */ e) => e.localId)).toEqual([
            "b03-1",
            "b03-2",
            "b03-3",
        ]);
    });
});
