/**
 * Side-effect CSS imports (S6).
 *
 * `import "./css/legend.css";` inside `capabilities/legend/install.ts` is what makes the CSS
 * tree-shakeable **at the same time as the capability**: the stylesheet is a node of the JS module
 * graph, so an entry that never imports `LEGEND_INSTALLER` never pulls the legend's CSS either.
 * Before S6 the CSS was produced by a PostCSS pipeline running entirely parallel to the module
 * graph (`postcss src/css/geoleaf-main.css -o …`), which is why no amount of file-moving could
 * have made it tree-shakeable — nothing linked a stylesheet to the code that needed it.
 *
 * The import yields no value; it exists for its effect. Rollup resolves it through
 * `rollup-plugin-postcss`, differently per delivery channel — see rollup.config.mjs:
 *   - the CDN bundle EXTRACTS to `dist/geoleaf-main.min.css` (a real file, served by `<link>`);
 *   - `dist/esm/` INJECTS through `adoptedStyleSheets` (CSP-safe under `style-src 'self'`).
 */
declare module "*.css";
