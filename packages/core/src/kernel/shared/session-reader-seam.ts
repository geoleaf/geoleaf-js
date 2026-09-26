/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description In-core seam for the **write session reader** — how the one holding the token
 * tells the pre-departure check what the session is worth.
 *
 * The core authenticates nothing: the token belongs to the connector when it manages the
 * session itself, to the host when it hands its own over (`getToken`). A check that must say
 * whether captures made off-network will reach the server cannot read it, then — it is TOLD,
 * the way a data plugin tells the drain what to finish first (`drain-hooks-seam.ts`). The core
 * never names who tells it: reading a plugin's namespace would make it depend on a property of
 * that plugin, which the core → plugins boundary forbids.
 *
 * **One slot, not a registry.** A page has one write session to report; the last registration
 * wins, and `null` empties the slot. The `-seam.js` suffix is the exemption the import rule
 * names (R.8), so `capabilities/offline/report/preflight.ts` reaches it directly.
 */

import type { WriteSession } from "../../contracts/sync.contract.js";

/**
 * Tells the write session, without renewing it — a check made before leaving writes nothing.
 * May answer synchronously or with a promise; `null` means it cannot say.
 */
export type SessionReader = () => WriteSession | null | Promise<WriteSession | null>;

let _reader: SessionReader | null = null;

/** In-core slot of the session reader. Written by `GeoLeaf.Sync`, read by the pre-departure check. */
export const SessionReaderContract = {
    /**
     * Registers (or replaces) the reader; `null` empties the slot.
     *
     * @param reader - The reader, or `null` to remove it.
     */
    register(reader: SessionReader | null): void {
        _reader = reader;
    },

    /** @returns the registered reader, or `null`. */
    _get(): SessionReader | null {
        return _reader;
    },

    /** Test seam: empty the slot. */
    _reset(): void {
        _reader = null;
    },
};
