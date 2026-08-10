// @ts-check
// Database SEEDING — the only helper here allowed to CREATE stores.
//
// WHY IT IS SEPARATE FROM `idb.js`. `idb.js` never passes a version to `indexedDB.open`,
// deliberately: it must not provision a database out of thin air, or an "it's there"
// assertion becomes vacuously true. That refusal makes it structurally unable to build a
// fixture. This file is the counterpart, and it is the only one that runs an upgrade.
//
// 🛑 THE FIXTURE CARRIES THE SCHEMA, NOT THIS FILE. A schema mirrored in helper code is a
// second source of truth that drifts silently the day production changes — and Sprint 3 is
// about to rewrite this very schema into v4. So `seedDatabase` applies whatever descriptor
// it is handed, and `e2e/fixtures/offline/db-v3-dump.json` is what says "v3 looks like
// this". Adding v4 means adding a fixture, not editing this helper.
//
// ⚠️ Re-derive the v3 descriptor from the engine rather than trusting the fixture blindly:
//     sed -n '/_upgradeDatabase(/,/^    },$/p' \
//       packages/core/src/capabilities/offline/db/indexeddb.ts | grep -E 'createObjectStore|createIndex'
//
// 🛑 SEED BEFORE `page.goto` OF THE APP, ALWAYS. Proof criterion 2 is "open `geoleaf-db`
// AFTER migration" — which needs a v3 database to already exist when the app boots. Seeding
// after boot tests nothing: the engine has already created its own database, at its own
// version, and there is no migration left to observe. `openBlankOnOrigin` exists for exactly
// this: it puts the page on the app's origin, with IndexedDB reachable, WITHOUT booting the
// app.

/** Sentinel path fulfilled locally to obtain a same-origin document that boots nothing. */
const BLANK_PATH = "__e2e_seed_blank__";

/**
 * Navigates to a minimal same-origin document so IndexedDB can be reached before the app
 * ever runs. The response is fulfilled by Playwright — nothing is requested from the server.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} origin e.g. `baseURL('core')`
 */
async function openBlankOnOrigin(page, origin) {
    const url = `${origin}/${BLANK_PATH}`;
    await page.route(url, (route) =>
        route.fulfill({
            status: 200,
            contentType: "text/html; charset=utf-8",
            body: "<!doctype html><meta charset=utf-8><title>e2e seed</title>",
        })
    );
    await page.goto(url, { waitUntil: "domcontentloaded" });
}

/**
 * In-page seeder. Serialized by `page.evaluate`, so it captures nothing from this module.
 *
 * Understands two value markers, because JSON cannot carry binary:
 *   - `{ "__blob__": { base64 | bytes, type } }` → a real `Blob` (proof criterion 6).
 *   - `{ "__arraybuffer__": { base64 } }`        → a raw `ArrayBuffer` (proof criterion 2).
 *
 * ⚠️ The two are NOT interchangeable. The Service Worker's `extractBinary()` reads an
 * ArrayBuffer, a `data:` string or a `{kind:"binary"}` envelope — a Blob falls through all
 * three and the record becomes unreadable by the path it was seeded for.
 *
 * @param {{name: string, version: number, stores: any[], data?: Record<string, any[]>,
 *          clear?: boolean}} spec
 * @returns {Promise<any>}
 */
