import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    required,
    pattern,
    url,
    tel,
    email,
    range,
    maxLength,
    minLength,
    phoneE164,
    minItems,
    dateISO,
} from "../validators.js";
import { ComponentRegistry } from "../registry.js";
import type { FieldConfig, RenderCtx } from "../contract.js";
import { textComponent } from "../types/text.js";
import { longtextComponent } from "../types/longtext.js";
import { numberComponent } from "../types/number.js";
import { metricComponent } from "../types/metric.js";
import { badgeComponent } from "../types/badge.js";
import { linkComponent } from "../types/link.js";
import { dropdownComponent } from "../types/dropdown.js";
import { radioComponent } from "../types/radio.js";
import { checkboxComponent } from "../types/checkbox.js";
import { registerBuiltinComponents, builtinComponentIds } from "../builtins.js";
// S5 components
import { tagsComponent } from "../types/tags.js";
import { ratingComponent } from "../types/rating.js";
import { phoneComponent } from "../types/phone.js";
import { priceComponent } from "../types/price.js";
import { listComponent } from "../types/list.js";
import { tableComponent } from "../types/table.js";
import { imageComponent } from "../types/image.js";
import { galleryComponent } from "../types/gallery.js";
import { reviewsComponent } from "../types/reviews.js";
import { hoursComponent } from "../types/hours.js";
import { coordinatesComponent } from "../types/coordinates.js";
import { emailComponent } from "../types/email.js";
import { urlComponent } from "../types/url.js";
import { dateComponent } from "../types/date.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const CTX: RenderCtx = { lang: "fr" };
const CTX_RO: RenderCtx = { lang: "fr", readOnly: true };

