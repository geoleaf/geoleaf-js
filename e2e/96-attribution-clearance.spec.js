/**
 * On a phone, the expanded basemap credit no longer covers the bottom-left controls.
 *
 * ## The defect
 *
 * The credit is shown expanded at load — what the providers' terms ask for; below 640 px
 * MapLibre folds it at the first drag. Expanded on a 412-px phone, it spans the whole bottom edge
 * (x 10 → 402, y 785 → 829) and covered the scale bar (y 780 → 804) and the branding overlay
 * (y 806 → 835) until the user's first drag.
 *
 * ## What the spec demands
 *
 * At load, credit expanded, neither the scale bar nor the branding overlay intersects the
 * credit — the bottom-left corner has moved up by the credit's measured height. After a drag,
 * credit folded, the corner is back down.
 */
import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { bootPage, installSignals } from "./helpers/mount.js";

test.use({
    baseURL: baseURL("core"),
    serviceWorkers: "block",
    viewport: { width: 412, height: 839 },
    hasTouch: true,
});

/** Boxes of the credit and of the two bottom-left controls, in viewport pixels. */
function boxes() {
    const b = (s) => {
        const e = document.querySelector(s);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return r.width && r.height ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null;
    };
    return {
        expanded: !!document.querySelector(".maplibregl-ctrl-attrib.maplibregl-compact-show"),
        attrib: b(".maplibregl-ctrl-attrib"),
        scale: b(".gl-scale-main-wrapper"),
        branding: b(".gl-branding"),
    };
}

/** @param {{l:number,t:number,r:number,b:number}|null} a @param {{l:number,t:number,r:number,b:number}|null} c */
function intersects(a, c) {
    return !!a && !!c && a.l < c.r && c.l < a.r && a.t < c.b && c.t < a.b;
}

test("au téléphone, le crédit déplié au chargement ne couvre ni l'échelle ni le bandeau", async ({
    page,
}) => {
    await installSignals(page);
    await bootPage(page);
    await expect(page.locator("#gl-loader")).toBeHidden({ timeout: 15_000 });
    await expect(page.locator(".gl-scale-main-wrapper")).toBeVisible({ timeout: 15_000 });
    // Let the corner's transition settle before measuring.
    await page.waitForTimeout(400);

    const atLoad = await page.evaluate(boxes);
    expect(atLoad.expanded, "le crédit n'est plus déplié au chargement : le sujet a changé").toBe(
        true
    );
    expect(intersects(atLoad.attrib, atLoad.scale), JSON.stringify(atLoad)).toBe(false);
    expect(intersects(atLoad.attrib, atLoad.branding), JSON.stringify(atLoad)).toBe(false);

    // A drag folds the credit; the corner comes back down to the bottom edge.
    await page.mouse.move(200, 400);
    await page.mouse.down();
    await page.mouse.move(240, 440, { steps: 5 });
    await page.mouse.up();
    await expect
        .poll(() =>
            page.evaluate(
                () =>
                    getComputedStyle(document.querySelector(".maplibregl-ctrl-bottom-left"))
                        .transform
            )
        )
        .toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
});
