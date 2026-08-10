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
 * ⚠ `addpoi` et `storage` étaient absents ON PURPOSE jusqu'à l'API publique S4.4c : ils ne
 * publiaient aucune déclaration, faute de pouvoir porter un `rootDir` — leurs tsconfig
 * compilaient les SOURCES du core. Cette dette est payée : les deux n'ont plus aucun import
 * `@core/*` et émettent 34 et 36 déclarations, **0 du core**. Ils sont donc ici, et les 13
 * plugins sont désormais tous asservis par le compilateur.
 */

// ── Libraries (packages/libs/) ───────────────────────────────────────────────────────────────
type _FieldRenderer = typeof import("@geoleaf/field-renderer");
type _HostRuntime = typeof import("@geoleaf/host-runtime");

// ── Plugins (packages/plugins/) — les 12, tous typés depuis l'API S4.4c ──────────────────────
// ⚠️ 5.1-f — `@geoleaf-plugins/addpoi` a fusionné dans `editor` : 13 → 12.
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

// The aliases above are the assertion: TypeScript must resolve each specifier to a declaration
// file to give them a type. `export {}` keeps this a module (and keeps the names off any global
// scope) without emitting a single byte.
export {};
