/**
 */
/* T22 — capabilities/theme-selector/theme-selector-secondary.ts (relocated S8/F4) */

vi.mock("../../../src/utils/log/index.js", () => ({
    Log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../src/capabilities/theme-selector/theme-selector-state.js", () => ({
    _state: {
        dropdown: null,
        secondaryThemes: [],
        secondaryContainer: null,
        currentTheme: null,
        config: { secondaryThemes: { placeholder: "Select theme", showNavigationButtons: false } },
    },
}));

const mockAttachDOMEvent = vi.fn();
vi.mock("../../../src/capabilities/theme-selector/theme-selector-events.js", () => ({
    attachDOMEvent: (...args) => mockAttachDOMEvent(...args),
}));

// `$create` IS `createElement` (an export alias) — one implementation, both names.
// `domCreate` was missing from this mock entirely although the module under test
// imports it: harmless only because these cases never reach a call site (B.18).
const createElementDouble = vi.hoisted(() =>
    vi.fn((tag, props) => {
        const el = document.createElement(tag);
        if (props) Object.assign(el, props);
        return el;
    })
);
vi.mock("../../../src/utils/general/dom-helpers.js", () => ({
    createElement: createElementDouble,
    $create: createElementDouble,
    domCreate: vi.fn((tag, className, parent) => domCreateDouble(tag, className, parent)),
}));

vi.mock("../../../src/utils/i18n/i18n.js", () => ({
    getLabel: vi.fn(() => "label"),
}));

vi.mock("../../../src/kernel/security/dom-security.js", () => ({
    DOMSecurity: { clearElementFast: vi.fn() },
}));
import { domCreateDouble } from "../../_helpers/dom-create-double.js";
import { _state } from "../../../src/capabilities/theme-selector/theme-selector-state.js";
import { Log } from "../../../src/utils/log/index.js";
import {
    attachDropdownHandler,
    attachNavButtonHandler,
    updateUIStateSecondary,
} from "../../../src/capabilities/theme-selector/theme-selector-secondary.js";

describe("capabilities/theme-selector/theme-selector-secondary (T22)", () => {
    beforeEach(() => {
        mockAttachDOMEvent.mockClear();
        _state.dropdown = null;
        _state.secondaryThemes = [];
        _state.currentTheme = null;
    });

    describe("updateUIStateSecondary", () => {
        it("returns early when _state.dropdown is null (branch 0.1 true)", () => {
            _state.dropdown = null;
            expect(() => updateUIStateSecondary("theme1")).not.toThrow();
        });

        it("sets dropdown.value to themeId when theme is secondary (branch 1.0 true)", () => {
            const select = document.createElement("select");
            ["theme1", "theme2"].forEach((id) => {
                const opt = document.createElement("option");
                opt.value = id;
                select.appendChild(opt);
            });
            _state.dropdown = select;
            _state.secondaryThemes = [{ id: "theme1" }, { id: "theme2" }];
            updateUIStateSecondary("theme1");
            expect(select.value).toBe("theme1");
        });

        it("sets dropdown.value to empty when theme is not secondary (branch 1.0 false)", () => {
            const select = document.createElement("select");
            const opt = document.createElement("option");
            opt.value = "other";
            select.appendChild(opt);
            _state.dropdown = select;
            _state.secondaryThemes = [{ id: "primary" }];
            updateUIStateSecondary("not-secondary");
            expect(select.value).toBe("");
        });
    });

    describe("attachDropdownHandler", () => {
        it("calls setThemeFn when themeId is truthy (branch 3.0 true)", () => {
            const select = { value: "theme1" };
            const setThemeFn = vi.fn(() => Promise.resolve());
            attachDropdownHandler(select, setThemeFn);
            const onChange = mockAttachDOMEvent.mock.calls[0][2];
            onChange({ type: "change", stopPropagation: vi.fn() });
            expect(setThemeFn).toHaveBeenCalledWith("theme1");
        });

        it("logs warn when themeId is empty (branch 3.0 false)", () => {
            Log.warn.mockClear();
            const select = { value: "" };
            const setThemeFn = vi.fn();
            mockAttachDOMEvent.mockClear();
            attachDropdownHandler(select, setThemeFn);
            const onChange = mockAttachDOMEvent.mock.calls[0][2];
            onChange({ type: "change", stopPropagation: vi.fn() });
            expect(setThemeFn).not.toHaveBeenCalled();
            expect(Log.warn).toHaveBeenCalled();
        });

        it("calls ev.stopPropagation directly (branch 0.0 true)", () => {
            const select = { value: "t" };
            mockAttachDOMEvent.mockClear();
            // Contract: `setThemeFn: (id: string) => Promise<void>`. `select.value` is
            // truthy here, so the handler DOES call it and chains .catch() — a bare
            // vi.fn() would return undefined. The sibling test at l.99 already honours
            // this; this one had drifted.
            attachDropdownHandler(
                select,
                vi.fn(() => Promise.resolve())
            );
            const onChange = mockAttachDOMEvent.mock.calls[0][2];
            const stopPropagation = vi.fn();
            const ev = { type: "change", stopPropagation };
            onChange(ev);
            // Source now calls ev.stopPropagation() directly
            expect(stopPropagation).toHaveBeenCalled();
        });
    });

    describe("attachNavButtonHandler", () => {
        it("calls nextThemeFn when direction is 'next' (branch 2.0 true)", () => {
            const nextFn = vi.fn();
            const prevFn = vi.fn();
            const btn = {};
            mockAttachDOMEvent.mockClear();
            attachNavButtonHandler(btn, "next", nextFn, prevFn);
            const onClick = mockAttachDOMEvent.mock.calls[0][2];
            onClick({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
            expect(nextFn).toHaveBeenCalled();
            expect(prevFn).not.toHaveBeenCalled();
        });

        it("calls previousThemeFn when direction is 'prev' (branch 2.0 false)", () => {
            const nextFn = vi.fn();
            const prevFn = vi.fn();
            const btn = {};
            mockAttachDOMEvent.mockClear();
            attachNavButtonHandler(btn, "prev", nextFn, prevFn);
            const onClick = mockAttachDOMEvent.mock.calls[0][2];
            onClick({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
            expect(prevFn).toHaveBeenCalled();
            expect(nextFn).not.toHaveBeenCalled();
        });
    });
});
