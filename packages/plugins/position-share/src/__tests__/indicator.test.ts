/**
 * @geoleaf-plugins/position-share — emission indicator and i18n dictionaries
 */
import { describe, it, expect, afterEach } from "vitest";

import { setIndicator, isIndicatorVisible } from "../indicator.js";
import langFr from "../lang/lang-fr.js";
import langEn from "../lang/lang-en.js";

afterEach(() => {
    setIndicator(false);
    document.body.innerHTML = "";
});

describe("emission indicator", () => {
    it("puts a badge on screen while emitting", () => {
        setIndicator(true);
        expect(isIndicatorVisible()).toBe(true);
        expect(document.querySelector(".gl-position-share-badge")).not.toBeNull();
    });

    it("removes it when emission stops", () => {
        setIndicator(true);
        setIndicator(false);
        expect(isIndicatorVisible()).toBe(false);
        expect(document.querySelector(".gl-position-share-badge")).toBeNull();
    });

    it("does not stack badges when raised twice", () => {
        setIndicator(true);
        setIndicator(true);
        expect(document.querySelectorAll(".gl-position-share-badge")).toHaveLength(1);
    });

    // The label crosses the i18n seam and a profile can override it: it is untrusted by the
    // time it reaches the DOM, so it goes in as text and never as markup.
    it("writes the label as text, not as markup", () => {
        setIndicator(true);
        const text = document.querySelector(".gl-position-share-badge-text");
        expect(text?.textContent).toBeTruthy();
        expect(text?.innerHTML).not.toContain("<");
    });

    it("announces itself to assistive technology", () => {
        setIndicator(true);
        const badge = document.querySelector(".gl-position-share-badge");
        expect(badge?.getAttribute("role")).toBe("status");
        expect(badge?.getAttribute("aria-live")).toBe("polite");
    });
});

describe("i18n dictionaries", () => {
    // A nested dictionary resolves to nothing and silently falls back to French — the defect
    // this repository already paid for once (audit C-5).
    it("uses flat, dotted keys only", () => {
        for (const dict of [langFr, langEn]) {
            for (const [key, value] of Object.entries(dict)) {
                expect(key.startsWith("position-share.")).toBe(true);
                expect(typeof value).toBe("string");
            }
        }
    });

    it("declares the same keys in both languages", () => {
        expect(Object.keys(langFr).sort()).toEqual(Object.keys(langEn).sort());
    });

    it("has no placeholder left from the scaffold", () => {
        for (const value of Object.values(langFr)) {
            expect(value).not.toBe("position-share");
        }
    });
});
