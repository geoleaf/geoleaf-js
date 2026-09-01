// @ts-check
// IndexedDB primitives — reading the ENTRY, not the event.
//
// WHY THIS EXISTS. The early offline defects all survived the same way: a spec
// asserted that something *happened* (an event fired, a flag flipped) and never that the
// right bytes *landed*. `e2e/10-addpoi.spec.js` waits on `window.__poiQueued` and never
// opens the database; `e2e/09-editor.spec.js` does the same. Both stayed green while the
// queue was storing entries without their attributes. These primitives read the store.
//
// 🛑 THE HELPER MUST NOT CARRY THE BUG IT MEASURES. Every open here is `indexedDB.open(name)`
// with NO version argument. Per spec, an undefined version opens at the database's current
// version and `onupgradeneeded` never fires. Passing a version would either provision an
// empty database out of thin air (making an "it's there" assertion vacuously true) or throw
// `VersionError` against a newer one — which is precisely root cause n°2 of the sprint,
// re-implemented inside its own instrument. Ported from the working reader already inline in
// `e2e/11-connector.spec.js`, which is correct on this point.
//
// ⚠️ KEY TYPES ARE PRESERVED, DELIBERATELY. `readRecord` passes the key through untouched:
// IndexedDB treats `3` and `"3"` as different keys, and that difference IS proven bug n°2
// ("restore a backup" reads a string id against a numeric autoIncrement store). A helper
// that coerced would hide the defect it exists to expose.
//
// All IndexedDB work funnels through ONE in-page executor. Seven copies of the same
// callback-to-promise dance would be a duplication finding, and a place for seven subtly
// different error behaviours to grow.

/**
 * The single in-page IndexedDB executor. Serialized into the page by `page.evaluate`, so it
 * must be self-contained: it can close over nothing from this module.
 *
 * @param {{db: string, op: string, store?: string, index?: string, key?: any, query?: any,
 *          records?: any[], field?: string, limit?: number}} o
 * @returns {Promise<any>}
 */
/* c8 ignore start — runs in the browser, never under node coverage */
function _inPage(o) {
    const openDb = () =>
        new Promise((resolve, reject) => {
            // NO VERSION — see the header. This is load-bearing.
            const req = indexedDB.open(o.db);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(new Error(`open(${o.db}) failed: ${req.error?.name}`));
            req.onblocked = () => reject(new Error(`open(${o.db}) BLOCKED`));
        });

    const withStore = (mode, fn) =>
        openDb().then(
            (db) =>
                new Promise((resolve, reject) => {
                    if (!db.objectStoreNames.contains(o.store)) {
                        db.close();
                        reject(
                            new Error(
                                `store "${o.store}" absent de ${o.db} — présents : ` +
                                    `[${Array.from(db.objectStoreNames).join(", ")}]`
                            )
                        );
                        return;
                    }
                    let out;
                    const tx = db.transaction(o.store, mode);
                    tx.oncomplete = () => {
                        db.close();
                        resolve(out);
                    };
                    tx.onerror = () => {
                        db.close();
                        reject(new Error(`tx on ${o.store} failed: ${tx.error?.name}`));
                    };
                    tx.onabort = () => {
                        db.close();
                        reject(new Error(`tx on ${o.store} aborted: ${tx.error?.name}`));
                    };
                    fn(tx.objectStore(o.store), (v) => {
                        out = v;
                    });
                })
        );

    switch (o.op) {
        case "describe":
            return openDb().then((db) => {
                const out = {
                    version: db.version,
                    stores: Array.from(db.objectStoreNames),
                };
                db.close();
                return out;
            });

        case "deleteDb":
            return new Promise((resolve) => {
                const req = indexedDB.deleteDatabase(o.db);
                const done = (v) => resolve(v);
                req.onsuccess = () => done({ deleted: true });
                req.onerror = () => done({ deleted: false, err: String(req.error?.name) });
                // A live connection blocks deletion. Reported, never silently swallowed:
                // a "deleted" that did not delete makes the next test read stale data.
                req.onblocked = () => done({ deleted: false, err: "BLOCKED" });
            });

        case "read":
            return withStore("readonly", (store, set) => {
                const src = o.index ? store.index(o.index) : store;
                const req = o.query === undefined ? src.getAll() : src.getAll(o.query);
                req.onsuccess = () =>
                    set(typeof o.limit === "number" ? req.result.slice(0, o.limit) : req.result);
            });

        case "readRecord":
            return withStore("readonly", (store, set) => {
                const req = store.get(o.key);
                req.onsuccess = () => set(req.result === undefined ? null : req.result);
            });

        case "count":
            return withStore("readonly", (store, set) => {
                const src = o.index ? store.index(o.index) : store;
                const req = o.query === undefined ? src.count() : src.count(o.query);
                req.onsuccess = () => set(req.result);
            });

        case "seed":
            return withStore("readwrite", (store, set) => {
                let n = 0;
                for (const rec of o.records || []) {
                    store.put(rec);
                    n++;
                }
                set(n);
            });

        case "keys":
            return withStore("readonly", (store, set) => {
                const req = store.getAllKeys();
                req.onsuccess = () =>
                    set(
                        req.result.map((k) => ({
                            key: typeof k === "object" ? JSON.stringify(k) : k,
                            type: typeof k,
                        }))
                    );
            });

        case "binary":
            return withStore("readonly", (store, set) => {
                const req = store.get(o.key);
                req.onsuccess = () => {
                    const rec = req.result;
                    if (rec === undefined || rec === null) {
                        set({ kind: "absent", byteLength: 0, present: false });
                        return;
                    }
                    const v = rec[o.field];
                    if (v === undefined || v === null) {
                        set({ kind: "absent", byteLength: 0, present: true });
                    } else if (typeof Blob !== "undefined" && v instanceof Blob) {
                        set({
                            kind: "blob",
                            byteLength: v.size,
                            type: v.type || null,
                            present: true,
                        });
                    } else if (v instanceof ArrayBuffer) {
                        set({ kind: "arraybuffer", byteLength: v.byteLength, present: true });
                    } else if (ArrayBuffer.isView(v)) {
                        set({ kind: "typedarray", byteLength: v.byteLength, present: true });
                    } else if (typeof v === "string") {
                        // The bug-3 signature: a data: URL or raw base64 stored where the
                        // schema declares a Blob. Reported as a STRING, never normalised —
                        // the whole point is that the caller can tell the two apart.
                        set({
                            kind: "string",
                            byteLength: v.length,
                            isDataUrl: v.startsWith("data:"),
                            present: true,
                        });
                    } else {
                        set({ kind: typeof v, byteLength: 0, present: true });
                    }
                };
            });

        default:
            return Promise.reject(new Error(`op inconnue: ${o.op}`));
    }
}
/* c8 ignore stop */

