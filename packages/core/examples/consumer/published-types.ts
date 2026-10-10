/*!
 * GeoLeaf — the PUBLISHED type surface of every package, resolved as an integrator resolves it.
 * © 2026 Mattieu Pottier — MIT
 */

/**
 *
 * @description
 * Type-only companion to `entry.ts`. It resolves each workspace package **through its
 * `exports` map**, exactly as an integrator's compiler does — no `paths`, no relative
 * escape hatch.
 *
 * ## Why this file exists (ARCHI S6)
 *
 * `entry.ts` proves the *core's* published types resolve. It imports nothing else, and that
 * blind spot let a whole class live: **11 packages** emitted `dist/types/**`, listed `dist/`
 * in `files[]`, and published the declarations to npm with **no `types` condition** in their
 * `exports` map. The .d.ts sat inside the tarball while `import "@geoleaf-plugins/table"`
 * failed with TS7016. No compiler in this repo imported them, so nothing said a word.
 *
 * `scripts/verify-published-types.cjs` checks the same rule structurally, by reading
 * package.json. This file makes the **compiler** answer instead. Having both matters: the
 * structural gate is the one that runs on a fresh checkout, and this one is the one that
 * cannot be fooled by a rule that turns out to be folklore — which is exactly what happened
 * to the "types must be the first condition" rule. It was assumed here, then tested against
 * this fixture and found FALSE (TypeScript resolves `types` after `import`, and even after
 * `default`). The gate kept the ordering as a convention and dropped the correctness claim.
 *
 * ## Why type-only
 *
 * `entry.ts` is bundled by `rollup.consumer.mjs` and measured by `check-consumer-bundle.cjs`
 * (tree-shaking proof, `size:consumer`). A runtime `import` of a plugin here would land in
 * that witness bundle and corrupt the measurement. `typeof import(...)` is **erased entirely**
 * at compile time: it forces module resolution and emits nothing.
 *
 * ⚠ `addpoi` and `storage` were absent ON PURPOSE for a while: they published no
 * declaration, unable to carry a `rootDir` — their tsconfigs compiled the
 * core's SOURCES. That debt is paid: both have no `@core/*` import left and
 * emit 34 and 36 declarations, **0 from the core**. So they are here, and the
 * 13 plugins are now all held by the compiler.
 */

// ── Libraries (packages/libs/) ───────────────────────────────────────────────────────────────
type _FieldRenderer = typeof import("@geoleaf/field-renderer");
type _HostRuntime = typeof import("@geoleaf/host-runtime");

// ── Plugins (packages/plugins/) — every one, all typed ──────────────────────────────────────────
// ⚠️ `navigation`, `position-share` and `routing` were missing from this list until
// 2026-10-05: it is written by hand, and nothing compared it to the plugins on disk.
type _Cog = typeof import("@geoleaf-plugins/cog");
type _Connector = typeof import("@geoleaf-plugins/connector");
type _Editor = typeof import("@geoleaf-plugins/editor");
type _FileImport = typeof import("@geoleaf-plugins/file-import");
type _Flatgeobuf = typeof import("@geoleaf-plugins/flatgeobuf");
type _Geocoding = typeof import("@geoleaf-plugins/geocoding");
type _Measure = typeof import("@geoleaf-plugins/measure");
type _Print = typeof import("@geoleaf-plugins/print");
type _RealtimeLayer = typeof import("@geoleaf-plugins/realtime-layer");
type _Storage = typeof import("@geoleaf-plugins/offline-ui");
type _Table = typeof import("@geoleaf-plugins/table");
type _Websocket = typeof import("@geoleaf-plugins/websocket");
type _Navigation = typeof import("@geoleaf-plugins/navigation");
type _PositionShare = typeof import("@geoleaf-plugins/position-share");
type _Routing = typeof import("@geoleaf-plugins/routing");

// The aliases above are the assertion: TypeScript must resolve each specifier to a declaration
// file to give them a type.

