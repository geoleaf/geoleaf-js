/**
 * HARNAIS DE MÉLANGE — socle-init 9.1 : ce que l'ordre de `FULL.capabilities` doit CESSER
 * de décider.
 *
 * ## Le problème que ce fichier garde
 *
 * `presets/manifest.full.ts` est une liste, et son ordre a longtemps décidé de choses sans
 * rapport les unes avec les autres. Réordonner pour l'une déplaçait silencieusement les
 * autres. Socle-init 7.5 en a coupé une — la disposition de la toolbar mobile — en la rendant
 * explicite (`mobileIcon.order`) au lieu d'émergente. Ce harnais est ce qui empêche le
 * couplage de revenir sans qu'on le voie.
 *
 * ## Ce qui n'est PAS asserté ici, et pourquoi
 *
 * ⚠️ Le tour d'horizon initial de 9.1 demandait « surface post-boot et effets d'`app:ready`
 * IDENTIQUES » sous permutation. **Le pré-vol 9.0 du 07/08/2026 a mesuré que c'est faux**, et
 * l'exiger ferait rougir ce fichier sur les propriétés suivantes, qui sont voulues :
 *
 *   - `route` avant `filter` — le tri topologique de Kahn départage à égalité sur l'ordre
 *     d'enregistrement (les deux dépendent de `geojson`) ;
 *   - `theme-selector` en dernier — même départage de Kahn, qui fixe l'ordre des auditeurs
 *     de `geoleaf:app:ready`.
 *
 * Une garde qui rougirait là-dessus serait bruyante, et une gate bruyante apprend à être
 * ignorée. Ce fichier asserte donc l'invariance de ce qui DOIT l'être — l'ensemble composé et
 * la toolbar — et laisse l'ordre d'init tranquille, en le nommant plutôt qu'en le taisant.
 *
 * 🛑 **Une TROISIÈME propriété figurait dans cette liste jusqu'au 08/08/2026 : « `pwa` avant
 * `offline` — leurs `sharedLifecycle` tournent dans cet ordre (#7 → #8), et `offline` lit
 * `modules.pwa.enabled` ».** Socle-init **7.4** l'a réfutée. Elle est retirée d'ici parce que ce
 * fichier la citait comme *voulue*, c'est-à-dire comme une raison de ne pas la tester — et elle
 * n'était ni voulue ni vraie.
 *
 * ⚠️ **Et l'assertion correspondante n'a PAS été ajoutée ici, délibérément.** Ce harnais ne fait
 * tourner que `registerPresetDeclarations` / `registerPresetModules` : il **n'appelle jamais
 * `SharedModule`**, donc il est structurellement incapable de voir un couplage de
 * `sharedLifecycle`. `pwa` et `offline` n'ayant ni `createModule` ni `mobileIcon`, les y permuter
 * ne change rien *par construction* — une règle posée là serait verte quoi qu'il arrive, y compris
 * sous la mutation qui compte. C'est `shared-lifecycle-order.test.ts` qui la porte, avec le seul
 * harnais qui exécute les lifecycles.
 *
 * @see packages/core/src/presets/manifest.full.ts — les contraintes restantes, et les DEUX qui
 *   ont été retirées parce qu'elles avaient cessé d'être vraies (ou ne l'avaient jamais été)
 * @see packages/core/__tests__/presets/shared-lifecycle-order.test.ts — la réfutation de 7.4
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

import type { ICoreModule } from "../../src/contracts/core-module.contract.js";
import type { PresetManifest } from "../../src/contracts/preset.contract.js";
// Extrait le 08/08/2026, quand `shared-lifecycle-order.test.ts` en a eu besoin aussi : deux
// copies d'un générateur congruentiel sont deux suites de graines qui divergeront.
import { shuffled } from "./_helpers/shuffle.ts";

const { FULL } = await import("../../src/presets/manifest.full.ts");
const { registerPresetDeclarations, registerPresetModules } = await import(
    "../../src/presets/apply-preset.ts"
);
const { CapabilityRegistry } = await import("../../src/kernel/api/capability-registry.ts");
const { ModuleRegistry } = await import("../../src/app/module-registry.ts");

/** Les installers d'un manifeste — le seul type dont ce fichier a besoin. */
type Capabilities = PresetManifest["capabilities"];

