/**
 * The language and palette choices open inside the screen, and announce what they are.
 *
 * ## The defects
 *
 * 1. **Off screen on the phone.** Both popovers were anchored by `right: 44px` — the geometry of
 *    the desktop tab strip, on the right edge. In the mobile toolbar, on the LEFT edge, the same
 *    rule threw them off the screen: measured on a Pixel 7, the language list at x = −156 and the
 *    palette list at x = −146, 160 px wide. The choice was unreachable on a phone.
 * 2. **A menu in name only.** `role="menu"` / `menuitem` promise the menu keyboard contract —
 *    arrows, focus on the active entry — and none of it was there; `aria-expanded` was never set,
 *    and the list was appended at the END of the bar, three tabs away from its button. They are
 *    now a disclosure: a button that says whether it is expanded, and a list of plain buttons,
 *    placed right after it, that receives the focus on its active entry.
 *
 * ## What the spec demands
 *
 * On a Pixel 7 and at the desktop width, for each of the two choices: the list lies entirely in
 * the viewport, the button reports `aria-expanded="true"`, no role promises a menu, and the focus
 * is inside the list.
 */
import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { bootPage, installSignals } from "./helpers/mount.js";

const CHOICES = [
    { name: "langue", button: ".gl-rp-lang-btn", popover: ".gl-lang-popover" },
    { name: "palette", button: ".gl-rp-palette-btn", popover: ".gl-palette-popover" },
];

/**
 * Opens one choice through its VISIBLE button and reads what the spec judges.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ button: string, popover: string }} choice
 */
async function openAndRead(page, choice) {
    const button = page.locator(`${choice.button}:visible`).first();
    await expect(button).toBeVisible({ timeout: 15_000 });
    await button.click();
    const popover = page.locator(choice.popover);
    await expect(popover).toBeVisible({ timeout: 5_000 });
    const box = await popover.boundingBox();
    const viewport = page.viewportSize();
    const state = await page.evaluate((c) => {
        const btn = [...document.querySelectorAll(c.button)].find(
            (b) => /** @type {HTMLElement} */ (b).offsetParent !== null
        );
        const pop = document.querySelector(c.popover);
        return {
            expanded: btn?.getAttribute("aria-expanded") ?? null,
            menuRoles: pop ? pop.querySelectorAll('[role="menu"], [role="menuitem"]').length : -1,
            selfMenu: pop?.getAttribute("role") === "menu",
            focusInside: !!pop?.contains(document.activeElement),
        };
    }, choice);
    return { box, viewport, ...state };
}

/** @param {{ box: any, viewport: any }} r */
function inside(r) {
    return (
        !!r.box &&
        r.box.x >= 0 &&
        r.box.y >= 0 &&
        r.box.x + r.box.width <= r.viewport.width &&
        r.box.y + r.box.height <= r.viewport.height
    );
}

for (const [format, use] of /** @type {const} */ ([
    // The Pixel 7 width the capability recipe measured on (412 px), touch on.
    ["téléphone (412 px)", { viewport: { width: 412, height: 839 }, hasTouch: true }],
    ["bureau (1 440 px)", { viewport: { width: 1440, height: 900 } }],
])) {
    test.describe(`choix de langue et de palette — ${format}`, () => {
        test.use({ ...use, baseURL: baseURL("core"), serviceWorkers: "block" });

        test.beforeEach(async ({ page }) => {
            await installSignals(page);
            await bootPage(page);
            await expect(page.locator("#gl-loader")).toBeHidden({ timeout: 15_000 });
        });

        for (const choice of CHOICES) {
            test(`${choice.name} : la liste tient dans l'écran, s'annonce ouverte et reçoit le focus`, async ({
                page,
            }) => {
                const r = await openAndRead(page, choice);
                expect(
                    inside(r),
                    `boîte ${JSON.stringify(r.box)} hors de ${JSON.stringify(r.viewport)}`
                ).toBe(true);
                expect(r.expanded).toBe("true");
                expect(r.selfMenu || r.menuRoles > 0, "un rôle promet encore un menu").toBe(false);
                expect(r.focusInside, "le focus n'est pas entré dans la liste").toBe(true);
            });
        }
    });
}
