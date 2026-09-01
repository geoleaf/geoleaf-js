/**
 * Covers the modules extracted at PLUGINS S2 — `types/field-base.ts` (field
 * scaffolding shared by the simple types and the option groups) and
 * `types/field-media.ts` (image upload, lightbox, source hardening).
 *
 * These carry the parameterised branches that no single field type exercises on
 * its own, plus the security-relevant `_safeImageSrc`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { FieldConfig } from "../contract.js";
// ⚠️ `_linkSidepanel` and `_readonlyPair` were removed from this list: they
// no longer exist, and their test blocks had gone with them — but **the
// import had stayed**. The suite still passed, vite resolving the missing
// specifier to `undefined` without throwing: a dead import no test exercises
// is silent. It only showed at the manual survey — neither `tsc`, nor
// vitest, nor the package typecheck had flagged it.
import {
    _errorSlot,
    _fieldWrap,
    _formLabel,
    _renderOptionGroup,
    _renderSimpleField,
} from "../types/field-base.js";
import {
    ACCEPTED_ACCEPT,
    ACCEPTED_MIME,
    _createObjectUrl,
    _openLightbox,
    _safeImageSrc,
    _uploadFile,
    _validateFile,
} from "../types/field-media.js";

const cfg = (extra: Record<string, unknown> = {}): FieldConfig =>
    ({ id: "fld", type: "t", label: "Label", ...extra }) as FieldConfig;

afterEach(() => {
    document.querySelectorAll(".gl-lightbox").forEach((n) => n.remove());
    vi.unstubAllGlobals();
});

describe("_base — primitives", () => {
    it("_fieldWrap carries the base class and the per-type modifier", () => {
        expect(_fieldWrap("text").className).toBe("gl-form-field gl-form-text");
    });

    it("_formLabel marks required fields and leaves optional ones unmarked", () => {
        expect(_formLabel(cfg()).dataset.required).toBeUndefined();
        expect(_formLabel(cfg({ required: true })).dataset.required).toBe("true");
        expect(_formLabel(cfg()).textContent).toBe("Label");
    });

    it("_errorSlot starts hidden", () => {
        const el = _errorSlot();
        expect(el.className).toBe("gl-form-error");
        expect(el.hidden).toBe(true);
    });
});

describe("_base — _renderSimpleField", () => {
    const build = (extra: Record<string, unknown> = {}, ctxExtra = {}) =>
        _renderSimpleField<string>({
            kind: "text",
            inputType: "text",
            setValue: (input, value) => {
                input.value = value ?? "";
            },
            read: (input) => input.value,
            applyAttrs: (input, c) => {
                if (c.placeholder) input.placeholder = String(c.placeholder);
            },
        })("v", cfg(extra), () => {}, { lang: "fr", ...ctxExtra });

    it("pairs htmlFor with the input id", () => {
        const wrap = build();
        const input = wrap.querySelector("input")!;
        expect(input.id).toBe("gl-field-fld");
        expect(wrap.querySelector("label")!.htmlFor).toBe("gl-field-fld");
    });

    it("applies the per-type attributes through applyAttrs", () => {
        expect(build({ placeholder: "P" }).querySelector("input")!.placeholder).toBe("P");
    });

    it("disables on ctx.readOnly and on a computed field alike", () => {
        expect(build({}, { readOnly: true }).querySelector("input")!.disabled).toBe(true);
        expect(build({ computed: "geometry.length" }).querySelector("input")!.disabled).toBe(true);
        expect(build().querySelector("input")!.disabled).toBe(false);
    });

    it("emits the value read back off the input and clears the error slot", () => {
        const seen: string[] = [];
        const wrap = _renderSimpleField<string>({
            kind: "text",
            inputType: "text",
            setValue: (i, v) => {
                i.value = v ?? "";
            },
            read: (i) => i.value.toUpperCase(),
        })("a", cfg(), (v) => seen.push(v), { lang: "fr" });

        const input = wrap.querySelector("input")!;
        const err = wrap.querySelector<HTMLElement>(".gl-form-error")!;
        err.hidden = false;
        input.value = "zz";
        input.dispatchEvent(new Event("input"));

        expect(seen).toEqual(["ZZ"]);
        expect(err.hidden).toBe(true);
    });

    it("routes the input through wrapInput when the type provides one", () => {
        const wrap = _renderSimpleField<string>({
            kind: "metric",
            inputType: "number",
            setValue: () => {},
            read: (i) => i.value,
            wrapInput: (input) => {
                const row = document.createElement("div");
                row.className = "gl-form-metric__row";
                row.appendChild(input);
                return row;
            },
        })("", cfg(), () => {}, { lang: "fr" });

        expect(wrap.children[1].className).toBe("gl-form-metric__row");
        expect(wrap.children[1].querySelector("input")).not.toBeNull();
    });
});

describe("_base — _renderOptionGroup", () => {
    const OPTIONS = [
        { value: "a", label: "Alpha" },
        { value: "b", label: "Bravo" },
    ];

    it("names the inputs only when the spec asks for it (radio semantics)", () => {
        const named = _renderOptionGroup(OPTIONS, cfg(), {
            groupClass: "gl-form-field gl-form-radio-group",
            itemClass: "gl-form-radio__item",
            inputType: "radio",
            named: true,
            isChecked: () => false,
            onToggle: () => {},
        });
        expect(named.querySelectorAll("input[name='gl-field-fld']")).toHaveLength(2);

        const unnamed = _renderOptionGroup(OPTIONS, cfg(), {
            groupClass: "gl-form-field gl-form-checkbox-group",
            itemClass: "gl-form-checkbox__item",
            inputType: "checkbox",
            isChecked: () => false,
            onToggle: () => {},
        });
        expect(unnamed.querySelector("input")!.getAttribute("name")).toBeNull();
    });

    it("uses the class lists it is given verbatim", () => {
        const group = _renderOptionGroup(OPTIONS, cfg(), {
            groupClass: "gl-form-field gl-form-checkbox-group",
            itemClass: "gl-form-checkbox__item",
            inputType: "checkbox",
            isChecked: () => false,
            onToggle: () => {},
        });
        expect(group.className).toBe("gl-form-field gl-form-checkbox-group");
        expect(group.querySelector(".gl-form-checkbox__item")).not.toBeNull();
    });

    it("marks the legend required and pre-checks via isChecked", () => {
        const group = _renderOptionGroup(OPTIONS, cfg({ required: true }), {
            groupClass: "gl-form-field gl-form-radio-group",
            itemClass: "gl-form-radio__item",
            inputType: "radio",
            isChecked: (o) => o.value === "b",
            onToggle: () => {},
        });
        expect(group.querySelector("legend")!.dataset.required).toBe("true");
        expect(group.querySelectorAll<HTMLInputElement>("input:checked")).toHaveLength(1);
    });

    it("disables every input under readOnly and fires onToggle otherwise", () => {
        const ro = _renderOptionGroup(OPTIONS, cfg(), {
            groupClass: "gl-form-field gl-form-radio-group",
            itemClass: "gl-form-radio__item",
            inputType: "radio",
            readOnly: true,
            isChecked: () => false,
            onToggle: () => {},
        });
        expect([...ro.querySelectorAll("input")].every((i) => i.disabled)).toBe(true);

        const seen: string[] = [];
        const live = _renderOptionGroup(OPTIONS, cfg(), {
            groupClass: "gl-form-field gl-form-checkbox-group",
            itemClass: "gl-form-checkbox__item",
            inputType: "checkbox",
            isChecked: () => false,
            onToggle: (opt) => seen.push(opt.value),
        });
        live.querySelectorAll("input")[1].dispatchEvent(new Event("change"));
        expect(seen).toEqual(["b"]);
    });

    it("renders an empty group when there are no options", () => {
        const group = _renderOptionGroup([], cfg(), {
            groupClass: "gl-form-field gl-form-radio-group",
            itemClass: "gl-form-radio__item",
            inputType: "radio",
            isChecked: () => false,
            onToggle: () => {},
        });
        expect(group.querySelectorAll("input")).toHaveLength(0);
        expect(group.querySelector(".gl-form-error")).not.toBeNull();
    });
});

describe("_media — source hardening", () => {
    it("passes http(s) through and blanks a javascript: URL", () => {
        expect(_safeImageSrc("https://example.org/a.png")).toBe("https://example.org/a.png");
        expect(_safeImageSrc("javascript:alert(1)")).toBe("");
    });

    it("allows an object URL it minted, but not a foreign blob: URL", () => {
        const file = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
        const own = _createObjectUrl(file);
        expect(own).toMatch(/^blob:/);
        // `safeUrl` does not whitelist blob:; without the own-URL allowance the
        // local preview would be blanked. This is the regression guard.
        expect(_safeImageSrc(own)).toBe(own);
        expect(_safeImageSrc("blob:https://evil.example/deadbeef")).toBe("");
    });

    it("exposes the accept list as a comma-joined MIME string", () => {
        expect(ACCEPTED_ACCEPT).toBe(ACCEPTED_MIME.join(","));
        expect(ACCEPTED_MIME).toContain("image/png");
    });
});

describe("_media — _openLightbox", () => {
    it("appends an overlay that removes itself on click", () => {
        _openLightbox("https://example.org/a.png");
        const overlay = document.querySelector<HTMLElement>(".gl-lightbox")!;
        expect(overlay).not.toBeNull();
        expect(overlay.querySelector("img")!.getAttribute("src")).toBe("https://example.org/a.png");
        overlay.dispatchEvent(new Event("click"));
        expect(document.querySelector(".gl-lightbox")).toBeNull();
    });

    it("opens nothing for a source outside the protocol whitelist", () => {
        _openLightbox("javascript:alert(1)");
        expect(document.querySelector(".gl-lightbox")).toBeNull();
    });
});

describe("_media — _uploadFile", () => {
    const file = new File([new Uint8Array([1, 2])], "a.png", { type: "image/png" });

    it("POSTs multipart and returns the url from the JSON body", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ url: "https://cdn.example/a.png" }),
        });
        vi.stubGlobal("fetch", fetchMock);

        await expect(_uploadFile(file, "/upload")).resolves.toBe("https://cdn.example/a.png");
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/upload");
        expect(init.method).toBe("POST");
        expect(init.body).toBeInstanceOf(FormData);
    });

    it("throws with the status when the response is not ok", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 507 }));
        await expect(_uploadFile(file, "/upload")).rejects.toThrow("Upload failed: HTTP 507");
    });
});

describe("_media — _validateFile", () => {
    it("rejects an unsupported MIME type before checking the size", () => {
        const bad = new File([new Uint8Array(1)], "a.pdf", { type: "application/pdf" });
        expect(_validateFile(bad, 5)).toBe("form.error.imageType");
    });

    it("rejects a file over the size budget", () => {
        const big = new File([new Uint8Array(3 * 1024 * 1024)], "a.png", { type: "image/png" });
        expect(_validateFile(big, 1)).toBe("form.error.imageSize");
    });

    it("accepts a supported file within budget", () => {
        const ok = new File([new Uint8Array(16)], "a.webp", { type: "image/webp" });
        expect(_validateFile(ok, 1)).toBeNull();
    });
});
