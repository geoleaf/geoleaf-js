/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Barrel — Log module public API
 */

export { Log } from "./logger.js";
// Types LogLevelName, LogImplInterface: import from './logger.js' (avoid export type for Rollup compatibility when consumed by plugins)

// `ErrorLogger` joined this directory (ex-`utils/general/error-logger.ts`), next
// to `logger.ts`, its only dependency. It is DELIBERATELY NOT on this barrel,
// against the initial intent — a measurement reversed the decision: **151 test
// files mock this barrel**, and a `vi.mock` must declare every export the module
// under test takes from it. Listing it would tax 151 files with a stub, for the
// benefit of **one real importer** (`utils/general/utils-namespace.ts`, which
// composes `GeoLeaf.Utils.ErrorLogger`).
//
// This is not a workaround of the barrel-mediation motive: that motive holds for
// `Log`, which 117 files take HERE. A single-importer export is not mediation.
// The same asymmetry is already documented the other way in the spec — "before
// concluding a barrel is dead, check WHO imports it: a single importer can be the
// expected outcome". Side benefit: `error-logger.ts` keeps its `Log` through this
// barrel, so existing mocks keep intercepting it, and no cycle forms.
