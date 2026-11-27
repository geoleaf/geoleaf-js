/**
 * `UI.setPaneSize` — the mobile sheet's reduced height.
 *
 * 🛑 The assertion carrying this file is "a reduced sheet is no longer modal": a sheet lowered to
 * its header but still `aria-modal`, still trapping focus and still catching every pointer on its
 * backdrop would show the map while forbidding it — the worst of both heights. Every other check
 * here (header tap restores, reopening restores, no sheet means no-op) is the way back.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import postcss, { type AtRule, type Rule } from "postcss";
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../src/utils/i18n/i18n.js", () => ({
    getLabel: vi.fn((k: string) => k),
}));

import {
    initMobileToolbar,
    destroyMobileToolbar,
} from "../../src/kernel/ui/mobile/mobile-toolbar.js";
import {
    openSheet,
    closeSheet,
    setPaneSize,
} from "../../src/kernel/ui/mobile/mobile-toolbar-sheet.js";
import { domState } from "../../src/kernel/ui/mobile/mobile-toolbar-state.js";

/** Boots a toolbar — and with it the sheet — into a fresh `.gl-main`. */
function mountToolbar(): void {
    const glMain = document.createElement("div");
    glMain.className = "gl-main";
    document.body.appendChild(glMain);
    initMobileToolbar({ glMain });
}

/** The live overlay, asserted present. */
function overlay(): HTMLElement {
    const el = document.querySelector<HTMLElement>(".gl-sheet-overlay");
    if (!el) throw new Error("no sheet overlay mounted");
    return el;
}

afterEach(() => {
    destroyMobileToolbar();
    if (domState.filterCheckInterval != null) {
        clearInterval(domState.filterCheckInterval);
        domState.filterCheckInterval = null;
    }
    document.body.innerHTML = "";
});

describe("setPaneSize — without an open sheet, nothing happens", () => {
    it("answers false when no sheet was ever built (a desktop layout, a bare page)", async () => {
        await expect(setPaneSize("peek")).resolves.toBe(false);
        expect(document.querySelector(".gl-sheet-overlay--peek")).toBeNull();
    });

    it("answers false on a built but closed sheet, and does not open it", async () => {
        mountToolbar();
        await expect(setPaneSize("peek")).resolves.toBe(false);
        expect(overlay().classList.contains("open")).toBe(false);
        expect(overlay().classList.contains("gl-sheet-overlay--peek")).toBe(false);
    });
});

describe("setPaneSize('peek') — the sheet stops being modal", () => {
    it("lowers the open sheet to its header and drops aria-modal", async () => {
        mountToolbar();
        openSheet("legend");
        await expect(setPaneSize("peek")).resolves.toBe(true);
        const el = overlay();
        expect(el.classList.contains("open")).toBe(true);
        expect(el.classList.contains("gl-sheet-overlay--peek")).toBe(true);
        expect(el.hasAttribute("aria-modal")).toBe(false);
        // The hidden part of the panel leaves the tab order.
        expect(el.querySelector(".gl-sheet-panel__body")?.hasAttribute("inert")).toBe(true);
    });

    it("no longer traps Tab inside the sheet", async () => {
        mountToolbar();
        openSheet("legend");
        await setPaneSize("peek");
        const close = overlay().querySelector<HTMLElement>(".gl-sheet-panel__close")!;
        close.focus();
        const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
        close.dispatchEvent(tab);
        expect(tab.defaultPrevented).toBe(false);
    });

    it("a tap on the header brings the full height back, modal again", async () => {
        mountToolbar();
        openSheet("legend");
        await setPaneSize("peek");
        overlay()
            .querySelector<HTMLElement>(".gl-sheet-panel__title")!
            .dispatchEvent(new MouseEvent("click", { bubbles: true }));
        const el = overlay();
        expect(el.classList.contains("gl-sheet-overlay--peek")).toBe(false);
        expect(el.getAttribute("aria-modal")).toBe("true");
        expect(el.querySelector(".gl-sheet-panel__body")?.hasAttribute("inert")).toBe(false);
        expect(el.classList.contains("open")).toBe(true);
    });

    it("the close button in the header still closes, rather than expanding", async () => {
        mountToolbar();
        openSheet("legend");
        await setPaneSize("peek");
        overlay().querySelector<HTMLElement>(".gl-sheet-panel__close")!.click();
        expect(overlay().classList.contains("open")).toBe(false);
    });

    it("closing then reopening the sheet gives the full height", async () => {
        mountToolbar();
        openSheet("legend");
        await setPaneSize("peek");
        closeSheet();
        expect(overlay().classList.contains("gl-sheet-overlay--peek")).toBe(false);
        openSheet("layers");
        expect(overlay().classList.contains("gl-sheet-overlay--peek")).toBe(false);
        expect(overlay().getAttribute("aria-modal")).toBe("true");
    });

    it("setPaneSize('full') restores the height from code too", async () => {
        mountToolbar();
        openSheet("legend");
        await setPaneSize("peek");
        await expect(setPaneSize("full")).resolves.toBe(true);
        expect(overlay().classList.contains("gl-sheet-overlay--peek")).toBe(false);
        expect(overlay().getAttribute("aria-modal")).toBe("true");
    });
});

