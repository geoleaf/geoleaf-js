/**
 * GATE — socle-init 9.4 : « qu'est-ce qui est allumé, et pourquoi ».
 *
 * ## La question à laquelle cette surface répond, et les deux qu'elle NE remplace PAS
 *
 * Trois méthodes voisines, trois objets distincts — et c'est la raison d'être du fichier :
 *
 *   - `getAllCapabilities()` rend ce qui est **déclaré** (le schéma) ;
 *   - `getActiveModules()` rend ce qui **tourne** (les modules dont l'`init()` a été appelé) ;
 *   - `getCapabilityStatus()` rend le **verdict de config** : embarquée ? activée ? par quel gate ?
 *
 * ## Les fixtures sont RÉELLES, et c'est délibéré
 *
 * `PERMALINK_INSTALLER`, `CLUSTER_INSTALLER` et `BRANDING_INSTALLER` sont importés du code
 * livré, pas simulés. Trois des cinq assertions ci-dessous ne peuvent rougir que sur les vrais
 * objets :
 *
 *   - `permalink` est **le seul** installeur du dépôt dont le module porte un AUTRE id que sa
 *     capacité (`share`) — il est le contre-exemple qui interdit de dériver `hasModule` du
 *     `ModuleRegistry` ;
 *   - `permalink` est aussi le seul à déclarer un `moduleGate`, donc le seul endroit où
 *     « le gate qui décide du module » et « le gate de la capacité » diffèrent ;
 *   - `cluster` est l'un des 5 installeurs (sur 21) sans `createModule` — sans lui,
 *     `hasModule` serait vrai partout et l'assertion ne discriminerait rien.
 *
 * ## Ce que la première exécution prouve, et ce qu'elle ne prouve pas
 *
 * ⚠️ Écrit avant le code, ce fichier rougit par **absence de symbole**
 * (`CapabilityRegistry.getAllStatuses is not a function`). C'est un rouge plus faible que
 * celui du gate 9.2, qui rougissait sur un comportement. Il faut le dire plutôt que le
 * maquiller : ce qui rend ces cinq règles crédibles est la **contre-épreuve** — chaque `it`
 * ci-dessous nomme la mutation d'UNE ligne du code livré qui doit le faire rougir. Sans elle
 * le fichier ne garderait rien.
 *
 * **Relevé de la contre-épreuve, jouée le 08/08/2026** — 7 verts au départ, une mutation à la
 * fois, restauration entre chaque :
 *
 * | Mutation | Verts | Règles rouges |
 * |---|---|---|
 * | `hasModule: false` dans la Pass 1 | 6 | CS-01 |
 * | gate évalué sur `toCapConfig({})` (verdict figé) | 5 | CS-02 **et** CS-05 |
 * | `embarked: true` en dur | 6 | CS-03 |
 * | `gate` inventé (celui de `share`) | 5 | CS-04 (ses deux `it`) |
 * | `gate: decl.gate` sans spread conditionnel | 6 | CS-04 (second `it`) |
 * | la façade passe `_NO_CONFIG` au lieu de `_config()` | 6 | CS-05 |
 *
 * ⚠️ **La deuxième mutation en rougit DEUX, et c'est correct** : CS-02 et CS-05 gardent la
 * même propriété — « le verdict est relu, jamais figé » — à deux niveaux, le registre et la
 * façade. Prétendre à une isolation parfaite aurait demandé d'affaiblir l'une des deux.
 *
 * 🛑 **Une mutation est structurellement IMPOSSIBLE, et c'est la meilleure garantie du lot** :
 * on ne peut pas faire restituer le `moduleGate` par `getAllStatuses()`, parce que l'information
 * n'est pas transportée jusque-là — les faits d'installation ne portent que `hasModule`. CS-04
 * garde donc un choix de conception que le code rend indémentable, et sa première assertion ne
 * peut être mise en défaut qu'en inventant un gate de toutes pièces (mutation 4 ci-dessus).
 *
 * @see roadmap_socle-init.md 📦 (archivée le 09/08/2026) § Sprint 9
 * @see packages/core/src/presets/apply-preset.ts — la Pass 1, qui relève les faits d'installation
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import type { CapabilityInstaller, PresetManifest } from "../../src/contracts/preset.contract.js";
import type { ICapabilityStatus } from "../../src/contracts/capability.contract.js";

const { CapabilityRegistry, toCapConfig } = await import(
    "../../src/kernel/api/capability-registry.ts"
);
const { registerPresetDeclarations } = await import("../../src/presets/apply-preset.ts");
const { Introspection } = await import("../../src/kernel/introspection/facade.ts");
const { PERMALINK_INSTALLER } = await import("../../src/capabilities/permalink/install.ts");
const { CLUSTER_INSTALLER } = await import("../../src/capabilities/cluster/install.ts");
const { BRANDING_INSTALLER } = await import("../../src/capabilities/branding/install.ts");

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Joue la Pass 1 sur les installeurs donnés — le canal « embarqué par le build ». */
function embark(...capabilities: CapabilityInstaller[]): void {
    registerPresetDeclarations(
        { id: "capability-status", capabilities } as unknown as PresetManifest,
        CapabilityRegistry,
        {}
    );
}

