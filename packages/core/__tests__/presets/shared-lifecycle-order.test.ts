/**
 * SLO — la POSITION de `pwa` et `offline` au manifeste ne décide de rien (socle-init 7.4).
 *
 * ## Ce que ce fichier tranche
 *
 * Le dépôt affirmait, sur **20 sites répartis dans 13 fichiers**, que l'ordre `pwa` (#7) puis
 * `offline` (#8) dans `presets/manifest.full.ts` est *load-bearing*. Sa formulation la plus forte,
 * `specs/capacites/pwa.md`, allait jusqu'à : « **Inverser les deux empêcherait le moteur
 * hors-ligne de démarrer.** » Aucun test ne l'éprouvait.
 *
 * **C'est faux, et ce fichier le mesure.** Le couplage est CONFIGURATIONNEL, pas ordinal :
 *
 *   - `offline/install.ts` lit `config.modules.pwa.enabled` dans le **sac fusionné** que
 *     `SharedModule.init()` lui passe — pas un état posé par `PwaLifecycle` ;
 *   - `GeoLeaf.Storage` et `GeoLeaf._OfflineDetector` sont posés **à l'import**, en phase A par
 *     `globals/globals.storage.ts`, donc bien avant l'un comme l'autre ;
 *   - et le seul effet que `pwa` produirait avant `offline` — l'enregistrement de l'ouvrier de
 *     service — est de toute façon **différé** par `Helpers.lazyExecute` (plafond 3 s). Même dans
 *     l'ordre nominal, il n'a pas eu lieu quand `offline` s'exécute.
 *
 * ⚠️ Le fichier incriminé se contredisait déjà lui-même : `manifest.full.ts` annonce la contrainte
 * dans son en-tête, puis écrit « **Position is free** (no module, no mobileIcon) » au-dessus du
 * couple, 90 lignes plus bas.
 *
 * ## Ce qui reste VRAI, et que ce fichier garde aussi
 *
 * Il faut deux distinctions, jamais mélangées :
 *
 *   - **le GATE** — `offline` refuse de démarrer son moteur si `modules.pwa.enabled` est faux.
 *     **VRAI**, conservé, épinglé par **SLO-05** ;
 *   - **le MÉCANISME** — les `sharedLifecycle` tournent dans l'ordre de la liste et les
 *     `sharedTeardown` en ordre inverse. **VRAI**, conservé, épinglé par
 *     `__tests__/config/s15-modules-storage-init.test.js` ;
 *   - **la POSITION** — « l'ordre entre les deux porte ». **RÉFUTÉ**, ici.
 *
 * ## Pourquoi PAS dans `manifest-shuffle.test.ts`
 *
 * Ce fichier-là ne fait tourner que `registerPresetDeclarations` / `registerPresetModules` : il
 * **n'appelle jamais `SharedModule`**. `pwa` et `offline` n'ont ni `createModule` ni `mobileIcon`,
 * donc les y permuter ne change rien d'observable *par construction* — une assertion posée là
 * serait verte quoi qu'il arrive, y compris sous la mutation M-A1 ci-dessous. Une garde
 * décorative, exactement ce que le Sprint 1 a payé deux fois.
 *
 * ## La comparaison porte sur le CONTENU des effets, pas sur leur ordre
 *
 * ⚠️ `[...effects].sort()`, délibérément. L'ordre des effets DIFFÈRE forcément entre les deux runs
 * — c'est trivial et sans conséquence, puisque aucun des deux n'attend l'autre. Ce qui doit être
 * identique est **ce qui a été fait**, pas dans quel ordre. Sans cette phrase, le prochain lecteur
 * croira la garde plus faible qu'elle n'est.
 *
 * ## Preuve par mutation — vue le 08/08/2026
 *
 *   M-A1  `offline` refuse de tourner si `pwa` n'a pas posé un drapeau (le couplage que la doc
 *         affirmait, écrit à la main)                                  → 🔴 **SLO-01 et SLO-08**
 *   M-A2  le run B n'est plus inversé                                   → 🔴 SLO-CTRL-1
 *   M-A3  retirer le stub `requestIdleCallback`                         → 🔴 SLO-CTRL-2
 *   M-A4  retirer `&& cfg.pwaEnabled === true` d'`offline/lifecycle.ts` → 🔴 SLO-05
 *   M-A5  `SharedModule.destroy()` itère en AVANT                       → 🟢 **SLO-06 reste vert**,
 *         et `s15-modules-storage-init.test.js` rougit. C'est la mutation la plus instructive du
 *         lot : elle sépare « le mécanisme d'ordre inverse existe » — vrai, gardé ailleurs — de
 *         « cet ordre porte une conséquence » — faux, et c'est ce que 7.4 réfute.
 *
 * ⚠️ M-A1 rougit **SLO-01 et SLO-08, pas les quatre cellules**, et c'est correct : sur les trois
 * autres, `offline` ne produit de toute façon aucun effet (son gate le bloque, ou il est
 * désactivé), donc les deux ordres restent identiques. Seule la cellule où le moteur démarre
 * vraiment peut voir un couplage. Une garde qui rougirait sur les quatre serait suspecte, pas
 * meilleure.
 *
 * ⚠️ Défaut de HARNAIS trouvé en écrivant ce fichier, consigné parce qu'il aurait fait conclure
 * l'inverse de la mesure : `run()` rend des **copies** de ses tableaux. Les stubs de `navigator.*`
 * survivent au retour, et le `reset()` qui sépare les deux runs rappelle `PwaLifecycle._reset()`
 * → `_unregisterAll()` → `getRegistrations()`. Sans la copie, cet appel s'écrivait dans les
 * effets du run **déjà terminé** et la cellule `pwa:off offline:off` comparait 2 contre 1.
 *
 * @see packages/core/src/presets/manifest.full.ts — l'en-tête requalifié
 * @see docs/specs/capacites/pwa.md — §Décisions, la ligne « Position libre »
 * @see roadmap_socle-init.md 📦 (archivée le 09/08/2026) §Sprint 7, tâche 7.4
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { shuffled } from "./_helpers/shuffle.ts";

// ⚠️ `vi.hoisted`, et pas un simple `let` : `offline/install.ts` importe `api/geoleaf.sync.ts`,
// qui s'AUTO-MONTE sur le namespace à l'import (pour qu'un plugin de données puisse enregistrer
// son gestionnaire de synchronisation avant la fin du boot). `ensureGeoLeaf()` est donc appelé
// pendant la résolution des imports ci-dessous — avant qu'un `let` de ce fichier soit initialisé.
const H = vi.hoisted(() => ({ GL: {} as Record<string, unknown> }));

vi.mock("../../src/utils/general/geoleaf-global.js", () => ({
    ensureGeoLeaf: () => H.GL,
    getGeoLeaf: () => H.GL,
}));
vi.mock("../../src/utils/i18n/i18n.js", () => ({
    initI18n: vi.fn(),
    getLabel: (k: string) => k,
    getActiveLang: () => "fr",
}));

const { SharedModule } = await import("../../src/app/boot-modules/shared.module.ts");
const { CapabilityRegistry } = await import("../../src/kernel/api/capability-registry.ts");
const { PWA_INSTALLER } = await import("../../src/capabilities/pwa/install.ts");
const { OFFLINE_INSTALLER } = await import("../../src/capabilities/offline/install.ts");
const { FULL } = await import("../../src/presets/manifest.full.ts");
const { SWRegister } = await import("../../src/kernel/storage/index.ts");
const { OfflineLifecycle } = await import("../../src/capabilities/offline/lifecycle.ts");
const { PwaLifecycle } = await import("../../src/capabilities/pwa/lifecycle.ts");

/** Un run : la séquence des lifecycles appelés, et les effets observés. */
interface Run {
    sequence: string[];
    effects: string[];
}

