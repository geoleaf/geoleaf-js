// @ts-check
/**
 * 42 — THE FORM DRAWER STAYS USABLE WITH A FINGER AND AN ON-SCREEN KEYBOARD
 *
 * Four findings, one surface — the attribute form of `@geoleaf/field-renderer`, in its phone
 * layout (a drawer anchored at the bottom of the screen):
 *
 * - T1 OCCLUSION. A mobile browser does not shrink the LAYOUT viewport when the keyboard opens;
 *   it shrinks the VISUAL viewport. A `position: fixed; bottom: 0` drawer therefore stays under
 *   the keyboard, with Cancel and Save, and the field being typed in can sit behind it too.
 * - T2 SIZES. WebKit zooms the page into any text control under 16px on focus, and a target
 *   under 44×44px is a miss waiting for a finger.
 * - T3 ANCHORING. `@geoleaf/host-runtime` adopts a copy of `.gl-form-modal-panel` at equal
 *   specificity when its first dialog opens — after the form's own sheet — so a confirmation
 *   dialog could take the drawer's anchoring away for the rest of the page's life.
 * - T4 `dvh`. `100vh` is the LARGEST viewport: a full-height sheet sized in it hides its bottom
 *   band behind the browser's toolbar.
 *
 * ⚠️ HOW THE KEYBOARD IS SIMULATED, AND WHAT THAT PROVES. No headless engine opens a software
 * keyboard. The spec redirects the `height` and `offsetTop` accessors of
 * `VisualViewport.prototype` to values it sets, and dispatches `resize` and `scroll` on the REAL
 * object — which is what a browser does when its keyboard opens or the page pans under it. That
 * proves the drawer FOLLOWS the visual viewport. That a given phone reports its keyboard that way
 * is the platform's documented behaviour; a check on a real device stays a manual step.
 *
 * ⚠️ `pointer: coarse` IS A HARD PRECONDITION OF T2: the touch rules live under that query, and
 * a run where it does not match would measure the desktop sizes and call them a regression.
 */

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("full") });

/** Height of the simulated keyboard — a phone keyboard with its suggestion bar. */
const KEYBOARD_PX = 336;

/**
 * Boots the app, loads the editor and opens the ADD form, which is a drawer at this width.
 *
 * `openAddForm` is not awaited: its promise settles when the form closes, not when it opens.
 *
 * @param {import("@playwright/test").Page} page
 */
async function openDrawer(page) {
    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
    await expect(page.locator("#gl-loader")).toBeHidden({ timeout: 20000 });
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.plugins.load("editor"));
    await page.waitForFunction(
        () =>
            typeof (/** @type {any} */ (window).GeoLeaf?.Editor?.AddForm?.openAddForm) ===
            "function",
        null,
        { timeout: 15000 }
    );
    await page.evaluate(() => {
        void (
            /** @type {any} */ (window).GeoLeaf.Editor.AddForm.openAddForm({
                lat: -32.95,
                lng: -60.66,
            })
        );
    });
    const drawer = page.locator(".gl-form-modal-panel--drawer");
    await expect(drawer).toBeVisible({ timeout: 8000 });
    return drawer;
}

/**
 * Makes the visual viewport controllable, and checks that the control is really READ.
 *
 * @param {import("@playwright/test").Page} page
 */
async function installKeyboard(page) {
    await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        const proto = VisualViewport.prototype;
        const nativeHeight = /** @type {PropertyDescriptor} */ (
            Object.getOwnPropertyDescriptor(proto, "height")
        );
        const nativeOffsetTop = /** @type {PropertyDescriptor} */ (
            Object.getOwnPropertyDescriptor(proto, "offsetTop")
        );
        /** @type {{ height: number | null, offsetTop: number | null }} */
        const state = { height: null, offsetTop: null };
        Object.defineProperty(proto, "height", {
            configurable: true,
            get() {
                return state.height ?? nativeHeight.get?.call(this);
            },
        });
        Object.defineProperty(proto, "offsetTop", {
            configurable: true,
            get() {
                return state.offsetTop ?? nativeOffsetTop.get?.call(this);
            },
        });
        const announce = () => {
            w.visualViewport.dispatchEvent(new Event("resize"));
            w.visualViewport.dispatchEvent(new Event("scroll"));
        };
        w.__glKeyboard = {
            /** @param {number} px @param {number} [offsetTop] */
            open(px, offsetTop = 0) {
                state.height = window.innerHeight - px;
                state.offsetTop = offsetTop;
                announce();
            },
            close() {
                state.height = null;
                state.offsetTop = null;
                announce();
            },
        };
        // 🛑 If the redirection is not what the page reads, every assertion below measures the
        // real, keyboard-less viewport and passes on the defect.
        state.height = 123;
        const seen = w.visualViewport.height;
        state.height = null;
        if (seen !== 123) throw new Error(`le visual viewport simulé n'est pas lu (lu : ${seen})`);
    });
}

