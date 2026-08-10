// @ts-check
/**
 * 29 — LES CRITÈRES DE PREUVE DU SPRINT 3 QUI RESTAIENT (n° 1, 3, 5 et 6)
 *
 * **Critère 1** — écrire hors ligne, puis **relire l'entrée IndexedDB et asserter la CHARGE
 *   UTILE** après un rechargement de page.
 * **Critère 3** — « un ajout suivi d'une suppression hors ligne produit ZÉRO requête ».
 * **Critère 5** — « une sauvegarde qui se restaure — aujourd'hui c'est impossible ».
 * **Critère 6** — « une photo prise hors réseau contient réellement ses octets après
 *   rechargement ».
 *
 * ⚠️ LES CRITÈRES 1 ET 6 ÉTAIENT ASSIGNÉS À S3b, QUI A ÉTÉ DÉCLARÉE CLOSE SANS LES FOURNIR.
 * Le CODE qu'ils éprouvent était bien corrigé — la façade de file par la tâche 3.3, les octets
 * de photo par le bug n° 3 de la tâche 3.6 — mais aucun scénario ne les avait jamais observés
 * en navigateur. Trouvé le 03/08/2026 en relisant la table des tranches plutôt que la liste des
 * tâches : les deux disaient des choses différentes, et c'est la liste des critères qui avait
 * raison. Un critère de preuve qu'aucun test ne porte n'est pas clos, il est **affirmé**.
 *
 * 🛑 CE QUE CES DEUX-LÀ EXIGENT ET QUE LES AUTRES N'EXIGEAIENT PAS : **un rechargement de
 * page**. C'est tout leur sujet — « après rechargement » est dans l'énoncé des deux. Un test
 * qui relit dans la même session prouve qu'un objet est en mémoire, pas qu'il a été PERSISTÉ.
 *
 * ═══ L'INSTRUMENT DU CRITÈRE 3 A ÉTÉ INSTRUIT AVANT D'ÉCRIRE CE SCÉNARIO ═══
 *
 * L'en-tête de `helpers/offline.js` consignait une limite mesurée : `recordRequests` compte
 * des **initiations** de requête, pas de la sortie réseau — un `fetch()` servi entièrement
 * par le Service Worker émet quand même un événement `request`, et
 * `Response.fromServiceWorker()` ne tranche pas (il rend `true` aussi quand le worker relaie).
 * Écrire « zéro requête » là-dessus sans mesurer aurait produit un rouge qui ne dit rien.
 *
 * Mesuré le 03/08/2026, enregistreur ouvert et **sans assertion**, contre le vhost :
 *
 *   1. **Le geste d'écriture produit RÉELLEMENT zéro requête.** Deux mises en file hors
 *      ligne → **0** événement, ni page ni worker. _(La mesure portait sur
 *      `addToSyncQueue` ; le geste passe par `Storage.applyEdit` depuis 4.4b, et le retrait
 *      de la file v3 à la tâche 4.11 a rendu l'ancien nom inatteignable. Le fait mesuré ne
 *      change pas : une mise en file n'émet rien.)_ La limite documentée ne s'applique
 *      pas ici : elle concerne les LECTURES que le worker intercepte, et une mise en file
 *      n'en est pas une. Aucun discriminateur n'est donc nécessaire — en construire un
 *      « au cas où » aurait été du code sans objet.
 *   2. **`request.serviceWorker()` DISCRIMINE, si un jour il le faut.** Sur une lecture que
 *      le worker relaie, l'enregistreur voit **deux** événements pour une seule URL : celui
 *      de la page (`serviceWorker() === null`) et celui du worker. Une requête portant un
 *      worker est une preuve **suffisante** que le fil a été sollicité — le `fetch` du
 *      worker n'est pas ré-interceptable. Consigné pour le jour où un scénario en aura besoin.
 *   3. **Le trafic de boot se calme en ~2 s**, pas en 300 ms. `settleNetwork` avant toute
 *      assertion de zéro n'est donc pas une précaution, c'est la condition.
 *
 * ⚠️ CE QUI NE PROUVERAIT RIEN : un `assertZeroNetwork` NON SCOPÉ. Une carte vivante ne cesse
 * jamais de parler au réseau ; « zéro requête » n'est jamais qu'un énoncé sur un PÉRIMÈTRE.
 * Le périmètre est ici l'origine d'écriture, et le contrôle négatif prouve que l'instrument
 * voit bien quelque chose quand il y a quelque chose à voir.
 */

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { wipeOnOrigin } from "./helpers/db-seed.js";
import { GEOLEAF_DB, seedStore, readStore, readBinary } from "./helpers/idb.js";
import {
    goOffline,
    goOnline,
    settleNetwork,
    assertZeroNetwork,
    recordRequests,
} from "./helpers/offline.js";