/* c8 ignore start — runs in the browser, never under node coverage */
function _seedInPage(spec) {
    const materialise = (v) => {
        if (Array.isArray(v)) return v.map(materialise);
        if (v && typeof v === "object") {
            if (v.__arraybuffer__) {
                // The SW's `extractBinary()` accepts an ArrayBuffer, a `data:` string, or a
                // `{kind:"binary"}` envelope — but NOT a Blob. A tile fixture seeded as a Blob
                // is silently unreadable by the very path it exists to exercise.
                const d = v.__arraybuffer__;
                const bin = atob(d.base64);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                return bytes.buffer;
            }
            if (v.__blob__) {
                const d = v.__blob__;
                let bytes;
                if (typeof d.base64 === "string") {
                    const bin = atob(d.base64);
                    bytes = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                } else {
                    bytes = new Uint8Array(d.bytes || []);
                }
                return new Blob([bytes], { type: d.type || "application/octet-stream" });
            }
            const out = {};
            // `_comment` documents the fixture in source; it has no business being written
            // into the store. Left in, it would show up in every record a spec reads back and
            // break any whole-record comparison.
            for (const k of Object.keys(v)) {
                if (k === "_comment") continue;
                out[k] = materialise(v[k]);
            }
            return out;
        }
        return v;
    };

    return new Promise((resolve, reject) => {
        const req = indexedDB.open(spec.name, spec.version);

        req.onupgradeneeded = () => {
            const db = req.result;
            for (const s of spec.stores || []) {
                if (db.objectStoreNames.contains(s.name)) continue;
                const opts = { keyPath: s.keyPath };
                if (s.autoIncrement) opts.autoIncrement = true;
                const store = db.createObjectStore(s.name, opts);
                for (const idx of s.indexes || []) {
                    store.createIndex(idx.name, idx.keyPath, { unique: !!idx.unique });
                }
            }
        };

        req.onblocked = () =>
            reject(new Error(`seed BLOCKED on ${spec.name} — une connexion vivante la retient`));
        req.onerror = () => reject(new Error(`seed open failed: ${req.error?.name}`));

        req.onsuccess = () => {
            const db = req.result;
            const data = spec.data || {};
            const names = Object.keys(data);
            if (names.length === 0) {
                const out = { version: db.version, stores: Array.from(db.objectStoreNames) };
                db.close();
                resolve({ ...out, written: {} });
                return;
            }
            for (const n of names) {
                if (!db.objectStoreNames.contains(n)) {
                    db.close();
                    reject(
                        new Error(
                            `store "${n}" absent du schéma semé — déclarés : ` +
                                `[${(spec.stores || []).map((s) => s.name).join(", ")}]`
                        )
                    );
                    return;
                }
            }
            /** @type {Record<string, number>} */
            const written = {};
            const tx = db.transaction(names, "readwrite");
            tx.oncomplete = () => {
                const out = { version: db.version, stores: Array.from(db.objectStoreNames) };
                db.close();
                resolve({ ...out, written });
            };
            tx.onerror = () => {
                db.close();
                reject(new Error(`seed tx failed: ${tx.error?.name}`));
            };
            tx.onabort = () => {
                db.close();
                reject(new Error(`seed tx aborted: ${tx.error?.name}`));
            };
            for (const n of names) {
                const store = tx.objectStore(n);
                if (spec.clear) store.clear();
                let c = 0;
                for (const rec of data[n]) {
                    store.put(materialise(rec));
                    c++;
                }
                written[n] = c;
            }
        };
    });
}
/* c8 ignore stop */

/**
 * Creates (or upgrades to) a database and fills it.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{name?: string, version: number, stores: {name: string, keyPath: string,
 *          autoIncrement?: boolean, indexes?: {name: string, keyPath: string|string[],
 *          unique?: boolean}[]}[], data?: Record<string, any[]>, clear?: boolean}} spec
 * @returns {Promise<{version: number, stores: string[], written: Record<string, number>}>}
 */
function seedDatabase(page, spec) {
    return page.evaluate(_seedInPage, {
        name: spec.name || "geoleaf-db",
        version: spec.version,
        stores: spec.stores,
        data: spec.data,
        clear: spec.clear,
    });
}

/**
 * The Sprint 3 entry point: puts a LEGACY v3 database on the app's origin, before the app
 * has ever run, so that booting it is an observable migration.
 *
 * ```js
 * import dump from "../fixtures/offline/db-v3-dump.json" with { type: "json" };
 * await seedLegacyDump(page, baseURL("core"), dump);
 * await page.goto(`${baseURL("core")}/`);   // ← the app now migrates a REAL v3 database
 * ```
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} origin
 * @param {{version: number, stores: any[], data?: Record<string, any[]>}} dump
 * @returns {Promise<{version: number, stores: string[], written: Record<string, number>}>}
 */
async function seedLegacyDump(page, origin, dump) {
    await openBlankOnOrigin(page, origin);
    return seedDatabase(page, { ...dump, clear: true });
}

/**
 * Deletes a database from a blank same-origin document — i.e. with no app connection alive
 * to block it. Test isolation that actually isolates.
 *
 * ⚠️ Check the verdict. A blocked delete reports `{deleted:false, err:"BLOCKED"}`, and
 * treating it as done makes the next scenario read stale data and pass for the wrong reason.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} origin
 * @param {string} [dbName]
 * @returns {Promise<{deleted: boolean, err?: string}>}
 */
async function wipeOnOrigin(page, origin, dbName = "geoleaf-db") {
    await openBlankOnOrigin(page, origin);
    return page.evaluate(
        (name) =>
            new Promise((resolve) => {
                const req = indexedDB.deleteDatabase(name);
                req.onsuccess = () => resolve({ deleted: true });
                req.onerror = () => resolve({ deleted: false, err: String(req.error?.name) });
                req.onblocked = () => resolve({ deleted: false, err: "BLOCKED" });
            }),
        dbName
    );
}

export { openBlankOnOrigin, seedDatabase, seedLegacyDump, wipeOnOrigin };
