/*!
 * @geoleaf/host-runtime — CSS module declarations
 * © 2026 Mattieu Pottier — MIT License
 *
 * Required since TS 6.0 (TS2882) for a side-effect stylesheet import.
 * https://geoleaf.dev
 */

/*
 * 🛑 TWO PATTERNS, AND THE ORDER BETWEEN THEM CARRIES BEHAVIOUR — the lazy one comes FIRST.
 *
 * Both have the same prefix (empty), so TypeScript breaks the tie on declaration order and keeps
 * the FIRST. Swapped, a default import of a lazy sheet resolves against the self-injecting
 * pattern and stops being a string.
 *
 * ⚠️ The failure is LOUD — TS2345 where the value reaches `adoptStylesheet` — so nothing passes
 * in silence. This note exists so the message reads at first glance rather than after half an
 * hour of wondering why a string is not a string.
 */

/**
 * A `*.lazy.css` sheet is a STRING, and its owner adopts it.
 *
 * The suffix is read by `csp-style-inject.mjs`, which emits no module-scope adoption for it. The
 * module is therefore a pure value export: rollup shakes the stylesheet away together with the
 * code that would have used it, instead of leaving it behind as an unremovable side effect.
 *
 * Measured on 2026-08-27, before the convention existed: nine plugin bundles carried 5.05 KB gz
 * of stylesheet for components that had been tree-shaken out of them.
 */
declare module "*.lazy.css" {
    const css: string;
    export default css;
}

/**
 * A plain `*.css` sheet injects itself, so there is NO value to import from it.
 *
 * ⚠️ An empty body, deliberately, rather than the one-line shorthand. A shorthand ambient module
 * types every import from it as `any`, which does two harms at once: it silently permits a
 * default import on a sheet that has already adopted itself — a double adoption — and it
 * short-circuits the more specific pattern above, so the typed form never applies at all. The
 * empty body says the true thing: this import exists for its effect.
 */
declare module "*.css" {}
