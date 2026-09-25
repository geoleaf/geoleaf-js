/**
 * Types for the in-memory `IndexedDB` double (`indexeddb.js`), for the suites written in
 * TypeScript.
 *
 * Without this file, a `.ts` suite importing the double earns a `TS7016` (a JS module with no
 * declaration), and the test typecheck baseline can only shrink. It declares the members the
 * double actually implements, with the engine's names; the double's `_db` is left loose on
 * purpose: it mimics just enough of the IndexedDB API for the cursor-reading paths.
 */

export declare const IndexedDB: {
    _db: unknown;
    init(): Promise<unknown>;
    getPreference(key: string, defaultValue?: unknown): Promise<unknown>;
    setPreference(key: string, value: unknown): Promise<void>;
    cacheLayer(
        id: string,
        data: unknown,
        profileId: string,
        metadata?: Record<string, unknown>
    ): Promise<void>;
    clearProfile(profileId: string): Promise<void>;
    getLayer(...args: unknown[]): Promise<unknown>;
    removeLayer(...args: unknown[]): Promise<void>;
};

/** Empties every in-memory store the double holds. */
export declare function clearMockStore(): void;
