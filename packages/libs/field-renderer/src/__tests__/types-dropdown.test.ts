/**
 * `types/dropdown.ts` — branch coverage.
 *
 * 40% branches and 60% functions at the start. `field-renderer.test.ts` only
 * exercised the static list; **the whole `fetchOptions` path was dead to the
 * measure** — the disabled waiting state, the `<select>` replacement after
 * the response, the loading indicator and the network-failure branch (lines 103-126).
 *
 * ⚠️ File separate from `field-renderer.test.ts` (2,074 l.) — see the header
 * of `types-gallery.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { FieldConfig, RenderCtx } from "../contract.js";
import { dropdownComponent } from "../types/dropdown.js";

const CTX: RenderCtx = { lang: "fr" };
const CTX_RO: RenderCtx = { lang: "fr", readOnly: true };

const OPTIONS = [
    { value: "a", label: "Alpha" },
    { value: "b", label: "Bravo" },
];

function field(overrides: Partial<FieldConfig> = {}): FieldConfig {
    return { id: "kind", type: "dropdown", label: "Type", ...overrides };
}

beforeEach(() => {
    document.body.innerHTML = "";
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

// ─── formRender — liste statique ─────────────────────────────────────────────────

describe("dropdown.formRender — liste statique", () => {
    it("pose un placeholder puis une option par entrée", () => {
        const el = dropdownComponent.formRender!("", field({ options: OPTIONS }), vi.fn(), CTX);
        const options = el.querySelectorAll("option");

        expect(options.length).toBe(3);
        expect(options[0].value).toBe("");
        expect(options[1].value).toBe("a");
    });

    it("sélectionne la valeur courante", () => {
        const el = dropdownComponent.formRender!("b", field({ options: OPTIONS }), vi.fn(), CTX);

        expect(el.querySelector<HTMLSelectElement>("select")!.value).toBe("b");
    });

    it("emptyLabel devient le texte du placeholder", () => {
        const el = dropdownComponent.formRender!(
            "",
            field({ options: OPTIONS, emptyLabel: "Choisir…" }),
            vi.fn(),
            CTX
        );

        expect(el.querySelector("option")!.textContent).toBe("Choisir…");
    });

    it("sans emptyLabel le placeholder reste vide", () => {
        const el = dropdownComponent.formRender!("", field({ options: OPTIONS }), vi.fn(), CTX);

        expect(el.querySelector("option")!.textContent).toBe("");
    });

    it("un champ requis rend le placeholder inchoisissable", () => {
        const el = dropdownComponent.formRender!(
            "",
            field({ options: OPTIONS, required: true }),
            vi.fn(),
            CTX
        );

        expect(el.querySelector<HTMLOptionElement>("option")!.disabled).toBe(true);
        expect(el.querySelector<HTMLLabelElement>("label")!.dataset.required).toBe("true");
    });

    it("un champ facultatif le laisse choisissable", () => {
        const el = dropdownComponent.formRender!("", field({ options: OPTIONS }), vi.fn(), CTX);

        expect(el.querySelector<HTMLOptionElement>("option")!.disabled).toBe(false);
    });

    it("lie le libellé au select par son identifiant", () => {
        const el = dropdownComponent.formRender!("", field({ options: OPTIONS }), vi.fn(), CTX);

        expect(el.querySelector<HTMLLabelElement>("label")!.htmlFor).toBe("gl-field-kind");
        expect(el.querySelector<HTMLSelectElement>("select")!.id).toBe("gl-field-kind");
    });

    it("désactive le select en lecture seule", () => {
        const el = dropdownComponent.formRender!("", field({ options: OPTIONS }), vi.fn(), CTX_RO);

        expect(el.querySelector<HTMLSelectElement>("select")!.disabled).toBe(true);
    });

    it("notifie la nouvelle valeur au changement", () => {
        const onChange = vi.fn();
        const el = dropdownComponent.formRender!("", field({ options: OPTIONS }), onChange, CTX);
        const select = el.querySelector<HTMLSelectElement>("select")!;

        select.value = "a";
        select.dispatchEvent(new Event("change"));

        expect(onChange).toHaveBeenCalledWith("a");
    });
});

// ─── formRender — options distantes ──────────────────────────────────────────────

describe("dropdown.formRender — fetchOptions", () => {
    it("rend un select désactivé et un indicateur pendant le chargement", () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(() => new Promise(() => {}))
        );
        const el = dropdownComponent.formRender!(
            "",
            field({ fetchOptions: "/opts" }),
            vi.fn(),
            CTX
        );

        expect(el.querySelector<HTMLSelectElement>("select")!.disabled).toBe(true);
        expect(el.querySelector(".gl-form-dropdown__spinner")).not.toBeNull();
    });

    it("remplace le select par la liste reçue et retire l'indicateur", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(OPTIONS) })
        );
        const el = dropdownComponent.formRender!(
            "b",
            field({ fetchOptions: "/opts" }),
            vi.fn(),
            CTX
        );

        await vi.waitFor(() => expect(el.querySelectorAll("option").length).toBe(3));

        expect(el.querySelector(".gl-form-dropdown__spinner")).toBeNull();
        const select = el.querySelector<HTMLSelectElement>("select")!;
        expect(select.disabled).toBe(false);
        // The original value is reapplied on the new select.
        expect(select.value).toBe("b");
        // And it keeps the id the label is tied to.
        expect(select.id).toBe("gl-field-kind");
    });

    it("le select remplacé reste branché sur onChange", async () => {
        const onChange = vi.fn();
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(OPTIONS) })
        );
        const el = dropdownComponent.formRender!(
            "",
            field({ fetchOptions: "/opts" }),
            onChange,
            CTX
        );
        await vi.waitFor(() => expect(el.querySelectorAll("option").length).toBe(3));

        const select = el.querySelector<HTMLSelectElement>("select")!;
        select.value = "a";
        select.dispatchEvent(new Event("change"));

        expect(onChange).toHaveBeenCalledWith("a");
    });

    it("une réponse HTTP en erreur affiche le message d'échec", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
        const el = dropdownComponent.formRender!(
            "",
            field({ fetchOptions: "/opts" }),
            vi.fn(),
            CTX
        );

        await vi.waitFor(() =>
            expect(el.querySelector<HTMLElement>(".gl-form-error")!.hidden).toBe(false)
        );

        expect(el.querySelector(".gl-form-dropdown__spinner")).toBeNull();
    });

    it("un rejet réseau affiche le même message", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
        const el = dropdownComponent.formRender!(
            "",
            field({ fetchOptions: "/opts" }),
            vi.fn(),
            CTX
        );

        await vi.waitFor(() =>
            expect(el.querySelector<HTMLElement>(".gl-form-error")!.hidden).toBe(false)
        );
    });

    it("un JSON illisible bascule aussi sur l'erreur", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.reject(new SyntaxError("Unexpected token")),
            })
        );
        const el = dropdownComponent.formRender!(
            "",
            field({ fetchOptions: "/opts" }),
            vi.fn(),
            CTX
        );

        await vi.waitFor(() =>
            expect(el.querySelector<HTMLElement>(".gl-form-error")!.hidden).toBe(false)
        );
    });

    it("une liste vide laisse le placeholder seul, sans erreur", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
        );
        const el = dropdownComponent.formRender!(
            "",
            field({ fetchOptions: "/opts" }),
            vi.fn(),
            CTX
        );

        await vi.waitFor(() => expect(el.querySelector(".gl-form-dropdown__spinner")).toBeNull());

        expect(el.querySelectorAll("option").length).toBe(1);
        expect(el.querySelector<HTMLElement>(".gl-form-error")!.hidden).toBe(true);
    });
});

// ─── validator ───────────────────────────────────────────────────────────────────

describe("dropdown.validator", () => {
    it("accepte une valeur vide quand le champ n'est pas requis", () => {
        expect(dropdownComponent.validator!("", field())).toBeNull();
    });

    it("refuse une valeur vide quand le champ est requis", () => {
        expect(dropdownComponent.validator!("", field({ required: true }))).not.toBeNull();
    });

    it("accepte une valeur renseignée quand le champ est requis", () => {
        expect(dropdownComponent.validator!("a", field({ required: true }))).toBeNull();
    });
});