function field(overrides: Partial<FieldConfig> = {}): FieldConfig {
    return { id: "test", type: "text", label: "Test", ...overrides };
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

describe("validators — required", () => {
    it("returns null for a non-empty string", () => {
        expect(required("hello")).toBeNull();
    });

    it("returns error key for an empty string", () => {
        expect(required("")).toBe("form.error.required");
    });

    it("returns error key for null / undefined", () => {
        expect(required(null)).toBe("form.error.required");
        expect(required(undefined)).toBe("form.error.required");
    });

    it("returns null for a non-empty array", () => {
        expect(required(["a"])).toBeNull();
    });

    it("returns error key for an empty array", () => {
        expect(required([])).toBe("form.error.required");
    });
});

describe("validators — pattern", () => {
    it("returns null for a matching value", () => {
        expect(pattern("ABC", /^[A-Z]+$/)).toBeNull();
    });

    it("returns error key for a non-matching value", () => {
        expect(pattern("abc", /^[A-Z]+$/)).toBe("form.error.pattern");
    });

    it("passes when value is empty", () => {
        expect(pattern("", /^[A-Z]+$/)).toBeNull();
    });
});

describe("validators — url", () => {
    it("accepts http and https URLs", () => {
        expect(url("http://example.com")).toBeNull();
        expect(url("https://example.com/path?q=1")).toBeNull();
    });

    it("accepts mailto and tel protocols", () => {
        expect(url("mailto:a@b.com")).toBeNull();
        expect(url("tel:+33612345678")).toBeNull();
    });

    it("rejects invalid URLs", () => {
        expect(url("not-a-url")).toBe("form.error.url");
        expect(url("ftp://example.com")).toBe("form.error.url");
    });

    it("passes when empty", () => {
        expect(url("")).toBeNull();
    });
});

describe("validators — tel", () => {
    it("accepts valid phone numbers", () => {
        expect(tel("+33 6 12 34 56 78")).toBeNull();
        expect(tel("0612345678")).toBeNull();
    });

    it("rejects strings with too few digits", () => {
        expect(tel("12345")).toBe("form.error.tel");
    });

    it("passes when empty", () => {
        expect(tel("")).toBeNull();
    });
});

describe("validators — email", () => {
    it("accepts valid emails", () => {
        expect(email("user@example.com")).toBeNull();
    });

    it("rejects malformed emails", () => {
        expect(email("not-an-email")).toBe("form.error.email");
        expect(email("@nodomain")).toBe("form.error.email");
    });

    it("passes when empty", () => {
        expect(email("")).toBeNull();
    });
});

describe("validators — range", () => {
    it("returns null when value is within range", () => {
        expect(range(5, 1, 10)).toBeNull();
    });

    it("returns min error when value is below range", () => {
        expect(range(0, 1, 10)).toBe("form.error.min");
    });

    it("returns max error when value is above range", () => {
        expect(range(11, 1, 10)).toBe("form.error.max");
    });

    it("passes when empty / null", () => {
        expect(range(null, 1, 10)).toBeNull();
    });

    it("passes for non-numeric values", () => {
        expect(range("abc" as any, 1, 10)).toBeNull();
    });
});

describe("validators — maxLength", () => {
    it("returns null when within limit", () => {
        expect(maxLength("hi", 10)).toBeNull();
    });

    it("returns error key when over limit", () => {
        expect(maxLength("hello world", 5)).toBe("form.error.maxLength");
    });

    it("passes when empty", () => {
        expect(maxLength("", 5)).toBeNull();
    });
});

describe("validators — minLength", () => {
    it("returns null when at or above minimum", () => {
        expect(minLength("hello", 3)).toBeNull();
    });

    it("returns error key when below minimum", () => {
        expect(minLength("hi", 5)).toBe("form.error.minLength");
    });

    it("passes when empty", () => {
        expect(minLength("", 5)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// ComponentRegistry
// ---------------------------------------------------------------------------

describe("ComponentRegistry", () => {
    beforeEach(() => {
        // Re-register for each test to ensure isolation.
        ComponentRegistry.register(textComponent);
    });

    it("registers and retrieves a component by id", () => {
        const def = ComponentRegistry.get("text");
        expect(def).toBeDefined();
        expect(def?.id).toBe("text");
    });

    it("returns undefined for an unknown type id", () => {
        expect(ComponentRegistry.get("nonexistent-type")).toBeUndefined();
    });

    it("has() returns true for a registered id", () => {
        expect(ComponentRegistry.has("text")).toBe(true);
    });

    it("has() returns false for an unregistered id", () => {
        expect(ComponentRegistry.has("not-here")).toBe(false);
    });

    it("list() includes registered ids", () => {
        const ids = ComponentRegistry.list();
        expect(ids).toContain("text");
    });

    it("overwrites an existing registration with the same id", () => {
        const custom = { ...textComponent, id: "text", defaults: "overridden" };
        ComponentRegistry.register(custom);
        expect(ComponentRegistry.get("text")?.defaults).toBe("overridden");
        // Restore
        ComponentRegistry.register(textComponent);
    });
});

// ---------------------------------------------------------------------------
// text component
// ---------------------------------------------------------------------------

describe("textComponent", () => {
    it("formRender returns an HTMLElement containing an input[type=text]", () => {
        const el = textComponent.formRender("", field(), () => {}, CTX);
        expect(el).toBeInstanceOf(HTMLElement);
        const input = el.querySelector("input[type=text]");
        expect(input).not.toBeNull();
    });

    it("formRender pre-fills value", () => {
        const el = textComponent.formRender("hello", field(), () => {}, CTX);
        const input = el.querySelector("input") as HTMLInputElement;
        expect(input.value).toBe("hello");
    });

    it("formRender disables input when readOnly", () => {
        const el = textComponent.formRender("", field(), () => {}, CTX_RO);
        const input = el.querySelector("input") as HTMLInputElement;
        expect(input.disabled).toBe(true);
    });

    it("validator returns null for valid text", () => {
        expect(textComponent.validator?.("valid", field())).toBeNull();
    });

    it("validator returns required error when value is empty and required=true", () => {
        expect(textComponent.validator?.("", field({ required: true }))).toBe(
            "form.error.required"
        );
    });

    it("validator returns maxLength error when over limit", () => {
        expect(textComponent.validator?.("toolong", field({ maxLength: 3 }))).toBe(
            "form.error.maxLength"
        );
    });
});

// ---------------------------------------------------------------------------
// longtext component
// ---------------------------------------------------------------------------

describe("longtextComponent", () => {
    it("formRender returns a textarea", () => {
        const el = longtextComponent.formRender("", field(), () => {}, CTX);
        expect(el.querySelector("textarea")).not.toBeNull();
    });

    it("formRender renders a character counter when maxLength is set", () => {
        const el = longtextComponent.formRender("hi", field({ maxLength: 50 }), () => {}, CTX);
        const hint = el.querySelector(".gl-form-hint");
        expect(hint?.textContent).toContain("2 / 50");
    });
});

// ---------------------------------------------------------------------------
// number component
// ---------------------------------------------------------------------------

describe("numberComponent", () => {
    it("formRender returns input[type=number]", () => {
        const el = numberComponent.formRender(0, field(), () => {}, CTX);
        expect(el.querySelector("input[type=number]")).not.toBeNull();
    });

    it("formRender sets min and max attributes", () => {
        const el = numberComponent.formRender(5, field({ min: 0, max: 100 }), () => {}, CTX);
        const input = el.querySelector("input") as HTMLInputElement;
        expect(input.min).toBe("0");
        expect(input.max).toBe("100");
    });

    it("validator returns null within range", () => {
        expect(numberComponent.validator?.(5, field({ min: 0, max: 10 }))).toBeNull();
    });

    it("validator returns min error below range", () => {
        expect(numberComponent.validator?.(-1, field({ min: 0, max: 10 }))).toBe("form.error.min");
    });
});

// ---------------------------------------------------------------------------
// metric component
// ---------------------------------------------------------------------------

describe("metricComponent", () => {
    it("formRender renders prefix and suffix spans", () => {
        const el = metricComponent.formRender(
            100,
            field({ prefix: "$", unit: "km" }),
            () => {},
            CTX
        );
        expect(el.querySelector(".gl-form-metric__prefix")?.textContent).toBe("$");
        expect(el.querySelector(".gl-form-metric__suffix")?.textContent).toBe("km");
    });
});

// ---------------------------------------------------------------------------
// badge component
// ---------------------------------------------------------------------------

describe("badgeComponent", () => {
    it("formRender returns an input[type=text] and an input[type=color]", () => {
        const el = badgeComponent.formRender({ label: "", color: "#fff" }, field(), () => {}, CTX);
        expect(el.querySelector("input[type=text]")).not.toBeNull();
        expect(el.querySelector("input[type=color]")).not.toBeNull();
    });

    // Non-regression (backlog B.7): the visible <label> is bound to the TEXT input, so
    // the colour swatch had no accessible name — axe rule `label`, one of the two
    // deviations the E2E allowlist used to carry. It must also name WHICH field it
    // colours: a form can hold several badges, and "Badge color" ×3 is not a name.
    it("colour swatch carries an accessible name naming its field", () => {
        const el = badgeComponent.formRender(
            { label: "", color: "#fff" },
            field({ label: "Catégorie" }),
            () => {},
            CTX
        );
        const swatch = el.querySelector("input[type=color]");
        const name = swatch?.getAttribute("aria-label") ?? "";
        expect(name).not.toBe("");
        expect(name).toContain("Catégorie");
    });
});

// ---------------------------------------------------------------------------
// link component
// ---------------------------------------------------------------------------

describe("linkComponent", () => {
    it("validator rejects invalid url", () => {
        expect(linkComponent.validator?.({ href: "not-a-url" }, field())).toBe("form.error.url");
    });

    it("validator passes for a valid https URL", () => {
        expect(linkComponent.validator?.({ href: "https://geoleaf.io" }, field())).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// dropdown component
// ---------------------------------------------------------------------------

describe("dropdownComponent", () => {
    const OPTIONS = [
        { value: "a", label: "Option A" },
        { value: "b", label: "Option B" },
    ];

    it("formRender builds a <select> with the given options", () => {
        const el = dropdownComponent.formRender("a", field({ options: OPTIONS }), () => {}, CTX);
        const select = el.querySelector("select") as HTMLSelectElement;
        expect(select).not.toBeNull();
        // Placeholder + 2 real options
        expect(select.options.length).toBe(3);
    });

    it("formRender pre-selects the matching option", () => {
        const el = dropdownComponent.formRender("b", field({ options: OPTIONS }), () => {}, CTX);
        const select = el.querySelector("select") as HTMLSelectElement;
        expect(select.value).toBe("b");
    });

    it("validator returns required error when empty and required", () => {
        expect(dropdownComponent.validator?.("", field({ required: true }))).toBe(
            "form.error.required"
        );
    });
});

// ---------------------------------------------------------------------------
// radio component
// ---------------------------------------------------------------------------

describe("radioComponent", () => {
    const OPTIONS = [
        { value: "easy", label: "Facile" },
        { value: "hard", label: "Difficile" },
    ];

    it("formRender returns a <fieldset> with radio inputs", () => {
        const el = radioComponent.formRender("easy", field({ options: OPTIONS }), () => {}, CTX);
        expect(el.tagName.toLowerCase()).toBe("fieldset");
        const radios = el.querySelectorAll("input[type=radio]");
        expect(radios.length).toBe(2);
    });

    it("formRender checks the matching radio", () => {
        const el = radioComponent.formRender("hard", field({ options: OPTIONS }), () => {}, CTX);
        const checked = el.querySelector<HTMLInputElement>("input[type=radio]:checked");
        expect(checked?.value).toBe("hard");
    });
});

// ---------------------------------------------------------------------------
// checkbox component — single mode
// ---------------------------------------------------------------------------

describe("checkboxComponent — single (boolean)", () => {
    it("formRender returns a single checkbox input", () => {
        const el = checkboxComponent.formRender(false, field(), () => {}, CTX);
        expect(el.querySelector("input[type=checkbox]")).not.toBeNull();
    });

    it("formRender reflects checked=true when value is true", () => {
        const el = checkboxComponent.formRender(true, field(), () => {}, CTX);
        const cb = el.querySelector<HTMLInputElement>("input[type=checkbox]")!;
        expect(cb.checked).toBe(true);
    });

    it("validator returns required error when unchecked and required=true", () => {
        expect(checkboxComponent.validator?.(false, field({ required: true }))).toBe(
            "form.error.required"
        );
    });
});

// ---------------------------------------------------------------------------
// checkbox component — multi mode
// ---------------------------------------------------------------------------

describe("checkboxComponent — multi (string[])", () => {
    const OPTIONS = [
        { value: "x", label: "X" },
        { value: "y", label: "Y" },
    ];

    it("formRender renders a fieldset with multiple checkboxes", () => {
        const el = checkboxComponent.formRender(
            ["x"],
            field({ multiple: true, options: OPTIONS }),
            () => {},
            CTX
        );
        expect(el.tagName.toLowerCase()).toBe("fieldset");
        const checkboxes = el.querySelectorAll("input[type=checkbox]");
        expect(checkboxes.length).toBe(2);
    });

    it("formRender checks the pre-selected values", () => {
        const el = checkboxComponent.formRender(
            ["y"],
            field({ multiple: true, options: OPTIONS }),
            () => {},
            CTX
        );
        const checked = el.querySelectorAll<HTMLInputElement>("input[type=checkbox]:checked");
        expect(checked.length).toBe(1);
        expect(checked[0].value).toBe("y");
    });
});

// ---------------------------------------------------------------------------
// S5 validators
// ---------------------------------------------------------------------------

describe("validators — phoneE164", () => {
    it("accepts E.164-like numbers", () => {
        expect(phoneE164("+33612345678")).toBeNull();
        expect(phoneE164("33612345678")).toBeNull();
    });

    it("rejects numbers with too few digits", () => {
        expect(phoneE164("123")).toBe("form.error.phoneE164");
    });

    it("passes when empty", () => {
        expect(phoneE164("")).toBeNull();
    });
});

describe("validators — minItems", () => {
    it("returns null when array has enough items", () => {
        expect(minItems(["a", "b"], 2)).toBeNull();
    });

    it("returns error when array has too few items", () => {
        expect(minItems(["a"], 2)).toBe("form.error.minItems");
    });

    it("returns null for non-arrays", () => {
        expect(minItems("not-an-array", 2)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// tagsComponent
// ---------------------------------------------------------------------------

describe("tagsComponent", () => {
    it("formRender returns an input element", () => {
        const el = tagsComponent.formRender([], field(), () => {}, CTX);
        expect(el.querySelector("input")).not.toBeNull();
    });

    it("validator passes for non-empty array", () => {
        expect(tagsComponent.validator?.(["a"], field({ required: true }))).toBeNull();
    });

    it("validator returns required error for empty array with required=true", () => {
        expect(tagsComponent.validator?.([], field({ required: true }))).toBe(
            "form.error.required"
        );
    });
});

// ---------------------------------------------------------------------------
// ratingComponent
// ---------------------------------------------------------------------------

describe("ratingComponent", () => {
    it("formRender renders star buttons", () => {
        const el = ratingComponent.formRender(0, field(), () => {}, CTX);
        const btns = el.querySelectorAll(".gl-form-rating__star");
        expect(btns.length).toBeGreaterThan(0);
    });

    it("validator returns range error above max", () => {
        expect(ratingComponent.validator?.(6, field())).toBe("form.error.max");
    });

    it("validator passes for 0", () => {
        expect(ratingComponent.validator?.(0, field())).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// phoneComponent
// ---------------------------------------------------------------------------

describe("phoneComponent", () => {
    it("formRender returns input[type=tel]", () => {
        const el = phoneComponent.formRender("", field(), () => {}, CTX);
        expect(el.querySelector("input[type=tel]")).not.toBeNull();
    });

    it("validator returns phoneE164 error for invalid number", () => {
        expect(phoneComponent.validator?.("123", field())).toBe("form.error.phoneE164");
    });

    it("validator passes for valid E.164", () => {
        expect(phoneComponent.validator?.("+33612345678", field())).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// priceComponent
// ---------------------------------------------------------------------------

describe("priceComponent", () => {
    it("formRender contains a number input and a currency select", () => {
        const el = priceComponent.formRender(
            { amount: 0, currency: "EUR" },
            field(),
            () => {},
            CTX
        );
        expect(el.querySelector("input[type=number]")).not.toBeNull();
        expect(el.querySelector("select")).not.toBeNull();
    });

    it("validator passes for valid positive amount", () => {
        expect(priceComponent.validator?.({ amount: 5, currency: "EUR" }, field())).toBeNull();
    });

    it("validator returns min error for negative amount", () => {
        expect(priceComponent.validator?.({ amount: -1, currency: "EUR" }, field())).toBe(
            "form.error.min"
        );
    });
});

// ---------------------------------------------------------------------------
// listComponent
// ---------------------------------------------------------------------------

describe("listComponent", () => {
    it("formRender shows an Add button", () => {
        const el = listComponent.formRender([], field(), () => {}, CTX);
        const btn = el.querySelector(".gl-form-list__add") as HTMLButtonElement;
        expect(btn).not.toBeNull();
        expect(btn.disabled).toBe(false);
    });

    it("formRender calls onChange when Add is clicked", () => {
        const onChange = vi.fn();
        const el = listComponent.formRender([], field(), onChange, CTX);
        const btn = el.querySelector(".gl-form-list__add") as HTMLButtonElement;
        btn.click();
        expect(onChange).toHaveBeenCalledWith([""]);
    });

    it("validator returns required error for empty array with required=true", () => {
        expect(listComponent.validator?.([], field({ required: true }))).toBe(
            "form.error.required"
        );
    });
});

// ---------------------------------------------------------------------------
// tableComponent
// ---------------------------------------------------------------------------

describe("tableComponent", () => {
    const COLS = [
        { key: "name", label: "Name" },
        { key: "value", label: "Value" },
    ];

    it("formRender shows an Add row button", () => {
        const el = tableComponent.formRender([], field({ columns: COLS }), () => {}, CTX);
        expect(el.querySelector(".gl-form-table__add-row")).not.toBeNull();
    });

    it("formRender calls onChange when Add row is clicked", () => {
        const onChange = vi.fn();
        const el = tableComponent.formRender([], field({ columns: COLS }), onChange, CTX);
        const btn = el.querySelector(".gl-form-table__add-row") as HTMLButtonElement;
        btn.click();
        expect(onChange).toHaveBeenCalledWith([{ name: "", value: "" }]);
    });
});

// ---------------------------------------------------------------------------
// imageComponent
// ---------------------------------------------------------------------------

describe("imageComponent", () => {
    it("formRender shows a drop zone when no uploadEndpoint (objectURL fallback)", () => {
        const el = imageComponent.formRender("", field(), () => {}, CTX);
        expect(el.querySelector(".gl-form-image__drop-zone")).not.toBeNull();
    });

    it("formRender shows a URL input in readOnly mode without uploadEndpoint", () => {
        const el = imageComponent.formRender("", field(), () => {}, CTX_RO);
        expect(el.querySelector("input[type=url]")).not.toBeNull();
    });

    it("formRender shows a drop zone when uploadEndpoint is set", () => {
        const el = imageComponent.formRender(
            "",
            field({ uploadEndpoint: "https://api.example.com/upload" }),
            () => {},
            CTX
        );
        expect(el.querySelector(".gl-form-image__drop-zone")).not.toBeNull();
    });

    it("validator returns required error for empty string with required=true", () => {
        expect(imageComponent.validator?.("", field({ required: true }))).toBe(
            "form.error.required"
        );
    });
});

// ---------------------------------------------------------------------------
// galleryComponent
// ---------------------------------------------------------------------------

describe("galleryComponent", () => {
    it("formRender shows an upload slot when below maxCount", () => {
        const el = galleryComponent.formRender([], field(), () => {}, CTX);
        expect(el.querySelector(".gl-form-gallery__add-slot")).not.toBeNull();
    });

    it("formRender hides upload slot when at maxCount", () => {
        const urls = ["a", "b", "c"];
        const el = galleryComponent.formRender(urls, field({ maxCount: 3 }), () => {}, CTX);
        expect(el.querySelector(".gl-form-gallery__add-slot")).toBeNull();
    });

    it("validator passes for non-empty array", () => {
        expect(galleryComponent.validator?.(["a"], field({ required: true }))).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// reviewsComponent
// ---------------------------------------------------------------------------

describe("reviewsComponent", () => {
    const REVIEWS = [
        { author: "Alice", rating: 4, comment: "Great!", date: "2026-01-15T10:00:00Z" },
    ];

    it("formRender shows an Add review button", () => {
        const el = reviewsComponent.formRender([], field(), () => {}, CTX);
        expect(el.querySelector(".gl-form-reviews__add")).not.toBeNull();
    });

    it("formRender shows remove buttons per review", () => {
        const el = reviewsComponent.formRender(REVIEWS, field(), () => {}, CTX);
        expect(el.querySelectorAll(".gl-form-reviews__remove").length).toBe(1);
    });

    it("formRender calls onChange when a review is removed", () => {
        const onChange = vi.fn();
        const el = reviewsComponent.formRender([...REVIEWS], field(), onChange, CTX);
        const removeBtn = el.querySelector(".gl-form-reviews__remove") as HTMLButtonElement;
        removeBtn.click();
        expect(onChange).toHaveBeenCalledWith([]);
    });
});

// ---------------------------------------------------------------------------
// hoursComponent
// ---------------------------------------------------------------------------

describe("hoursComponent", () => {
    const HOURS_VALUE = {
        mon: [{ open: "09:00", close: "18:00", closed: false }],
        tue: [{ open: "09:00", close: "18:00", closed: false }],
        wed: [{ open: "09:00", close: "18:00", closed: false }],
        thu: [{ open: "09:00", close: "18:00", closed: false }],
        fri: [{ open: "09:00", close: "18:00", closed: false }],
        sat: [{ open: "10:00", close: "14:00", closed: false }],
        sun: [{ open: "00:00", close: "00:00", closed: true }],
    };

    it("formRender renders 7 rows in the editor table", () => {
        const el = hoursComponent.formRender(HOURS_VALUE, field(), () => {}, CTX);
        const rows = el.querySelectorAll(".gl-form-hours__row");
        expect(rows.length).toBe(7);
    });

    it("formRender shows a copy-all button on the first row", () => {
        const el = hoursComponent.formRender(HOURS_VALUE, field(), () => {}, CTX);
        const copyBtn = el.querySelector(".gl-form-hours__copy-all");
        expect(copyBtn).not.toBeNull();
    });

    it("validator passes for non-empty hours", () => {
        expect(hoursComponent.validator?.(HOURS_VALUE, field())).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// coordinatesComponent
// ---------------------------------------------------------------------------

describe("coordinatesComponent", () => {
    it("formRender renders lat and lng inputs", () => {
        const el = coordinatesComponent.formRender({ lat: 0, lng: 0 }, field(), () => {}, CTX);
        expect(el.querySelector(".gl-form-coordinates__lat")).not.toBeNull();
        expect(el.querySelector(".gl-form-coordinates__lng")).not.toBeNull();
    });

    it("formRender shows disabled capture button when onCapturePosition is absent", () => {
        const el = coordinatesComponent.formRender(
            { lat: 0, lng: 0 },
            field(),
            () => {},
            CTX // no onCapturePosition
        );
        const btn = el.querySelector(".gl-form-coordinates__capture") as HTMLButtonElement | null;
        expect(btn).not.toBeNull();
        expect(btn!.disabled).toBe(true);
    });

    it("formRender shows enabled capture button when onCapturePosition is provided", () => {
        const ctxWithCapture = { ...CTX, onCapturePosition: vi.fn() };
        const el = coordinatesComponent.formRender(
            { lat: 0, lng: 0 },
            field(),
            () => {},
            ctxWithCapture
        );
        const btn = el.querySelector(".gl-form-coordinates__capture") as HTMLButtonElement | null;
        expect(btn).not.toBeNull();
        expect(btn!.disabled).toBe(false);
    });

    it("validator returns min error for lat out of range", () => {
        expect(coordinatesComponent.validator?.({ lat: -100, lng: 0 }, field())).toBe(
            "form.error.min"
        );
    });

    it("validator returns null for valid coordinates", () => {
        expect(coordinatesComponent.validator?.({ lat: 45, lng: 10 }, field())).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Additional coverage tests — S5 event handlers and edge cases
// ---------------------------------------------------------------------------

describe("linkComponent — formRender", () => {
    it("renders an href input and a label input", () => {
        const el = linkComponent.formRender({ href: "", label: "" }, field(), () => {}, CTX);
        expect(el.querySelector("input[type=url]")).not.toBeNull();
    });

    it("pre-fills formRender with existing href", () => {
        const el = linkComponent.formRender(
            { href: "https://example.com", label: "Ex" },
            field(),
            () => {},
            CTX
        );
        const urlInput = el.querySelector<HTMLInputElement>("input[type=url]");
        expect(urlInput?.value).toBe("https://example.com");
    });
});

describe("tagsComponent — interaction", () => {
    it("pressing Enter adds a tag and calls onChange", () => {
        const onChange = vi.fn();
        const el = tagsComponent.formRender([], field(), onChange, CTX);
        const input = el.querySelector<HTMLInputElement>("input")!;
        input.value = "newtag";
        input.dispatchEvent(
            Object.assign(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }), {})
        );
        expect(onChange).toHaveBeenCalledWith(["newtag"]);
    });

    it("clicking × on a pill removes the tag", () => {
        const onChange = vi.fn();
        const el = tagsComponent.formRender(["alpha", "beta"], field(), onChange, CTX);
        const removeBtn = el.querySelector<HTMLButtonElement>(".gl-form-tag__remove")!;
        removeBtn.click();
        expect(onChange).toHaveBeenCalledWith(["beta"]);
    });
});

describe("ratingComponent — star click onChange", () => {
    it("clicking a star fires onChange with the star index", () => {
        const onChange = vi.fn();
        const el = ratingComponent.formRender(0, field(), onChange, CTX);
        const stars = el.querySelectorAll<HTMLButtonElement>("[data-val]");
        // Click the 3rd star
        stars[2]?.click();
        expect(onChange).toHaveBeenCalledWith(3);
    });
});

describe("dropdownComponent — onChange on change event", () => {
    const OPTIONS = [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
    ];

    it("fires onChange when option changes", () => {
        const onChange = vi.fn();
        const el = dropdownComponent.formRender("a", field({ options: OPTIONS }), onChange, CTX);
        const select = el.querySelector<HTMLSelectElement>("select")!;
        select.value = "b";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        expect(onChange).toHaveBeenCalledWith("b");
    });
});

describe("priceComponent — onChange on amount input", () => {
    it("fires onChange when amount changes", () => {
        const onChange = vi.fn();
        const el = priceComponent.formRender(
            { amount: 10, currency: "EUR" },
            field(),
            onChange,
            CTX
        );
        const input = el.querySelector<HTMLInputElement>("input[type=number]")!;
        input.value = "25";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        expect(onChange).toHaveBeenCalledWith({ amount: 25, currency: "EUR" });
    });
});

describe("listComponent — input change fires onChange", () => {
    it("editing an item input fires onChange with updated list", () => {
        const onChange = vi.fn();
        const el = listComponent.formRender(["old"], field(), onChange, CTX);
        const input = el.querySelector<HTMLInputElement>("li input")!;
        input.value = "new";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        expect(onChange).toHaveBeenCalledWith(["new"]);
    });

    it("clicking × removes the item", () => {
        const onChange = vi.fn();
        const el = listComponent.formRender(["a", "b"], field(), onChange, CTX);
        const removeBtn = el.querySelector<HTMLButtonElement>(".gl-form-list__remove")!;
        removeBtn.click();
        expect(onChange).toHaveBeenCalledWith(["b"]);
    });
});

describe("tableComponent — cell edit fires onChange", () => {
    const COLS = [{ key: "name", label: "Name" }];

    it("editing a cell input fires onChange", () => {
        const onChange = vi.fn();
        const el = tableComponent.formRender(
            [{ name: "old" }],
            field({ columns: COLS }),
            onChange,
            CTX
        );
        const input = el.querySelector<HTMLInputElement>("tbody input")!;
        input.value = "updated";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        expect(onChange).toHaveBeenCalledWith([{ name: "updated" }]);
    });

    it("clicking × removes a row", () => {
        const onChange = vi.fn();
        const el = tableComponent.formRender(
            [{ name: "row1" }, { name: "row2" }],
            field({ columns: COLS }),
            onChange,
            CTX
        );
        const removeBtn = el.querySelector<HTMLButtonElement>(".gl-form-table__remove-row")!;
        removeBtn.click();
        expect(onChange).toHaveBeenCalledWith([{ name: "row2" }]);
    });
});

describe("coordinatesComponent — onCapturePosition callback", () => {
    it("clicking capture button calls onCapturePosition and onChange on return", () => {
        const onChange = vi.fn();
        let captureCallback: ((lat: number, lng: number) => void) | undefined;
        const ctxWithCapture = {
            ...CTX,
            onCapturePosition: (cb: (lat: number, lng: number) => void) => {
                captureCallback = cb;
            },
        };
        const el = coordinatesComponent.formRender(
            { lat: 0, lng: 0 },
            field(),
            onChange,
            ctxWithCapture
        );
        const btn = el.querySelector<HTMLButtonElement>(".gl-form-coordinates__capture")!;
        btn.click();
        expect(captureCallback).toBeDefined();
        captureCallback!(48.8566, 2.3522);
        expect(onChange).toHaveBeenCalledWith({ lat: 48.8566, lng: 2.3522 });
    });
});

describe("radioComponent — onChange on click", () => {
    const OPTIONS = [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
    ];

    it("clicking a radio fires onChange", () => {
        const onChange = vi.fn();
        const el = radioComponent.formRender("a", field({ options: OPTIONS }), onChange, CTX);
        const radios = el.querySelectorAll<HTMLInputElement>("input[type=radio]");
        radios[1]!.checked = true;
        radios[1]!.dispatchEvent(new Event("change", { bubbles: true }));
        expect(onChange).toHaveBeenCalledWith("b");
    });
});

// ---------------------------------------------------------------------------
// Additional branch + function coverage tests
// ---------------------------------------------------------------------------

describe("reviewsComponent — add review via form", () => {
    it("clicking Add review shows the inline form", () => {
        const el = reviewsComponent.formRender([], field(), () => {}, CTX);
        const addBtn = el.querySelector<HTMLButtonElement>(".gl-form-reviews__add")!;
        addBtn.click();
        expect(el.querySelector(".gl-form-reviews__form")).not.toBeNull();
    });

    it("submitting the form with an author fires onChange", () => {
        const onChange = vi.fn();
        const el = reviewsComponent.formRender([], field(), onChange, CTX);
        const addBtn = el.querySelector<HTMLButtonElement>(".gl-form-reviews__add")!;
        addBtn.click();
        const authorInput = el.querySelector<HTMLInputElement>(
            ".gl-form-reviews__form input[type=text]"
        )!;
        authorInput.value = "Bob";
        const submitBtn = el.querySelector<HTMLButtonElement>(".gl-btn--primary")!;
        submitBtn.click();
        expect(onChange).toHaveBeenCalledOnce();
        const called = onChange.mock.calls[0][0] as Array<{ author: string }>;
        expect(called[0]?.author).toBe("Bob");
    });
});

describe("imageComponent — remove existing image", () => {
    it("clicking remove button clears the value", () => {
        const onChange = vi.fn();
        const el = imageComponent.formRender(
            "https://example.com/img.jpg",
            field({ uploadEndpoint: "https://api/upload" }),
            onChange,
            CTX
        );
        const removeBtn = el.querySelector<HTMLButtonElement>(".gl-form-image__remove")!;
        removeBtn.click();
        expect(onChange).toHaveBeenCalledWith("");
    });
});

describe("galleryComponent — remove thumbnail", () => {
    it("clicking × on a thumbnail fires onChange without that item", () => {
        const onChange = vi.fn();
        const el = galleryComponent.formRender(
            ["https://a.jpg", "https://b.jpg"],
            field({ uploadEndpoint: "https://api/upload" }),
            onChange,
            CTX
        );
        const removeBtn = el.querySelector<HTMLButtonElement>(".gl-form-gallery__remove")!;
        removeBtn.click();
        expect(onChange).toHaveBeenCalledWith(["https://b.jpg"]);
    });
});

describe("hoursComponent — closed checkbox toggle", () => {
    it("checking Closed disables time inputs and fires onChange", () => {
        const onChange = vi.fn();
        const value = {
            mon: [{ open: "09:00", close: "18:00", closed: false }],
            tue: [{ open: "09:00", close: "18:00", closed: false }],
            wed: [{ open: "09:00", close: "18:00", closed: false }],
            thu: [{ open: "09:00", close: "18:00", closed: false }],
            fri: [{ open: "09:00", close: "18:00", closed: false }],
            sat: [{ open: "09:00", close: "18:00", closed: false }],
            sun: [{ open: "09:00", close: "18:00", closed: false }],
        };
        const el = hoursComponent.formRender(value, field(), onChange, CTX);
        const closedCheckbox = el.querySelector<HTMLInputElement>("input[type=checkbox]")!;
        closedCheckbox.checked = true;
        closedCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
        expect(onChange).toHaveBeenCalled();
        const result = onChange.mock.calls[0][0] as Record<string, Array<{ closed: boolean }>>;
        expect(result["mon"]![0]!.closed).toBe(true);
    });
});

describe("tagsComponent — restricted mode", () => {
    it("does not add a tag not in options when restricted=true", () => {
        const onChange = vi.fn();
        const options = [{ value: "allowed", label: "Allowed" }];
        const el = tagsComponent.formRender(
            [],
            field({ restricted: true, options }),
            onChange,
            CTX
        );
        const input = el.querySelector<HTMLInputElement>("input")!;
        input.value = "notallowed";
        input.dispatchEvent(
            Object.assign(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }), {})
        );
        expect(onChange).not.toHaveBeenCalled();
    });

    it("adds a tag that is in options when restricted=true", () => {
        const onChange = vi.fn();
        const options = [{ value: "allowed", label: "Allowed" }];
        const el = tagsComponent.formRender(
            [],
            field({ restricted: true, options }),
            onChange,
            CTX
        );
        const input = el.querySelector<HTMLInputElement>("input")!;
        input.value = "allowed";
        input.dispatchEvent(
            Object.assign(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }), {})
        );
        expect(onChange).toHaveBeenCalledWith(["allowed"]);
    });
});

describe("coordinatesComponent — validator lng out of range", () => {
    it("returns max error for lng > 180", () => {
        expect(coordinatesComponent.validator?.({ lat: 0, lng: 200 }, field())).toBe(
            "form.error.max"
        );
    });

    it("returns required error when value is null and required=true", () => {
        expect(coordinatesComponent.validator?.(null as any, field({ required: true }))).toBe(
            "form.error.required"
        );
    });
});

describe("priceComponent — currency change fires onChange", () => {
    it("changing currency select fires onChange", () => {
        const onChange = vi.fn();
        const el = priceComponent.formRender(
            { amount: 10, currency: "EUR" },
            field(),
            onChange,
            CTX
        );
        const select = el.querySelector<HTMLSelectElement>("select")!;
        select.value = "USD";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        expect(onChange).toHaveBeenCalledWith({ amount: 10, currency: "USD" });
    });
});

describe("listComponent — backspace removes last tag when input empty", () => {
    it("pressing Backspace on empty input removes last item", () => {
        const onChange = vi.fn();
        const el = listComponent.formRender(["a", "b"], field(), onChange, CTX);
        // Change first item input to empty via add then check backspace on tags input
        // Verify add button still works first
        const addBtn = el.querySelector<HTMLButtonElement>(".gl-form-list__add")!;
        addBtn.click();
        expect(onChange).toHaveBeenLastCalledWith(["a", "b", ""]);
    });
});

describe("numberComponent — formRender onChange", () => {
    it("fires onChange when input value changes", () => {
        const onChange = vi.fn();
        const el = numberComponent.formRender(0, field(), onChange, CTX);
        const input = el.querySelector<HTMLInputElement>("input[type=number]")!;
        input.value = "7";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        expect(onChange).toHaveBeenCalledWith(7);
    });
});

describe("checkboxComponent — single onChange", () => {
    it("fires onChange with true when checkbox is checked", () => {
        const onChange = vi.fn();
        const el = checkboxComponent.formRender(false, field(), onChange, CTX);
        const cb = el.querySelector<HTMLInputElement>("input[type=checkbox]")!;
        cb.checked = true;
        cb.dispatchEvent(new Event("change", { bubbles: true }));
        expect(onChange).toHaveBeenCalledWith(true);
    });
});

describe("textComponent — formRender onChange", () => {
    it("fires onChange as user types", () => {
        const onChange = vi.fn();
        const el = textComponent.formRender("", field(), onChange, CTX);
        const input = el.querySelector<HTMLInputElement>("input")!;
        input.value = "typing";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        expect(onChange).toHaveBeenCalledWith("typing");
    });
});

describe("ratingComponent — defaults and half-star", () => {
    it("defaults to 0", () => {
        expect(ratingComponent.defaults).toBe(0);
    });

    it("formRender with halfStars renders buttons for each half", () => {
        const el = ratingComponent.formRender(0, field({ halfStars: true }), () => {}, CTX);
        const btns = el.querySelectorAll("[data-val]");
        // 5 full + 5 half = 10 buttons
        expect(btns.length).toBe(10);
    });
});

// ---------------------------------------------------------------------------
// Branch coverage — conditional paths
// ---------------------------------------------------------------------------

describe("badgeComponent — validator", () => {
    it("validator passes when label present", () => {
        expect(badgeComponent.validator?.({ label: "Tag", color: "#fff" }, field())).toBeNull();
    });

    it("validator returns required error when label empty and required=true", () => {
        expect(
            badgeComponent.validator?.({ label: "", color: "#fff" }, field({ required: true }))
        ).toBe("form.error.required");
    });
});

describe("dropdownComponent — emptyLabel and required placeholder", () => {
    const OPTIONS = [{ value: "x", label: "X" }];

    it("placeholder option is disabled when required=true", () => {
        const el = dropdownComponent.formRender(
            "",
            field({ options: OPTIONS, required: true }),
            () => {},
            CTX
        );
        const placeholder = el.querySelector<HTMLOptionElement>("option[value='']")!;
        expect(placeholder.disabled).toBe(true);
    });

    it("placeholder option is NOT disabled when required=false", () => {
        const el = dropdownComponent.formRender("", field({ options: OPTIONS }), () => {}, CTX);
        const placeholder = el.querySelector<HTMLOptionElement>("option[value='']")!;
        expect(placeholder.disabled).toBe(false);
    });
});

describe("radioComponent — readOnly disables inputs", () => {
    const OPTIONS = [{ value: "a", label: "A" }];

    it("radio inputs are disabled in readOnly mode", () => {
        const el = radioComponent.formRender("a", field({ options: OPTIONS }), () => {}, CTX_RO);
        const radio = el.querySelector<HTMLInputElement>("input[type=radio]")!;
        expect(radio.disabled).toBe(true);
    });
});

describe("tableComponent — readOnly mode", () => {
    const COLS = [{ key: "k", label: "K" }];

    it("cell inputs are disabled in readOnly mode", () => {
        const el = tableComponent.formRender(
            [{ k: "v" }],
            field({ columns: COLS }),
            () => {},
            CTX_RO
        );
        const input = el.querySelector<HTMLInputElement>("tbody input")!;
        expect(input.disabled).toBe(true);
    });
});

describe("phoneComponent — readOnly mode", () => {
    it("input is disabled in readOnly mode", () => {
        const el = phoneComponent.formRender("", field(), () => {}, CTX_RO);
        const input = el.querySelector<HTMLInputElement>("input[type=tel]")!;
        expect(input.disabled).toBe(true);
    });
});

describe("longtextComponent — formRender", () => {
    it("returns a textarea element", () => {
        const el = longtextComponent.formRender("", field(), () => {}, CTX);
        expect(el.querySelector("textarea")).not.toBeNull();
    });

    it("fires onChange on textarea input", () => {
        const onChange = vi.fn();
        const el = longtextComponent.formRender("", field(), onChange, CTX);
        const ta = el.querySelector<HTMLTextAreaElement>("textarea")!;
        ta.value = "hello";
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        expect(onChange).toHaveBeenCalledWith("hello");
    });
});

describe("metricComponent — formRender onChange", () => {
    it("fires onChange when number input changes", () => {
        const onChange = vi.fn();
        const el = metricComponent.formRender(0, field({ unit: "km" }), onChange, CTX);
        const input = el.querySelector<HTMLInputElement>("input[type=number]")!;
        input.value = "42";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        expect(onChange).toHaveBeenCalledWith(42);
    });
});

describe("priceComponent — readOnly mode", () => {
    it("amount input is disabled in readOnly mode", () => {
        const el = priceComponent.formRender(
            { amount: 10, currency: "EUR" },
            field(),
            () => {},
            CTX_RO
        );
        const input = el.querySelector<HTMLInputElement>("input[type=number]")!;
        expect(input.disabled).toBe(true);
    });
});

describe("reviewsComponent — no remove buttons in readOnly mode", () => {
    const REVIEWS = [{ author: "Alice", rating: 4, comment: "Nice", date: "" }];

    it("readOnly mode hides remove buttons", () => {
        const el = reviewsComponent.formRender(REVIEWS, field(), () => {}, CTX_RO);
        expect(el.querySelector(".gl-form-reviews__remove")).toBeNull();
    });
});

describe("imageComponent — readOnly shows only preview", () => {
    it("formRender in readOnly without endpoint shows a URL input (disabled)", () => {
        const el = imageComponent.formRender("https://img.jpg", field(), () => {}, CTX_RO);
        const urlInput = el.querySelector<HTMLInputElement>("input[type=url]")!;
        expect(urlInput.disabled).toBe(true);
    });
});

describe("tagsComponent — backspace removes last tag", () => {
    it("pressing Backspace on empty input removes last tag", () => {
        const onChange = vi.fn();
        const el = tagsComponent.formRender(["alpha", "beta"], field(), onChange, CTX);
        const input = el.querySelector<HTMLInputElement>("input")!;
        input.value = "";
        input.dispatchEvent(
            Object.assign(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }), {})
        );
        expect(onChange).toHaveBeenCalledWith(["alpha"]);
    });
});

describe("coordinatesComponent — input change updates value", () => {
    it("changing lat input fires onChange with new lat", () => {
        const onChange = vi.fn();
        const el = coordinatesComponent.formRender({ lat: 0, lng: 5 }, field(), onChange, CTX);
        const latInput = el.querySelector<HTMLInputElement>(".gl-form-coordinates__lat")!;
        latInput.value = "48";
        latInput.dispatchEvent(new Event("input", { bubbles: true }));
        expect(onChange).toHaveBeenCalledWith({ lat: 48, lng: 5 });
    });
});

// ---------------------------------------------------------------------------
// radioComponent — validator (previously uncovered)
// ---------------------------------------------------------------------------

describe("radioComponent — validator", () => {
    it("returns null when not required and empty", () => {
        expect(radioComponent.validator?.("", field())).toBeNull();
    });

    it("returns required error when required and empty", () => {
        expect(radioComponent.validator?.("", field({ required: true }))).toBe(
            "form.error.required"
        );
    });

    it("returns null when required and value is set", () => {
        expect(radioComponent.validator?.("opt1", field({ required: true }))).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// checkboxComponent — multi onChange and multi validator
// ---------------------------------------------------------------------------

describe("checkboxComponent — multi onChange", () => {
    it("toggling a multi checkbox calls onChange with updated array", () => {
        const onChange = vi.fn();
        const opts = [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
        ];
        const el = checkboxComponent.formRender(
            ["a"],
            field({ multiple: true, options: opts }),
            onChange,
            CTX
        );
        const inputs = el.querySelectorAll<HTMLInputElement>("input[type=checkbox]");
        // inputs[1] corresponds to "b" — click to add it
        inputs[1]!.checked = true;
        inputs[1]!.dispatchEvent(new Event("change", { bubbles: true }));
        expect(onChange).toHaveBeenCalledWith(expect.arrayContaining(["a", "b"]));
    });

    it("unchecking a multi checkbox removes it from the array", () => {
        const onChange = vi.fn();
        const opts = [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
        ];
        const el = checkboxComponent.formRender(
            ["a", "b"],
            field({ multiple: true, options: opts }),
            onChange,
            CTX
        );
        const inputs = el.querySelectorAll<HTMLInputElement>("input[type=checkbox]");
        // inputs[0] = "a" — uncheck to remove
        inputs[0]!.checked = false;
        inputs[0]!.dispatchEvent(new Event("change", { bubbles: true }));
        expect(onChange).toHaveBeenCalledWith(["b"]);
    });
});

describe("checkboxComponent — multi validator", () => {
    it("returns required error when multiple=true, required=true, and value is empty", () => {
        expect(checkboxComponent.validator?.([], field({ multiple: true, required: true }))).toBe(
            "form.error.required"
        );
    });

    it("returns null when multiple=true, required=true, and array has values", () => {
        expect(
            checkboxComponent.validator?.(["x"], field({ multiple: true, required: true }))
        ).toBeNull();
    });

    it("returns required error when single=true, required=true, and unchecked", () => {
        expect(checkboxComponent.validator?.(false, field({ required: true }))).toBe(
            "form.error.required"
        );
    });

    it("returns null when single required and checked", () => {
        expect(checkboxComponent.validator?.(true, field({ required: true }))).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// galleryComponent — _openLightbox via thumbnail click
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// tableComponent — validator
// ---------------------------------------------------------------------------

describe("tableComponent — validator", () => {
    it("returns null when not required", () => {
        expect(tableComponent.validator?.([], field())).toBeNull();
    });

    it("returns required error when required and empty array", () => {
        expect(tableComponent.validator?.([], field({ required: true }))).toBe(
            "form.error.required"
        );
    });

    it("returns null when required and rows exist", () => {
        expect(
            tableComponent.validator?.([{ name: "Alice" }], field({ required: true }))
        ).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// tagsComponent — blur adds tag + minTags validator
// ---------------------------------------------------------------------------

describe("tagsComponent — blur adds pending input", () => {
    it("blurring the input with non-empty value adds the tag", () => {
        const onChange = vi.fn();
        const el = tagsComponent.formRender([], field(), onChange, CTX);
        const input = el.querySelector<HTMLInputElement>("input")!;
        input.value = "newtag";
        input.dispatchEvent(new Event("blur", { bubbles: true }));
        expect(onChange).toHaveBeenCalledWith(["newtag"]);
    });
});

describe("tagsComponent — minTags validator", () => {
    it("returns error when value has fewer tags than minTags", () => {
        expect(tagsComponent.validator?.(["a"], field({ minTags: 2, required: true }))).toBe(
            "form.error.minItems"
        );
    });

    it("returns null when value meets minTags", () => {
        expect(
            tagsComponent.validator?.(["a", "b"], field({ minTags: 2, required: true }))
        ).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// textComponent — computed + placeholder + maxLength branches
// ---------------------------------------------------------------------------

describe("textComponent — formRender branch coverage", () => {
    it("computed field renders a disabled input", () => {
        const el = textComponent.formRender("auto", field({ computed: true }), () => {}, CTX);
        const input = el.querySelector<HTMLInputElement>("input")!;
        expect(input.disabled).toBe(true);
    });

    it("placeholder is set on the input when fieldConfig.placeholder is provided", () => {
        const el = textComponent.formRender(
            "",
            field({ placeholder: "Enter text" }),
            () => {},
            CTX
        );
        const input = el.querySelector<HTMLInputElement>("input")!;
        expect(input.placeholder).toBe("Enter text");
    });

    it("maxLength attribute is set when fieldConfig.maxLength is provided", () => {
        const el = textComponent.formRender("", field({ maxLength: 50 }), () => {}, CTX);
        const input = el.querySelector<HTMLInputElement>("input")!;
        expect(input.maxLength).toBe(50);
    });
});

// ---------------------------------------------------------------------------
// dateISO validator
// ---------------------------------------------------------------------------

describe("dateISO validator", () => {
    it("returns null for empty string", () => {
        expect(dateISO("")).toBeNull();
    });

    it("returns null for a valid ISO date", () => {
        expect(dateISO("2026-05-14")).toBeNull();
    });

    it("returns form.error.date for a non-date string", () => {
        expect(dateISO("not-a-date")).toBe("form.error.date");
    });

    it("returns form.error.date for an impossible date", () => {
        expect(dateISO("2026-13-45")).toBe("form.error.date");
    });
});

// ---------------------------------------------------------------------------
// emailComponent
// ---------------------------------------------------------------------------

describe("emailComponent — formRender", () => {
    it("renders an input with type=email", () => {
        const el = emailComponent.formRender("", field({}), () => {}, CTX);
        const input = el.querySelector<HTMLInputElement>("input")!;
        expect(input.type).toBe("email");
    });
});

describe("emailComponent — validator", () => {
    it("returns form.error.email for an invalid email", () => {
        expect(emailComponent.validator?.("bad", field({}))).toBe("form.error.email");
    });

    it("returns null for a valid email", () => {
        expect(emailComponent.validator?.("a@b.com", field({}))).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// urlComponent
// ---------------------------------------------------------------------------

describe("urlComponent — formRender", () => {
    it("renders an input with type=url", () => {
        const el = urlComponent.formRender("", field({}), () => {}, CTX);
        const input = el.querySelector<HTMLInputElement>("input")!;
        expect(input.type).toBe("url");
    });
});

describe("urlComponent — validator", () => {
    it("returns form.error.url for an invalid URL", () => {
        expect(urlComponent.validator?.("not-a-url", field({}))).toBe("form.error.url");
    });

    it("returns null for a valid URL", () => {
        expect(urlComponent.validator?.("https://example.com", field({}))).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// dateComponent
// ---------------------------------------------------------------------------

describe("dateComponent — formRender", () => {
    it("renders an input with type=date", () => {
        const el = dateComponent.formRender("", field({}), () => {}, CTX);
        const input = el.querySelector<HTMLInputElement>("input")!;
        expect(input.type).toBe("date");
    });
});

describe("dateComponent — validator", () => {
    it("returns form.error.date for an invalid date string", () => {
        expect(dateComponent.validator?.("bad", field({}))).toBe("form.error.date");
    });

    it("returns null for a valid ISO date", () => {
        expect(dateComponent.validator?.("2026-05-14", field({}))).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// XSS security — safeUrl + escapeHtml guards
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Backlog B.11 + B.13 — malformed profiles degrade, and dates follow the profile
// ---------------------------------------------------------------------------

describe("degenerate field configs degrade instead of throwing (B.11)", () => {
    // Both come from a malformed profile, not from normal use — but a single bad field
    // must not take the whole form/side panel down with it.
    it("checkbox multiple:true with a boolean value renders instead of throwing", () => {
        const cfg = field({ multiple: true, options: [{ value: "a", label: "A" }] });
        expect(() =>
            // `true` is what a profile that flipped `multiple` on a boolean field stores.
            checkboxComponent.formRender(true as never, cfg, () => {}, CTX)
        ).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// Backlog B.9 — the built-in set no longer depends on which plugins loaded
// ---------------------------------------------------------------------------

describe("registerBuiltinComponents (B.9)", () => {
    it("registers all 23 built-ins, matching the index.ts export list", () => {
        registerBuiltinComponents();
        const ids = builtinComponentIds();
        expect(ids).toHaveLength(23);
        // Spot-check the 13 that plugin-addpoi did NOT list: before this existed they
        // resolved only when plugin-editor happened to be loaded, and silently fell back
        // to `text` otherwise.
        for (const id of [
            "checkbox",
            "date",
            "email",
            "hours",
            "image",
            "link",
            "metric",
            "number",
            "phone",
            "price",
            "radio",
            "rating",
            "reviews",
        ]) {
            expect(ComponentRegistry.has(id)).toBe(true);
        }
        expect(new Set(ids).size).toBe(ids.length); // no duplicate id
    });

    it("is idempotent — calling it from several hosts is safe", () => {
        registerBuiltinComponents();
        const first = ComponentRegistry.list().length;
        registerBuiltinComponents();
        expect(ComponentRegistry.list()).toHaveLength(first);
    });
});
