/**
 * StorageHelper.openDatabase — the one method of this module with a production caller
 * (`core/indexeddb.ts`). CAPACITÉS B.7.
 *
 * Runs against `fake-indexeddb`, like `images-idb-keys.test.js` and
 * `sync-queue-compat-surface.test.js`: the hand-rolled DB mock used by the rest of the
 * offline suite cannot produce a versionchange event, an `onerror`, or an `onblocked`, so
 * it cannot exercise a single one of the callbacks below.
 *
 * ⚠️ ESM `import` on purpose — see the measurement note in
 * `storage-helper-validation.test.js`.
 */

import "fake-indexeddb/auto";
import { StorageHelperModule as StorageHelper } from "../../../src/capabilities/offline/db/storage-helper.ts";

let dbSeq = 0;
/** Fresh database name per test — a leftover connection would make the next open block. */
const freshName = () => `geoleaf-open-db-test-${++dbSeq}`;

/** Connections opened by a test, closed in afterEach (a live handle blocks deleteDatabase). */
let open = [];

/** Log double installed through the `globalThis.GeoLeaf.Log` hook the Log proxy honours. */
let logSpy;

beforeEach(() => {
    open = [];
    logSpy = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    globalThis.GeoLeaf = { ...(globalThis.GeoLeaf ?? {}), Log: logSpy };
});

afterEach(async () => {
    vi.unstubAllGlobals();
    delete globalThis.GeoLeaf;
    for (const db of open) {
        try {
            db.close();
        } catch {
            /* already closed */
        }
    }
    for (let i = 1; i <= dbSeq; i++) {
        await new Promise((resolve) => {
            const req = globalThis.indexedDB.deleteDatabase(`geoleaf-open-db-test-${i}`);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
        });
    }
});

/** Opens through the module and registers the connection for teardown. */
async function openTracked(...args) {
    const db = await StorageHelper.openDatabase(...args);
    open.push(db);
    return db;
}

describe("openDatabase — argument guards (reject before touching indexedDB)", () => {
    test.each([
        ["an empty string", ""],
        ["null", null],
        ["undefined", undefined],
        ["a number", 42],
    ])("rejects %s as a database name", async (_label, name) => {
        await expect(StorageHelper.openDatabase(name, 1)).rejects.toThrow(
            "[StorageHelper] Invalid database name"
        );
    });

    test.each([
        ["zero", 0],
        ["null", null],
        ["undefined", undefined],
        ["a numeric string", "3"],
        ["NaN", Number.NaN],
    ])("rejects %s as a database version", async (_label, version) => {
        await expect(StorageHelper.openDatabase(freshName(), version)).rejects.toThrow(
            "[StorageHelper] Invalid database version"
        );
    });

    test("rejects when IndexedDB is not supported", async () => {
        vi.stubGlobal("indexedDB", undefined);
        await expect(StorageHelper.openDatabase(freshName(), 1)).rejects.toThrow(
            "[StorageHelper] IndexedDB not supported in this browser"
        );
    });
});