/**
 * What is wrong with the drawer under the current visual viewport — `""` when nothing is.
 *
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string>}
 */
function occlusionProblems(page) {
    return page.evaluate(() => {
        const vv = /** @type {VisualViewport} */ (window.visualViewport);
        const top = vv.offsetTop;
        const bottom = vv.offsetTop + vv.height;
        /** @type {string[]} */
        const problems = [];
        for (const selector of [".gl-form-modal__btn-save", ".gl-form-modal__btn-cancel"]) {
            const el = document.querySelector(`.gl-form-modal-panel--drawer ${selector}`);
            if (!el) {
                problems.push(`${selector} absent`);
                continue;
            }
            const r = el.getBoundingClientRect();
            if (r.top < top - 1 || r.bottom > bottom + 1) {
                problems.push(
                    `${selector} [${Math.round(r.top)}, ${Math.round(r.bottom)}] hors du visual viewport [${Math.round(top)}, ${Math.round(bottom)}]`
                );
            }
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            if (!hit || !el.contains(hit)) {
                problems.push(
                    `${selector} recouvert en son centre par ${hit ? hit.className : "rien"}`
                );
            }
        }
        const focused = document.activeElement;
        const body = document.querySelector(".gl-form-modal-panel--drawer .gl-form-modal__body");
        if (!focused || !body || !body.contains(focused)) {
            problems.push("aucun champ du formulaire n'a le focus");
        } else {
            const r = focused.getBoundingClientRect();
            const b = body.getBoundingClientRect();
            const shownTop = Math.max(top, b.top);
            const shownBottom = Math.min(bottom, b.bottom);
            if (r.top < shownTop - 1 || r.bottom > shownBottom + 1) {
                problems.push(
                    `champ focalisé [${Math.round(r.top)}, ${Math.round(r.bottom)}] hors de la zone visible [${Math.round(shownTop)}, ${Math.round(shownBottom)}]`
                );
            }
        }
        return problems.join(" ; ");
    });
}

test("[touch][form] T1 — Enregistrer, Annuler et le champ saisi restent au-dessus du clavier", async ({
    page,
}) => {
    await openDrawer(page);
    await installKeyboard(page);

    // A LOW field, the one a real keyboard hides first.
    const field = page.locator("#gl-field-site_web");
    await field.scrollIntoViewIfNeeded();
    await field.tap();

    await page.evaluate((px) => /** @type {any} */ (window).__glKeyboard.open(px), KEYBOARD_PX);
    await expect
        .poll(() => occlusionProblems(page), { timeout: 5000, message: "clavier ouvert" })
        .toBe("");

    // The page panned under the keyboard: the visual viewport no longer starts at the top.
    await page.evaluate(
        (px) => /** @type {any} */ (window).__glKeyboard.open(px, 120),
        KEYBOARD_PX
    );
    await expect
        .poll(() => occlusionProblems(page), { timeout: 5000, message: "page décalée de 120 px" })
        .toBe("");

    // Keyboard closed: the drawer is back at the bottom of the screen.
    await page.evaluate(() => /** @type {any} */ (window).__glKeyboard.close());
    await expect
        .poll(
            () =>
                page.evaluate(() => {
                    const d = /** @type {Element} */ (
                        document.querySelector(".gl-form-modal-panel--drawer")
                    );
                    return Math.round(window.innerHeight - d.getBoundingClientRect().bottom);
                }),
            { timeout: 5000, message: "le tiroir ne revient pas en bas à la fermeture du clavier" }
        )
        .toBeLessThanOrEqual(1);
});

