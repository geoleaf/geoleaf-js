/**
 * @file sync-facade-surface.guard.test.js
 * @description Test-garde — tout ce qu'un plugin DÉCLARE sur `GeoLeaf.Storage.DB` existe
 * vraiment sur la façade, et la façade expose tout ce que son module implémente.
 *
 * Pourquoi ce garde existe (tâche 3.10, 03/08/2026)
 * ------------------------------------------------
 * Le 03/08, l'E2E `28-offline-queue.spec.js` a rendu deux `TypeError` sur le bundle livré :
 * `db.getSyncQueueEntry is not a function` et `db.getSyncQueueSummary is not a function`.
 * Les deux méthodes étaient **implémentées** par `db/sync.ts`, **déclarées** par
 * `addpoi/sync-handler-types.ts`, **appelées** par `addpoi/sync-handler.ts` — et **absentes**
 * de la façade `db/indexeddb.ts` qui les relaie. Effets mesurés :
 *
 *   - `getSyncSummary()` jetait, donc `autoSync()` jetait, donc **la file n'était jamais
 *     rejouée au retour du réseau** — le `.catch` de l'écouteur `geoleaf:online` avalait
 *     l'erreur. Le seul moment pour lequel la chaîne existe est celui où elle échouait ;
 *   - la passe de nettoyage de `processSyncQueue()` jetait **après** avoir marqué les entrées
 *     `synced`, donc rien n'était retiré et un rejeu réussi se rapportait en échec.
 *
 * 🛑 C'EST LA TROISIÈME FOIS. B.45 avait posé exactement le même diagnostic sur
 * `updateSyncQueueStatus` et `removeSyncQueueEntry`, et l'a corrigé cas par cas. Deux méthodes
 * plus tard, la classe était de retour. Ce garde ferme la CLASSE.
 *
 * ## Pourquoi aucun typecheck ne peut l'attraper
 *
 * Un plugin **ne peut pas** importer les sources du core (INV-NS, gaté par
 * `verify-plugin-core-boundary.cjs`) : il **redéclare** donc la forme qu'il attend. Les deux
 * déclarations sont alors libres de diverger indéfiniment, chacune verte de son côté. C'est la
 * définition d'un seam, et un seam se garde par confrontation — jamais par relecture.
 *
 * ## Ce qu'il vérifie
 *
 * **Plugin → façade** : chaque méthode que les trois plugins déclarent sur `Storage.DB` existe
 * sur la façade. C'est le sens qui a mordu, et c'est celui que le typecheck ne peut pas voir.
 *
 * ⚠️ **Il vérifiait un second sens jusqu'au 04/08/2026** — « Module → façade : chaque méthode
 * de `SyncDBInstance` (`db/sync.ts`) est relayée ». Ce module est supprimé à la tâche 4.11 avec
 * le magasin `sync_queue`, et le cas est retiré plus bas, avec son motif. Le garde a **jeté**
 * sur le fichier introuvable plutôt que de sortir vert — c'est ce qu'attendait sa dernière
 * section.
 *
 * ## Ce qu'il ne vérifie PAS
 *
 * Ni la signature (arité, types) — un plugin déclare volontairement des formes plus étroites
 * que la façade —, ni le sens « la façade expose une méthode que nul ne déclare » : le core a
 * le droit d'exposer plus que ce que ces trois plugins-là consomment.
 *
 * ## Une garde jamais vue rouge ne garde rien
 *
 * Vue rouge le jour de sa pose, sur les deux méthodes manquantes, **avant** leur ajout. Et
 * trois assertions anti-garde-vide : si une ancre de bloc disparaît, si un fichier de plugin
 * devient introuvable, ou si un relevé rend zéro méthode, le garde **jette** au lieu de sortir
 * vert — un garde qui ne cherche plus rien rend zéro écart.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");

const FACADE = path.join(REPO_ROOT, "packages/core/src/capabilities/offline/db/indexeddb.ts");

/**
 * Les surfaces `Storage.DB` que les plugins redéclarent, chacune avec SON ancre.
 *
 * ⚠️ Table nommée plutôt qu'un glob : les trois fichiers ont trois formes de déclaration
 * (interface imbriquée, interface plate, propriétés optionnelles), et un extracteur générique
 * qui les manquerait sortirait vert en n'ayant rien lu. Une entrée dont l'ancre disparaît fait
 * JETER ce garde, donc un déplacement se voit.
 */
