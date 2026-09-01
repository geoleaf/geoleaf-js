/*!
 * @geoleaf-plugins/navigation — Screen wake lock
 *
 * Keeps the screen awake while guidance runs, and — the part that is actually hard — keeps it
 * awake after the user comes back from another application.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * ## 🛑 The trap this module exists for
 *
 * A screen wake lock is **released by the browser** whenever the document stops being visible
 * — the user switches app, answers a call, locks the phone. That release is silent and
 * permanent: coming back to the foreground does **not** restore it.
 *
 * So an implementation that requests the lock once, at the start of guidance, works perfectly
 * in every test and then lets the screen go dark the first time a driver glances at a message.
 * The symptom arrives minutes later, on a device, in traffic — the worst place to notice it —
 * and it looks like a device setting rather than a bug.
 *
 * ⚠️ **The re-acquisition is therefore systematic, not conditional.** Checking whether the
 * sentinel is still alive before re-requesting looks careful and is wrong: the sentinel's
 * `released` flag is exactly what a stale reference reports incorrectly on some engines, and
 * requesting a lock that is already held is harmless.
 *
 * ## Why every failure is swallowed
 *
 * A wake lock is a comfort, never a prerequisite. It is refused on an insecure origin, when
 * the battery is low, when a policy forbids it — all ordinary. Guidance that stopped, or even
 * warned, because the screen might dim would be worse than a screen that dims.
 */

/** A wake lock that survives the user leaving and coming back. */
export interface ScreenWakeLock {
    /** Whether a lock is believed to be held right now. */
    readonly held: boolean;
    /** Requests the lock and starts watching visibility. Idempotent. */
    acquire(): Promise<void>;
    /** Releases the lock and stops watching. Idempotent. */
    release(): Promise<void>;
}

/**
 * Creates a wake lock bound to the document's visibility.
 *
 * @param doc The document to watch. Injected rather than read from the global so a test can
 *            drive `visibilitychange` without a browser — and so this module has exactly one
 *            place where the platform enters.
 * @returns The lock.
 */
export function createScreenWakeLock(doc: Document = globalThis.document): ScreenWakeLock {
    let sentinel: WakeLockSentinel | null = null;
    let wanted = false;
    let listening = false;

    /**
     * Requests a lock, swallowing every refusal.
     *
     * ⚠️ The presence check is not redundant even though the DOM types declare
     * `navigator.wakeLock` as NON-optional. That declaration is a lie at runtime: the API is
     * absent on several engines still in use, and trusting the type would throw on exactly the
     * browsers this comfort feature is most needed on. Typed as possibly-undefined here rather
     * than cast, because a double cast is a debt this repository counts and ratchets down.
     */
    async function request(): Promise<void> {
        const api: WakeLock | undefined = globalThis.navigator?.wakeLock;
        if (!api) return;
        try {
            sentinel = await api.request("screen");
        } catch {
            // Refused — insecure origin, low battery, policy. A comfort, never a prerequisite.
            sentinel = null;
        }
    }

    /** Re-requests whenever the document becomes visible again, if the lock is still wanted. */
    const onVisibility = (): void => {
        if (!wanted || doc.visibilityState !== "visible") return;
        // ⚠️ Unconditional: see the note above on why checking the sentinel first is wrong.
        void request();
    };

    return {
        get held(): boolean {
            return sentinel !== null;
        },

        async acquire(): Promise<void> {
            wanted = true;
            if (!listening && doc) {
                doc.addEventListener("visibilitychange", onVisibility);
                listening = true;
            }
            await request();
        },

        async release(): Promise<void> {
            wanted = false;
            if (listening && doc) {
                doc.removeEventListener("visibilitychange", onVisibility);
                listening = false;
            }
            const held = sentinel;
            sentinel = null;
            // The reference is cleared BEFORE awaiting: a release that rejects — the page was
            // already discarded, say — must still leave this object saying it holds nothing.
            if (held) {
                try {
                    await held.release();
                } catch {
                    /* Already gone. Nothing to repair. */
                }
            }
        },
    };
}
