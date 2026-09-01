/**
 * `sanitize.ts` — escapeHtml / validateUrl / safeUrl, exercised directly.
 *
 * Branch coverage work. This module sat at **45% branches and 66.66%
 * functions** while carrying the library's XSS boundary. It was only reached
 * **indirectly**, through the components (`urlComponent`, `linkComponent`,
 * `imageComponent`, `galleryComponent` in `field-renderer.test.ts`, security
 * section), and only on the "javascript: refused / https: accepted" pair.
 *
 * What that detour left entirely aside:
 *   · `validateUrl` **throws** — the components all go through `safeUrl`, which swallows;
 *   · the `data:` URL MIME whitelist — 6 types admitted, everything else refused;
 *   · `escapeHtml`'s coercion and null cases.
 *
 * A security boundary tested only through its callers is tested on the cases
 * its callers know. The others are the ones that cost.
 */
import { describe, it, expect } from "vitest";

import { escapeHtml, validateUrl, safeUrl } from "../sanitize.js";

describe("escapeHtml", () => {
    it("rend une chaîne vide pour null et undefined", () => {
        expect(escapeHtml(null)).toBe("");
        expect(escapeHtml(undefined)).toBe("");
    });

    it("neutralise les chevrons d'une charge <script>", () => {
        const out = escapeHtml('<script>alert("xss")</script>');

        expect(out).not.toContain("<script>");
        expect(out).toContain("&lt;script&gt;");
    });

    it("échappe l'esperluette", () => {
        expect(escapeHtml("Tom & Jerry")).toBe("Tom &amp; Jerry");
    });

    it("laisse passer un texte sans métacaractère", () => {
        expect(escapeHtml("Château d'eau")).toBe("Château d'eau");
    });

    it("coerce les non-chaînes plutôt que de jeter", () => {
        expect(escapeHtml(42 as unknown as string)).toBe("42");
        expect(escapeHtml(false as unknown as string)).toBe("false");
        expect(escapeHtml({} as unknown as string)).toBe("[object Object]");
    });

    it("rend la chaîne vide telle quelle — et non le repli de null", () => {
        // `str == null` is a deliberate `==`: "" must NOT fall into this branch.
        expect(escapeHtml("")).toBe("");
    });
});

describe("validateUrl — ce qui passe", () => {
    it("accepte http: et https:", () => {
        expect(validateUrl("https://example.com/a")).toContain("https://example.com/a");
        expect(validateUrl("http://example.com/b")).toContain("http://example.com/b");
    });

    it("rogne les espaces avant analyse", () => {
        expect(validateUrl("  https://example.com/c  ")).toContain("https://example.com/c");
    });

    it("résout une URL relative contre l'origine courante", () => {
        const href = validateUrl("/profiles/demo.json");

        expect(href).toContain("/profiles/demo.json");
        expect(href.startsWith("http")).toBe(true);
    });

    it("accepte les 6 types MIME image de la whitelist data:", () => {
        for (const mime of [
            "image/png",
            "image/jpeg",
            "image/jpg",
            "image/gif",
            "image/svg+xml",
            "image/webp",
        ]) {
            expect(() => validateUrl(`data:${mime};base64,AAAA`)).not.toThrow();
        }
    });

    it("accepte un data: sans paramètre ;base64", () => {
        // The pattern is `data:([^;,]+)`: the comma bounds as well as the semicolon.
        expect(() => validateUrl("data:image/png,AAAA")).not.toThrow();
    });
});

describe("validateUrl — ce qui jette", () => {
    it("refuse une entrée vide ou non-chaîne", () => {
        expect(() => validateUrl("")).toThrow(TypeError);
        expect(() => validateUrl(null as unknown as string)).toThrow(TypeError);
        expect(() => validateUrl(42 as unknown as string)).toThrow(TypeError);
    });

    it("refuse javascript: et vbscript:", () => {
        expect(() => validateUrl("javascript:alert(1)")).toThrow(/not allowed/);
        expect(() => validateUrl("vbscript:msgbox(1)")).toThrow(/not allowed/);
    });

    it("refuse file: et ftp:, absents de la whitelist", () => {
        expect(() => validateUrl("file:///etc/passwd")).toThrow(/not allowed/);
        expect(() => validateUrl("ftp://example.com/x")).toThrow(/not allowed/);
    });

    it("refuse data:text/html — le protocole passe, le MIME non", () => {
        // The case justifying the second guard: `data:` is in the protocol
        // whitelist, so only the MIME check stops this one.
        expect(() => validateUrl("data:text/html,<script>alert(1)</script>")).toThrow(
            /data: URL type not allowed/
        );
    });

    it("refuse un data: de type image inconnu", () => {
        expect(() => validateUrl("data:image/tiff;base64,AAAA")).toThrow(
            /data: URL type not allowed/
        );
    });

    it("refuse un data: sans type analysable", () => {
        expect(() => validateUrl("data:,rien")).toThrow(/data: URL type not allowed/);
    });

    it("le message d'erreur MIME énumère les types admis", () => {
        // This message is what the integrator who gets the format wrong sees;
        // it must carry the answer, not just the refusal.
        expect(() => validateUrl("data:application/pdf;base64,AAAA")).toThrow(/image\/png/);
    });
});

describe("safeUrl", () => {
    it("rend la même valeur que validateUrl quand l'URL est valide", () => {
        expect(safeUrl("https://example.com/ok")).toBe(validateUrl("https://example.com/ok"));
    });

    it("avale ce que validateUrl jette et rend une chaîne vide", () => {
        expect(safeUrl("javascript:alert(1)")).toBe("");
        expect(safeUrl("data:text/html,<script>")).toBe("");
        expect(safeUrl("")).toBe("");
    });

    it("rend une chaîne vide sur une URL syntaxiquement invalide", () => {
        // `new URL()` throws here, and `safeUrl` is what absorbs — not the whitelist.
        expect(safeUrl("http://[")).toBe("");
        expect(safeUrl("https://exa mple.com")).toBe("");
    });

    it("ne jette jamais, quelle que soit l'entrée", () => {
        for (const input of [
            "://",
            "http://[",
            null as unknown as string,
            undefined as unknown as string,
            {} as unknown as string,
            [] as unknown as string,
        ]) {
            expect(() => safeUrl(input)).not.toThrow();
        }
    });

    it("« :// » n'est PAS malformé — c'est un chemin relatif, et il est accepté", () => {
        // Counter-intuitive, and written here because this test's first
        // version expected it empty: `new URL("://", origin)` resolves to
        // `<origin>/://`. The resulting protocol is the page's (http/https),
        // so the whitelist lets it through. Nothing to fix in `sanitize.ts` —
        // it is the semantics of relative resolution, and the protocol guard
        // does apply to the result.
        expect(safeUrl("://")).toContain("://");
        expect(safeUrl("://").startsWith("http")).toBe(true);
    });
});
