/**
 * @file workspace-debris.guard.test.ts
 * @description Guard test — the GHOST-package detector knows all its
 * producers, bites on each, and `ci:local` really launches it.
 *
 * Why this guard exists
 * ------------------------------------------------------------------------------------
 * Two scripts plant a real workspace under `packages/plugins/` and erase it
 * in a `finally`. A `finally` does not survive a `SIGKILL`: the directory
 * stays, matches the workspaces glob, and becomes a repo package. The next
 * run yields **seventeen** red gates none of which names the cause —
 * measured on 19/08/2026 by suffering it.
 *
 * 🛑 **The refusal set that day covered only one producer of two, and the
 * second got through three days later.** On 22/08/2026, two concurrent
 * `ci:local` runs left `packages/plugins/__probe__`: six reds, one cause, no
 * message naming it. The refusal filtered `zz-scaffold-` hardcoded — a guard
 * written exactly for this class, blind to half the class.
 *
 * That is what this guard keeps from recurring, and it does so in four
 * distinct steps.
 *
 * ## WD-01 — the table is still ANCHORED to its producers
 *
 * A pattern that stops matching does not turn red on its own: it finds zero
 * debris and comes out green. Renaming `zz-scaffold-full` in the producer
 * script would blind the detector **silently**. Each producer thus carries
 * `anchors` — literals that must stay present in its script — and their
 * disappearance turns red here.
 *
 * ## WD-02 — the detector BITES, on each pattern
 *
 * ⚠️ The fixture is planted in a **fake root** under `os.tmpdir()`, never in
 * the repo. Planting real debris to exercise the debris detector would
 * create exactly what it detects, and a killed test would leave it behind —
 * the defect, inside its own test.
 *
 * ## WD-03 — it does NOT bite on a legitimate plugin
 *
 * The discriminant is a table of named patterns, never "what git does not
 * track": the latter would make `ci:local` refuse anyone scaffolding a
 * plugin by hand, hence a permanently red guard, hence disarmed within the week.
 *
 * ## WD-04 — `ci:local` really launches it
 *
 * A perfect, unwired detector guards as much as an absent one. The class
 * `probe-gate-visibility.cjs` hunts everywhere else; it holds for this one too.
 *
 * ## 🖐 What this guard does NOT say
 *
 * Nothing about a THIRD producer born tomorrow. No machine can guess a new
 * script plants a workspace; it is the reviewer's job to add its entry. This
 * guard protects the table against erosion, not against omission.
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface Producer {
    script: string;
    scope: string;
    match: { kind: "prefix" | "exact"; value: string };
    anchors: string[];
    note: string;
}
interface Debris {
    path: string;
    producer: string;
    note: string;
}
interface WorkspaceDebris {
    PRODUCERS: Producer[];
    findDebris(root: string): Debris[];
    unanchoredProducers(root: string): { script: string; motif: string }[];
}

const requireCjs = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..");
const { PRODUCERS, findDebris, unanchoredProducers }: WorkspaceDebris = requireCjs(
    "../../../../scripts/lib/workspace-debris.cjs"
);

/** Disposable fake root — never the repo, cf. WD-02. */
function fakeRoot(dirNames: string[]): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "geoleaf-debris-"));
    for (const d of dirNames) {
        fs.mkdirSync(path.join(root, "packages", "plugins", d), { recursive: true });
    }
    return root;
}

describe("workspace-debris — le détecteur de paquets fantômes", () => {
    it("WD-00 — la table porte EXACTEMENT les producteurs connus", () => {
        // Itemised, not derived: the only mechanical criterion available — a
        // script mentioning `packages/plugins` and calling `mkdirSync` or
        // `create-plugin.cjs` — yields **13 candidates** for **2** real
        // producers (measured on 23/08/2026). The eleven others read the
        // tree leaving nothing in it. An exemption list that long would turn
        // red on the next script that merely READS `packages/plugins`, hence
        // permanently red, hence disarmed within the week — the motive that
        // made PARITY-13 notifying. Removing a producer here is a
        // TWO-place gesture, deliberately.
        expect(PRODUCERS.map((p) => p.script).sort()).toEqual([
            "scripts/probe-gate-visibility.cjs",
            "scripts/verify-plugin-scaffold.cjs",
        ]);
        for (const p of PRODUCERS) {
            expect(p.anchors.length, `${p.script} doit porter au moins une ancre`).toBeGreaterThan(
                0
            );
        }
    });

    it("WD-01 — chaque motif est encore ancré dans le script qui le produit", () => {
        const broken = unanchoredProducers(REPO_ROOT);
        expect(
            broken,
            `Un motif ne mord plus — le détecteur serait aveugle EN SILENCE :\n` +
                broken.map((b) => `  ${b.script} : ${b.motif}`).join("\n")
        ).toEqual([]);
    });

    it("WD-02 — il mord sur un résidu fabriqué, pour CHAQUE producteur", () => {
        for (const p of PRODUCERS) {
            const name = p.match.kind === "prefix" ? `${p.match.value}temoin` : p.match.value;
            const root = fakeRoot([name]);
            try {
                const found = findDebris(root);
                expect(
                    found.map((f) => f.path),
                    `motif de ${p.script} non détecté`
                ).toEqual([`packages/plugins/${name}`]);
                expect(found[0].producer, "le résidu doit NOMMER son producteur").toBe(p.script);
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }
    });

    it("WD-03 — il ne mord pas sur un plugin légitime", () => {
        const root = fakeRoot(["measure", "editor", "offline-ui"]);
        try {
            expect(findDebris(root)).toEqual([]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("WD-04 — `ci:local` charge le détecteur ET l'appelle avant ses gates", () => {
        const src = fs.readFileSync(path.join(REPO_ROOT, "scripts/ci-local.cjs"), "utf8");
        expect(src, "ci-local.cjs doit charger le corpus partagé").toContain(
            "lib/workspace-debris.cjs"
        );
        expect(src, "ci-local.cjs doit APPELER le refus, pas seulement le définir").toMatch(
            /^\s+refuseIfWorkspaceDebris\(\);$/m
        );
    });

    it("WD-05 — le dépôt lui-même ne porte aucun paquet fantôme", () => {
        const debris = findDebris(REPO_ROOT);
        expect(
            debris.map((d) => `${d.path} (${d.producer})`),
            "un run précédent a été tué — `rm -rf` les chemins listés"
        ).toEqual([]);
    });
});
