// @ts-check
// E2E Playwright — deploy variants (e2e/)

import { defineConfig, devices } from "@playwright/test";
import { launchOptions } from "./e2e/helpers/launch-options.js";
import { baseURL, isNginxTarget, hostResolverArgs } from "./e2e/helpers/base-url.js";
import { e2eWorkers } from "./e2e/helpers/worker-budget.js";

export default defineConfig({
    // Deploy variants only (e2e/)
    testDir: ".",
    testMatch: ["e2e/**/*.spec.js"],
    // Never scan Claude Code worktree copies (.claude/worktrees/*) — they carry
    // their own node_modules and duplicate every spec, which crashes the loader
    // ("Requiring @playwright/test second time").
    testIgnore: ["**/.claude/**"],

    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    // Derived from the host rather than pinned, on the pattern this repository already
    // applies to Vitest (`packages/build-config/vitest/worker-budget.mjs`). The motive lives
    // in `e2e/helpers/worker-budget.js`, with the measurement that supports it — and the
    // point of deriving is precisely that the motive can no longer be a value nobody wrote
    // down: a constant imposes the slowest machine's answer on every machine.
    //
    // ⚠️ This line read `workers: 1` with nothing beside it. What justified the 1 was assumed
    // to be shared browser state; measured, service workers, Cache Storage and IndexedDB are
    // per BrowserContext and therefore isolated between workers by construction. The only
    // genuinely shared resource is the backend, and the helper REFUSES a parallel run while
    // its bindings are present rather than leaving the collision to chance.
    workers: e2eWorkers(),
    // EXPLICIT paths. Two defects, both closed here:
    //   1. `playwright.coverage.config.js` declared the SAME `outputFolder` as
    //      this file: running the coverage variant after the full suite silently
    //      overwrote its report. That config was DELETED in the same commit (its
    //      `testMatch` was a strict subset of this one's, and spec 07 sets its
    //      own `baseURL`) — the collision resolves by subtraction.
    //   2. no `outputDir` was declared, so results fell into Playwright's default
    //      `test-results/` — namesake of the Vitest reporter's
    //      `test-results.json` FILE (ci.yml:112, read by
    //      check-test-failures.cjs), which is unrelated and does not move.
    //
    // ⚠️ `outputDir` and `outputFolder` must stay SIBLINGS, never nested: the
    // HTML reporter empties its folder before generating and Playwright refuses
    // the configuration if one contains the other.
    outputDir: "artifacts/playwright/results",
    reporter: [
        // ⚠️ `open: 'never'` — the `'on-failure'` default STARTS an HTTP server to
        // serve the report, which is forbidden in a session. Pre-existing risk,
        // closed here.
        ["html", { outputFolder: "artifacts/playwright/report", open: "never" }],
        ["list"],
    ],
    timeout: 60 * 1000,

    use: {
        // Default baseURL: deploy-core (port 8766, or its nginx vhost under E2E_TARGET=nginx)
        baseURL: baseURL("core"),
        trace: "on-first-retry",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
        viewport: { width: 1280, height: 720 },
        ignoreHTTPSErrors: true,
        // ⚠️ 30 s, and NOT 10 s — raised on 2026-08-01. CI run 30703087739
        // produced 5 `locator.click: Timeout 10000ms` (4 counted failed, 1 flaky
        // as it passed on retry) that no local run ever saw. `retries: 2` being
        // active in CI, each of the 4 failed THREE times: these are not flakes.
        // Their call log is explicit, and it says the opposite of what a quick
        // read suggests:
        //
        //     - element is visible, enabled and stable      ← stability PASSES
        //     - scrolling into view if needed / done scrolling
        //     - performing click action                     ← IT BLOCKS HERE
        //
        // So neither an unstable element nor an overlay: it is the event
        // DISPATCH whose ack the renderer does not return, because its main
        // thread is busy. The action budget measures an ack latency, not an
        // animation duration.
        //
        // Measurement of the same action (`.gl-emprise-ok`) degrading this
        // machine toward the runner:
        //
        //     24 cores, CPU throttle ×8   → 1,887 ms
        //      2 cores, no throttle       → 4,641 ms
        //      2 cores + throttle ×4      → 8,093 ms   ← 81 % of the budget, on a
        //                                                machine LESS degraded
        //                                                than the runner
        //
        // ⚠️ The factor that counts is the CORE COUNT, not
        // `setCPUThrottlingRate`: the latter only throttles the JS thread, while
        // SwiftShader rasterises in parallel. A throttle-only repro stays
        // optimistic — `taskset -c 0,1` is needed. (`E2E_HW_GL` undefined here ⇒
        // this machine ALREADY runs under SwiftShader like CI; GL is not the
        // variable, unlike the perf-baseline.)
        //
        // The value is aligned on `navigationTimeout`: both wait on the same
        // thread.
        actionTimeout: 30 * 1000,
        navigationTimeout: 30 * 1000,
        // Force software WebGL on GPU-less hosts (CI/WSL); opt out with E2E_HW_GL=1.
        // `hostResolverArgs` is empty on the default target — spreading it is a no-op there.
        launchOptions: {
            ...launchOptions,
            args: [...(launchOptions.args || []), ...hostResolverArgs],
        },
    },

    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
            // 🛑 A PROJECT-level `testIgnore` OVERWRITES the config-level one — it
            // does NOT add to it (`playwright/lib/common/index.js`, `takeFirst`).
            // The `**/.claude/**` of line 15 thus vanishes for this project as
            // soon as the key is declared here, and the worktree copies return
            // with the double-load crash the comment above describes. It is
            // COPIED, not a redundancy.
            testIgnore: ["**/.claude/**", "e2e/**/*.touch.spec.js"],
        },
        {
            // Two mobile defects the synthetic mouse cannot see, by construction
            // and not by accident:
            //   · editor  — at the 1st tap, Terra Draw lays a LineString [c, c]
            //     and NOTHING else. On desktop the hover moves the 2nd vertex and
            //     masks the defect; with a finger there is no hover.
            //   · measure — `createDragTool` filters on
            //     `originalEvent.button !== 0`, which a TouchEvent cannot
            //     satisfy.
            //
            // ⚠️ This project does NOT REPLAY the suite by finger: `testMatch`
            // bounds it to the specs written for it. A tag `grep:` would have
            // LOADED the 40+ files to keep only two.
            //
            // ⚠️ The touch specs stay FLAT in `e2e/` — hence the suffix rather
            // than a subdirectory. `scripts/check-e2e-wait-signature.cjs` reads
            // `e2e/` through a NON-RECURSIVE `readdirSync`: an `e2e/touch/` would
            // escape the gate IN SILENCE.
            name: "chromium-touch",
            testMatch: ["e2e/**/*.touch.spec.js"],
            testIgnore: ["**/.claude/**"],
            use: {
                ...devices["Desktop Chrome"],
                // Both plugins' niche is mobile, and 390×844 is the value already
                // retained by `09-editor.spec.js`.
                viewport: { width: 390, height: 844 },
                hasTouch: true,
                // Safe here, and verified rather than assumed: `isMobile` makes
                // the `<meta name="viewport">` count, which both served variants
                // do declare as `width=device-width`. Without that meta, Chromium
                // would fall back to 980 CSS px and the mobile layout would NOT
                // be exercised.
                isMobile: true,
                // ⚠️ Do NOT take `devices["Pixel 7"]` wholesale: it carries a
                // `deviceScaleFactor: 2.625` — which triples the surface to
                // rasterise under the `launchOptions`' software SwiftShader — and
                // an Android UA, yet product code already branches on the UA
                // (cf. `23-pwa-install-banner.spec.js`).
                deviceScaleFactor: 1,
            },
        },
    ],

    // Auto-start servers, one per deploy variant under test (5.5 — 3, not 4):
    //   8766 deploy-core · 8768 deploy-full · 8769 deploy-coverage
    // 8769 is a distinct axis (instrumented copy of deploy-core, built by
    // build-deploy-coverage.cjs), not a plugin variant. 8767 was retired with deploy-storage.
    //
    // ⚠️ EMPTY UNDER E2E_TARGET=nginx, and that is the whole point of the target: the four
    // deploy folders are already served by the persistent dev nginx (docker-compose.dev.yml),
    // so the suite runs WITHOUT STARTING ANY SERVER. Do not "simplify" this ternary away —
    // it is the property that makes the suite runnable in a Claude Code session at all.
    webServer: isNginxTarget
        ? []
        : [
              {
                  command:
                      "node node_modules/http-server/bin/http-server deploy/deploy-core -p 8766 -c0 --cors",
                  url: "http://localhost:8766",
                  reuseExistingServer: !process.env.CI,
                  timeout: 60 * 1000,
                  stdout: "pipe",
                  stderr: "pipe",
              },
              // ARCHI S8 — 8767 (deploy-storage) is gone: storage now ships in BOTH gated variants,
              // so a storage-only deploy tested nothing the others did not. Its 2 specs moved to 8768.
              {
                  command:
                      "node node_modules/http-server/bin/http-server deploy/deploy-full -p 8768 -c0 --cors",
                  url: "http://localhost:8768",
                  reuseExistingServer: !process.env.CI,
                  timeout: 60 * 1000,
                  stdout: "pipe",
                  stderr: "pipe",
              },
              {
                  command:
                      "node node_modules/http-server/bin/http-server deploy/deploy-coverage -p 8769 -c0 --cors",
                  url: "http://localhost:8769",
                  reuseExistingServer: !process.env.CI,
                  timeout: 60 * 1000,
                  stdout: "pipe",
                  stderr: "pipe",
              },
          ],
});
