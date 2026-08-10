/**
 * GATE — socle-init 9.2 : un profil doit pouvoir ALLUMER une capacité.
 *
 * ## Le défaut, tel qu'il se mesure
 *
 * `bootWithPreset()` évalue la Pass 2 (`registerPresetModules`) sur `toCapConfig(baseCfg)`,
 * c'est-à-dire la config **AVANT** que `loadActiveProfileResources()` ait rendu celle du
 * profil (`boot-core.ts` — Pass 2 puis, plus bas, `effectiveCfg`). Un profil qui écrit
 * `modules.branding.enabled: true` arrive donc trop tard : au moment où le gate est lu, la
 * clé est absente, `enableWhenAbsent` vaut `false`, et le module n'est jamais créé.
 *
 * La conséquence est celle qui compte pour un intégrateur : **le profil est la surface de
 * configuration documentée du produit, et elle ne peut pas allumer ce qu'elle décrit.**
 *
 * ## Pourquoi `branding` et pas une autre
 *
 * Ce n'est pas un exemple choisi pour la démonstration, c'est le seul sujet possible — relevé
 * au pré-vol 9.0 du 07/08/2026 sur les 20 gates du dépôt :
 *
 *   - 17 capacités sont **opt-out** (`enableWhenAbsent: true`) : absente ⟹ allumée. Le défaut
 *     ne les empêche pas de s'allumer, il les empêche de s'ÉTEINDRE depuis un profil.
 *   - 3 sont **opt-in** : `branding`, `offline`, `pwa`.
 *   - `offline` et `pwa` n'ont **pas** de `createModule` — leur TSDoc le dit en toutes lettres.
 *     Elles sont app-global et gatent déjà **post-merge**, dans `SharedModule.init()`.
 *
 * Il reste `branding` : la seule capacité opt-in qui possède un `ICoreModule`, donc le seul
 * endroit du dépôt où « le profil allume » est aujourd'hui sans effet.
 *
 * ## Ce que ce fichier N'AUTORISE PAS
 *
 * ⛔ Il ne demande pas de déplacer la Pass 2 sous `loadActiveProfileResources()`. Le TSDoc de
 * `app/boot-core.ts` porte l'interdiction, et il précise qu'un sprint antérieur a dû reverter
 * cette zone. Le geste de 9.2 est de **retirer une condition** — enregistrer le module dans
 * tous les cas, et laisser un enrobage décider dans son `init()`, qui lui tourne post-merge.
 *
 * @see roadmap_socle-init.md 📦 (archivée le 09/08/2026) § Sprint 9
 * @see packages/core/src/app/boot-core.ts — l'ordre des passes, et pourquoi il ne bouge pas
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { ICapabilityConfigGate } from "../../src/contracts/capability.contract.js";
import type { ICoreModule } from "../../src/contracts/core-module.contract.js";
import type { PresetManifest } from "../../src/contracts/preset.contract.js";

const { bootWithPreset } = await import("../../src/app/boot-core.ts");
const { CapabilityRegistry } = await import("../../src/kernel/api/capability-registry.ts");

/**
 * Un installer instrumenté.
 *
 * ⚠️ `initCalls` ne fait pas partie du contrat `ICapabilityInstaller` — c'est le seul canal
 * d'observation de ce fichier, et il est déclaré plutôt qu'attaché à la volée pour que sa
 * disparition soit une erreur de type et non un test silencieusement vide.
 */
interface InstrumentedInstaller {
    declaration: { id: string; gate?: ICapabilityConfigGate };
    registerGlobals: ReturnType<typeof vi.fn>;
    createModule: ReturnType<typeof vi.fn>;
    /** Les configs reçues par chaque `init()` — vide = le module n'a pas tourné. */
    initCalls: unknown[];
}

