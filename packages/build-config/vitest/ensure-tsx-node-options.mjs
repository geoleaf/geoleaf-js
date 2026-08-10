/**
 * Shared side-effect module — ensure `--import tsx` in NODE_OPTIONS.
 *
 * Vitest 4 rewrote its pools (no tinypool), and at the time this module was written
 * it did not reliably load tsx via per-project `poolOptions.forks.execArgv` for
 * forked workers. Setting NODE_OPTIONS at config-load time propagates tsx to every
 * worker regardless of how the config is invoked (root `projects` run OR a
 * standalone `--config package/vitest.config.ts` run).
 *
 * ⚠️ The rest of that original rationale did NOT survive measurement — see the
 * "Measured 24/07/2026" section below before reasoning from it. In particular the
 * `ERR_MODULE_NOT_FOUND` on the `.js` → `.ts` convention it used to claim is not
 * what happens: Vite's `resolveJsToTs` plugin handles that case.
 *
 * ## Why this file is .mjs and not .ts — ARCHI S9.3
 *
 * A robustness choice, NOT a hard constraint. The claim it replaces ("Vite
 * externalises bare specifiers, so a `.ts` here throws ERR_UNKNOWN_FILE_EXTENSION")
 * was tested and is FALSE in this setup: a `.ts` module under build-config,
 * imported by npm specifier from a `vitest.config.ts`, loads fine — including with
 * NODE_OPTIONS explicitly cleared. Vitest transpiles the config graph with its own
 * esbuild-based loader.
 *
 * `.mjs` is kept anyway, for reasons that do not depend on that behaviour:
 *
 *  - This module's entire purpose is to install the loader that would be needed to
 *    read it. Depending on a transpiler to load the thing that installs the
 *    transpiler is a circularity worth refusing on principle, even where it
 *    currently happens to work.
 *  - Vitest's config-loading behaviour is an implementation detail, not a contract;
 *    it already changed between v3 and v4 (this module exists because of one such
 *    change).
 *  - Plain `.mjs` also loads from a non-Vite context — a bare node script, a gate —
 *    with no toolchain at all.
 *
 * Keep new files here `.mjs` and type them in JSDoc. If that ever becomes costly,
 * revisit it as a decision, not as an inherited prohibition.
 *
 * ## Ordering
 *
 * `base.mjs` imports this module, and so does each leaf config (core, addpoi,
 * storage, `_plugin-template`, `vitest.bundle.config.ts`) — belt and braces. A
 * static ESM import is fully evaluated before the importing module's body runs,
 * so the side effect lands before Vitest spawns anything either way.
 *
 * ## Measured 24/07/2026 — what actually depends on tsx (backlog R.22)
 *
 * R.22 asked whether build-config can stop loading tsx, on the premise that it
 * exists to serve `require()` calls on `.ts` files and that the S5 conversion
 * removed the last of them. Both halves of that premise are wrong, and so was
 * the reason stated above this block. Measured by neutralising each channel and
 * running the full core suite (420 files, 8475 tests):
 *
 *   • **NODE_OPTIONS alone neutralised → 420/420 files pass.** This module's own
 *     side effect is currently INERT: `poolOptions.forks.execArgv` carries tsx on
 *     its own in the Vitest version in use. It is kept as the belt to that
 *     braces — the v3→v4 change that created this module is exactly the kind of
 *     thing that recurs — but it is not what holds the suite up today.
 *   • **Both channels neutralised → 6 files / 48 tests FAIL.** So tsx is still
 *     required. R.22 closes on "no, it cannot be removed".
 *   • **The failure is not `ERR_MODULE_NOT_FOUND` on the `.js` → `.ts`
 *     convention** described above — Vite's `resolveJsToTs` plugin covers that.
 *     It is `ReferenceError: module is not defined in ES module scope`, thrown by
 *     CJS `.js` files living in a `"type": "module"` package, which only tsx's
 *     transpilation accepts.
 *     (`__mocks__/maplibre-gl.cjs` is fine — it says `.cjs`.)
 *
 * ── STRUCT S7 (26/07/2026) — the list went from seven files to three ──
 * Four of the seven were deleted or relocated as a side effect of realigning the
 * test mirror, none of it aimed at tsx:
 *   • `__tests__/helpers/cjs-bridge.js`         — deleted (0 consumers, @deprecated
 *                                                 since Sprint 4B, said so itself)
 *   • `__tests__/app/__mocks__/globals-app.js`  — deleted (0 consumers)
 *   • `__tests__/entry/__mocks__/empty.js`      — deleted, byte-equivalent to
 *                                                 `__mocks__/empty-module.js`
 *   • `__tests__/entry/__mocks__/esm-exports.js`— deleted (stubbed POI and Route,
 *                                                 dissolved at S9 and S11)
 * The three that remain, all still CJS in an ESM package:
 *       `__tests__/_helpers/dom-create-double.js`  (moved from `helpers/`),
 *       `__tests__/__mocks__/empty-module.js`, `__tests__/__mocks__/indexeddb.js`.
 *
 * ⚠️ The "6 files / 48 tests FAIL" figure above was measured against SEVEN blockers.
 * It has NOT been re-measured against three, so R.22's verdict — "no, tsx cannot be
 * removed" — is now standing on a premise that no longer holds. Do not read this
 * note as saying tsx can go: read it as saying the question is open again and the
 * measurement is cheap. Converting the last three to ESM (or renaming them `.cjs`)
 * remains the prerequisite, and it is the same rule CLAUDE.md enforces on the two
 * plugins. Until someone re-runs the neutralisation, this stays.
 */
if (!process.env.NODE_OPTIONS?.includes("--import tsx")) {
    process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS || "", "--import tsx"]
        .filter(Boolean)
        .join(" ");
}
