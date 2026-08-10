/**
 * Vitest configuration for @geoleaf-plugins/file-import
 */
import { packageConfig } from "@geoleaf/build-config/vitest/base.mjs";

export default packageConfig({
    configUrl: import.meta.url,
    name: "@geoleaf-plugins/file-import",
    coverageExclude: ["src/**/*.d.ts"],
});
