/**
 * Guard MRS — a rule of the modal's shared classes is written ONCE across the two libraries
 * that write those classes.
 *
 * ## Why two libraries write the same classes
 *
 * `@geoleaf/host-runtime` builds the dialogs — an overlay, a panel, a footer, buttons — and
 * ships their stylesheets. `@geoleaf/field-renderer` builds the form's modal out of the same
 * classes, without going through the dialog's code. Until 04/10/2026 each carried its own copy
 * of the eighteen rules, "to stay byte-equivalent": nothing checked it, and since every bundle
 * adopts its sheets when it first needs them, the copy adopted LAST won every tie. A drawer
 * lost its anchoring to the other copy that way.
 *
 * The rules now live in host-runtime alone, and the form adopts those sheets
 * (`ui/host-sheets.ts`). This guard is what keeps a second copy from coming back.
 *
 *   MRS-01  both sides are read, and each holds rules. The rule guarding the guard: a reader
 *           that finds nothing would compare nothing and stay green.
 *   MRS-02  no selector of host-runtime's modal sheets is a selector of a form sheet — at the
 *           top level and inside every `@media` block alike.
 *   MRS-03  the form adopts host-runtime's two sheets, and does so before its own are injected.
 *
 * ⚠️ What this does NOT judge: a form rule that TIES with a host rule under another selector.
 * That one is covered where it shows — `e2e/42`, which opens another bundle's dialog after the
 * form and reads the form back.
 *
 * ## Proof by mutation — to replay before believing this guard
 *
 * Pasting `.gl-form-modal__footer { display: flex; }` into the form's `form-modal-base.css`
 * must turn MRS-02 red, and so must pasting `.gl-form-modal__btn-save { min-height: 44px; }`
 * inside the `@media` block of `form-touch.css`. Moving the `host-sheets.js` import below the
 * stylesheet imports of `responsive-modal.ts` must turn MRS-03 red.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../../..");

// `packages.cjs` is the packages' single registry, and it THROWS when a package is not found —
// which is why no `packages/<name>` path is written here by hand.
const packages = createRequire(import.meta.url)(path.join(REPO, "scripts/lib/packages.cjs"));

const HOST_CSS = path.join(packages.requireByDirName("host-runtime").absDir, "src/css");
const FORM_SRC = path.join(packages.requireByDirName("field-renderer").absDir, "src");
/** The sheets whose rules the form borrows. The tooltip's are not the modal's. */
const HOST_MODAL_SHEETS = ["modal-shell.lazy.css", "confirm-dialog.lazy.css"];

/**
 * Every selector of a stylesheet, one entry per comma-separated member, each prefixed by the
 * `@media` condition it sits under — `""` at the top level. `@keyframes` are named whole.
 */
function selectorsOf(file: string): Set<string> {
    const css = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const found = new Set<string>();
    const walk = (block: string, scope: string): void => {
        let depth = 0;
        let head = 0;
        let open = 0;
        for (let i = 0; i < block.length; i++) {
            if (block[i] === "{") {
                if (depth === 0) open = i;
                depth++;
            } else if (block[i] === "}") {
                depth--;
                if (depth !== 0) continue;
                const prelude = block.slice(head, open).replace(/\s+/g, " ").trim();
                const body = block.slice(open + 1, i);
                head = i + 1;
                if (prelude.startsWith("@media")) walk(body, `${prelude} `);
                else if (prelude.startsWith("@")) found.add(`${scope}${prelude}`);
                else for (const member of prelude.split(",")) found.add(`${scope}${member.trim()}`);
            }
        }
    };
    walk(css, "");
    return found;
}

const hostSelectors = new Set(
    HOST_MODAL_SHEETS.flatMap((name) => [...selectorsOf(path.join(HOST_CSS, name))])
);
const formSheets = fs
    .readdirSync(path.join(FORM_SRC, "css"))
    .filter((name) => name.endsWith(".css"))
    .sort();

describe("garde — une règle de la modale n'est écrite qu'une fois", () => {
    it("MRS-01 : les deux côtés sont lus, et portent des règles", () => {
        expect(hostSelectors.size, "aucune règle lue dans host-runtime").toBeGreaterThan(15);
        expect(formSheets.length, "aucune feuille lue dans field-renderer").toBeGreaterThan(0);
        for (const name of formSheets) {
            expect(
                selectorsOf(path.join(FORM_SRC, "css", name)).size,
                `aucune règle lue dans ${name}`
            ).toBeGreaterThan(0);
        }
    });

    it("MRS-02 : aucun sélecteur de host-runtime n'est récrit par une feuille du formulaire", () => {
        const twice = formSheets.flatMap((name) =>
            [...selectorsOf(path.join(FORM_SRC, "css", name))]
                .filter((selector) => hostSelectors.has(selector))
                .map((selector) => `${name} : ${selector}`)
        );
        expect(twice, "règles écrites des deux côtés").toEqual([]);
    });

    it("MRS-03 : le formulaire adopte les deux feuilles, avant d'injecter les siennes", () => {
        const adoption = fs.readFileSync(path.join(FORM_SRC, "ui/host-sheets.ts"), "utf8");
        expect(adoption).toMatch(/^adoptModalShellSheet\(\);$/m);
        expect(adoption).toMatch(/^adoptConfirmDialogSheet\(\);$/m);

        const modal = fs.readFileSync(path.join(FORM_SRC, "ui/responsive-modal.ts"), "utf8");
        const imports = [...modal.matchAll(/^import "([^"]+)";$/gm)].map((match) => match[1] ?? "");
        expect(imports[0], "le premier import à effet de bord n'est pas l'adoption").toBe(
            "./host-sheets.js"
        );
        expect(
            imports.slice(1).every((specifier) => specifier.endsWith(".css")),
            "un import à effet de bord inattendu suit l'adoption"
        ).toBe(true);
        expect(imports.length, "aucune feuille du formulaire n'est importée").toBeGreaterThan(1);
    });
});