describe("openDatabase — success path", () => {
    test("resolves with the opened database at the requested version", async () => {
        const name = freshName();
        const db = await openTracked(name, 2);

        expect(db).toBeInstanceOf(IDBDatabase);
        expect(db.name).toBe(name);
        expect(db.version).toBe(2);
    });

    test("runs the upgrade callback with a usable versionchange event", async () => {
        const name = freshName();
        const seen = [];

        const db = await openTracked(name, 3, (event) => {
            seen.push([event.oldVersion, event.newVersion]);
            event.target.result.createObjectStore("things", { keyPath: "id" });
        });

        expect(seen).toEqual([[0, 3]]);
        expect([...db.objectStoreNames]).toEqual(["things"]);
    });

    test("opens without an upgrade callback, and ignores a non-function one", async () => {
        const first = await openTracked(freshName(), 1);
        expect(first).toBeInstanceOf(IDBDatabase);

        const second = await openTracked(freshName(), 1, "not-a-function");
        expect(second).toBeInstanceOf(IDBDatabase);
        // Ignored by the `typeof === "function"` guard, NOT called and rescued by the inner
        // catch — the absence of the error log is what tells the two apart.
        expect(logSpy.error).not.toHaveBeenCalled();
    });

    test("a throwing upgrade callback does NOT fail the open — the partial upgrade is kept", async () => {
        // Deliberate policy in the source ("Don't reject here, let the transaction handle
        // it"). The consequence is worth pinning: the store created before the throw is
        // committed, so the database comes back at the new version with a half-built schema.
        const name = freshName();

        const db = await openTracked(name, 2, (event) => {
            event.target.result.createObjectStore("created-before-the-throw", { keyPath: "id" });
            throw new Error("upgrade blew up");
        });

        expect(db.version).toBe(2);
        expect([...db.objectStoreNames]).toEqual(["created-before-the-throw"]);
        expect(logSpy.error).toHaveBeenCalledWith(
            "[StorageHelper] Upgrade callback error:",
            "upgrade blew up"
        );
    });
});

describe("openDatabase — failure paths", () => {
    test("rejects when the open request errors (opening below the stored version)", async () => {
        const name = freshName();
        const v2 = await openTracked(name, 2);
        v2.close();

        const error = await StorageHelper.openDatabase(name, 1).catch((err) => err);

        expect(error).toBeInstanceOf(Error);
        expect(error.message).toMatch(/^\[StorageHelper\] Failed to open database: /);
        expect(error.message).not.toMatch(/Unknown error/);
    });

    test("rejects when the open never settles, after the requested timeout", async () => {
        // A hung `open` is the reason the timeout exists: the request object is returned but
        // no callback ever fires, so without the timer the promise would never settle.
        vi.stubGlobal("indexedDB", { open: () => ({}) });

        await expect(StorageHelper.openDatabase("hung", 1, undefined, 20)).rejects.toThrow(
            "[StorageHelper] IndexedDB open timeout after 20ms"
        );
    });

    test("rejects when indexedDB.open throws synchronously", async () => {
        // Real shape: a negative version is a synchronous TypeError per the IDB spec, and it
        // slips past the `!version || typeof version !== "number"` guard above.
        const error = await StorageHelper.openDatabase(freshName(), -1).catch((err) => err);

        expect(error).toBeInstanceOf(Error);
        expect(error.message).not.toMatch(/^\[StorageHelper\]/);
        expect(logSpy.error).toHaveBeenCalledWith(
            "[StorageHelper] Exception opening database:",
            error.message
        );
    });

    // ⚠️ REWRITTEN on 02/08/2026 (connection hygiene). This test was called
    // "warns instead of failing when the upgrade is blocked" and LOCKED the
    // defect in: an `onblocked` that merely logged left the request hanging
    // until the 15 s timeout, after which the caller installed the `_isStub`
    // fallback — a RECOVERABLE condition ("close the other tab") turned into
    // "no storage on this device", silently and 15 s too late. It was not
    // loosened, it was flipped.
    test("REJECTS with a named error when another connection blocks the upgrade", async () => {
        const name = freshName();
        const holder = await openTracked(name, 1);

        // `blocked` fires because `holder` still holds v1.
        await expect(StorageHelper.openDatabase(name, 2)).rejects.toMatchObject({
            name: "GeoLeafDbBlockedError",
        });

        // The message has to be ACTIONABLE — it is the only thing a user can act on.
        expect(logSpy.error).toHaveBeenCalledWith(expect.stringContaining("BLOCKED"));
        expect(logSpy.error).toHaveBeenCalledWith(expect.stringContaining("Close the other tabs"));

        // And the rejection cancels nothing: releasing the holder still lets the upgrade
        // through on a fresh attempt, so the condition stays recoverable.
        holder.close();
        const db = await openTracked(name, 2);
        expect(db.version).toBe(2);
    });
});