// ── The namespaces the plugins mount ────────────────────────────────────────────────────
//
// The core declares `GeoLeaf.Table`, `GeoLeaf.Editor`… and cannot type them: it never imports a
// plugin. Each plugin's published declarations add its API to `GeoLeafPluginApis`, the
// registry those namespaces read — so resolving the fourteen specifiers above must be enough
// to type the fourteen namespaces. Two assertions per namespace on the registry, because one is not enough:
//
//   - `Typed<K>` refuses `unknown` — the state of a namespace nobody augmented, which is what
//     every one of them was before the plugins carried their own type — and `any`.
//   - the `@ts-expect-error` line refuses a BAG: an API typed `Record<string, unknown>` passes
//     the first assertion and names nothing. A member no plugin has must not compile.
//
// And a third line, for the NAME: each plugin exports the type of its API (`TableApi`…), for
// an integrator who wants to hold it in a variable. `Same<…>` holds that export to what the
// registry carries — a name that resolved to another type would be a second, drifting API.
//
// ⚠️ The list is the one `plugin-namespace-declared.guard.test.js` derives from the plugins'
// entries, and that guard reads this file: a namespace mounted and missing here is red there.
type _Namespace = NonNullable<typeof GeoLeaf>;
type Typed<K extends string> = unknown extends GeoLeafPluginApi<K> ? never : true;
declare const _mounted: _Namespace;
const _cogTyped: Typed<"COG"> = true;
const _cogNamed: Same<import("@geoleaf-plugins/cog").CogApi, GeoLeafPluginApi<"COG">> = true;
// @ts-expect-error — `GeoLeaf.COG` is its plugin's API, not a bag
_mounted.COG?.memberNoPluginHas;
const _connectorTyped: Typed<"Connector"> = true;
const _connectorNamed: Same<
    import("@geoleaf-plugins/connector").ConnectorApi,
    GeoLeafPluginApi<"Connector">
> = true;
// @ts-expect-error — `GeoLeaf.Connector` is its plugin's API, not a bag
_mounted.Connector?.memberNoPluginHas;
const _editorTyped: Typed<"Editor"> = true;
const _editorNamed: Same<
    import("@geoleaf-plugins/editor").EditorApi,
    GeoLeafPluginApi<"Editor">
> = true;
// @ts-expect-error — `GeoLeaf.Editor` is its plugin's API, not a bag
_mounted.Editor?.memberNoPluginHas;
const _fileImportTyped: Typed<"FileImport"> = true;
const _fileImportNamed: Same<
    import("@geoleaf-plugins/file-import").FileImportApi,
    GeoLeafPluginApi<"FileImport">
> = true;
// @ts-expect-error — `GeoLeaf.FileImport` is its plugin's API, not a bag
_mounted.FileImport?.memberNoPluginHas;
const _flatGeobufTyped: Typed<"FlatGeobuf"> = true;
const _flatGeobufNamed: Same<
    import("@geoleaf-plugins/flatgeobuf").FlatGeobufApi,
    GeoLeafPluginApi<"FlatGeobuf">
> = true;
// @ts-expect-error — `GeoLeaf.FlatGeobuf` is its plugin's API, not a bag
_mounted.FlatGeobuf?.memberNoPluginHas;
const _geocodingTyped: Typed<"Geocoding"> = true;
const _geocodingNamed: Same<
    import("@geoleaf-plugins/geocoding").GeocodingApi,
    GeoLeafPluginApi<"Geocoding">
> = true;
// @ts-expect-error — `GeoLeaf.Geocoding` is its plugin's API, not a bag
_mounted.Geocoding?.memberNoPluginHas;
const _measureTyped: Typed<"Measure"> = true;
const _measureNamed: Same<
    import("@geoleaf-plugins/measure").MeasureApi,
    GeoLeafPluginApi<"Measure">
> = true;
// @ts-expect-error — `GeoLeaf.Measure` is its plugin's API, not a bag
_mounted.Measure?.memberNoPluginHas;
const _navigationTyped: Typed<"Navigation"> = true;
const _navigationNamed: Same<
    import("@geoleaf-plugins/navigation").NavigationApi,
    GeoLeafPluginApi<"Navigation">
> = true;
// @ts-expect-error — `GeoLeaf.Navigation` is its plugin's API, not a bag
_mounted.Navigation?.memberNoPluginHas;
const _positionShareTyped: Typed<"PositionShare"> = true;
const _positionShareNamed: Same<
    import("@geoleaf-plugins/position-share").PositionShareApi,
    GeoLeafPluginApi<"PositionShare">
> = true;
// @ts-expect-error — `GeoLeaf.PositionShare` is its plugin's API, not a bag
_mounted.PositionShare?.memberNoPluginHas;
const _printTyped: Typed<"Print"> = true;
const _printNamed: Same<
    import("@geoleaf-plugins/print").PrintApi,
    GeoLeafPluginApi<"Print">
