/**
 * Vitest configuration for @geoleaf-plugins/navigation
 *
 * 🛑 **THIS FILE GOES THROUGH `packageConfig()`, AND IT MUST STAY THERE.**
 *
 * A scaffold is **the first thing an external developer copies**. If it
 * diverges, it does not produce a bug: it produces **divergent third-party
 * plugins**, and the gap surfaces at their end — the external developer's
 * journey starts here.
 *
 * ⚠️ **And nothing guards this file.** `packages/_plugin-template/` is
 * **outside the workspaces** (`!packages/_*` in the root `package.json`): no
 * configuration-consistency gate opens it. The only protection is this
 * comment. **Do not remove it while "cleaning up".**
 *
 * ## What the previous version copied by hand, and why that was a trap
 *
 * It rewrote ~45 lines of `defineConfig` instead of calling the shared base.
 * Measured on 17/08/2026, `packageConfig()` (`build-config/vitest/base.mjs`)
 * returns **exactly the same values** for the eleven settings it declared —
 * `environment: "happy-dom"`, `pool: "vmForks"`, `include`, `exclude`,
 * istanbul provider, `reporter`, `reportsDirectory`, the four thresholds at
 * 75, `testTimeout: 10_000`, `reporters: ["verbose"]`. The copy therefore
 * brought **nothing**, and it would have diverged at `base.mjs`'s first evolution.
 *
 * 🛑 **Except on one point, where it was ACTIVELY wrong**: it carried
 * `memoryLimit: "1/2"`. `base.mjs`'s comment says it plainly — that key was
 * **doubly wrong**: the one Vitest 4 reads is `vmMemoryLimit`, and `"1/2"`
 * would have parsed there to **1** anyway, i.e. **100% of RAM**. The base
 * replaces it with `maxWorkers()` and `vmMemoryLimit()`, derived from a
 * single source. **The template thus taught an inoperative setting which, had
 * it been read, would have done the opposite of what it promised.**
 *
 * ## The template's only own setting
 *
 * `coverageExclude` — the entry and the public facade carry no testable
 * logic; excluding them avoids a falsely low coverage floor on a new plugin.
 */

// Side effect: guarantees `--import tsx` in NODE_OPTIONS before the workers start.
// ⚠️ MUST stay the first import — see the ordering note at the top of `base.mjs`.
import "@geoleaf/build-config/vitest/ensure-tsx-node-options.mjs";
import { packageConfig } from "@geoleaf/build-config/vitest/base.mjs";

export default packageConfig({
    configUrl: import.meta.url,
    // ⚠️ `packageConfig` THROWS when `name` is empty (`base.mjs`). The
    // placeholder is truthy, so the template passes as-is — but a
    // `create-plugin` forgetting the substitution would produce a project
    // named `@geoleaf-plugins/navigation`, not an error. Verified on 17/08/2026.
    name: "@geoleaf-plugins/navigation",
    coverageExclude: ["src/entry.ts", "src/public-api.ts"],
});
