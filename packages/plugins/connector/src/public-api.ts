/*!
 * GeoLeaf Connector — Public API
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * The plugin's public surface, mounted on `GeoLeaf.Connector`.
 *
 *
 * ## Why this file exists
 *
 * This is not cosmetic uniformity. `scripts/check-facade-purity.cjs`
 * (INV-FACADE) enumerates the facades to check **by file existence**: it
 * sweeps every package carrying a `src/public-api.ts`, and those without one
 * escape it entirely. The connector mounted its namespace through an object
 * literal in `entry.ts` — hence outside the gate's field — as did, at the
 * time of that finding, two other packages since removed or renamed. The list
 * of escapees is not what matters, the CRITERION is: without
 * `src/public-api.ts`, a package does not enter the check.
 *
 * Creating this file is what brings the package into the check. Nothing to
 * add to the script: its only list is the file system, which is what makes it
 * incorruptible.
 *
 * ## The grammar, and why `openLoginModal`'s body is not here
 *
 * The gate only accepts a **thin delegate**: a shortcut to an imported
 * symbol, or a method whose body is ONE forwarding call. `openLoginModal`
 * carries an `if` and a `throw` — two statements — so its body lives in
 * `connector-api.ts`, with the state it reads. This file only names the surface.
 *
 * ⚠️ `buildPublicApi` must stay this file's ONLY local function: the gate
 * rejects any other declaration.
 */

import { configure, openLoginModal } from "./connector-api.js";

/** @internal Returns the plugin's public surface, in the shape mounted on the namespace. */
export function buildPublicApi() {
    return { configure, openLoginModal };
}
