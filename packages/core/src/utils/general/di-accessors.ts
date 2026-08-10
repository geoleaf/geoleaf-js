/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview Late-bound accessor for the shared logger.
 *
 * @remarks
 * Extracted from `general-utils.ts` at KERNEL S10. `getLog` is not a utility —
 * it is a dependency accessor, and living in a grab-bag meant its 20 consumers
 * transitively pulled the whole utility surface (including the
 * `geoleaf.core.js` facade and the security module) just to reach a logger.
 * This module deliberately imports nothing but `Log`.
 *
 * `getActiveProfile` stayed behind: it has no direct importer, so moving it
 * bought nothing and forced every `di-accessors` mock to stub it as well.
 *
 * Note that direct `import { Log } from "../log/index.js"` is the dominant
 * pattern in this codebase (103 modules against 20 for `getLog()`); the
 * indirection here is retained for compatibility, not recommended for new code.
 *
 * **KERNEL S11 — inlining evaluated and rejected. Do not reopen without new facts.**
 * The 103/20 ratio was re-measured and holds. Removing `getLog()` would mean touching
 * 20 production modules and 22 test files that mock this path, and would drop
 * `GeoLeaf.Utils.getLog` — a global that is published at runtime but carries no published
 * declaration, so the breakage would surface only at runtime. Against that: no measured gain, since the
 * decoupling this module was created for is real. The S10 note about mocks failing
 * *silently* no longer applies either — the 22 mocks now target `di-accessors.js`
 * directly, so deleting it would fail loudly at module resolution.
 */

import { Log } from "../log/index.js";

/**
 * Return the shared logger instance.
 *
 * @returns The `Log` singleton.
 */
export function getLog(): typeof Log {
    return Log;
}
