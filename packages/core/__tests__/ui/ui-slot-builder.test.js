/**
 * @tests built-in/ui/ui-slot-builder — profileKey + requiresPlugin visibility guards
 *
 * Extracted in KERNEL S8 from two identical blocks (desktop-panel-slots +
 * mobile-toolbar-pill). The callers' tests only ever exercised slot defs WITHOUT
 * `profileKey`/`requiresPlugin`, so both guard bodies were dead to coverage —
 * visible only once extracted (28 % file). These tests drive both guards directly.
 */
import { resolveUISlotVisibility } from "../../src/kernel/ui/ui-slot-builder.js";

const BOTH = { checkRequiresPlugin: true, useDefaultVisible: true };

/** Installs a minimal `GeoLeaf` global with the Config / plugins surfaces read by the guards. */
function stubGeoLeaf({ configGet, isLoaded, isLazyAvailable } = {}) {
    globalThis.GeoLeaf = {
        Config: configGet ? { get: configGet } : undefined,
        plugins: { isLoaded, isLazyAvailable },
    };
}

describe("resolveUISlotVisibility", () => {
    afterEach(() => {
        delete globalThis.GeoLeaf;
    });

    it("shows a slot that declares neither guard", () => {
        stubGeoLeaf();
        expect(resolveUISlotVisibility({}, BOTH)).toBe(true);
    });

    describe("guard 1 — profileKey", () => {
        it("hides the slot when the profile says false", () => {
            stubGeoLeaf({ configGet: () => false });
            expect(resolveUISlotVisibility({ profileKey: "modules.legend.enabled" }, BOTH)).toBe(
                false
            );
        });

        it("shows the slot when the profile says true", () => {
            stubGeoLeaf({ configGet: () => true });
            expect(resolveUISlotVisibility({ profileKey: "modules.legend.enabled" }, BOTH)).toBe(
                true
            );
        });

        it("only `false` hides — a missing key resolves to the fallback", () => {
            const get = vi.fn((_key, fallback) => fallback);
            stubGeoLeaf({ configGet: get });
            expect(resolveUISlotVisibility({ profileKey: "absent" }, BOTH)).toBe(true);
        });

        // 🛑 THESE TWO TESTS LOCKED THE CALL'S SHAPE, NOT THE BEHAVIOUR — and
        // that is what made them turn red on a change that breaks nothing.
        // They asserted `get("k", <fallback>)`, yet the key is now queried
        // WITHOUT a default (sentinel `undefined`) to tell "absent" from
        // "declared false" — the only way to know whether to consult
        // `legacyProfileKey`. The fallback is applied AFTER, and the
        // observable result is identical. Rewritten to exercise what
        // matters: the VALUE returned. Same class as
        // `polling-source.test.ts`'s lock test, loosened on 17/08.
        it("applique defaultVisible quand la clé est ABSENTE et useDefaultVisible est posé", () => {
            const get = vi.fn(() => undefined); // key not declared in the profile
            stubGeoLeaf({ configGet: get });
            const def = { profileKey: "k", defaultVisible: false };
            expect(resolveUISlotVisibility(def, BOTH)).toBe(false);
            expect(get).toHaveBeenCalled();
        });

        it("ignore defaultVisible pour les slots paresseux (useDefaultVisible false → visible)", () => {
            const get = vi.fn(() => undefined);
            stubGeoLeaf({ configGet: get });
            const def = { profileKey: "k", defaultVisible: false };
            const opts = { checkRequiresPlugin: false, useDefaultVisible: false };
            expect(resolveUISlotVisibility(def, opts)).toBe(true);
        });

        // ── The `legacyProfileKey` fallback (INV-CONFIG / PC-14) ──────────────────────────
        it("REPLI — lit la clé héritée quand la canonique est absente", () => {
            const get = vi.fn((key) => (key === "ui.vieux" ? false : undefined));
            stubGeoLeaf({ configGet: get });
            const def = { profileKey: "modules.x.showButton", legacyProfileKey: "ui.vieux" };
            expect(
                resolveUISlotVisibility(def, BOTH),
                "un profil non migré doit continuer de masquer le bouton"
            ).toBe(false);
        });

        it("REPLI — la clé CANONIQUE fait foi dès qu'elle est présente, même à `true`", () => {
            // 🛑 The case that matters: BOTH keys are declared and
            // contradict each other. Without the priority, a migrated
            // profile would stay governed by a value it believes replaced —
            // the fallback would become a trap instead of a transition.
            const get = vi.fn((key) => (key === "modules.x.showButton" ? true : false));
            stubGeoLeaf({ configGet: get });
            const def = { profileKey: "modules.x.showButton", legacyProfileKey: "ui.vieux" };
            expect(resolveUISlotVisibility(def, BOTH)).toBe(true);
        });

        it("REPLI — n'est pas consulté quand aucune clé héritée n'est déclarée", () => {
            const get = vi.fn(() => undefined);
            stubGeoLeaf({ configGet: get });
            expect(resolveUISlotVisibility({ profileKey: "modules.x.showButton" }, BOTH)).toBe(
                true
            );
            expect(get).toHaveBeenCalledTimes(1);
        });

        it("shows the slot when Config is absent entirely", () => {
            stubGeoLeaf();
            expect(resolveUISlotVisibility({ profileKey: "k" }, BOTH)).toBe(true);
        });
    });

    describe("guard 2 — requiresPlugin", () => {
        it("shows the slot when the plugin is loaded", () => {
            stubGeoLeaf({ isLoaded: () => true, isLazyAvailable: () => false });
            expect(resolveUISlotVisibility({ requiresPlugin: "print" }, BOTH)).toBe(true);
        });

        it("shows the slot when the plugin is lazy-available but not yet loaded", () => {
            stubGeoLeaf({ isLoaded: () => false, isLazyAvailable: () => true });
            expect(resolveUISlotVisibility({ requiresPlugin: "print" }, BOTH)).toBe(true);
        });

        it("hides the slot when the plugin is neither loaded nor lazy-available", () => {
            stubGeoLeaf({ isLoaded: () => false, isLazyAvailable: () => false });
            expect(resolveUISlotVisibility({ requiresPlugin: "print" }, BOTH)).toBe(false);
        });

        it("skips the guard for lazy slots — they ARE the plugin", () => {
            stubGeoLeaf({ isLoaded: () => false, isLazyAvailable: () => false });
            const opts = { checkRequiresPlugin: false, useDefaultVisible: false };
            expect(resolveUISlotVisibility({ requiresPlugin: "print" }, opts)).toBe(true);
        });
    });

    // ── guard 3 — moduleGateId ────────────────────────────────────────────────
    //
    // 🛑 WHAT THIS GUARD REPAIRS, AND WHY IT LIVES HERE AND NOT IN `init.js`.
    // Each plugin's `entry.ts` wraps its registration in
    // `if (getXConfig().enabled !== false)`: a disabled module thus has no
    // button for the integrator who loads the bundle themselves. The LAZY
    // slot, though, is declared by `apps/geoleaf-app/init.js` BEFORE the
    // profile is loaded — it CANNOT read `enabled` when declaring itself.
    // The same flag thus returned two opposite verdicts depending on the
    // path (measured on 20/08/2026: 0 buttons eager, 1 button VISIBLE
    // lazy). The guard is set at RENDER, the only moment the merged
    // configuration exists.
    describe("guard 3 — moduleGateId (aligne le chemin paresseux sur entry.ts)", () => {
        const LAZY = { checkRequiresPlugin: false, useDefaultVisible: false };

        /** Config that only knows the keys given to it — the others return undefined. */
        const configDe = (table) =>
            vi.fn((key, fallback) => (key in table ? table[key] : fallback));

        it("masque le créneau quand le module est explicitement désactivé", () => {
            stubGeoLeaf({ configGet: configDe({ "modules.print.enabled": false }) });
            expect(resolveUISlotVisibility({}, { ...LAZY, moduleGateId: "print" })).toBe(false);
        });

        it("montre le créneau quand le module est explicitement activé", () => {
            stubGeoLeaf({ configGet: configDe({ "modules.print.enabled": true }) });
            expect(resolveUISlotVisibility({}, { ...LAZY, moduleGateId: "print" })).toBe(true);
        });

        // 🛑 THE TEST THAT MATTERS MOST, and the one an `=== true` would turn
        // red: the guard is an OPT-OUT. `profiles/tourism` declares NEITHER
        // `print`, NOR `measure`, NOR `editor` — their three buttons are
        // legitimate and must stay so. Only an EXPLICIT deactivation removes
        // the button. The exact semantics of `entry.ts`'s `!== false`.
        it("montre le créneau quand le profil ne déclare PAS le module (opt-out)", () => {
            const get = configDe({});
            stubGeoLeaf({ configGet: get });
            expect(resolveUISlotVisibility({}, { ...LAZY, moduleGateId: "print" })).toBe(true);
            expect(get).toHaveBeenCalledWith("modules.print.enabled", undefined);
        });

        it("interroge la clé du plugin PORTEUR, pas celle de l'action", () => {
            // `poi-add` and `editor-export-session` belong to the `editor`
            // plugin: its flag governs them, exactly as in its `entry.ts`,
            // where the three registrations nest in the same `if`.
            const get = configDe({ "modules.editor.enabled": false });
            stubGeoLeaf({ configGet: get });
            expect(resolveUISlotVisibility({}, { ...LAZY, moduleGateId: "editor" })).toBe(false);
        });

        // ⚠️ The REGISTRY path does not go through this guard, deliberately:
        // `entry.ts` already filtered there at registration, and in-core
        // capabilities have their own grid (`presets/apply-preset.ts`).
        // Doubling it would mask twice instead of once.
        it("ne s'applique pas quand moduleGateId est absent — le chemin du registre", () => {
            const get = configDe({ "modules.print.enabled": false });
            stubGeoLeaf({ configGet: get });
            expect(
                resolveUISlotVisibility({}, { checkRequiresPlugin: true, useDefaultVisible: true })
            ).toBe(true);
            expect(get).not.toHaveBeenCalled();
        });

        it("reste silencieuse quand Config est absent entièrement", () => {
            stubGeoLeaf();
            expect(resolveUISlotVisibility({}, { ...LAZY, moduleGateId: "print" })).toBe(true);
        });
    });

    it("applies profileKey before requiresPlugin — a hidden slot never probes the registry", () => {
        const isLoaded = vi.fn(() => true);
        stubGeoLeaf({ configGet: () => false, isLoaded, isLazyAvailable: () => true });
        expect(resolveUISlotVisibility({ profileKey: "k", requiresPlugin: "print" }, BOTH)).toBe(
            false
        );
        expect(isLoaded).not.toHaveBeenCalled();
    });
});
