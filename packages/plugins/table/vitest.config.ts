/**
 * Vitest configuration for @geoleaf-plugins/table
 */
import { packageConfig } from "@geoleaf/build-config/vitest/base.mjs";

export default packageConfig({
    configUrl: import.meta.url,
    name: "@geoleaf-plugins/table",
    // entry/public-api are thin façades; lang/* are i18n data dictionaries;
    // __tests__/* are the test files and helpers themselves.
    coverageExclude: ["src/entry.ts", "src/public-api.ts", "src/lang/**", "src/__tests__/**"],
    // Four suites of this package import the module under test dynamically in a `beforeAll`,
    // after their `vi.doMock` calls. Under coverage that import is instrumented on the fly,
    // and on a loaded 4-core runner it took more than the 10 s a hook is given by default: the
    // hook timed out, the whole file was skipped, and the run turned red on a commit that
    // touched no line of this package. The bound stays — a hook that hangs must still fail —
    // but it is the bound of an import, not of an assertion.
    test: { hookTimeout: 60_000 },
});