/** La variante qui embarque À LA FOIS l'édition et `offline-ui` — la seule où le cycle de
 *  restauration est atteignable de bout en bout. ⚠️ 5.5 : c'était `deploy-addpoi` ; depuis la
 *  fusion c'est `deploy-full` qui joue ce rôle, et ce n'est pas un simple changement de port. */
const ORIGIN = baseURL("full");

/**
 * Le PÉRIMÈTRE du critère 3 : tout ce qui n'est pas l'origine de l'application est du bruit.
 *
 * 🛑 IL EST DÉRIVÉ, PAS ÉCRIT À LA MAIN, et ce n'est pas de la cosmétique. Une première
 * version de ce test n'avait aucun périmètre : elle a rendu **28 URL distinctes** — les
 * tuiles `s3.amazonaws.com/elevation-tiles-prod` et `tile.opentopomap.org` du fond de carte,
 * qui continuent d'arriver bien après `settleNetwork`. Une carte vivante ne cesse jamais de
 * parler au réseau ; « zéro requête » n'est jamais qu'un énoncé sur un périmètre.
 *
 * ⚠️ ET C'EST UN BIAIS D'INSTRUMENT DE MA PART, pas une surprise du code : l'instruction
 * préalable avait été jouée sur la variante `full`, où la carte s'était calmée, et j'en ai
 * conclu « zéro requête tout court ». Mesurer sur une variante et conclure sur une autre est
 * exactement ce que la règle de pré-vol interdit.
 *
 * Le périmètre est POSITIF — « l'origine de l'application » — et non une liste noire de
 * fournisseurs : une liste noire excuserait en silence le trafic qu'un futur scénario doit
 * précisément attraper. Et c'est le bon périmètre pour ce critère : une pousée de POI part
 * vers l'origine (`/api/pois`), jamais vers un fournisseur de tuiles.
 */
const NOT_APP_ORIGIN = new RegExp(`^(?!${ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`);

/**
 * Boote l'application et attend la SURFACE, jamais un événement.
 *
 * ⚠️ Le témoin de disponibilité était `Storage.DB.addToSyncQueue`, retiré avec la file v3
 * (tâche 4.11). On attend désormais `Storage.applyEdit` — le point d'écriture unique depuis
 * 4.4b, c'est-à-dire ce que ces tests exercent réellement.
 */
async function boot(page) {
    await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
        // 🛑 Le témoin doit prouver que le moteur est CÂBLÉ, pas seulement que la façade
        // existe. `Storage.applyEdit` est monté dès le boot et rendrait `true` trop tôt —
        // mesuré : les tests partaient alors avec `Storage.DB` encore `null`. `DB.<méthode>`
        // exige les deux, c'est ce que faisait `addToSyncQueue` avant son retrait.
        () =>
            typeof (/** @type {any} */ (globalThis).GeoLeaf?.Storage?.DB?.listPendingEdits) ===
            "function",
        null,
        { timeout: 25000 }
    );
}

