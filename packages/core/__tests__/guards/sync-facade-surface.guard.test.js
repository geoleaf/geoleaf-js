/**
 * @file sync-facade-surface.guard.test.js
 * @description Guard test — everything a plugin DECLARES on
 * `GeoLeaf.Storage.DB` really exists on the facade, and the facade exposes
 * everything its module implements.
 *
 * Why this guard exists (03/08/2026)
 * ------------------------------------------------
 * On 03/08, the E2E `28-offline-queue.spec.js` rendered two `TypeError`s on
 * the shipped bundle: `db.getSyncQueueEntry is not a function` and
 * `db.getSyncQueueSummary is not a function`. Both methods were
 * **implemented** by `db/sync.ts`, **declared** by
 * `addpoi/sync-handler-types.ts`, **called** by `addpoi/sync-handler.ts` —
 * and **absent** from the `db/indexeddb.ts` facade that relays them.
 * Measured effects:
 *
 *   - `getSyncSummary()` threw, so `autoSync()` threw, so **the queue was
 *     never replayed on network return** — the `geoleaf:online` listener's
 *     `.catch` swallowed the error. The one moment the chain exists for is
 *     the one where it failed;
 *   - `processSyncQueue()`'s cleanup pass threw **after** marking the entries
 *     `synced`, so nothing was removed and a successful replay reported as failure.
 *
 * 🛑 IT WAS THE THIRD TIME. The same diagnosis had been made on
 * `updateSyncQueueStatus` and `removeSyncQueueEntry`, and fixed case by
 * case. Two methods later, the class was back. This guard closes the CLASS.
 *
 * ## Why no typecheck can catch it
 *
 * A plugin **cannot** import the core's sources (INV-NS, gated by
 * `verify-plugin-core-boundary.cjs`): it therefore **redeclares** the shape
 * it expects. The two declarations are then free to diverge indefinitely,
 * each green on its side. That is the definition of a seam, and a seam is
 * guarded by confrontation — never by rereading.
 *
 * ## What it verifies
 *
 * **Plugin → facade**: every method the three plugins declare on
 * `Storage.DB` exists on the facade. The direction that bit, and the one the
 * typecheck cannot see.
 *
 * ⚠️ **It verified a second direction until 04/08/2026** — "Module → facade:
 * every `SyncDBInstance` (`db/sync.ts`) method is relayed". That module is
 * deleted with the `sync_queue` store, and the case is removed below, with
 * its motive. The guard **threw** on the missing file rather than coming out
 * green — which is what its last section expected.
 *
 * ## What it does NOT verify
 *
 * Neither the signature (arity, types) — a plugin deliberately declares
 * narrower shapes than the facade —, nor the direction "the facade exposes a
 * method nobody declares": the core may expose more than these three plugins consume.
 *
 * ## A guard never seen red guards nothing
 *
 * Seen red the day of its pose, on the two missing methods, **before** their
 * addition. And three anti-empty-guard assertions: if a block anchor
 * vanishes, a plugin file becomes unfindable, or a survey yields zero
 * methods, the guard **throws** instead of coming out green — a guard that
 * no longer searches yields zero gaps.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");

const FACADE = path.join(REPO_ROOT, "packages/core/src/capabilities/offline/db/indexeddb.ts");

/**
 * The `Storage.DB` surfaces the plugins redeclare, each with ITS anchor.
 *
 * ⚠️ A named table rather than a glob: the three files have three declaration
 * shapes (nested interface, flat interface, optional properties), and a
 * generic extractor missing them would come out green having read nothing.
 * An entry whose anchor vanishes makes this guard THROW, so a move is seen.
 */
const PLUGIN_SEAMS = [
    {
        label: "offline-ui/shared/storage-contract.ts",
        file: "packages/plugins/offline-ui/src/shared/storage-contract.ts",
        anchor: "export interface StorageContractDB {",
    },
    {
        // ⚠️ RE-POINTED on 04/08/2026, at the closure check — the anchor
        // MOVED, it did not vanish. The editor declared `StorageQueueDb`: the
        // v3 queue's four `sync_queue` methods. It now writes through
        // `Storage.applyEdit`, those four declarations had no caller left,
        // and they were removed. What it STILL declares on `Storage.DB` is
        // `_ensureModule`, through which the pending modal reads the `outbox`.
        //
        // 🛑 The entry is NOT removed from this table, and this guard is
        // precisely what demanded it: it threw on the unfindable anchor
        // instead of coming out green. Without it, the editor would have kept
        // a declaration on the facade nobody confronted any more — the class
        // of two methods declared by a plugin and absent from the facade.
        label: "editor/persistence/storage-seam.ts",
        file: "packages/plugins/editor/src/persistence/storage-seam.ts",
        anchor: "export interface OutboxAccess {",
    },
];

/** The `{ … }` body following `anchor`, braces balanced. */
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
 * Method names declared at an interface body's FIRST level.
 *
 * Recognises the repo's two forms — `name(args): T;` and
 * `name?: (args) => T;` — and ignores comment lines, which contain method
 * names in prose.
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

/** Methods the facade's `IndexedDB` object defines (`async name(` and `name(` forms). */
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

    // 🛑 THE `SyncDBInstance` CASE IS REMOVED — its subject no longer exists.
    //
    // It confronted the facade with the `db/sync.ts` module, deleted with the
    // `sync_queue` store. ⚠️ **And it did its job on the way out**: rather
    // than come out green on an empty survey, it THREW on `ENOENT` — the
    // guard was written for that, and it is what distinguishes an observed
    // removal from a silent one.
    //
    // ⚠️ **What remains below is the half that really guards.** The three
    // plugin seams are the dangerous direction: a plugin declaring a method
    // the facade does not carry is exactly the "fiction of the global" of
    // root cause no. 1. The removed case guarded the reverse direction, and
    // the module it watched has no code left.

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
