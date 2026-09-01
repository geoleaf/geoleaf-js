// @vitest-environment happy-dom
/*!
 * @geoleaf/host-runtime — the three `.lazy.css` sheets adopt at CALL time
 * © 2026 Mattieu Pottier — MIT License
 *
 * Needs a DOM (`CSSStyleSheet` + `document.adoptedStyleSheets`), hence the per-file
 * environment override.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * ## 🛑 The defect this file exists for, and why nothing else could see it
 *
 * `tooltip`, `modal-shell` and `confirm-dialog` used to carry a module-scope side-effect import of its stylesheet at module
 * scope. The build turns that into an unconditional adoption into
 * `document.adoptedStyleSheets` — **a side effect rollup cannot remove**. The JS was shaken out
 * of every bundle that never called these functions; the stylesheet was not.
 *
 * Measured on 2026-08-27: **nine plugin bundles carried 5.05 KB gz of stylesheet for dialogs
 * that were not in them**, adopted on every page load. Nothing could see it. The bundle-size
 * budget measures what a bundle CONTAINS and cannot know what it should; the dead-CSS gate
 * scans source stylesheets against source class names, and these sheets ARE used — just not by
 * the packages paying for them; and the unit suites all passed, because they exercise the
 * functions that legitimately want the styles.
 *
 * ## 🛑 What this suite does NOT guard — and saying so is the point
 *
 * It guards ONE half: that each seam adopts its sheet at call time, and only once. **It cannot
 * guard the other half**, and pretending otherwise would be worse than not having it. Under
 * vitest the CSS injector never runs — `csp-style-inject.mjs` belongs to the rollup build — so
 * putting a module-scope a module-scope side-effect import of its stylesheet back passes every case below. Verified by
 * mutation on 2026-08-27: the import was restored, and this file stayed green.
 *
 * The half that matters therefore lives where the defect does, in the built bundle:
 * `checkOrphanStylesheets` in `scripts/check-bundle-size.cjs` fails when a bundle carries a
 * host-runtime stylesheet whose seam was tree-shaken away. That one WAS seen red — 8 plugins,
 * exit 1, on the same mutation.
 *
 * ⚠️ And the trap both of them exist for: changing the import from `import "…"` to
 * `import css from "…"` does NOT fix anything. `rollup-plugin-postcss` emits
 * `export default <css>` for every CSS module regardless, and appends the injector all the
 * same. Only the `.lazy.css` suffix stops the injection being emitted.
 */

/** Counts the sheets adopted so far. */
const adopted = (): number => document.adoptedStyleSheets.length;

beforeEach(() => {
    document.adoptedStyleSheets = [];
    vi.resetModules();
});

describe("les feuilles `.lazy.css` n'entrent pas au chargement du module", () => {
    it("🛑 importer `modal-shell` n'adopte RIEN", async () => {
        await import("../ui/modal-shell.js");
        expect(adopted()).toBe(0);
    });

    it("🛑 importer `confirm-dialog` n'adopte RIEN", async () => {
        await import("../ui/confirm-dialog.js");
        expect(adopted()).toBe(0);
    });

    it("🛑 importer `tooltip` n'adopte RIEN", async () => {
        await import("../ui/tooltip.js");
        expect(adopted()).toBe(0);
    });

    it("🛑 importer le BARIL n'adopte rien non plus — c'est par lui que les plugins entrent", async () => {
        // The one that matters in practice: a plugin writes `import { getGeoLeaf } from
        // "@geoleaf/host-runtime"`, and it is the barrel that used to drag three stylesheets in
        // behind it.
        await import("../index.js");
        expect(adopted()).toBe(0);
    });
});

describe("elles entrent au premier APPEL, et une seule fois", () => {
    it("`createModalShell` adopte à l'appel", async () => {
        const { createModalShell } = await import("../ui/modal-shell.js");
        expect(adopted()).toBe(0);
        createModalShell({ fill: () => {} });
        expect(adopted()).toBe(1);
        createModalShell({ fill: () => {} });
        expect(adopted()).toBe(1); // idempotent par clé
    });

    it("`confirmDialog` adopte à l'appel", async () => {
        const { confirmDialog } = await import("../ui/confirm-dialog.js");
        expect(adopted()).toBe(0);
        void confirmDialog({ message: "m", confirmLabel: "ok", cancelLabel: "non" });
        expect(adopted()).toBeGreaterThanOrEqual(1);
    });

    it("`wireTooltips` adopte AVANT de poser les écouteurs", async () => {
        // Before, not inside: the sheet is then in place well ahead of the first hover, so
        // nothing flashes unstyled on the way in.
        const { wireTooltips } = await import("../ui/tooltip.js");
        const root = document.createElement("div");
        root.innerHTML = '<button data-tooltip="x"></button>';
        expect(adopted()).toBe(0);
        wireTooltips(
            () => root,
            () => null
        );
        expect(adopted()).toBe(1);
    });

    it("`showTooltip` adopte aussi — un hôte peut positionner sans câbler", async () => {
        const { showTooltip } = await import("../ui/tooltip.js");
        const el = document.createElement("div");
        const btn = document.createElement("button");
        btn.dataset.tooltip = "x";
        expect(adopted()).toBe(0);
        showTooltip(el, btn);
        expect(adopted()).toBe(1);
    });
});
