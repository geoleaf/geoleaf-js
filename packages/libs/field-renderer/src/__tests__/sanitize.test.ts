/**
 * `sanitize.ts` — escapeHtml / validateUrl / safeUrl, exercés directement.
 *
 * Backlog R.2 (couverture des branches). Ce module était à **45 % de branches et 66,66 %
 * de fonctions** alors qu'il porte la frontière XSS de la bibliothèque. Il n'était atteint
 * qu'**indirectement**, par les composants (`urlComponent`, `linkComponent`, `imageComponent`,
 * `galleryComponent` dans `field-renderer.test.ts` §S2.2), et uniquement sur le couple
 * « javascript: refusé / https: accepté ».
 *
 * Ce que ce détour laissait entièrement de côté :
 *   · `validateUrl` **jette** — les composants passent tous par `safeUrl`, qui avale ;
 *   · la whitelist de MIME des `data:` URL — 6 types admis, tout le reste refusé ;
 *   · la coercition et les cas nuls d'`escapeHtml`.
 *
 * Une frontière de sécurité testée seulement à travers ses appelants est testée sur les
 * cas que ses appelants connaissent. Ce sont les autres qui coûtent cher.
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
        // `str == null` est un `==` volontaire : "" ne doit PAS tomber dans cette branche.
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
        // Le motif est `data:([^;,]+)` : la virgule borne aussi bien que le point-virgule.
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
        // Le cas qui justifie la seconde garde : `data:` est dans la whitelist de
        // protocoles, donc seul le contrôle de MIME arrête celui-ci.
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
        // Ce message est ce que voit l'intégrateur qui se trompe de format ; il doit
        // porter la réponse, pas seulement le refus.
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
        // `new URL()` jette ici, et c'est `safeUrl` qui absorbe — pas la whitelist.
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
        // Contre-intuitif, et écrit ici parce que la première version de ce test
        // l'attendait vide : `new URL("://", origin)` résout en `<origin>/://`. Le
        // protocole résultant est celui de la page (http/https), donc la whitelist
        // laisse passer. Rien à corriger dans `sanitize.ts` — c'est la sémantique de
        // la résolution relative, et la garde de protocole s'applique bien au résultat.
        expect(safeUrl("://")).toContain("://");
        expect(safeUrl("://").startsWith("http")).toBe(true);
    });
});
