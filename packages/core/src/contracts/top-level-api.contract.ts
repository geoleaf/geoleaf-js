/*! GeoLeaf Core / © 2026 Mattieu Pottier / MIT / https://geoleaf.dev */
/**
 * GeoLeaf Contract — the top-level methods of the `GeoLeaf` namespace.
 *
 * Defines:
 * - `GeoLeafTopLevelApi` — the eleven shorthand methods mounted directly on `GeoLeaf`
 *
 * ## Pourquoi ce contrat existe : il y avait DEUX implémentations, et aucun lien
 *
 * ✅ **There is only one left**: `globals/globals.api.ts` (`defineApiMethods`), which
 * assigns the eleven one by one onto the namespace.
 *
 * Until then, `kernel/api/geoleaf-api.ts` re-set them via an `Object.assign` on the same
 * object, and **nothing linked them**: `verify-host-contract-sync.cjs` compares NAMES,
 * both carried the same ones, and two homonymous members with diverging shapes therefore
 * passed every gate. A long-open hole, closed in two steps — this contract first, which
 * tied the two shapes together; then the removal of one of the two.
 *
 * ⚠️ **This contract stays necessary after the removal**, and for a reason that changed:
 * it no longer arbitrates between two writers, it states what each method MUST return —
 * which is where the asymmetry below comes from (three refuse a dead controller, eight
 * return an empty value). It is referenced by `global.d.ts`, so the compiler checks the
 * assignments (`_gl` is typed `GeoLeafGlobal` there).
 *
 * ✅ And writer uniqueness is now **guarded**, not merely achieved:
 * `__tests__/guards/top-level-api-single-writer.guard.test.ts` reads these eleven names
 * right here, at the AST, and refuses a second module rewriting them.
 *
 * ## What measurement established before writing these signatures
 *
 * The duplication was believed INERT: `globals.api.ts` had long claimed that
 * `geoleaf-api.js` is eliminated by Rollup's DCE in the ESM build. **That was false.**
 * The `get BaseLayers` marker, declared nowhere else, is present in the shipped bundle,
 * and its emission offset shows this module runs LAST.
 *
 * The belief cost two production defects, measured in Chromium on the shipped bundle:
 *
 *   1. `GeoLeaf.BaseLayers === undefined`. `Object.assign` invokes the source getter with
 *      `this` bound to the literal, which does not declare `Baselayers` — the
 *      backward-compatible alias therefore wrote `undefined` over the correct value set
 *      just before.
 *   2. `GeoLeaf.getMetrics` threw as soon as it was detached
 *      (`const { getMetrics } = GeoLeaf`), its ESM form being `this.getHealth()` where
 *      its UMD twin did not depend on `this`.
 *
 * No gate could see either: they compare names, and both keys existed.
 *
 * ## The signatures' posture: the most PRECISE, not the most accommodating
 *
 * Where the two sides diverged, the runtime decided, not the most permissive view.
 * `kernel/api/api-types.ts` declared four controller methods as `unknown` while
 * `kernel/api/controller.ts` writes them `(theme: string): boolean` and
 * `(input): Promise<unknown>`: the interface was narrowed onto the implementation, and
 * the ESM wrappers with it. An `unknown` only survives here where the controller
 * returns one.
 */

// ─── Les onze méthodes de premier niveau ─────────────────────────────────────────────

/**
 * The shortcut methods mounted directly on `globalThis.GeoLeaf`.
 *
 * All members are optional: the namespace is assembled at boot (B1→B11 chain), and a
 * consumer reading it too early sees a partial object. Same posture as `GeoLeafGlobal`,
 * which references this contract member by member — **inline, never via `extends`**: the
 * repo's AST readers (`scripts/lib/ts-decl-read.cjs`) iterate declared members only, and
 * an inherited member would be invisible to them.
 */
export interface GeoLeafTopLevelApi {
    /**
     * Initialises GeoLeaf and creates the map.
     *
     * ⚠️ `map.target` — or its shorthand `target`/`mapId` — is **required**:
     * `APIInitializationManager._normalizeInitOptions` throws without it. The expected
     * shape is `{ map: { target }, data: { activeProfile, profilesBasePath } }`.
     *
     * ⚠️ Distinct from {@link GeoLeafTopLevelApi.boot}: `boot()` launches the
     * profile-driven application (config load then `registry.init()`), `init()` is the
     * manual wrapper around `GeoLeaf.Core.init()`. The `init` of the boot path is the
     * ModuleRegistry's, not this one.
     */
    init?: (options: Record<string, unknown>) => unknown;

    /** Applies a theme by identifier. Returns `true` when the theme was applied. */
    setTheme?: (theme: string) => boolean;

    /** Loads a configuration from a URL or an object. Throws (`TypeError`) on anything else. */
    loadConfig?: (input: string | Record<string, unknown>) => Promise<unknown>;

    /** Creates a GeoLeaf-managed map instance. Returns `null` when the controller is absent. */
    createMap?: (id: string, options?: Record<string, unknown>) => unknown;

    /** Returns the map instance registered under this identifier, or `null`. */
    getMap?: (id: string) => unknown;

    /** Returns every registered map instance — empty array when there is none. */
    getAllMaps?: () => unknown[];

    /** Returns a registered module by name, or `null`. */
    getModule?: (name: string) => unknown;

    /** `true` when a module of that name is registered. */
    hasModule?: (name: string) => boolean;

    /** Returns a top-level namespace (`GeoLeaf[name]`), or `null`. */
    getNamespace?: (name: string) => unknown;

    /** Health report of the `APIController`, or `null` when it is unavailable. */
    getHealth?: () => unknown;

    /**
     * Alias of {@link GeoLeafTopLevelApi.getHealth}.
     *
     * ⚠️ Both implementations must point at a function that does not depend on `this` —
     * the `this.getHealth()` form threw as soon as the method was detached from the
     * namespace.
     */
    getMetrics?: () => unknown;
}