/** Compose un manifeste et rend ce qui en est sorti, sans rien initialiser. */
function compose(capabilities: Capabilities): { declared: string[]; modules: ICoreModule[] } {
    CapabilityRegistry._reset();
    const declared: string[] = [];
    const modules: ICoreModule[] = [];
    const capReg = {
        register: (d: { id: string }) => {
            declared.push(d.id);
            CapabilityRegistry.register(d as Parameters<typeof CapabilityRegistry.register>[0]);
        },
        // Socle-init 9.4 : la Pass 1 relève les faits d'installation. Ce harnais ne les lit
        // pas, mais le collaborateur est requis — un bouchon absent serait un `TypeError`.
        noteInstaller: () => {},
        isEnabled: () => true,
    };
    const preset = { id: "shuffled", capabilities } as PresetManifest;
    registerPresetDeclarations(preset, capReg, {});
    registerPresetModules(preset, capReg, {
        register: (m: ICoreModule) => modules.push(m),
    });
    return { declared, modules };
}

/**
 * Reproduit le comparateur de `_appendRegistryIcons` (`kernel/ui/mobile/mobile-toolbar-pill.ts`).
 *
 * ⚠️ Il est inline dans une fonction qui touche le DOM, donc non importable. Le dupliquer
 * serait tester la copie ; ce n'est pas ce qui est fait ici — l'assertion qui compte est
 * `SEEDS`-invariante ET adossée à `PILLS_CARRY_EXPLICIT_ORDER` ci-dessous, qui est la vraie
 * condition de son indépendance à l'ordre du manifeste.
 */
function pillOrder(modules: readonly ICoreModule[]): string[] {
    return [...modules]
        .sort((a, b) => {
            const oa = a.ui?.mobileIcon?.order;
            const ob = b.ui?.mobileIcon?.order;
            if (oa === undefined && ob === undefined) return 0;
            if (oa === undefined) return 1;
            if (ob === undefined) return -1;
            return oa - ob;
        })
        .filter((m) => m.ui?.mobileIcon)
        .map((m) => m.id);
}

/**
 * Fait tourner le VRAI tri topologique sur le graphe composé, et rend l'ordre observé.
 *
 * ## Pourquoi ce second harnais existe (socle-init 9.1, complété le 08/08/2026)
 *
 * `compose()` s'arrête à l'enregistrement : il ne voit ni le tri de Kahn ni le parcours qui en
 * découle. Or c'est le tri qui décide l'ordre des `init()`, donc celui des auditeurs de
 * `geoleaf:app:ready` — la propriété même que l'énoncé initial de 9.1 visait. La vérification
 * du 08/08 a relevé ce trou : le fichier composait là où sa ligne de roadmap disait « booter ».
 *
 * ## Pourquoi des sondes plutôt que les modules réels
 *
 * Chaque enrobage est remplacé par une sonde qui **conserve `id` et `dependencies`** — donc le
 * graphe trié est le vrai — mais n'appelle jamais l'`init()` du module réel. Faire tourner les
 * 16 `init()` livrés demanderait un adaptateur MapLibre et un DOM complet, et éprouverait le
 * comportement des capacités, pas l'invariance du tri. Ici le sujet est le tri.
 *
 * Les deux modules kernel dont les capacités dépendent (`geojson`, `config`) sont enregistrés
 * **en DERNIER**, et c'est délibéré : `ModuleRegistry` jette sur dépendance manquante, donc ils
 * doivent être là — mais s'ils étaient en tête, l'ordre d'insertion satisferait déjà le graphe
 * *par accident*, et la règle « chacun après ses dépendances » resterait verte même si le tri
 * était supprimé. Les mettre à la fin fait que seul un vrai tri peut la satisfaire. Vu rougir
 * en remplaçant `_topoSort()` par l'ordre d'enregistrement brut.
 *
 * @param capabilities Les installeurs, dans l'ordre à éprouver.
 * @returns Les ids dans l'ordre où le registre les a initialisés.
 */
async function bootOrder(capabilities: Capabilities): Promise<string[]> {
    const seen: string[] = [];
    // `init` et `destroy` vont ensemble — `ModuleRegistry.register()` valide la disjonction et
    // jette. Une sonde qui n'aurait que l'un des deux ne serait pas un module.
    const probe = (id: string, dependencies: readonly string[]): ICoreModule =>
        ({
            id,
            dependencies,
            init: () => {
                seen.push(id);
            },
            destroy: () => {},
        }) as unknown as ICoreModule;

    const registry = new ModuleRegistry();
    for (const m of compose(capabilities).modules) {
        registry.register(probe(m.id, m.dependencies ?? []));
    }
    registry.register(probe("geojson", []));
    registry.register(probe("config", []));

    await registry.init({} as never, {} as never);
    return seen;
}

const SEEDS = [1, 7, 42, 1337, 90210];

beforeEach(() => {
    CapabilityRegistry._reset();
    vi.restoreAllMocks();
});