/**
 * Exécute `SharedModule.init()` sur une liste d'installers et collecte ce qui en sort.
 *
 * Trois pièges sont désarmés ici, et chacun rendrait la comparaison AVEUGLE s'il ne l'était pas —
 * c'est-à-dire verte pour une raison qui n'a rien à voir avec ce qu'on mesure. Voir SLO-CTRL-*.
 */
async function run(installers: readonly unknown[], cfg: Record<string, unknown>): Promise<Run> {
    const sequence: string[] = [];
    const effects: string[] = [];
    const note = (s: string) => effects.push(s);

    // ── Piège 2 — `navigator.storage` et `navigator.serviceWorker` sont ABSENTS sous happy-dom.
    // Sans stub, `_requestPersistentStorage()` et `_unregisterAll()` sortent en no-op et les
    // cellules « pwa off » ne compareraient rien du tout.
    Object.defineProperty(navigator, "storage", {
        configurable: true,
        value: {
            persist: vi.fn(async () => {
                note("navigator.storage.persist()");
                return true;
            }),
        },
    });
    Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: {
            getRegistrations: vi.fn(async () => {
                note("navigator.serviceWorker.getRegistrations()");
                return [];
            }),
        },
    });

    vi.spyOn(SWRegister, "register").mockImplementation(async (opts: unknown) => {
        note(`SWRegister.register(${JSON.stringify(opts)})`);
        return undefined as never;
    });
    vi.spyOn(CapabilityRegistry, "ensureLoaded").mockImplementation(async (id: string) => {
        note(`CapabilityRegistry.ensureLoaded(${JSON.stringify(id)})`);
        return undefined as never;
    });

    const Storage = {
        init: vi.fn((c: unknown) => {
            note(`Storage.init(${JSON.stringify(c)})`);
            return Promise.resolve();
        }),
    };
    const _OfflineDetector = {
        init: vi.fn(() => note("_OfflineDetector.init()")),
    };

    H.GL = {
        _app: { checkPlugins: vi.fn(), AppLog: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } },
        Storage,
        _OfflineDetector,
    };

    // Enveloppe : trace QUI a tourné, sans changer ce que fait l'installer.
    const traced = installers.map((inst) => {
        const i = inst as { declaration?: { id?: string }; sharedLifecycle?: (c: unknown) => void };
        return {
            ...i,
            sharedLifecycle: (ctx: unknown) => {
                sequence.push(i.declaration?.id ?? "?");
                i.sharedLifecycle?.(ctx);
            },
        };
    });

    new SharedModule(traced as never).init(null as never, cfg as never);

    // ── Piège 3 — la chaîne d'offline est asynchrone : `Storage.init` vit dans le `.then()` de
    // `ensureLoaded`. Drainer avant de figer `effects`, sinon la cellule on/on ne verrait rien.
    await new Promise((r) => setTimeout(r, 20));

    // ⚠️ COPIES, pas les tableaux vivants. Les stubs de `navigator.*` posés ci-dessus restent en
    // place après le retour, et le `reset()` qui sépare les deux runs rappelle
    // `PwaLifecycle._reset()` → `_unregisterAll()` → `getRegistrations()`. Sans la copie, cet
    // appel-là allait s'écrire dans les effets du run DÉJÀ TERMINÉ, et la comparaison voyait
    // 2 contre 1 sur une cellule où les deux ordres font pourtant la même chose. Défaut du
    // harnais, pas du sujet — mais il aurait fait conclure l'inverse de la mesure.
    return { sequence: [...sequence], effects: [...effects] };
}

