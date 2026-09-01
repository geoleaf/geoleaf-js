/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Declarative catalogue of the namespace modules.
 *
 *
 * ## Ce qu'il remplace
 *
 * `APIModuleManager._scanExistingModules()` used to discover its modules by sweeping
 * `Object.keys(gl)` on the `_` prefix. That was not discovery, it was a **copy of
 * everything starting with an underscore** — and it promoted to "module" a string
 * (`_version`), a state bag (`_app`), and an ACCESSOR it invoked in passing
 * (`_APIController`).
 *
 * That last point is not theoretical: reading `GeoLeaf._APIController` constructs an
 * `APIController`, whose `init()` → `_setupModuleAccess()` → `_scanExistingModules()`
 * **re-reads the accessor mid-construction**. The recursion really blew the stack in a
 * browser (`controller.ts` keeps the account), and it was only held back by the
 * instance parking set just before `init()`. The catalogue applies an accessor policy —
 * record the NAME, never read the value — which turns the parking into a seatbelt
 * instead of the only brake.
 *
 * ## What it does NOT claim to do
 *
 * ⚠️ It does not preserve the output of `getModuleList()`. That one unions with
 * `Object.keys(gl)` **on every call**: it tracks the namespace by construction,
 * catalogue or not. The plan announced otherwise; measurement corrected it (cf. the
 * header of `__tests__/api/module-discovery.characterisation.test.js`).
 *
 * ## The presence guard is MANDATORY
 *
 * Three names of `PUBLIC_MODULES` are mounted by nobody — `POI` (subsystem dissolved),
 * `Route` (facade dissolved) and `Constants` (the namespace carries `CONSTANTS`, in
 * capitals). The old code's `if (gl[name])` skipped them silently; the new one discards
 * them on `!descriptor`, since an absent key has no descriptor.
 *
 * ⚠️ This paragraph first claimed an explicit "presence guard" was MANDATORY for them.
 * **The reddening probe did not confirm it**: disarming this guard turned no test red,
 * because the case was already covered upstream. What it really guards is the key
 * PRESENT but falsy (`_gl.X = undefined` does create an own property) — a facade set to
 * `undefined` is not a module, and caching it would make it indistinguishable from a
 * real one for `hasModule`. The three names stay declared in
 * {@link CATALOG_EXPECTED_ABSENT}, which is their real net.
 */

/**
 * Les modules publics interrogés au boot — liste héritée, conservée telle quelle.
 *
 * ⚠️ Three entries match nothing at runtime: see {@link CATALOG_EXPECTED_ABSENT}. They
 * stay here because removing them would change the output of `getModule()` for a name an
 * integrator may still query — `getModule("POI")` must return `null`, not `undefined`.
 * The namespace fallback is what produces that `null`, and it only exists if the name
 * crosses the loop without being cached.
 */
const PUBLIC_MODULES: readonly string[] = [
    "Core",
    "UI",
    "Config",
    "Baselayers",
    "BaseLayers",
    "POI",
    "GeoJSON",
    "Route",
    "Legend",
    "LayerManager",
    "Storage",
    "Log",
    "Security",
    "Utils",
    "Constants",
    "Validators",
    "Errors",
];

/**
 * The namespace's internal modules, ENUMERATED instead of prefix-swept.
 *
 * 24 entries — it was 37 before the public-API review removed 13 with no reader.
 *
 * ⚠️ This list does NOT contain `_app`, `_registry`, `_version` nor `_APIController`
 * although they sit on the namespace, and that is deliberate: they are not modules.
 * `_version` is a string, `_app` a state bag, `_registry` the `ModuleRegistry` instance,
 * and `_APIController` an accessor we do not want to trigger. Caching them brought
 * nothing — the sweep took them because they start with `_`, not because they are
 * modules. They stay reachable through `getModule()`, via the namespace fallback.
 */
const INTERNAL_MODULES: readonly string[] = [
    "_Cluster",
    "_ConfigLoader",
    "_DataConverter",
    "_GeoJSONLayerConfig",
    "_GeoJSONLayerManager",
    "_GeoJSONLoader",
    "_LabelButtonManager",
    "_LabelRenderer",
    "_LayerManagerControl",
    "_LayerManagerStyleSelector",
    "_LayerVisibilityManager",
    "_LegendControl",
    "_LegendGenerator",
    "_OfflineDetector",
    "_UIComponents",
    "_UIEventDelegation",
    "_UINotifications",
    "_UITheme",
    "_Validators",
    "_VectorTiles",
];

/**
 * The order is load-bearing: public ones first, as the historical sweep did.
 *
 * ⚠️ `PUBLIC_MODULES` and `INTERNAL_MODULES` are NOT exported: they are composition
 * details, and exporting them made them orphans in the `check-orphan-exports` and knip
 * sense — both flagged it, and both were right. The module's surface is this array plus
 * {@link CATALOG_EXPECTED_ABSENT}.
 */
export const MODULE_CATALOG: readonly string[] = [...PUBLIC_MODULES, ...INTERNAL_MODULES];

/**
 * Catalogue entries whose ABSENCE from the namespace is expected and motivated.
 *
 * The anti-drift test (`__tests__/api/module-discovery.characterisation.test.js`)
 * requires every catalogue entry to be mounted at runtime, EXCEPT these. An exemption
 * without a motive is indistinguishable from a name someone stopped pursuing — hence
 * the `Map`.
 */
export const CATALOG_EXPECTED_ABSENT: ReadonlyMap<string, string> = new Map([
    ["POI", "Sous-système POI dissous au S9 — aucun installeur ne monte cette clé."],
    ["Route", "Façade de namespace dissoute au S11 ; la capacité `route` n'a pas de layer B."],
    ["Constants", "Le namespace porte `CONSTANTS`, en capitales. Ce nom-ci n'a jamais existé."],
]);
