// @ts-check
// Touch gestures that Playwright's own API does not provide.
//
// `page.touchscreen` exposes `tap(x, y)` and NOTHING ELSE — no drag, no swipe. Its own
// docblock says so: "This class is limited to emulating tap gestures. For examples of
// other gestures ... see the emulating legacy touch events page."
//
// 🛑 WHY CDP AND NOT `page.dispatchEvent` / `new TouchEvent()` IN `evaluate`.
// Those two build events in the page: `isTrusted: false`, and — the part that decides it —
// the browser derives NO `pointer*` events from them. Terra Draw listens to `pointerdown`
// / `pointermove` / `pointerup` and to nothing else, so a synthesised TouchEvent cannot
// exercise the editor at all. It would test our own dispatch, not the interaction.
//
// `Input.dispatchTouchEvent` is not a workaround: it is LITERALLY the call Playwright
// makes for `touchscreen.tap()` (`RawTouchscreenImpl.tap` sends `touchStart` + `touchEnd`
// through this same CDP method). A drag is therefore the same call with `touchMove` in
// between — the input goes through the browser's real pipeline: hit-testing, gesture
// recognition, trusted events, derived pointer events.
//
// Requires `hasTouch: true` on the project: the renderer only accepts touch input once
// Playwright has issued `Emulation.setTouchEmulationEnabled`. CDP is Chromium-only, which
// is the only channel this repo has (see `playwright.config.js` projects).

/**
 * CDP sessions are per-page and cannot be opened twice, so they are memoised.
 * @type {WeakMap<import('@playwright/test').Page, Promise<import('@playwright/test').CDPSession>>}
 */
const _sessions = new WeakMap();

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<import('@playwright/test').CDPSession>}
 */
function _session(page) {
    let s = _sessions.get(page);
    if (!s) {
        s = page.context().newCDPSession(page);
        _sessions.set(page, s);
    }
    return s;
}

/** Lets the compositor commit a frame between two touch points. */
async function _frame(page) {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
}

/**
 * Presses one finger, drags it to a second point, and releases.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{x: number, y: number}} from Press point, in CSS pixels relative to the viewport.
 * @param {{x: number, y: number}} to   Release point, same frame of reference.
 * @param {{steps?: number}} [opts] `steps` is the number of intermediate `touchMove`s.
 *
 * @example
 * const box = await canvasBox(page);
 * await touchDrag(page, at(box, 0.4, 0.4), at(box, 0.62, 0.58));
 */
async function touchDrag(page, from, to, opts = {}) {
    // ⚠️ 12 moves, not 1. A single jump would clear `MIN_DRAG_PX` / `MIN_RADIUS_M` and go
    // green without ever proving that the live preview follows the finger — which is half
    // of what the drag tools do. It also would not reproduce the gesture a fix must absorb.
    const steps = opts.steps ?? 12;
    const client = await _session(page);

    // The SAME `id` across start and every move: that is what makes Chromium treat them as
    // one touch source rather than a series of unrelated presses.
    const TOUCH_ID = 1;

    await client.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: from.x, y: from.y, id: TOUCH_ID }],
    });

    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        await client.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [
                {
                    x: from.x + (to.x - from.x) * t,
                    y: from.y + (to.y - from.y) * t,
                    id: TOUCH_ID,
                },
            ],
        });
        // MapLibre coalesces input per frame; firing 12 `send()` back to back just queues
        // them on a main thread that is already the bottleneck of this suite.
        await _frame(page);
    }

    // ⚠️ `touchEnd` MUST carry no point — the protocol requires it, and Chromium rejects
    // the call otherwise.
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/**
 * Presses one finger, drags it, and reports back mid-gesture WITHOUT releasing.
 *
 * Needed because the drag tools clear their preview on release: anything drawn only
 * while the gesture is live (the anchor vertex, the elastic outline) is unobservable
 * from a completed {@link touchDrag}.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{x: number, y: number}} from
 * @param {{x: number, y: number}} to
 * @param {() => Promise<void>} inspect Runs after the last move, before the release.
 */
async function touchDragInspect(page, from, to, inspect) {
    const client = await _session(page);
    const TOUCH_ID = 1;

    await client.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: from.x, y: from.y, id: TOUCH_ID }],
    });
    for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        await client.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [
                { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, id: TOUCH_ID },
            ],
        });
        await _frame(page);
    }

    await inspect();

    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

export { touchDrag, touchDragInspect };
