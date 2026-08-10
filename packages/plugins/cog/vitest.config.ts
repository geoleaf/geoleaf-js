/**
 * Vitest configuration for @geoleaf-plugins/cog
 */
import { packageConfig } from "@geoleaf/build-config/vitest/base.mjs";

export default packageConfig({
    configUrl: import.meta.url,
    name: "@geoleaf-plugins/cog",
    coverageExclude: ["src/entry.ts"],
});