test.describe("29 — critères de preuve n° 1, 3, 5 et 6", () => {
    test.beforeEach(async ({ page }) => {
        await wipeOnOrigin(page, ORIGIN);
    });

    test.afterEach(async ({ context, page }) => {
        await goOnline(context, page).catch(() => {
            /* le contexte peut déjà être en ligne */
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════════════
    // CRITÈRE 3
    // ═══════════════════════════════════════════════════════════════════════════════════

    test("CRITÈRE 3 — un ajout PUIS une suppression hors ligne ne produisent AUCUNE requête", async ({
        context,
        page,
    }) => {
        await boot(page);
        // Sans ça, l'assertion rougirait sur le trafic de boot : ~2 s de tuiles, styles,
        // glyphes et sprites qui n'ont rien à voir avec le geste éprouvé.
        await settleNetwork(context, { quietMs: 800, timeout: 30000 });

        await goOffline(context, page);

        /** @type {{add: string, del: string, due: string[]}} */
        let queued;
        await assertZeroNetwork(
            context,
            async () => {
                queued = await page.evaluate(async () => {
                    const gl = /** @type {any} */ (globalThis).GeoLeaf;
                    const feature = {
                        type: "Feature",
                        geometry: { type: "Point", coordinates: [55.38, -21.07] },
                        properties: { nom: "Saisie hors réseau" },
                    };
                    // ⚠️ `sites_rosario` et NON `poi_tourisme` : `applyEdit` valide la couche
                    // (refus `layerUnknown`), là où la file v3 acceptait n'importe quel
                    // identifiant. Le profil `tourism` n'a que quatre couches éditables, et
                    // celle-ci est la seule à porter un bloc `write`.
                    const add = await gl.Storage.applyEdit({
                        layerId: "sites_rosario",
                        kind: "create",
                        localId: "c3-poi",
                        feature,
                    });
                    // État APRÈS la création seule : l'entité est là, son entrée aussi.
                    const afterAdd = await gl.Storage.DB.listPendingEdits();

                    const del = await gl.Storage.applyEdit({
                        layerId: "sites_rosario",
                        kind: "delete",
                        localId: "c3-poi",
                    });
                    const afterDel = await gl.Storage.DB.listPendingEdits();
                    return {
                        add: add.entryId,
                        del: del.entryId,
                        afterAdd: afterAdd.length,
                        afterDel: afterDel.length,
                    };
                });
                // Laisser le temps à une requête tardive de se manifester : une assertion
                // qui ferme sa fenêtre trop tôt ne prouve pas l'absence, elle prouve
                // l'impatience.
                await page.waitForTimeout(1500);
            },
            { allow: [NOT_APP_ORIGIN] }
        );

        // 🛑 L'ASSERTION QUI PORTE LE CRITÈRE N'EST PAS « ZÉRO REQUÊTE » SEULE. Zéro requête
        // est aussi ce que produirait un geste qui n'a rien fait. Il faut que le geste ait
        // LAISSÉ UNE TRACE pour que le zéro veuille dire « c'est resté local ».
        //
        // ⚠️ **PORTÉ SUR LE CYCLE v4 (tâche 4.11), et la propriété a CHANGÉ DE FORME.** En v3
        // les deux opérations restaient empilées côte à côte, et le test lisait leur ordre.
        // L'outbox **coalesce** : une entité créée puis supprimée hors ligne n'a jamais existé
        // côté serveur, donc les deux entrées s'ANNULENT (`local-edit.ts`, cas « annulation »).
        // Garder l'ancienne assertion aurait exigé de désactiver la coalescence pour la
        // mesurer — c'est-à-dire de tester le contraire du contrat.
        //
        // La trace se lit donc en deux temps : la création seule laisse UNE entrée en file,
        // la suppression qui suit n'en laisse AUCUNE. Un geste inerte ne produirait ni l'une
        // ni l'autre.
        // @ts-expect-error — affecté dans le callback ci-dessus
        expect(queued.add, "la création doit rendre un identifiant d'entrée").toBeTruthy();
        // @ts-expect-error — affecté dans le callback ci-dessus
        expect(queued.afterAdd, "une entrée après la création").toBe(1);
        // @ts-expect-error — affecté dans le callback ci-dessus
        expect(queued.afterDel, "ANNULATION — plus rien après la suppression").toBe(0);
    });

    test("CONTRÔLE NÉGATIF — l'instrument VOIT une requête quand il y en a une", async ({
        context,
        page,
    }) => {
        // Sans ce test, le vert du précédent serait indiscernable d'un enregistreur débranché.
        // C'est la garde de la garde : une mesure de zéro n'a de valeur que si l'on montre
        // que la même mesure sait rendre autre chose que zéro.
        await boot(page);
        await settleNetwork(context, { quietMs: 800, timeout: 30000 });

        const rec = recordRequests(context, { filter: (url) => url.includes("/profiles/") });
        await page.evaluate(async () => {
            await fetch("./profiles/tourism/profile.json", { cache: "reload" }).catch(() => {});
        });
        await page.waitForTimeout(1200);
        rec.stop();

        expect(
            rec.count(),
            "l'enregistreur doit voir la requête qu'on vient de faire"
        ).toBeGreaterThan(0);
    });
    // 🛑 LE CRITÈRE 5 EST RETIRÉ — LA FONCTIONNALITÉ N'EXISTE PLUS (tâche 4.11, 04/08/2026).
    //
    // Ses trois tests portaient sur la restauration de sauvegarde : la moitié prouvée (la clé
    // numérique, corrigée en 3.6), le `test.fixme` de **B-116**, et son contrôle négatif.
    //
    // Le pré-vol du 04/08 a retourné la prémisse de B-116. La ligne disait « les sauvegardes
    // sont créées VIDES » ; la mesure dit qu'elles **ne sont plus créées du tout** —
    // `_createBackup` n'avait aucun appelant de production depuis que 4.4b a réécrit
    // `processSyncQueue` en délégation à `pushOutbox`. Et son motif était faux sur le
    // mécanisme : le magasin vivait dans la base qu'une purge d'origine détruit, donc il ne
    // protégeait pas du cas pour lequel il existait. La chaîne entière est supprimée, et
    // **B-116 se ferme par retrait**.
    //
    // ⚠️ Ce qui la remplaçait existait déjà : l'outbox interdit contractuellement de détruire
    // une entrée, et l'export JSON d'`offline-ui` sort du navigateur — lui survit à la purge.

    // ═══════════════════════════════════════════════════════════════════════════════════
    // CRITÈRE 1 — la charge utile SURVIT au rechargement
    // ═══════════════════════════════════════════════════════════════════════════════════

    test("CRITÈRE 1 — une saisie hors ligne se relit AVEC SA CHARGE UTILE après rechargement", async ({
        context,
        page,
    }) => {
        // 🛑 LE DÉFAUT QUE CE TEST ÉPINGLE (tâche 3.3). La façade `addToSyncQueue` remappait
        // les arguments : elle lisait `operation.data` — toujours `undefined` — et n'avait
        // **aucun slot pour `payload`**. Toute saisie de terrain partait donc en file
        // `poiData: null`, et l'éditeur perdait son enveloppe. Deux vocabulaires de charge
        // utile, deux pertes, un seul remap fautif.
        //
        // ⚠️ ET VOICI POURQUOI CE CRITÈRE EXISTE : le seul E2E qui coupait le réseau avant le
        // 02/08 assertait un DRAPEAU (`window.__edQueued`), jamais la donnée. Un événement se
        // déclenche aussi bien quand ce qu'il transporte est vide — c'est exactement ainsi que
        // le défaut a survécu des mois.
        await boot(page);
        await goOffline(context, page);

        // ⚠️ **PORTÉ SUR LE CYCLE v4 (tâche 4.11) — et le défaut d'origine est devenu
        // INEXPRIMABLE.** Le test écrivait DEUX entrées de file, une par vocabulaire de charge
        // utile (`poiData` pour `addpoi`, `payload` pour l'éditeur), parce que le remap de
        // `addToSyncQueue` en perdait une. Depuis 4.4b il n'y a qu'un point d'écriture et un
        // seul vocabulaire ; depuis 3.4, **l'entrée de file ne porte PLUS la charge utile du
        // tout** — elle référence `localId`, et la donnée vit dans `features`.
        //
        // La propriété reste la même — « une saisie hors ligne se relit AVEC SA CHARGE UTILE
        // après rechargement » — mais elle se lit désormais dans le magasin d'entités.
        const queued = await page.evaluate(async () => {
            const gl = /** @type {any} */ (globalThis).GeoLeaf;
            const poi = await gl.Storage.applyEdit({
                layerId: "sites_rosario",
                kind: "create",
                localId: "c1-poi",
                feature: {
                    type: "Feature",
                    geometry: { type: "Point", coordinates: [55.38, -21.07] },
                    properties: { nom: "Belvédère du Maïdo", categorie: "belvedere" },
                },
            });
            const ed = await gl.Storage.applyEdit({
                layerId: "sites_rosario",
                kind: "create",
                localId: "c1-geom",
                feature: {
                    type: "Feature",
                    geometry: {
                        type: "LineString",
                        coordinates: [
                            [55.3, -21.0],
                            [55.4, -21.1],
                        ],
                    },
                    properties: { nom: "Sentier" },
                },
            });
            return { poi: poi.entryId, ed: ed.entryId };
        });

        await goOnline(context, page);

        // ── LE RECHARGEMENT — c'est tout le sujet du critère ────────────────────────────
        // Sans lui, on prouverait qu'un objet est en mémoire, pas qu'il a été PERSISTÉ.
        // ⚠️ Aucun `wipeOnOrigin` entre les deux : ce serait effacer la preuve.
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForFunction(
            () =>
                typeof (/** @type {any} */ (globalThis).GeoLeaf?.Storage?.DB?.listPendingEdits) ===
                "function",
            null,
            { timeout: 25000 }
        );

        // Relu par les STORES, pas par le moteur : ce qu'on assert est ce qui est sur le disque.
        const entities = await readStore(page, { db: GEOLEAF_DB, store: "features" });
        const outbox = await readStore(page, { db: GEOLEAF_DB, store: "outbox" });
        const poiRow = entities.find((/** @type {any} */ r) => r.localId === "c1-poi");
        const edRow = entities.find((/** @type {any} */ r) => r.localId === "c1-geom");

        expect(poiRow, "l'entité POI doit survivre au rechargement").toBeTruthy();
        expect(edRow, "l'entité tracée doit survivre au rechargement").toBeTruthy();

        // 🛑 LES ASSERTIONS QUI PORTENT LE CRITÈRE : la charge utile, pas sa présence.
        // `toBeTruthy()` sur la ligne aurait été vert AVANT 3.3, avec `poiData: null`.
        expect(poiRow.feature.properties).toMatchObject({
            nom: "Belvédère du Maïdo",
            categorie: "belvedere",
        });
        expect(poiRow.feature.geometry.coordinates).toEqual([55.38, -21.07]);
        expect(edRow.feature.properties).toMatchObject({ nom: "Sentier" });
        expect(edRow.feature.geometry.type).toBe("LineString");

        // 🛑 ET VOICI CE QUI REND LE DÉFAUT D'ORIGINE INEXPRIMABLE : l'entrée de file ne
        // porte AUCUNE charge utile. Il n'y a plus de slot où l'enveloppe d'un producteur
        // puisse tomber à côté de celle d'un autre — le contrat l'écrit (« It references
        // `localId` and never `serverId` »), et c'est vérifiable sur le disque.
        const poiEntry = outbox.find((/** @type {any} */ e) => e.id === queued.poi);
        expect(poiEntry, "l'entrée de file doit survivre au rechargement").toBeTruthy();
        expect(poiEntry.localId).toBe("c1-poi");
        expect(poiEntry.poiData).toBeUndefined();
        expect(poiEntry.payload).toBeUndefined();
    });

    // ⚠️ LA MOITIÉ « retour en ligne → vérifier le push » DU CRITÈRE 1 N'EST PAS ICI, et son
    // absence est délibérée : elle exige un vrai backend et l'authentification du connector.
    // C'est la preuve du **Sprint 4**, dont l'énoncé la reprend mot pour mot. La moitié qui
    // relevait du Sprint 3 — écrire hors ligne et relire la charge utile — est ci-dessus.

    // ═══════════════════════════════════════════════════════════════════════════════════
    // CRITÈRE 6 — la photo contient ses OCTETS
    // ═══════════════════════════════════════════════════════════════════════════════════

    test("CRITÈRE 6 — une photo prise hors réseau contient ses OCTETS après rechargement", async ({
        context,
        page,
    }) => {
        // 🛑 LE DÉFAUT (bug n° 3, tâche 3.6) — et il était DOUBLE dans le même objet.
        //   ① `image-upload.ts` écrivait `base64: <data-url>` alors que `db/images.ts` déclare
        //      `blob: Blob` et que `storeImageLocally` mappe explicitement `blob:
        //      imageData.blob`. La clé `base64` n'était lue par personne : le store recevait
        //      `blob: undefined`. L'enregistrement existait, il était INEXPLOITABLE.
        //   ② `uploaded: false` — un booléen n'est PAS une clé IndexedDB valide, et le store
        //      porte un index `uploaded`. L'enregistrement restait HORS de cet index, donc
        //      invisible à `getPendingImages()` : jamais téléversé, jamais nettoyé.
        //
        // Les deux moitiés sont éprouvées ici, et le contrôle négatif ci-dessous rejoue la
        // forme défectueuse pour montrer que la correction fait une différence OBSERVABLE.
        await boot(page);
        await goOffline(context, page);

        const written = await page.evaluate(async () => {
            const db = /** @type {any} */ (globalThis).GeoLeaf.Storage.DB;
            // Des octets qu'on CONNAÎT — l'en-tête PNG, pour que l'assertion puisse dire
            // « ce sont les miens » et pas seulement « il y a quelque chose ».
            const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
            await db.storeImageLocally({
                id: "c6-photo",
                blob: new Blob([bytes], { type: "image/png" }),
                filename: "terrain.png",
                type: "image/png",
                size: bytes.byteLength,
                timestamp: Date.now(),
                uploaded: 0,
            });
            return { size: bytes.byteLength };
        });

        await goOnline(context, page);

        // ── LE RECHARGEMENT ─────────────────────────────────────────────────────────────
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForFunction(
            () =>
                typeof (/** @type {any} */ (globalThis).GeoLeaf?.Storage?.DB?.getPendingImages) ===
                "function",
            null,
            { timeout: 25000 }
        );

        // ── ① Les OCTETS, et sous la bonne FORME ────────────────────────────────────────
        // `readBinary` distingue un Blob d'un ArrayBuffer et d'une chaîne — c'est l'outil
        // écrit pour ce critère, et c'est ce qui sépare « il y a un enregistrement » de
        // « il y a une image ». Un `toBeTruthy()` aurait été vert avec le défaut.
        const stored = await readBinary(page, {
            db: GEOLEAF_DB,
            store: "local_images",
            key: "c6-photo",
            field: "blob",
        });
        expect(stored.kind, "la photo doit être un Blob, pas une chaîne base64").toBe("blob");
        expect(stored.byteLength).toBe(written.size);

        // ── ② Et elle est DANS L'INDEX des « en attente » ────────────────────────────────
        // La seconde moitié du bug : un booléen reste hors index. Sans cette assertion, une
        // photo pourrait avoir ses octets et rester invisible au téléversement pour toujours.
        const pending = await page.evaluate(async () => {
            const db = /** @type {any} */ (globalThis).GeoLeaf.Storage.DB;
            const rows = await db.getPendingImages();
            return rows.map((/** @type {any} */ r) => r.id);
        });
        expect(pending, "l'index `uploaded` doit voir la photo en attente").toContain("c6-photo");
    });

    test("CONTRÔLE NÉGATIF — la forme du bug n° 3 perd les octets ET sort de l'index", async ({
        page,
    }) => {
        // Sans ce test, les deux assertions ci-dessus seraient indiscernables d'un store
        // tolérant. On rejoue la forme EXACTE que `image-upload.ts` écrivait avant 3.6 —
        // `base64` au lieu de `blob`, `uploaded: false` au lieu de `0` — et on montre que
        // les deux défauts sont observables sur le store réel, pas seulement raisonnés.
        await boot(page);

        await seedStore(page, {
            db: GEOLEAF_DB,
            store: "local_images",
            records: [
                {
                    id: "c6-defectueuse",
                    base64: "data:image/png;base64,iVBORw0KGgo=",
                    filename: "terrain.png",
                    type: "image/png",
                    size: 12,
                    timestamp: 1785600000000,
                    uploaded: false,
                },
            ],
        });

        // ① Les octets ne sont nulle part : le champ que le lecteur regarde est ABSENT.
        const stored = await readBinary(page, {
            db: GEOLEAF_DB,
            store: "local_images",
            key: "c6-defectueuse",
            field: "blob",
        });
        expect(stored.kind, "`base64` n'est pas `blob` — le lecteur ne trouve rien").toBe("absent");

        // ② Et l'enregistrement est hors de l'index, donc invisible au téléversement.
        const pending = await page.evaluate(async () => {
            const db = /** @type {any} */ (globalThis).GeoLeaf.Storage.DB;
            const rows = await db.getPendingImages();
            return rows.map((/** @type {any} */ r) => r.id);
        });
        expect(pending, "un booléen reste HORS de l'index `uploaded`").not.toContain(
            "c6-defectueuse"
        );
        // …alors qu'il est bien EN BASE : c'est ce qui rend le défaut silencieux.
        const rows = await readStore(page, { db: GEOLEAF_DB, store: "local_images" });
        expect(rows.map((/** @type {any} */ r) => r.id)).toContain("c6-defectueuse");
    });
});
