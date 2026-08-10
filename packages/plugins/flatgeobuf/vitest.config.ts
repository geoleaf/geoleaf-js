/**
 * Vitest configuration for @geoleaf-plugins/flatgeobuf
 */
import { packageConfig } from "@geoleaf/build-config/vitest/base.mjs";

export default packageConfig({
    configUrl: import.meta.url,
    name: "@geoleaf-plugins/flatgeobuf",
    coverageExclude: ["src/entry.ts"],
});