describe("setPaneSize('peek') — the map's bottom-left corner clears the lowered sheet", () => {
    /** The custom property the host carries while the sheet is lowered. */
    const VAR = "--gl-sheet-peek-clearance";

    /** A header that measures `height` px — jsdom lays nothing out. */
    function headerOf(height: number): void {
        const header = overlay().querySelector<HTMLElement>(".gl-sheet-panel__header")!;
        header.getBoundingClientRect = () => ({ height }) as DOMRect;
    }

    it("puts the measured header height on the map's host, and takes it back at full height", async () => {
        mountToolbar();
        const glMain = document.querySelector<HTMLElement>(".gl-main")!;
        openSheet("legend");
        headerOf(86);
        await setPaneSize("peek");
        expect(glMain.style.getPropertyValue(VAR)).toBe("86px");
        await setPaneSize("full");
        expect(glMain.style.getPropertyValue(VAR)).toBe("");
    });

    it("takes it back when the lowered sheet is closed", async () => {
        mountToolbar();
        const glMain = document.querySelector<HTMLElement>(".gl-main")!;
        openSheet("legend");
        headerOf(56);
        await setPaneSize("peek");
        expect(glMain.style.getPropertyValue(VAR)).toBe("56px");
        closeSheet();
        expect(glMain.style.getPropertyValue(VAR)).toBe("");
    });

    /** Values of `prop` declared outside any `@media` on a rule naming exactly `selector`. */
    function valuesOf(sheet: string, selector: string, prop: string): string[] {
        const file = path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            "..",
            "..",
            "src",
            sheet
        );
        const root = postcss.parse(fs.readFileSync(file, "utf8"), { from: file });
        const out: string[] = [];
        root.walkRules((rule: Rule) => {
            if (!rule.selectors.map((s) => s.trim()).includes(selector)) return;
            for (let p = rule.parent; p && p.type !== "root"; p = p.parent) {
                if (p.type === "atrule" && (p as AtRule).name === "media") return;
            }
            rule.walkDecls(prop, (d) => {
                out.push(d.value);
            });
        });
        return out;
    }

    // jsdom computes no transform: the stylesheets are read. The corner and the toolbar both
    // follow the larger of the two things covering the bottom edge — the expanded credit, or the
    // lowered sheet's header (z-index above both).
    it("the corner's lift and the toolbar's bottom read the host's variable", () => {
        const lift = valuesOf(
            "css/geoleaf-controls.css",
            ".maplibregl-ctrl-bottom-left",
            "transform"
        );
        expect(lift.length, "the corner's lift must still be declared").toBe(1);
        expect(lift[0]).toContain("var(--gl-attrib-clearance");
        expect(lift[0]).toContain(`var(${VAR}`);

        const bottom = valuesOf(
            "kernel/ui/mobile/css/mobile-toolbar-bar.css",
            ".gl-map-toolbar-wrapper",
            "bottom"
        );
        expect(bottom.length, "the toolbar's bottom must still be declared").toBe(1);
        expect(bottom[0]).toContain("var(--gl-attrib-clearance");
        expect(bottom[0]).toContain(`var(${VAR}`);
    });
});

describe("the façade", () => {
    it("mounts the member on GeoLeaf.UI", async () => {
        await import("../../src/globals/globals.ui.js");
        const ui = (globalThis as { GeoLeaf?: { UI?: { setPaneSize?: unknown } } }).GeoLeaf?.UI;
        // `typeof` first: two `undefined` would pass the identity check on a missing member.
        expect(typeof ui?.setPaneSize).toBe("function");
        expect(ui?.setPaneSize).toBe(setPaneSize);
    });
});