/** Le statut d'un id, ou `undefined` — l'absence est une réponse, pas une erreur. */
function statusOf(
    statuses: readonly ICapabilityStatus[],
    id: string
): ICapabilityStatus | undefined {
    return statuses.find((s) => s.id === id);
}

beforeEach(() => {
    // Singleton de module : déclarations ET faits d'installation fuiraient d'un test à l'autre.
    CapabilityRegistry._reset();
});

afterEach(() => {
    delete (globalThis as { GeoLeaf?: unknown }).GeoLeaf;
});

// ── CS-01 ─────────────────────────────────────────────────────────────────────

describe("CS-01 — `hasModule` est un fait de l'INSTALLEUR, jamais du registre de modules", () => {
    it("distingue permalink (module) de cluster (aucun), sans inventer d'entrée `share`", () => {
        embark(PERMALINK_INSTALLER, CLUSTER_INSTALLER);

        const statuses = CapabilityRegistry.getAllStatuses(toCapConfig({}));

        expect(statusOf(statuses, "permalink")?.hasModule).toBe(true);
        expect(statusOf(statuses, "cluster")?.hasModule).toBe(false);
        // Le module de `permalink` s'appelle `share`. Le dériver du ModuleRegistry rendrait
        // `hasModule: false` pour permalink ET ferait apparaître une capacité qui n'existe pas.
        expect(statuses.map((s) => s.id)).not.toContain("share");
        // Anti-gate-vide : deux capacités embarquées, deux statuts.
        expect(statuses).toHaveLength(2);
    });

    // MUTATION : dans `getAllStatuses`, remplacer `facts?.hasModule ?? false` par une lecture
    // du ModuleRegistry → `permalink` bascule à `false`.
});

// ── CS-02 ─────────────────────────────────────────────────────────────────────

describe("CS-02 — `enabled` est relu à l'appel, jamais figé à l'enregistrement", () => {
    it("rend deux verdicts opposés pour deux configs, sur un registre inchangé", () => {
        // `branding` est la seule capacité opt-in du dépôt qui possède un `ICoreModule` —
        // le sujet même du Sprint 9 (cf. le pré-vol 9.0).
        embark(BRANDING_INSTALLER);

        const off = CapabilityRegistry.getAllStatuses(toCapConfig({}));
        const on = CapabilityRegistry.getAllStatuses(
            toCapConfig({ modules: { branding: { enabled: true } } })
        );

        expect(statusOf(off, "branding")?.enabled).toBe(false);
        expect(statusOf(on, "branding")?.enabled).toBe(true);
    });

    // MUTATION : calculer `enabled` dans `register()` et le restituer → les deux lectures
    // deviennent identiques. C'est exactement le verdict pré-merge que 9.2 a supprimé.
});

// ── CS-03 ─────────────────────────────────────────────────────────────────────