/** Le registre de substitution, avec ses ids exposés pour l'assertion. */
interface StandInRegistry {
    modules: ICoreModule[];
    register: ReturnType<typeof vi.fn>;
    isInitialized: ReturnType<typeof vi.fn>;
    init: ReturnType<typeof vi.fn>;
    getAll: ReturnType<typeof vi.fn>;
    ids(): string[];
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

/**
 * Un installer minimal, dont le module ENREGISTRE l'appel de son `init()`.
 *
 * `boot-core.test.js` porte le même fixture en plus court ; ici le module doit être
 * observable jusque dans son cycle de vie, parce que la question posée n'est pas seulement
 * « a-t-il été enregistré » mais « a-t-il tourné, et sur quelle config ».
 *
 * @param id Identifiant de capacité.
 * @param gate Gate de déclaration. Omis ⟹ capacité non gatée (toujours active).
 */
function makeInstaller(id: string, gate?: ICapabilityConfigGate): InstrumentedInstaller {
    const initCalls: unknown[] = [];
    return {
        declaration: gate ? { id, gate } : { id },
        registerGlobals: vi.fn(),
        initCalls,
        createModule: vi.fn(() => ({
            id,
            dependencies: [],
            init: vi.fn((_adapter: unknown, cfg: unknown) => {
                initCalls.push(cfg);
            }),
        })),
    };
}

/**
 * Un ModuleRegistry de substitution qui INITIALISE réellement ses modules.
 *
 * Le stand-in de `boot-core.test.js` stube `init()` ; il ne pourrait donc pas distinguer
 * « module enregistré » de « module qui a tourné ». Ici les deux doivent être séparables :
 * l'enrobage de 9.2 enregistre TOUJOURS, et c'est `init()` qui tranche.
 */
function makeRegistry(): StandInRegistry {
    const modules: ICoreModule[] = [];
    return {
        modules,
        register: vi.fn((m: ICoreModule) => modules.push(m)),
        isInitialized: vi.fn(() => false),
        init: vi.fn(async (adapter: unknown, cfg: unknown) => {
            for (const m of modules) {
                await (m.init as ((a: unknown, c: unknown) => unknown) | undefined)?.(adapter, cfg);
            }
        }),
        getAll: vi.fn(() => modules),
        /** Les ids enregistrés, dans l'ordre. */
        ids: () => modules.map((m) => m.id),
    };
}

/**
 * Assemble un BootContext séparant explicitement les deux configs.
 *
 * @param cfg Ce que rend `GeoLeaf.loadConfig` — la config **pré-merge** (`baseCfg`).
 * @param profileCfg Ce que rend `Config.loadActiveProfileResources` — le **post-merge**.
 */
function makeCtx(cfg: Record<string, unknown>, profileCfg: Record<string, unknown> | null) {
    const AppLog = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const GeoLeaf = {
        loadConfig: (opts: { onLoaded: (c: unknown) => void }) =>
            setTimeout(() => opts.onLoaded(cfg), 0),
        Config: {
            loadActiveProfileResources: vi.fn(() => Promise.resolve(profileCfg ?? null)),
        },
    };
    const registry = makeRegistry();
    const app = { AppLog, getProfilesBasePath: () => "../profiles/", _appStarted: false };
    return { GeoLeaf, app, registry, AppLog };
}

const preset = (...capabilities: InstrumentedInstaller[]) =>
    ({ id: "gate-post-merge", capabilities }) as unknown as PresetManifest;

/** Le gate réel de `branding` : opt-in, `enableWhenAbsent` omis ⟹ absent = éteint. */
const BRANDING_GATE: ICapabilityConfigGate = { configPath: "modules.branding.enabled" };

beforeEach(() => {
    // Singleton de module : les déclarations fuiraient d'un test à l'autre.
    CapabilityRegistry._reset();
    sessionStorage.clear();
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Le gate ───────────────────────────────────────────────────────────────────

describe("GATE 9.2 — le profil décide, et il décide APRÈS la Pass 2", () => {
    it("allume une capacité opt-in que SEUL le profil active", async () => {
        const branding = makeInstaller("branding", BRANDING_GATE);
        // Pré-merge : rien. Post-merge : le profil l'allume. C'est tout le sujet.
        const ctx = makeCtx({}, { modules: { branding: { enabled: true } } });

        await bootWithPreset(preset(branding), ctx);

        expect(ctx.registry.ids()).toContain("branding");
        expect(branding.initCalls).toHaveLength(1);
        // Et il a bien reçu la config du PROFIL, pas la pré-merge vide — sans quoi le module
        // existerait en lisant encore un état antérieur à ce qui l'a allumé.
        expect(branding.initCalls[0]).toMatchObject({
            modules: { branding: { enabled: true } },
        });
    });

    it("laisse éteint ce qu'aucune des deux configs n'allume", async () => {
        const branding = makeInstaller("branding", BRANDING_GATE);
        const ctx = makeCtx({}, { modules: {} });

        await bootWithPreset(preset(branding), ctx);

        expect(branding.initCalls).toHaveLength(0);
    });

    it("laisse le pré-merge allumer, quand c'est lui qui porte la clé", async () => {
        // Contre-épreuve : le correctif ne doit pas se contenter de déplacer l'aveuglement.
        // Une clé présente AVANT le profil reste valable si le profil ne la contredit pas.
        const branding = makeInstaller("branding", BRANDING_GATE);
        const ctx = makeCtx({ modules: { branding: { enabled: true } } }, null);

        await bootWithPreset(preset(branding), ctx);

        expect(branding.initCalls).toHaveLength(1);
    });
});

// ── Caractérisation : le sens INVERSE ─────────────────────────────────────────
//
// ⚠️ Ce bloc n'est pas une demande, c'est un relevé. Le correctif 9.2 évalue le gate sur la
// config fusionnée, donc il agit aussi dans l'autre sens : un profil qui écrit `false` sur une
// capacité opt-out cesserait d'être ignoré. C'est cohérent avec la sémantique déclarée du gate
// (`value false → disabled`), et c'est un CHANGEMENT DE COMPORTEMENT réel.
//
// Il est écrit ici pour qu'il soit visible et daté, plutôt que découvert plus tard comme une
// régression. `boot-core.ts` met en garde contre la migration de la Pass 2 pour cette raison
// précise — mais sa mise en garde porte sur le fait de DÉ-ENREGISTRER un module gaté tard,
// pas sur le fait de ne pas l'initialiser.

describe("caractérisation — un profil qui ÉTEINT une capacité opt-out", () => {
    it("relève le comportement courant, quel qu'il soit", async () => {
        const legend = makeInstaller("legend", {
            configPath: "modules.legend.enabled",
            enableWhenAbsent: true,
        });
        const ctx = makeCtx({}, { modules: { legend: { enabled: false } } });

        await bootWithPreset(preset(legend), ctx);

        // Avant 9.2 : le module est enregistré ET initialisé — le `false` du profil arrive
        // après la Pass 2, donc il n'est jamais lu par le gate.
        // Après 9.2 : l'enrobage relit le gate post-merge et n'initialise pas.
        expect(ctx.registry.ids()).toContain("legend");
        expect(legend.initCalls.length).toBe(0);
    });
});
