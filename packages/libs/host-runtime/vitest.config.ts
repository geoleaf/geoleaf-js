/**
 * Vitest configuration for @geoleaf/host-runtime
 *
 * Mirrors packages/http-helpers/vitest.config.ts:
 * - resolveJsToTs plugin: .js imports in source → resolved to .ts at test time
 * - vmForks pool: isolated VM context per test file
 * - globals: true — describe/it/expect/vi available without imports
 *
 * Environment stays "node" as the package DEFAULT, deliberately: the namespace accessors
 * take no DOM, and host.test.ts relies on `window` being genuinely absent to reach
 * getGeoLeaf's second lookup — a happy-dom default would mask that arm.
 *
 * The ui/ modules added at PLUGINS S1 do need a DOM. Their suites opt in with a per-file
 * environment docblock (the idiom already used in core and connector) rather than
 * flipping the default, so the node-only suites keep their conditions.
 *
 * ⚠️ Do not spell that annotation out here: knip scans this file for it and would try to
 * resolve a `vitest-environment-<name>` package that does not exist. It fails the
 * dead-code gate, not the test run — so it only shows up in ci:local.
 */
import { packageConfig } from "@geoleaf/build-config/vitest/base.mjs";

export default packageConfig({
    configUrl: import.meta.url,
    name: "@geoleaf/host-runtime",
    environment: "node",
    coverageExclude: [
        "src/**/*.d.ts",
        // Carried over verbatim from plugin-editor and plugin-measure at PLUGINS S1,
        // which both excluded their own copy with this motive:
        // "S3 touch/tooltip UI: DOM event-driven, requires real browser interaction".
        // Only the touch half is excluded — the geometry it uses lives in ui/drag.ts
        // and IS covered there, as is the mouse path and the tooltips.
        "src/ui/touch-drag.ts",
    ],
});