describe("CS-03 — `embarked` distingue le canal d'enregistrement", () => {
    it("sépare ce que le build a embarqué de ce que le runtime a déclaré", () => {
        embark(CLUSTER_INSTALLER);
        // Le canal runtime : `GeoLeaf.plugins.registerCapability` aboutit ici. Aucun installeur,
        // donc aucun fait d'installation — et c'est CE fait qui vaut `embarked: false`.
        CapabilityRegistry.register({ id: "table", gate: { configPath: "modules.table.enabled" } });

        const statuses = CapabilityRegistry.getAllStatuses(toCapConfig({}));

        expect(statusOf(statuses, "cluster")?.embarked).toBe(true);
        expect(statusOf(statuses, "table")?.embarked).toBe(false);
        // Une déclaration runtime ne peut rien affirmer sur un module : elle n'en porte pas.
        expect(statusOf(statuses, "table")?.hasModule).toBe(false);
    });

    // MUTATION : `embarked: true` en dur → la seconde assertion rougit. Le champ deviendrait
    // décoratif, ce qui est le mode d'échec n°5 de CLAUDE.md (verdict infalsifiable).
});

// ── CS-04 ─────────────────────────────────────────────────────────────────────

describe("CS-04 — `gate` est la CAUSE de `enabled`, et les deux se correspondent", () => {
    it("restitue le gate de la déclaration, pas le `moduleGate` du sous-module", () => {
        embark(PERMALINK_INSTALLER);

        const status = statusOf(CapabilityRegistry.getAllStatuses(toCapConfig({})), "permalink");

        // `permalink` porte les deux : `modules.permalink.enabled` sur sa déclaration, et
        // `modules.permalink.share.enabled` sur son installeur. Rendre le second sous l'id de
        // la capacité accolerait une cause et un effet qui ne se correspondent pas.
        expect(status?.gate?.configPath).toBe("modules.permalink.enabled");
        expect(status?.gate?.enableWhenAbsent).toBe(true);
    });

    it("rend `gate` absent et `enabled` vrai pour une capacité non gatée", () => {
        const ungated: CapabilityInstaller = {
            declaration: { id: "ungated" },
            registerGlobals: () => {},
        };
        embark(ungated);

        const status = statusOf(CapabilityRegistry.getAllStatuses(toCapConfig({})), "ungated");

        // Pas de gate ⟹ toujours activée (`evaluateGate` rend `true`), et la clé `gate` est
        // ABSENTE, pas présente à `undefined` — le lecteur peut faire la différence.
        expect(status?.gate).toBeUndefined();
        expect(status && "gate" in status).toBe(false);
        expect(status?.enabled).toBe(true);
    });

    // MUTATION : `gate: inst.moduleGate ?? decl.gate` → `permalink` restitue la clé de `share`.
});

// ── CS-05 ─────────────────────────────────────────────────────────────────────

describe("CS-05 — la façade lit la config VIVANTE, elle ne la capture pas", () => {
    it("change de verdict quand la config change, sans re-boot", () => {
        embark(BRANDING_INSTALLER);
        // `loadActiveProfileResources()` enrichit l'objet de config EN PLACE (il rend le même
        // objet, jamais un remplacement). Une façade qui capturerait son lecteur au premier
        // appel resterait sur le verdict pré-merge — le mensonge que 9.4 doit éviter.
        const cfg: Record<string, unknown> = { modules: {} };
        (globalThis as { GeoLeaf?: unknown }).GeoLeaf = { Config: toCapConfig(cfg) };

        expect(statusOf(Introspection.getCapabilityStatus(), "branding")?.enabled).toBe(false);

        cfg.modules = { branding: { enabled: true } };

        expect(statusOf(Introspection.getCapabilityStatus(), "branding")?.enabled).toBe(true);
    });

    it("dégrade sans jeter quand aucune config n'est chargée", () => {
        embark(BRANDING_INSTALLER, CLUSTER_INSTALLER);
        // Avant boot il n'y a pas de `GeoLeaf.Config`. La réponse attendue n'est pas une
        // exception ni un tableau vide, mais le verdict exact de « rien n'est configuré » :
        // chaque gate répond son `enableWhenAbsent`.
        const statuses = Introspection.getCapabilityStatus();

        expect(statuses).toHaveLength(2);
        expect(statusOf(statuses, "branding")?.enabled).toBe(false); // opt-in
        expect(statusOf(statuses, "cluster")?.enabled).toBe(true); // opt-out
    });

    // MUTATION : capturer le lecteur dans une constante de module au premier appel → la
    // première assertion rougit sur le second `expect`.
});