/** Les deux ordres à comparer, sur une même configuration. */
async function bothOrders(cfg: Record<string, unknown>) {
    const nominal = await run([PWA_INSTALLER, OFFLINE_INSTALLER], cfg);
    reset();
    const inverse = await run([OFFLINE_INSTALLER, PWA_INSTALLER], cfg);
    return { nominal, inverse };
}

function reset() {
    OfflineLifecycle._reset();
    PwaLifecycle._reset();
    CapabilityRegistry._reset();
}

/** Les quatre cellules `{pwa on|off} × {offline on|off}`. */
const CELLS = [
    { name: "pwa:on offline:on", pwa: true, offline: true },
    { name: "pwa:on offline:off", pwa: true, offline: false },
    { name: "pwa:off offline:on", pwa: false, offline: true },
    { name: "pwa:off offline:off", pwa: false, offline: false },
] as const;

const cfgFor = (c: (typeof CELLS)[number]) => ({
    map: {},
    modules: {
        pwa: { enabled: c.pwa, installPrompt: { enabled: false } },
        offline: { enabled: c.offline },
    },
});

describe("SLO — la position de pwa/offline au manifeste ne décide de rien (7.4)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // ── Piège 1 — happy-dom n'expose PAS `requestIdleCallback`, donc `Helpers.lazyExecute`
        // retombe sur `setTimeout(cb, 3000)` et l'enregistrement du SW n'a lieu dans AUCUN des
        // deux ordres. La comparaison serait alors aveugle sur l'axe qui compte le plus. Le stub
        // synchrone met l'effet DANS le tick, donc dans le champ de la mesure. SLO-CTRL-2 est ce
        // qui empêche ce piège de se refermer en silence.
        (window as unknown as Record<string, unknown>).requestIdleCallback = (cb: () => void) => {
            cb();
            return 0;
        };
        reset();
    });

    afterEach(() => {
        delete (window as unknown as Record<string, unknown>).requestIdleCallback;
        vi.restoreAllMocks();
        reset();
    });

    it("SLO-CTRL-1 — l'inversion a VRAIMENT eu lieu", async () => {
        // Sans elle, SLO-01..04 seraient vrais par vacuité : deux runs identiques comparés
        // l'un à l'autre passent toujours.
        const { nominal, inverse } = await bothOrders(cfgFor(CELLS[0]));
        expect(nominal.sequence).toEqual(["pwa", "offline"]);
        expect(inverse.sequence).toEqual(["offline", "pwa"]);
    });

    it("SLO-CTRL-2 — l'enregistrement du SW est bien OBSERVÉ quand pwa est actif", async () => {
        // Désarme le piège `lazyExecute`. Si cette règle rougit, SLO-01..04 ne mesurent plus
        // l'axe service-worker et leur vert ne vaut rien.
        const { nominal, inverse } = await bothOrders(cfgFor(CELLS[0]));
        for (const r of [nominal, inverse]) {
            expect(r.effects.some((e) => e.startsWith("SWRegister.register("))).toBe(true);
        }
    });

    it("SLO-CTRL-3 — le drain asynchrone a bien eu lieu", async () => {
        // Sans le drain, `Storage.init` n'est jamais observé et la cellule on/on comparerait
        // deux ensembles également tronqués.
        const { nominal } = await bothOrders(cfgFor(CELLS[0]));
        expect(nominal.effects.some((e) => e.startsWith("Storage.init("))).toBe(true);
    });

    for (const cell of CELLS) {
        it(`SLO-0${CELLS.indexOf(cell) + 1} — effets identiques sous les deux ordres (${cell.name})`, async () => {
            const { nominal, inverse } = await bothOrders(cfgFor(cell));
            expect(
                [...inverse.effects].sort(),
                `Cellule ${cell.name} : inverser pwa et offline au manifeste a changé ce que le ` +
                    `boot FAIT. Si ce test rougit, la contrainte d'ordre que socle-init 7.4 a ` +
                    `réfutée le 08/08/2026 est réapparue — et il faut la DÉCLARER, pas la subir.`
            ).toEqual([...nominal.effects].sort());
        });
    }

    it("SLO-05 — le GATE tient : pwa désactivé ⟹ aucun moteur hors-ligne, dans LES DEUX ordres", async () => {
        // La moitié VRAIE de l'énoncé historique, et elle n'est gardée que là. `offline` lit
        // `modules.pwa.enabled` du sac fusionné : c'est une condition, pas une position.
        const { nominal, inverse } = await bothOrders(cfgFor(CELLS[2]));
        for (const r of [nominal, inverse]) {
            expect(r.effects.some((e) => e.includes("ensureLoaded"))).toBe(false);
            expect(r.effects.some((e) => e.startsWith("Storage.init("))).toBe(false);
        }
    });

    it("SLO-06 — le démontage aussi est invariant sous les deux ordres", async () => {
        const teardown = async (installers: readonly unknown[]) => {
            const seen: string[] = [];
            const traced = installers.map((inst) => {
                const i = inst as { declaration?: { id?: string }; sharedTeardown?: () => void };
                return {
                    ...i,
                    sharedTeardown: () => {
                        seen.push(i.declaration?.id ?? "?");
                        i.sharedTeardown?.();
                    },
                };
            });
            H.GL = { _app: { checkPlugins: vi.fn() } };
            new SharedModule(traced as never).destroy();
            return seen;
        };
        // Le MÉCANISME (ordre inverse) est bien là — c'est `s15-modules-storage-init.test.js`
        // qui l'épingle. Ce qui est asserté ICI est que son inversion n'a aucune conséquence.
        expect((await teardown([PWA_INSTALLER, OFFLINE_INSTALLER])).sort()).toEqual(
            (await teardown([OFFLINE_INSTALLER, PWA_INSTALLER])).sort()
        );
    });

    it("SLO-08 — invariance généralisée à TOUS les contributeurs de sharedLifecycle", async () => {
        const contributors = FULL.capabilities.filter(
            (i: { sharedLifecycle?: unknown }) => typeof i.sharedLifecycle === "function"
        );
        // Anti-gate-vide : avec moins de deux contributeurs il n'y a rien à permuter, et cette
        // règle sortirait verte en ne gardant plus rien.
        expect(
            contributors.length,
            "moins de deux capacités contribuent un `sharedLifecycle` — SLO-08 n'a plus de sujet"
        ).toBeGreaterThanOrEqual(2);

        const cfg = cfgFor(CELLS[0]);
        const base = await run(contributors, cfg);
        reset();
        for (const seed of [1, 7, 42]) {
            const permuted = await run(shuffled(contributors, seed), cfg);
            reset();
            expect(
                [...permuted.effects].sort(),
                `Graine ${seed} : permuter les contributeurs de \`sharedLifecycle\` a changé ce ` +
                    `que le boot fait. Un couplage d'ORDRE est réapparu entre capacités app-globales.`
            ).toEqual([...base.effects].sort());
        }
    });
});
