/**
 * Vitest configuration for @geoleaf-plugins/geocoding
 */
import { packageConfig } from "@geoleaf/build-config/vitest/base.mjs";

export default packageConfig({
    configUrl: import.meta.url,
    name: "@geoleaf-plugins/geocoding",
    coverageExclude: ["src/entry.ts", "src/public-api.ts"],
});
