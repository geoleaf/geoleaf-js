/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description In-core registry seam for **pre-drain steps** — work a plugin must finish
 * before the outbox is pushed.
 *
 * 🛑 **WHY A SECOND REGISTRY RATHER THAN `SyncHandlerContract`.** Three reasons, in order
 * of force:
 *
 *  1. **Mechanics.** That seam exposes `getHandler(id)` and nothing else; its plural
 *     accessor was REMOVED in a 3.1.0 break, with its motive written down. Iterating hooks
 *     would mean putting back a plural just retired for a neighbouring need.
 *  2. **Meaning.** A `SyncHandler` is a plugin that *drives* a replay — its
 *     `processSyncQueue` calls `pushOutbox`. Iterating those inside the drain would create
 *     re-entrance by construction. A hook is a plugin that must *finish* something first.
 *     Two roles under one registry is the shape of the defect, not its fix.
 *  3. **Boundary.** The `-seam.js` suffix is the exemption the import rule already names
 *     (`eslint.config.mjs`, R.8), so `capabilities/**` reaches this file directly and the
 *     `kernel/shared/index.ts` barrel does not have to widen for it.
 *
 * **The step that motivated it**: the editor uploads the photos held locally BEFORE the
 * queue is pushed, so that the reconciling `update` it writes is coalesced into the
 * still-pending `create` — the server then never sees an image token it cannot resolve.
 * That sequence used to live in the plugin's own drain wrapper, so it was skipped by every
 * caller that did not go through it (the console, the E2E suite, `offline-ui`'s replay
 * button). Moving the drain in-core without moving this would have silently dropped it.
 */

/**
 * A step run before each drain.
 *
 * ⚠️ **Its failure must never stop the drain**: a photo that cannot be uploaded is a photo
 * still waiting, not a reason to hold every other capture hostage. The drain enforces
 * this — a step is not trusted to.
 */
export type BeforeDrainStep = () => Promise<unknown> | unknown;

/** Registered steps, keyed by a stable id (e.g. `"editor:images"`). Insertion order kept. */
const _steps = new Map<string, BeforeDrainStep>();

/** In-core registry of pre-drain steps. Read by the drain, one pass, in order. */
export const DrainHooksContract = {
    /**
     * Registers (or replaces) a step under `id`; `null` **unregisters** it.
     *
     * ⚠️ **The `null` case is an asymmetry with `registerHandler`, and it is deliberate.**
     * That one no-ops on a falsy handler because nothing ever had to take a handler back.
     * A step belongs to a plugin that can be destroyed, and a destroyed editor still
     * holding the drain hostage on its images is a leak with a very long fuse: the hook
     * survives the DOM it was written for.
     *
     * @param id - Stable identifier of the step.
     * @param step - The step, or `null` to remove it.
     */
    register(id: string, step: BeforeDrainStep | null): void {
        if (!id) return;
        if (step) _steps.set(id, step);
        else _steps.delete(id);
    },

    /** @returns the registered steps, in registration order. */
    _list(): BeforeDrainStep[] {
        return [..._steps.values()];
    },

    /** Test seam: clear all registered steps. */
    _reset(): void {
        _steps.clear();
    },
};