describe("mélange du manifeste — ce qui doit rester invariant", () => {
    it("compose le MÊME ensemble de déclarations, quel que soit l'ordre", () => {
        const reference = [...compose(FULL.capabilities).declared].sort();
        expect(reference.length).toBeGreaterThan(10); // anti-gate-vide : un manifeste creux passerait tout

        for (const seed of SEEDS) {
            const got = [...compose(shuffled(FULL.capabilities, seed)).declared].sort();
            expect(got, `graine ${seed}`).toEqual(reference);
        }
    });

    it("compose le MÊME ensemble de modules, quel que soit l'ordre", () => {
        const reference = compose(FULL.capabilities)
            .modules.map((m) => m.id)
            .sort();
        expect(reference.length).toBeGreaterThan(10);

        for (const seed of SEEDS) {
            const got = compose(shuffled(FULL.capabilities, seed))
                .modules.map((m) => m.id)
                .sort();
            expect(got, `graine ${seed}`).toEqual(reference);
        }
    });

    // C'EST L'ASSERTION DE 7.5, et la raison d'être de ce fichier.
    it("rend les pastilles de la toolbar dans le MÊME ordre, quel que soit l'ordre du manifeste", () => {
        const reference = pillOrder(compose(FULL.capabilities).modules);
        expect(reference.length).toBeGreaterThan(0); // anti-gate-vide

        for (const seed of SEEDS) {
            const got = pillOrder(compose(shuffled(FULL.capabilities, seed)).modules);
            expect(got, `graine ${seed}`).toEqual(reference);
        }
    });

    /**
     * La condition qui rend l'assertion précédente VRAIE — et la seule qui puisse la trahir.
     *
     * Le comparateur range les modules sans `order` **après** tous ceux qui en ont, en gardant
     * leur ordre d'enregistrement relatif (tri stable). Donc dès qu'une DEUXIÈME pastille sans
     * `order` apparaît, leur ordre redevient celui du manifeste — et le couplage que 7.5 a
     * coupé revient, silencieusement, sans qu'aucune des assertions ci-dessus ne bouge tant que
     * les graines testées ne les inversent pas.
     *
     * Cette garde-ci ne dépend d'aucune graine : elle interdit la condition elle-même.
     */
    it("PILLS_CARRY_EXPLICIT_ORDER — toute pastille déclare son ordre", () => {
        const pills = compose(FULL.capabilities).modules.filter((m) => m.ui?.mobileIcon);
        expect(pills.length).toBeGreaterThan(0);

        const sansOrdre = pills
            .filter((m) => m.ui?.mobileIcon?.order === undefined)
            .map((m) => m.id);

        expect(
            sansOrdre,
            "une pastille sans `order` retombe sur l'ordre d'enregistrement — c'est exactement " +
                "le couplage que socle-init 7.5 a coupé. Lui donner un `mobileIcon.order`."
        ).toEqual([]);
    });
});

// ── Le tri, sous permutation ──────────────────────────────────────────────────

describe("tri topologique — ce qu'un vrai registre décide, sous permutation", () => {
    it("initialise le MÊME ensemble de modules, quel que soit l'ordre du manifeste", async () => {
        const reference = [...(await bootOrder(FULL.capabilities))].sort();
        expect(reference.length).toBeGreaterThan(10); // anti-gate-vide

        for (const seed of SEEDS) {
            const got = [...(await bootOrder(shuffled(FULL.capabilities, seed)))].sort();
            expect(got, `graine ${seed}`).toEqual(reference);
        }
    });

    /**
     * ⚠️ **L'ordre exact n'est PAS asserté, et ce n'est pas un renoncement — c'est la mesure.**
     *
     * Le pré-vol 9.0 a relevé deux contraintes d'ordre réelles (`route` avant `filter`,
     * `theme-selector` en dernier) qui sortent du départage de Kahn à égalité, lequel suit
     * l'ordre d'enregistrement. Elles se DÉPLACENT sous permutation, légitimement. Exiger
     * l'invariance d'ordre ferait rougir ce fichier sur un comportement voulu.
     *
     * Ce qui doit être vrai en revanche, sous toute permutation, c'est que le tri **honore le
     * graphe** : aucun module ne s'initialise avant une de ses dépendances. C'est la propriété
     * que le tri existe pour produire, et la seule qu'une permutation ne doit jamais entamer.
     */
    it("place toujours chaque module APRÈS ses dépendances", async () => {
        for (const seed of SEEDS) {
            const capabilities = shuffled(FULL.capabilities, seed);
            const order = await bootOrder(capabilities);
            const rank = new Map(order.map((id, i) => [id, i]));

            const deps = compose(capabilities).modules.flatMap((m) =>
                (m.dependencies ?? []).map((d) => [m.id, d] as const)
            );
            expect(deps.length, `graine ${seed}`).toBeGreaterThan(0); // anti-gate-vide

            for (const [id, dep] of deps) {
                expect(rank.get(id), `graine ${seed} — ${id} dépend de ${dep}`).toBeGreaterThan(
                    rank.get(dep)!
                );
            }
        }
    });
});