> = true;
// @ts-expect-error — `GeoLeaf.Print` is its plugin's API, not a bag
_mounted.Print?.memberNoPluginHas;
const _realtimeLayerTyped: Typed<"RealtimeLayer"> = true;
const _realtimeLayerNamed: Same<
    import("@geoleaf-plugins/realtime-layer").RealtimeLayerApi,
    GeoLeafPluginApi<"RealtimeLayer">
> = true;
// @ts-expect-error — `GeoLeaf.RealtimeLayer` is its plugin's API, not a bag
_mounted.RealtimeLayer?.memberNoPluginHas;
const _routingTyped: Typed<"Routing"> = true;
const _routingNamed: Same<
    import("@geoleaf-plugins/routing").RoutingApi,
    GeoLeafPluginApi<"Routing">
> = true;
// @ts-expect-error — `GeoLeaf.Routing` is its plugin's API, not a bag
_mounted.Routing?.memberNoPluginHas;
const _tableTyped: Typed<"Table"> = true;
const _tableNamed: Same<
    import("@geoleaf-plugins/table").TableApi,
    GeoLeafPluginApi<"Table">
> = true;
// @ts-expect-error — `GeoLeaf.Table` is its plugin's API, not a bag
_mounted.Table?.memberNoPluginHas;
const _wsTyped: Typed<"Ws"> = true;
const _wsNamed: Same<import("@geoleaf-plugins/websocket").WsApi, GeoLeafPluginApi<"Ws">> = true;
// @ts-expect-error — `GeoLeaf.Ws` is its plugin's API, not a bag
_mounted.Ws?.memberNoPluginHas;

// ── A namespace the core does not know ─────────────────────────────────────────────────
//
// The registry above serves the namespaces the core DECLARES. A plugin written outside this
// repository mounts one the core has never heard of: it adds the member itself, and that is
// allowed precisely because the name is new — redeclaring an existing one is TS2717. This is
// the recipe `PLUGIN_DEVELOPMENT_GUIDE.md` gives; it is compiled here so that the guide
// cannot teach something the published types refuse.
declare global {
    interface GeoLeafGlobal {
        /** The namespace of a plugin this repository does not ship. */
        ThirdPartyProbe?: { greet(name: string): string };
    }
}
const _thirdPartyGreeting: string | undefined = _mounted.ThirdPartyProbe?.greet("world");
// @ts-expect-error — typed by the augmentation, so a wrong argument is refused
_mounted.ThirdPartyProbe?.greet(42);

// ── The package's front door ──────────────────────────────────────────────────────────────
//
// `import GeoLeaf from "@geoleaf/core"` is what every guide teaches, and the default export
// was typed `unknown`: the import compiled, its first dereference did not. It is the ambient
// namespace's own type now — and `ensureGeoLeaf()` is exported, for a module that must mount
// a member on the namespace.
type _Core = typeof import("@geoleaf/core");
/** `true` only when `A` and `B` are the same type — `unknown` is not "the same" as anything else. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _defaultIsTheNamespace: Same<_Core["default"], _Namespace> = true;
const _ensureReturnsTheNamespace: Same<ReturnType<_Core["ensureGeoLeaf"]>, _Namespace> = true;

// ── A plugin's namespace, typed by the plugin ──────────────────────────────────────────────
//
// The core declares the plugin namespaces, and cannot type them: it never imports a plugin.
// `GeoLeafPluginApis` is the registry a plugin's own types augment; a namespace nobody
// augmented stays `unknown`. Held on two keys no plugin owns, so the witness does not depend
// on which plugins this project resolves.
declare global {
    interface GeoLeafPluginApis {
        __witnessAugmented: { ping(): void };
    }
}
const _augmentedIsTyped: Same<GeoLeafPluginApi<"__witnessAugmented">, { ping(): void }> = true;
const _absentIsUnknown: Same<GeoLeafPluginApi<"__witnessAbsent">, unknown> = true;
// And a declared namespace reads the registry: `GeoLeaf.Table` is that very type.
const _tableReadsTheRegistry: Same<_Namespace["Table"], GeoLeafPluginApi<"Table"> | undefined> =
    true;

void [
    _defaultIsTheNamespace,
    _ensureReturnsTheNamespace,
    _augmentedIsTyped,
    _absentIsUnknown,
    _tableReadsTheRegistry,
];

// `export {}` keeps this a module (and keeps the names off any global scope).
export {};