const PLUGIN_SEAMS = [
    {
        label: "offline-ui/shared/storage-contract.ts",
        file: "packages/plugins/offline-ui/src/shared/storage-contract.ts",
        anchor: "export interface StorageContractDB {",
    },
    {
        // ⚠️ RE-POINTÉE le 04/08/2026, à la vérification de clôture du Sprint 4 — l'ancre a
        // DÉMÉNAGÉ, elle n'a pas disparu. L'éditeur déclarait `StorageQueueDb` : les quatre
        // méthodes `sync_queue` de la file v3. Depuis 4.9 il écrit par `Storage.applyEdit`,
        // ces quatre déclarations n'avaient plus aucun appelant, et elles ont été retirées.
        // Ce qu'il déclare ENCORE sur `Storage.DB` est `_ensureModule`, par où la modale
        // d'attente lit l'`outbox`.
        //
        // 🛑 L'entrée n'est PAS retirée de cette table, et ce garde est précisément ce qui l'a
        // exigé : il a jeté sur l'ancre introuvable au lieu de sortir vert. Sans lui, l'éditeur
        // aurait gardé une déclaration sur la façade que plus personne ne confrontait — la
        // classe B.45, celle de deux méthodes déclarées par un plugin et absentes de la façade.
        label: "editor/persistence/storage-seam.ts",
        file: "packages/plugins/editor/src/persistence/storage-seam.ts",
        anchor: "export interface OutboxAccess {",
    },
];

/** Le corps `{ … }` qui suit `anchor`, accolades équilibrées. */
function blockAfter(src, anchor, where) {
    const start = src.indexOf(anchor);
    if (start === -1) {
        throw new Error(
            `sync-facade-surface.guard: ancre « ${anchor} » introuvable dans ${where}. ` +
                "Re-pointer ce garde, ne pas l'assouplir : sortir vert ici signifierait " +
                "« aucune méthode à confronter »."
        );
    }
    const open = src.indexOf("{", start + anchor.length - 1);
    let depth = 0;
    for (let k = open; k < src.length; k += 1) {
        if (src[k] === "{") depth += 1;
        else if (src[k] === "}") {
            depth -= 1;
            if (depth === 0) return src.slice(open + 1, k);
        }
    }
    throw new Error(`sync-facade-surface.guard: bloc non fermé après « ${anchor} » dans ${where}`);
}

/**
 * Noms de méthodes déclarés au PREMIER niveau d'un corps d'interface.
 *
 * Reconnaît les deux formes du dépôt — `nom(args): T;` et `nom?: (args) => T;` — et ignore les
 * lignes de commentaire, qui contiennent des noms de méthode en prose.
 */
function declaredMethods(body) {
    const names = new Set();
    let depth = 0;
    for (const raw of body.split("\n")) {
        const line = raw.trim();
        const atTop = depth === 0;
        depth += (raw.match(/\{/g) ?? []).length - (raw.match(/\}/g) ?? []).length;
        if (!atTop || line.startsWith("*") || line.startsWith("//") || line.startsWith("/*")) {
            continue;
        }
        const m = line.match(/^([A-Za-z_$][\w$]*)\s*\??\s*[(:]/);
        if (m && m[1] !== "readonly") names.add(m[1]);
    }
    return names;
}

/** Méthodes que l'objet `IndexedDB` de la façade définit (formes `async nom(` et `nom(`). */
function facadeMethods() {
    const src = fs.readFileSync(FACADE, "utf8");
    const names = new Set();
    for (const m of src.matchAll(/^ {4}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/gm)) {
        names.add(m[1]);
    }
    if (names.size === 0) {
        throw new Error(
            "sync-facade-surface.guard: aucune méthode relevée sur la façade — l'indentation " +
                "de `db/indexeddb.ts` a changé. Le garde jette plutôt que de rendre « 0 écart »."
        );
    }
    return names;
}

describe("garde — la façade `Storage.DB` porte tout ce qu'on lui demande (3.10)", () => {
    const facade = facadeMethods();

    // 🛑 LE CAS `SyncDBInstance` EST RETIRÉ (tâche 4.11) — son sujet n'existe plus.
    //
    // Il confrontait la façade au module `db/sync.ts`, supprimé avec le magasin `sync_queue`
    // (B-124). ⚠️ **Et il a fait son travail en partant** : plutôt que de sortir vert sur un
    // relevé vide, il a JETÉ sur `ENOENT` — le garde était écrit pour ça, et c'est ce qui
    // distingue un retrait constaté d'un retrait silencieux.
    //
    // ⚠️ **Ce qui reste ci-dessous est la moitié qui garde vraiment.** Les trois seams de
    // plugin sont la direction dangereuse : un plugin qui déclare une méthode que la façade
    // ne porte pas est exactement la « fiction du global » de la cause racine n° 1. Le cas
    // retiré gardait la direction inverse, et le module qu'il surveillait n'a plus de code.

    it.each(PLUGIN_SEAMS)("honore ce que $label déclare sur Storage.DB", ({ file, anchor }) => {
        const abs = path.join(REPO_ROOT, file);
        if (!fs.existsSync(abs)) {
            throw new Error(
                `sync-facade-surface.guard: ${file} introuvable. Le fichier a bougé — re-pointer ` +
                    "la table PLUGIN_SEAMS, ne pas retirer l'entrée."
            );
        }
        const declared = [
            ...declaredMethods(blockAfter(fs.readFileSync(abs, "utf8"), anchor, file)),
        ];

        expect(declared.length, `relevé vide sur ${file}`).toBeGreaterThan(0);
        expect(declared.filter((n) => !facade.has(n))).toEqual([]);
    });
});
