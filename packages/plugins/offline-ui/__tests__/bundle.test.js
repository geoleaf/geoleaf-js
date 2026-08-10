/**
 * Bundle validation — @geoleaf-plugins/offline-ui (post-build).
 *
 * Reads dist/geoleaf-offline-ui.plugin.js, so it requires a prior build. Excluded from the regular
 * vitest.config.ts for exactly that reason — run via `npm run test:bundle -w @geoleaf-plugins/offline-ui`
 * (vitest.bundle.config.ts), which CI runs after `turbo run build`.
 *
 * These assertions used to live in packages/core/__tests__/bundle.test.js, where they read a COPY
 * of this plugin built by two extra configs inside the core's rollup.config.mjs. That copy was
 * consumed by nobody (build-deploy.cjs copies the artefact below), shipped ~660 KB of plugin code
 * inside the public @geoleaf/core npm package, and was built with the CSP-violating `styleInject`.
 * The configs are gone. The assertions belong here — against the artefact that actually ships.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE = path.join(__dirname, "..", "dist", "geoleaf-offline-ui.plugin.js");

describe("Bundle Storage (dist/geoleaf-offline-ui.plugin.js)", () => {
    let content;

    beforeAll(() => {
        if (fs.existsSync(BUNDLE)) content = fs.readFileSync(BUNDLE, "utf8");
    });

    test("le bundle existe", () => {
        expect(fs.existsSync(BUNDLE)).toBe(true);
    });

    test("le bundle n'est pas vide (> 10 KB)", () => {
        expect(fs.statSync(BUNDLE).size).toBeGreaterThan(10 * 1024);
    });

    // Storage is a THIN UI plugin since S14 phase B: the IndexedDB engine moved into the core
    // (`src/capabilities/offline/`, behind a dynamic import()), and this package's src/ does not
    // contain a single `indexedDB` reference any more. Pin the boundary — the plugin carries the
    // UI, the core carries the engine.
    test("est la couche UI mince (CacheButton), PAS le moteur IndexedDB", () => {
        expect(content).toContain("CacheButton");
        expect(content).not.toContain("createObjectStore");
        expect(content).not.toContain("onupgradeneeded");
    });

    // CSP gate (B.7) — the strict `style-src 'self'` blocks a `<style>` element, but not a
    // constructable stylesheet. The plugin builds with `inject: cspStyleInject`, so the bundle
    // must reach the DOM through `adoptedStyleSheets` and never build a <style> node.
    //
    // Asserted on markers that survive minification: `createElement("style")` is a string literal
    // and `adoptedStyleSheets` a property name. Grepping for the helper's *function name*
    // (`styleInject`) would silently pass the day the bundle gets minified and it is mangled.
    test("injecte le CSS via adoptedStyleSheets, jamais via un <style> (CSP style-src 'self')", () => {
        expect(content).toContain("adoptedStyleSheets");
        expect(content).not.toMatch(/createElement\((["'])style\1\)/);
    });

    // Logger gate (CAPACITÉS S1) — ARCHI S7 established that a single deep import into a
    // core module that itself imports `Log` drags the WHOLE logger into this bundle, and
    // that there is no intermediate step: the markers only drop when the LAST such import
    // goes. S7 left two (`cache/calculator.js`, `config/profile-layers.js`); S1 removed
    // both — 270.45 → 253.41 KiB. That measurement was manual and nothing pinned it, so a
    // future deep import could silently bring the logger back. This is the pin.
    //
    // Asserted on method names of the core logger object, which survive minification
    // (property names are not mangled) — same rationale as the CSP markers above.
    test("n'embarque pas le logger du core (deep import porteur de Log)", () => {
        for (const marker of ["setQuietMode", "getLevelName", "showSummary"]) {
            expect(content).not.toContain(marker);
        }
    });
});
