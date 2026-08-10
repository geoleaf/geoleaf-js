/*!
 * @geoleaf/host-runtime — CSS module declaration
 * © 2026 Mattieu Pottier — MIT License
 *
 * Required since TS 6.0 (TS2882) for the side-effect `import "./x.css"` form. Same
 * two lines as the nine other packages that ship CSS — `@geoleaf/field-renderer` is the
 * closest precedent (a `libs/` package whose CSS is inlined into each consumer).
 */
declare module "*.css";
