// Ambient declaration for side-effect CSS imports (bundled by rollup-plugin-postcss).
// Required since TypeScript 6.0, which rejects untyped side-effect imports (TS2882).
declare module "*.css";
