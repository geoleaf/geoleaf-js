/*!
 * Tests — le catalogue i18n du plugin dit-il tout ce que le plugin demande ?
 *
 * 🛑 **CETTE GARDE NAÎT D'UN DÉFAUT VIVANT, TROUVÉ À LA TÂCHE 5.2 — ET DE SON ABSENCE.**
 * `editor.modal.btn.delete` était lue par la **bibliothèque partagée**
 * (`field-renderer/src/ui/responsive-modal.ts`) sur le bouton de suppression que **ce plugin
 * arme lui-même** (`entry.ts`, `onDelete`), et elle n'était déclarée **dans aucune** de ses six
 * locales : seul `addpoi` la portait. Dans `deploy-full` — editor sans addpoi — le bouton
 * affichait donc **la clé brute**. La corriger sans poser cette garde aurait laissé le défaut
 * revenir au premier oubli : mesuré, retirer la clé d'une locale laissait les 447 tests verts.
 *
 * ⚠️ **CE QUE LA GARDE DOIT SCANNER, ET POURQUOI C'EST LE POINT.** Une garde qui ne lirait que
 * `editor/src/**` **aurait manqué ce défaut précis** — la clé n'y est écrite nulle part. Le
 * balayage inclut donc la **bibliothèque de rendu de champs**, dont ce plugin est le principal
 * consommateur et qui résout des clés `editor.*` pour son compte. C'est exactement la cécité que
 * le corollaire « le pré-vol porte la cécité qu'il mesure » désigne.
 *
 * ⚠️ `GeoLeaf.I18n.getLabel` rend **la clé** quand il ne la connaît pas — c'est son contrat, pas
 * `undefined`. Rien ne rougit donc à l'exécution : un libellé manquant est indiscernable d'un
 * libellé juste, sauf à l'œil. D'où une garde **statique**.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// ⚠️ Préfixés `L_` : la locale italienne s'importerait sous le nom `it`, déjà celui de la
// fonction de test de vitest — la collision casse le parseur, pas le test.
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

/** Répertoires balayés — le plugin ET la lib qui résout des clés `editor.*` pour lui. */
const SCANNED = [
    path.join(REPO_ROOT, "packages/plugins/editor/src"),
    path.join(REPO_ROOT, "packages/libs/field-renderer/src"),
];

/** `"editor.<quelque.chose>"` dans un littéral de chaîne. */
const KEY_RE = /["'`](editor\.[a-zA-Z0-9_.]+)["'`]/g;

/**
 * Retire commentaires de bloc et de ligne avant le balayage.
 *
 * ⚠️ **Sans ça, la garde compte la PROSE comme du code**, et c'est mesuré : le premier run a
 * signalé `editor.save` / `editor.update` / `editor.delete` comme « lues mais non déclarées ».
 * Ce sont l'ancien **vocabulaire d'opération de file** (tâche 4.9), cités dans deux blocs de
 * documentation — jamais des clés i18n. Une garde qui jette sur de la prose se fait désarmer,
 * pas corriger : la liste d'exceptions aurait grossi jusqu'à ne plus rien garder.
 */
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Fichiers sources scannés, hors tests, mocks et dictionnaires. */
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
 * ⚠️ Clés construites à l'exécution, donc invisibles au scan et légitimement absentes des
 * dictionnaires. Toute entrée ici porte son motif — une liste sans motif redevient un
 * fourre-tout, et la garde cesse de garder.
 */
const DYNAMIC_PREFIXES = [
    // `editor.history.op.<type>` — assemblée depuis le type d'opération (`undo-stack.ts`).
    "editor.history.op.",
    // `editor.tool.<id>.label|hint` — assemblée depuis l'identifiant d'outil.
    "editor.tool.",
    // `editor.sync.kind.<kind>` — assemblée depuis le genre d'opération de file.
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
    // Anti-garde-vide : une garde qui ne lit rien sort verte en ne gardant rien.
    it("lit réellement des fichiers dans les DEUX répertoires", () => {
        for (const dir of SCANNED) {
            expect(sourceFiles(dir).length, `aucun fichier scanné dans ${dir}`).toBeGreaterThan(0);
        }
    });

    it("trouve des clés `editor.*` à confronter", () => {
        expect(used.size).toBeGreaterThan(10);
    });

    it("🛑 voit les clés écrites DANS LA LIB, pas seulement dans le plugin", () => {
        // Sans cette assertion, restreindre le scan au seul plugin passerait inaperçu — et
        // c'est précisément la cécité qui a laissé vivre le défaut de 5.2.
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
