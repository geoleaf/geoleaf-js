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
});