test("[touch][form] T2 — 16 px sur les champs, 44 px sur les cibles, sans chevauchement", async ({
    page,
}) => {
    const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
    expect(
        coarse,
        "(pointer: coarse) ne correspond pas : les règles tactiles ne peuvent pas s'appliquer"
    ).toBe(true);

    const drawer = await openDrawer(page);
    // Some targets only exist once a component is used: one list item, one table row, tags.
    await drawer.locator(".gl-form-list__add").first().tap();
    await drawer.locator(".gl-form-table__add-row").first().tap();
    const tags = drawer.locator(".gl-form-tags__input").first();
    for (const tag of ["quai", "parc", "musée"]) {
        await tags.fill(tag);
        await tags.press("Enter");
    }

    const report = await page.evaluate(() => {
        const panel = /** @type {Element} */ (
            document.querySelector(".gl-form-modal-panel--drawer")
        );
        /** @param {Element} el */
        const shown = (el) => {
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return (
                r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"
            );
        };
        /** @param {Element} el */
        const name = (el) =>
            `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.classList.length ? `.${[...el.classList].join(".")}` : ""}`;
        const notTargets = ["hidden", "file", "checkbox", "radio"];

        /** @type {string[]} */
        const fonts = [];
        for (const el of panel.querySelectorAll("input, select, textarea")) {
            if (notTargets.includes(/** @type {HTMLInputElement} */ (el).type) || !shown(el))
                continue;
            const size = parseFloat(getComputedStyle(el).fontSize);
            if (size < 16) fonts.push(`${name(el)} ${size}px`);
        }

        /** @type {string[]} */
        const targets = [];
        /** @type {Map<Element, { el: Element, r: DOMRect }[]>} */
        const groups = new Map();
        for (const el of panel.querySelectorAll("button, [role=button], select, input, textarea")) {
            if (notTargets.includes(/** @type {HTMLInputElement} */ (el).type) || !shown(el))
                continue;
            const r = el.getBoundingClientRect();
            if (r.width < 44 || r.height < 44)
                targets.push(`${name(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
            if (el.matches("button, [role=button]")) {
                const group =
                    el.closest(
                        ".gl-form-modal__body > *, .gl-form-modal__footer, .gl-form-modal__header"
                    ) ?? panel;
                groups.set(group, [...(groups.get(group) ?? []), { el, r }]);
            }
        }

        /** @type {string[]} */
        const overlaps = [];
        for (const members of groups.values()) {
            for (let i = 0; i < members.length; i++) {
                for (let j = i + 1; j < members.length; j++) {
                    const a = members[i].r;
                    const b = members[j].r;
                    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                    if (w > 2 && h > 2)
                        overlaps.push(`${name(members[i].el)} × ${name(members[j].el)}`);
                }
            }
        }
        return { fonts, targets, overlaps };
    });

    expect(report.fonts, "champs sous 16 px — WebKit zoome au focus").toEqual([]);
    expect(report.targets, "cibles sous 44×44 px").toEqual([]);
    expect(report.overlaps, "cibles qui se chevauchent dans un même champ").toEqual([]);
});

/**
 * Dirties the form, taps Cancel, and keeps editing from the confirmation dialog — the path that
 * adopts `@geoleaf/host-runtime`'s dialog sheet into the page.
 *
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Locator} drawer
 */
async function confirmThenKeepEditing(page, drawer) {
    await page.locator("#gl-field-title").fill("Site 42");
    // Cancel on a dirty form asks for confirmation; its FIRST action keeps the form open.
    await drawer.locator(".gl-form-modal__btn-cancel").tap();
    const confirm = page.locator(".gl-form-modal-confirm");
    await expect(confirm).toBeVisible({ timeout: 5000 });
    await confirm.locator(".gl-form-modal__footer button").first().tap();
    await expect(confirm).toBeHidden({ timeout: 5000 });
    await expect(drawer).toBeVisible();
}

/**
 * How the drawer sits once the dialog is gone: whether its overlay is tracked, its position, and
 * the gap between its bottom and the bottom of what the user sees.
 *
 * @param {import("@playwright/test").Page} page
 */
function drawerAnchoring(page) {
    return page.evaluate(() => {
        const d = /** @type {Element} */ (document.querySelector(".gl-form-modal-panel--drawer"));
        const vv = window.visualViewport;
        const seenBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
        return {
            tracked: !!d.closest(".gl-form-modal-overlay--viewport"),
            position: getComputedStyle(d).position,
            gap: Math.round(seenBottom - d.getBoundingClientRect().bottom),
        };
    });
}

test("[touch][form] T3 — le tiroir reste ancré en bas après un dialogue de confirmation", async ({
    page,
}) => {
    const drawer = await openDrawer(page);
    await confirmThenKeepEditing(page, drawer);

    const anchoring = await drawerAnchoring(page);
    expect(anchoring.position, "le tiroir a perdu son positionnement").not.toBe("relative");
    expect(
        Math.abs(anchoring.gap),
        "le tiroir ne touche plus le bas du visual viewport"
    ).toBeLessThanOrEqual(1);
});

test("[touch][form] T3b — sans visualViewport, le tiroir reste ancré par sa propre règle", async ({
    page,
}) => {
    // 🛑 T3 CANNOT SEE THE DRAWER'S OWN RULE. With a tracked overlay, a more specific rule anchors
    // the drawer, and the drawer's rule could lose to the dialog sheet with T3 still green. An
    // engine without `visualViewport` gets no tracked overlay: that rule is then the ONLY thing
    // holding the drawer at the bottom, and this case measures it alone.
    await page.addInitScript(() => {
        Object.defineProperty(window, "visualViewport", { configurable: true, value: null });
    });
    const drawer = await openDrawer(page);
    await confirmThenKeepEditing(page, drawer);

    const anchoring = await drawerAnchoring(page);
    expect(
        anchoring.tracked,
        "l'overlay est suivi : ce cas ne mesurerait pas la règle du tiroir"
    ).toBe(false);
    expect(anchoring.position, "le tiroir a perdu son positionnement").toBe("fixed");
    expect(
        Math.abs(anchoring.gap),
        "le tiroir ne touche plus le bas de l'écran"
    ).toBeLessThanOrEqual(1);
});

test("[touch][layout] T4 — les panneaux pleine hauteur se mesurent en dvh", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

    const declared = await page.evaluate(() => {
        /** Selector → the property that sizes it to the screen. */
        const wanted = {
            ".gl-page": "height",
            ".gl-poi-sidepanel": "height",
            "#gl-filter-panel.gl-filter-panel": "height",
            ".gl-share-modal__panel": "max-height",
        };
        /** @type {Record<string, string[]>} */
        const seen = {};
        /** @param {CSSRuleList} rules */
        const walk = (rules) => {
            for (const rule of rules) {
                if (rule instanceof CSSStyleRule) {
                    const selectors = rule.selectorText.split(",").map((s) => s.trim());
                    for (const [selector, property] of Object.entries(wanted)) {
                        const value = rule.style.getPropertyValue(property);
                        if (selectors.includes(selector) && value)
                            (seen[selector] ??= []).push(value);
                    }
                }
                const nested = /** @type {any} */ (rule).cssRules;
                if (nested) walk(nested);
            }
        };
        for (const sheet of [...document.styleSheets, ...document.adoptedStyleSheets]) {
            try {
                walk(sheet.cssRules);
            } catch {
                // A cross-origin sheet cannot be read; none of the wanted rules lives in one.
            }
        }
        return { wanted: Object.keys(wanted), seen };
    });

    for (const selector of declared.wanted) {
        const values = declared.seen[selector];
        // 🛑 A rule that is not found is a FAILURE, never a pass: a renamed selector would
        // otherwise turn this test into a check of nothing.
        expect(values, `règle \`${selector}\` introuvable dans les feuilles livrées`).toBeTruthy();
        expect(
            values.some((v) => v.includes("dvh")),
            `\`${selector}\` : ${values.join(" | ")}`
        ).toBe(true);
    }
});
