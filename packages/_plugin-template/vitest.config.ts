/**
 * Vitest configuration for __PLUGIN_PKG__
 *
 * 🛑 **THIS FILE GOES THROUGH `packageConfig()`, AND IT MUST STAY THAT WAY.**
 *
 * A scaffold is **the first thing an external developer copies**. When it diverges it does
 * not produce a bug: it produces **divergent third-party plugins**, and the gap surfaces on
 * their side — the external developer's path begins here, and this file is its first step.
 *
 * ⚠️ **And nothing guards this file.** `packages/_plugin-template/` sits **outside the
 * workspaces** (`!packages/_*` in the root `package.json`): no configuration-coherence gate
 * ever opens it. This comment is its only protection. **Do not remove it while "cleaning".**
 *
 * ## What the previous version copied by hand, and why that was a trap
 *
 * It rewrote ~45 lines of `defineConfig` instead of calling the shared base. Measured on
 * 17/08/2026: `packageConfig()` (`build-config/vitest/base.mjs`) returns **exactly the same
 * values** for the eleven settings it declared — `environment: "happy-dom"`,
 * `pool: "vmForks"`, `include`, `exclude`, the istanbul provider, `reporter`,
 * `reportsDirectory`, the four thresholds at 75, `testTimeout: 10_000`,
 * `reporters: ["verbose"]`. The copy added **nothing**, and it would have drifted at the
 * first evolution of `base.mjs`.
 *
 * 🛑 **Except on one point, where it was ACTIVELY wrong**: it carried `memoryLimit: "1/2"`.
 * The comment in `base.mjs` says it plainly — that key was **wrong twice over**: the one
 * Vitest 4 reads is `vmMemoryLimit`, and `"1/2"` would have parsed there as **1**, i.e.
 * **100% of RAM**. The base replaces it with `maxWorkers()` and `vmMemoryLimit()`, derived
 * from a single source. **The scaffold was therefore teaching an inert setting which, had
 * it been read, would have done the opposite of what it promised.**
 *
 * ## The only setting specific to the scaffold
 *
 * `coverageExclude` — the entry and the public façade carry no testable logic; excluding
 * them avoids a misleadingly low coverage floor on a fresh plugin.
 */

// Side effect: guarantees `--import tsx` in NODE_OPTIONS before the workers start.
// ⚠️ MUST stay the first import — see the ordering note at the top of `base.mjs`.
import "@geoleaf/build-config/vitest/ensure-tsx-node-options.mjs";
import { packageConfig } from "@geoleaf/build-config/vitest/base.mjs";

export default packageConfig({
    configUrl: import.meta.url,
    // ⚠️ `packageConfig` THROWS when `name` is empty (`base.mjs`). The placeholder is
    // truthy, so the scaffold passes as-is — but a `create-plugin` that skipped the
    // substitution would produce a project named `__PLUGIN_PKG__`, not an error. Verified
    // on 17/08/2026.
    name: "__PLUGIN_PKG__",
    coverageExclude: ["src/entry.ts", "src/public-api.ts"],
});