/**
 * @param {import('@playwright/test').Page} page
 * @param {object} op
 * @returns {Promise<any>}
 */
function _run(page, op) {
    // The executor is handed to `evaluate` BY REFERENCE. Playwright serializes the function
    // itself, so `_inPage` still runs in the page and still captures nothing from this module.
    //
    // ⚠️ Do NOT reach for the `toString()` + `new Function(...)` reconstruction used by
    // `scripts/probe-boot-contract.mjs`. That file needs it (`addInitScript` composes a
    // source string) AND lives in `scripts/`, which ESLint ignores. Here it trips
    // `no-new-func` — a rule `CLAUDE.md` forbids downgrading without a written motive, and
    // there is none: passing the reference does the same job with no dynamic evaluation.
    return page.evaluate(_inPage, op);
}

/**
 * Opens a database and reports what it actually is. The first call of any offline scenario:
 * it distinguishes "absent" from "present but empty", which no assertion on a store can.
 * @param {import('@playwright/test').Page} page
 * @param {string} dbName
 * @returns {Promise<{version: number, stores: string[]}>}
 */
function describe(page, dbName) {
    return _run(page, { db: dbName, op: "describe" });
}

/**
 * Reads every record of a store, optionally through an index and/or a key range.
 * @param {import('@playwright/test').Page} page
 * @param {{db: string, store: string, index?: string, query?: any, limit?: number}} sel
 * @returns {Promise<any[]>}
 */
function readStore(page, sel) {
    return _run(page, { ...sel, op: "read" });
}

/**
 * Reads ONE record by primary key. The key keeps its JavaScript type — see the header.
 * @param {import('@playwright/test').Page} page
 * @param {{db: string, store: string, key: any}} sel
 * @returns {Promise<any|null>} `null` when no record carries that key.
 */
function readRecord(page, sel) {
    return _run(page, { ...sel, op: "readRecord" });
}

/**
 * Counts records, optionally through an index and/or a key range.
 * @param {import('@playwright/test').Page} page
 * @param {{db: string, store: string, index?: string, query?: any}} sel
 * @returns {Promise<number>}
 */
function countStore(page, sel) {
    return _run(page, { ...sel, op: "count" });
}

/**
 * Lists the primary keys of a store WITH THEIR TYPE.
 *
 * This is the discriminator of proven bug n°2: a store declared `autoIncrement` mints
 * NUMERIC keys, and a reader that looks them up as strings finds nothing. Asserting the
 * type here turns a silent miss into a named failure.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{db: string, store: string}} sel
 * @returns {Promise<{key: any, type: string}[]>}
 */
function listKeys(page, sel) {
    return _run(page, { ...sel, op: "keys" });
}

/**
 * Writes records into a store (`put`, so it upserts).
 * @param {import('@playwright/test').Page} page
 * @param {{db: string, store: string, records: any[]}} sel
 * @returns {Promise<number>} how many were written.
 */
function seedStore(page, sel) {
    return _run(page, { ...sel, op: "seed" });
}

/**
 * Inspects ONE field of ONE record and reports what it PHYSICALLY holds.
 *
 * The instrument of proof criterion 6 — "a photo taken offline actually contains its bytes".
 * `expect(record).toBeTruthy()` cannot tell a `Blob` from a base64 string sitting where the
 * schema declares a `Blob`; this returns `kind` and `byteLength` so the caller can.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{db: string, store: string, key: any, field: string}} sel
 * @returns {Promise<{kind: 'blob'|'arraybuffer'|'typedarray'|'string'|'absent'|string,
 *                    byteLength: number, present: boolean, type?: string|null,
 *                    isDataUrl?: boolean}>}
 */
function readBinary(page, sel) {
    return _run(page, { ...sel, op: "binary" });
}

/**
 * Deletes a database outright — test isolation, so a green can never come from a previous run.
 *
 * ⚠️ Reports `{deleted:false, err:"BLOCKED"}` when a live connection holds it (a controlling
 * Service Worker is the usual culprit). Check the result: treating a blocked delete as done
 * makes the next scenario read stale data and pass for the wrong reason.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} dbName
 * @returns {Promise<{deleted: boolean, err?: string}>}
 */
function deleteDatabase(page, dbName) {
    return _run(page, { db: dbName, op: "deleteDb" });
}

/** The database every offline scenario of this repository talks to. */
const GEOLEAF_DB = "geoleaf-db";

export {
    GEOLEAF_DB,
    describe,
    readStore,
    readRecord,
    countStore,
    listKeys,
    seedStore,
    readBinary,
    deleteDatabase,
};
