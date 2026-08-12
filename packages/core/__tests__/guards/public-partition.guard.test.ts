/**
 * @file public-partition.guard.test.ts
 * @description Test-garde — la frontière atelier/public mord dans les DEUX sens, et refuse
 * de laisser passer un lot qu'elle n'a pas su lire.
 *
 * Pourquoi ce garde existe (11/08/2026)
 * --------------------------------------
 * `scripts/lib/public-partition.cjs` décide ce qui part dans `geoleaf/geoleaf-js`. C'est une
 * décision **irréversible par diffusion** : un fichier d'atelier poussé sur un dépôt public a
 * été cloné, forké et indexé avant qu'on s'en aperçoive, et le repasser en privé ne rappelle
 * rien.
 *
 * Or cette frontière a exactement la forme que ce dépôt sait défaillante : une garde qui, en
 * cessant de mordre, **sort verte**. Un `_docs_projet/` renommé, un `git ls-files` lancé au
 * mauvais endroit, un motif ancré par erreur — dans les trois cas la partition ne retire rien,
 * le portage réussit, et l'atelier part. Rien en aval ne le verrait : le clone est éphémère,
 * et aucune gate ne tourne sur lui avant le push.
 *
 * ## Ce qui est gardé, et pourquoi chaque cas est là
 *
 * ① **Les formes que la réintroduction prendrait.** `CLAUDE.md` est lu par son harnais dans
 *    n'importe quel sous-répertoire : `packages/core/CLAUDE.md` est la forme la plus probable
 *    du retour, et un motif ancré (`/CLAUDE.md`) la laisserait passer. C'est la raison pour
 *    laquelle trois motifs sur quatre sont NON ancrés, et ce test est ce qui empêche qu'on les
 *    « corrige » en les ancrant.
 *
 * ② **Les faux positifs.** Un motif trop large qui happerait `docs/CLAUDE_GUIDE.md` retirerait
 *    de la doc publique sans que rien ne le dise — l'échec symétrique, silencieux lui aussi.
 *
 * ③ **Les trois refus.** Plancher de vraisemblance, motif stérile, et partition entièrement
 *    aveugle. Chacun a été vu mordre le jour où il a été posé ; ce test est ce qui garantit
 *    qu'il mord encore.
 *
 * ## Une garde jamais vue rouge ne garde rien
 *
 * Assertion anti-garde-vide : les quatre motifs déclarés doivent tous être exercés par au moins
 * un cas. Sans elle, retirer un motif du module rendrait ce garde vert en ne testant plus rien.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** La forme du module CommonJS sous test, décrite ici parce qu'il n'émet pas de types. */
interface PublicPartition {
    INTERNAL_PATTERNS: ReadonlyArray<{ pattern: string; dir: boolean; why: string }>;
    MIN_PUBLIC_FILES: number;
    classify(relPath: string): { internal: boolean; pattern?: string };
    isInternal(relPath: string): boolean;
    split(files: string[]): {
        publicFiles: string[];
        internalFiles: string[];
        byPattern: Map<string, string[]>;
    };
    assertPartitionSane(parts: ReturnType<PublicPartition["split"]>): void;
    gitignoreFragment(): string;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "../../../..");
const requireCjs = createRequire(import.meta.url);

const partition: PublicPartition = requireCjs(
    path.join(REPO_ROOT, "scripts/lib/public-partition.cjs")
) as PublicPartition;

/**
 * Cas de classification : `[chemin, retenu à l'atelier ?, motif du cas]`.
 * Les sept premiers exercent les quatre motifs ; les six suivants sont les faux positifs
 * qu'un motif trop large produirait.
 */
const CASES: ReadonlyArray<[string, boolean, string]> = [
    ["CLAUDE.md", true, "racine"],
    ["packages/core/CLAUDE.md", true, "motif NON ancré — la forme la plus probable du retour"],
    ["packages/plugins/table/CLAUDE.md", true, "même forme, profondeur 3"],
    ["_docs_projet/JOURNAL.md", true, "atelier"],
    ["_docs_projet/registres/backlog_technique.md", true, "atelier, profond"],
    [".claude/commands/audit.md", true, "harnais"],
    [".github/copilot-instructions.md", true, "ancré par sa barre oblique"],
    ["README.md", false, "vitrine"],
    ["docs/specs/CDC_kernel.md", false, "doc publique"],
    ["packages/core/src/index.ts", false, "source"],
    ["scripts/lib/public-partition.cjs", false, "le module lui-même part au public"],
    ["docs/CLAUDE_GUIDE.md", false, "contient CLAUDE, n'est pas CLAUDE.md"],
    ["packages/core/docs/claude.md", false, "casse différente — le harnais ne le lit pas"],
];

/** Un lot de taille plausible, portant les quatre motifs. */
function plausibleLot(): string[] {
    const files: string[] = [];
    for (let i = 0; i < partition.MIN_PUBLIC_FILES + 400; i++) {
        files.push(`packages/core/src/f${i}.ts`);
    }
    files.push(
        "CLAUDE.md",
        "_docs_projet/ETAT.md",
        ".claude/commands/x.md",
        ".github/copilot-instructions.md"
    );
    return files;
}

describe("public-partition — la frontière atelier/public", () => {
    it.each(CASES)("%s → %s (%s)", (file: string, internal: boolean) => {
        expect(partition.isInternal(file)).toBe(internal);
    });

    it("exerce les QUATRE motifs déclarés — anti-garde-vide", () => {
        const exercised = new Set<string>();
        for (const [file] of CASES) {
            const { internal, pattern } = partition.classify(file);
            if (internal) exercised.add(pattern);
        }
        const declared = partition.INTERNAL_PATTERNS.map((p) => p.pattern);
        expect(declared.length).toBeGreaterThan(0);
        // Un motif ajouté au module sans cas ici serait un motif que rien n'éprouve.
        expect([...exercised].sort()).toEqual([...declared].sort());
    });

    it("laisse passer un lot plausible", () => {
        expect(() => partition.assertPartitionSane(partition.split(plausibleLot()))).not.toThrow();
    });

    it("REFUSE un lot sous le plancher — `git ls-files` n'a pas lu ce qu'on croit", () => {
        const maigre = ["README.md", "CLAUDE.md", "_docs_projet/a.md", ".claude/b.md"];
        expect(() => partition.assertPartitionSane(partition.split(maigre))).toThrow(/plancher/);
    });

    it("REFUSE quand un motif ne retire RIEN — cible renommée, partition aveugle", () => {
        const sansAtelier = plausibleLot().filter((f) => !f.startsWith("_docs_projet/"));
        expect(() => partition.assertPartitionSane(partition.split(sansAtelier))).toThrow(
            /_docs_projet\//
        );
    });

    it("REFUSE quand AUCUN motif ne mord — l'atelier partirait en entier", () => {
        const rienDInterne = plausibleLot().filter((f) => !partition.isInternal(f));
        expect(() => partition.assertPartitionSane(partition.split(rienDInterne))).toThrow(
            /4 motif\(s\)/
        );
    });

    it("le fragment `.gitignore` porte les quatre motifs", () => {
        const fragment = partition.gitignoreFragment();
        for (const { pattern } of partition.INTERNAL_PATTERNS) {
            expect(fragment).toContain(pattern);
        }
    });
});
