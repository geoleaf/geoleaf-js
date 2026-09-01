/*!
 * Tests — does the plugin's i18n catalogue say everything the plugin asks for?
 *
 * 🛑 **THIS GUARD IS BORN FROM A LIVE DEFECT — AND FROM ITS OWN ABSENCE.**
 * `editor.modal.btn.delete` was read by the **shared library**
 * (`field-renderer/src/ui/responsive-modal.ts`) on the delete button **this
 * plugin arms itself** (`entry.ts`, `onDelete`), and it was declared **in
 * none** of its six locales: only `addpoi` carried it. In `deploy-full` —
 * editor without addpoi — the button thus displayed **the raw key**. Fixing it
 * without setting this guard would have let the defect return at the first
 * omission: measured, removing the key from one locale left all 447 tests green.
 *
 * ⚠️ **WHAT THE GUARD MUST SCAN, AND WHY THAT IS THE POINT.** A guard reading
 * only `editor/src/**` **would have missed this precise defect** — the key is
 * written nowhere there. The sweep therefore includes the **field-rendering
 * library**, of which this plugin is the main consumer and which resolves
 * `editor.*` keys on its behalf. Exactly the blindness the corollary "the
 * preflight carries the blindness it measures" names.
 *
 * ⚠️ `GeoLeaf.I18n.getLabel` returns **the key** when it does not know it —
 * that is its contract, not `undefined`. So nothing turns red at runtime: a
 * missing label is indistinguishable from a correct one, except by eye. Hence
 * a **static** guard.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// ⚠️ Prefixed `L_`: the Italian locale would import under the name `it`,
// already vitest's test function — the collision breaks the parser, not the test.
import L_fr from "../lang/lang-fr.js";
import L_en from "../lang/lang-en.js";
import L_es from "../lang/lang-es.js";
import L_de from "../lang/lang-de.js";
import L_it from "../lang/lang-it.js";
import L_pt from "../lang/lang-pt.js";

const ALL: Record<string, Record<string, string>> = {
    fr: L_fr,
    en: L_en,
    es: L_es,
    de: L_de,
    it: L_it,
    pt: L_pt,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../../..");

/** Swept directories — the plugin AND the lib resolving `editor.*` keys for it. */
const SCANNED = [
    path.join(REPO_ROOT, "packages/plugins/editor/src"),
    path.join(REPO_ROOT, "packages/libs/field-renderer/src"),
];

/** `"editor.<some.thing>"` inside a string literal. */
const KEY_RE = /["'`](editor\.[a-zA-Z0-9_.]+)["'`]/g;

/**
 * Strips block and line comments before the sweep.
 *
 * ⚠️ **Without this, the guard counts PROSE as code**, and that is measured:
 * the first run flagged `editor.save` / `editor.update` / `editor.delete` as
 * "read but undeclared". They are the old **queue operation vocabulary**,
 * cited in two documentation blocks — never i18n keys. A guard that throws on
 * prose gets disarmed, not fixed: the exception list would have grown until it
 * guarded nothing.
 */
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Scanned source files, excluding tests, mocks and dictionaries. */
function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (/^(__tests__|__mocks__|dist|node_modules)$/.test(e.name)) continue;
            out.push(...sourceFiles(p));
        } else if (/\.(ts|js)$/.test(e.name) && !/\.test\.|\.spec\./.test(e.name)) {
            if (path.basename(path.dirname(p)) === "lang") continue;
            out.push(p);
        }
    }
    return out;
}

/**
 * ⚠️ Keys built at runtime, hence invisible to the scan and legitimately absent
 * from the dictionaries. Every entry here carries its motive — a motiveless
 * list becomes a catch-all again, and the guard stops guarding.
 */
const DYNAMIC_PREFIXES = [
    // `editor.history.op.<type>` — assembled from the operation type (`undo-stack.ts`).
    "editor.history.op.",
    // `editor.tool.<id>.label|hint` — assembled from the tool identifier.
    "editor.tool.",
    // `editor.sync.kind.<kind>` — assembled from the queue operation kind.
    "editor.sync.kind.",
];

const files = SCANNED.flatMap(sourceFiles);
const used = new Set<string>();
for (const f of files) {
    const text = stripComments(fs.readFileSync(f, "utf8"));
    for (const m of text.matchAll(KEY_RE)) {
        const k = m[1]!;
        if (DYNAMIC_PREFIXES.some((p) => k.startsWith(p) && k !== p)) continue;
        used.add(k);
    }
}

describe("le corpus scanné", () => {
    // Anti-empty-guard: a guard that reads nothing comes out green guarding nothing.
    it("lit réellement des fichiers dans les DEUX répertoires", () => {
        for (const dir of SCANNED) {
            expect(sourceFiles(dir).length, `aucun fichier scanné dans ${dir}`).toBeGreaterThan(0);
        }
    });

    it("trouve des clés `editor.*` à confronter", () => {
        expect(used.size).toBeGreaterThan(10);
    });

    it("🛑 voit les clés écrites DANS LA LIB, pas seulement dans le plugin", () => {
        // Without this assertion, narrowing the scan to the plugin alone would
        // go unnoticed — precisely the blindness that let the original defect live.
        const libFiles = sourceFiles(SCANNED[1]!);
        const libKeys = new Set<string>();
        for (const f of libFiles) {
            const t = stripComments(fs.readFileSync(f, "utf8"));
            for (const m of t.matchAll(KEY_RE)) libKeys.add(m[1]!);
        }
        expect(libKeys.has("editor.modal.btn.delete")).toBe(true);
    });
});

describe("toute clé `editor.*` lue par le code est DÉCLARÉE", () => {
    it("dans le dictionnaire français (la locale de repli)", () => {
        const missing = [...used].filter((k) => !(k in L_fr)).sort();
        expect(missing, `clés lues mais non déclarées : ${missing.join(", ")}`).toEqual([]);
    });
});

describe("les six locales sont à parité", () => {
    const reference = Object.keys(L_fr).sort();

    for (const [code, dict] of Object.entries(ALL)) {
        it(`\`${code}\` porte exactement les mêmes clés que \`fr\``, () => {
            expect(Object.keys(dict).sort()).toEqual(reference);
        });

        it(`\`${code}\` n'a aucune valeur vide`, () => {
            const empty = Object.entries(dict)
                .filter(([, v]) => typeof v !== "string" || v.trim() === "")
                .map(([k]) => k);
            expect(empty).toEqual([]);
        });
    }
});
