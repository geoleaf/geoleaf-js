/**
 * Integration tests — the `routes` store, against `fake-indexeddb`.
 *
 * What is asserted is the PERSISTED record, never a mock's echo: a store
 * whose calls alone are verified says nothing about what survives the tab
 * closing, which is yet its only reason to exist.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

// ⚠️ The module and the base are loaded dynamically AFTER
// `fake-indexeddb/auto`, so their types are unknown at write time. `any` is
// the honest form here: pretending to type an import whose evaluation order
// IS the test's subject would give false assurance. (No `eslint-disable`
// directive is set: the rule is not active on this corpus, and a pointless
// suppression is noise the linter rightly refuses.)

import type { RoutesAPI } from "../../../src/capabilities/offline/db/routes.js";

/** The shape the store accepts, derived from its signature. */
type StoredEntry = Parameters<RoutesAPI["saveRoute"]>[0];

const DB_NAME = "geoleaf-routes-test";

describe("magasin `routes`", () => {
    let DBRoutes: any;
    let db: any;

    /** Opens a test base carrying the `routes` store and its index. */
    function openWithRoutesStore(): Promise<any> {
        return new Promise((resolve, reject) => {
            const req = globalThis.indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => {
                const store = req.result.createObjectStore("routes", { keyPath: "id" });
                store.createIndex("timestamp", "timestamp", { unique: false });
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    /** A persistable route. */
    /**
     * A persistable route, typed by the store's REAL shape.
     *
     * ⚠️ The type is DERIVED from the signature —
     * `Parameters<RoutesAPI["saveRoute"]>[0]` — and not imported by name. Two
     * reasons: an object literal that "looks like" the record compiles as
     * long as it has the fields and silently stops representing it as soon as
     * the store gains one; and exporting the type for a test's sole use would
     * make it an orphan, whose baseline freeze would be the admission of
     * defect forbidden here. Derived, it cannot diverge from what the store
     * really accepts.
     */
    function entry(id: string, timestamp = 1_000): StoredEntry {
        return {
            id,
            route: { distance: 1200, provider: "test" },
            line: [
                [55.4781, -21.0964],
                [55.4805, -21.0964],
            ],
            timestamp,
            corridorBufferM: 500,
            corridorZooms: [12, 13, 14],
        };
    }

    beforeEach(async () => {
        await import("fake-indexeddb/auto");
        ({ DBRoutes } = await import("../../../src/capabilities/offline/db/routes.js"));
        db = await openWithRoutesStore();
    });

    afterEach(async () => {
        db?.close();
        await new Promise((resolve) => {
            const req = globalThis.indexedDB.deleteDatabase(DB_NAME);
            req.onsuccess = resolve;
            req.onerror = resolve;
            req.onblocked = resolve;
        });
    });

    it("refuse d'être construit sans base — plutôt que d'échouer au premier appel", () => {
        // An error at wiring time names the wiring. The same error at the
        // first `saveRoute` would name a save, six screens later.
        expect(() => DBRoutes.init(null)).toThrow(/Database instance is required/);
    });

    it("écrit un itinéraire et le relit À L'IDENTIQUE", async () => {
        const api = DBRoutes.init(db);
        await api.saveRoute(entry("r1"));
        const back = await api.getRoute("r1");
        expect(back).not.toBeNull();
        expect(back.id).toBe("r1");
        expect(back.corridorBufferM).toBe(500);
        expect(back.corridorZooms).toEqual([12, 13, 14]);
    });

    it("🛑 persiste la LIGNE DÉCODÉE, pas seulement l'itinéraire", async () => {
        // Decoding a polyline takes a codec that lives in a plugin. A core
        // store keeping only the encoded form would force every reader to own
        // a decoder — of which this repo already has a gate and a scar.
        const api = DBRoutes.init(db);
        await api.saveRoute(entry("r1"));
        const back = await api.getRoute("r1");
        expect(Array.isArray(back.line)).toBe(true);
        expect(back.line[0]).toEqual([55.4781, -21.0964]);
    });

    it("rend `null` sur un identifiant absent, jamais `undefined`", async () => {
        // Two distinct absences read the same in a condition, and behave
        // differently in a `JSON.stringify` or a parameter default.
        const api = DBRoutes.init(db);
        expect(await api.getRoute("jamais-écrit")).toBeNull();
    });

    it("remplace un itinéraire de même identité au lieu d'en empiler deux", async () => {
        const api = DBRoutes.init(db);
        await api.saveRoute(entry("r1", 1_000));
        await api.saveRoute({ ...entry("r1", 2_000), corridorBufferM: 250 });
        const all = await api.listRoutes();
        expect(all).toHaveLength(1);
        expect(all[0].corridorBufferM).toBe(250);
    });

    it("liste du plus RÉCENT au plus ancien", async () => {
        // "What I prepared last" is what a user looks for. Sorting here
        // rather than at each caller is what keeps two screens from contradicting each other.
        const api = DBRoutes.init(db);
        await api.saveRoute(entry("vieux", 1_000));
        await api.saveRoute(entry("récent", 9_000));
        await api.saveRoute(entry("moyen", 5_000));
        expect((await api.listRoutes()).map((r: any) => r.id)).toEqual([
            "récent",
            "moyen",
            "vieux",
        ]);
    });

    it("supprime, et la suppression d'un absent RÉUSSIT", async () => {
        // A deletion reporting "not found" forces every caller to write a
        // read it does not need.
        const api = DBRoutes.init(db);
        await api.saveRoute(entry("r1"));
        await api.deleteRoute("r1");
        expect(await api.getRoute("r1")).toBeNull();
        await expect(api.deleteRoute("jamais-écrit")).resolves.toBeUndefined();
    });

    it("🛑 REJETTE quand le magasin n'existe pas, au lieu de jeter en synchrone", async () => {
        // The case of an old base, opened by an engine that has not yet
        // upgraded. Rejecting keeps all callers on ONE error path; throwing
        // synchronously would open a second one half of them would forget.
        const bare = await new Promise((resolve, reject) => {
            const req = globalThis.indexedDB.open(`${DB_NAME}-bare`, 1);
            req.onupgradeneeded = () => req.result.createObjectStore("autre", { keyPath: "id" });
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        try {
            const api = DBRoutes.init(bare);
            await expect(api.getRoute("r1")).rejects.toBeInstanceOf(Error);
        } finally {
            bare.close();
        }
    });

    it("🛑 GARDE DE SOURCE — la promesse est tenue par `tx.oncomplete`, jamais par `onsuccess`", async () => {
        // The distinction this module exists to hold: `onsuccess` fires while
        // the transaction is STILL OPEN. Resolving there lets a caller
        // believe the write landed when it can still abort — on a quota
        // error, most often, i.e. exactly the condition this feature works near.
        //
        // 🛑 **Why a SOURCE guard and not a behaviour test.** I wrote two, and
        // neither discriminated. The window to exercise is "the request
        // succeeded, the transaction has not yet committed", and it is not
        // reliably reachable under `fake-indexeddb`: a microtask aborts
        // BEFORE `onsuccess` (IDB callbacks are tasks), so both
        // implementations reject; a macrotask arrives AFTER the commit, so
        // both resolve. Measured both ways.
        //
        // Rather than forging a window with a fragile delay — a test passing
        // by machine load —, we guard the property where it is true: in the
        // code. The idiom this repo already uses for the same constraint
        // class, in `sw-core.test.js` ("no `indexedDB.open(` carries a second
        // argument"), and for the same reason: no behaviour assertion renders it.
        const source = (await import("../../../src/capabilities/offline/db/routes.ts?raw")).default;

        const resolvers = source.match(/(\w+(?:\.\w+)*)\s*=\s*\(\)\s*=>\s*resolve\(/g) || [];
        // Witness: the guard does not measure emptiness.
        expect(resolvers.length).toBeGreaterThan(0);
        for (const r of resolvers) {
            expect(r).toMatch(/tx\.oncomplete/);
        }
        // And the reverse, which is what makes the guard conclusive: no
        // `onsuccess` resolves. Without this second assertion, adding a
        // second resolver next to the first would pass — the first only looks
        // at what it found.
        expect(source).not.toMatch(/onsuccess\s*=\s*\(\)\s*=>\s*resolve\(/);
    });

    it("survit à une RÉOUVERTURE de la base — c'est la seule chose que ce magasin promet", async () => {
        // The test that justifies the sub-module. Everything else could pass on a Map.
        const api = DBRoutes.init(db);
        await api.saveRoute(entry("r1"));
        db.close();
        db = await openWithRoutesStore();
        const reopened = DBRoutes.init(db);
        const back = await reopened.getRoute("r1");
        expect(back?.id).toBe("r1");
        expect(back?.line).toHaveLength(2);
    });
});
